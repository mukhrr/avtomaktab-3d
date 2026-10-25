import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Vec2 } from '../shared/district';
import { DRIVE_SURFACE_Y } from '../physics/world';
import { BodyLean } from './bodyLean';
import { createCarModel, WHEEL_POSITIONS } from './carModel';
import { stepDrivetrain, IDLE_RPM, WHEEL_RADIUS, type Controls, type DrivetrainState, type Gearbox } from './drivetrain';

const MASS = 1150;
const HALF_EXTENTS = { x: 0.87, y: 0.31, z: 2.24 };
const SPAWN_HEIGHT = 0.75;
const REST_LENGTH = 0.3;
const MAX_STEER = 0.6;
const STEER_FALLOFF_SPEED = 12;
// Newtons per wheel; Rapier's setWheelBrake takes an impulse per step, so these are multiplied by dt.
const BRAKE_FORCE = 2500;
const HANDBRAKE_FORCE = 3500;
/** Engine braking when off the throttle, total across the wheels. */
const COAST_FORCE = 250;
// 0.5 * air density 1.2 * Cd 0.33 * frontal area 2.2 m^2.
const AERO_DRAG = 0.436;
const ROLLING_RESISTANCE = 0.012 * MASS * 9.81;
const FRONT = [0, 1];
const REAR = [2, 3];

const WHEEL_FRICTION = 2.2;
const leanAccel = new THREE.Vector3();
const leanRot = new THREE.Quaternion();

const HARD_BRAKE = 0.8;
const HARD_BRAKE_MIN_SPEED = 5;

interface SlipSource {
  numWheels(): number;
  wheelSideImpulse(i: number): number | null;
  wheelForwardImpulse(i: number): number | null;
  wheelSuspensionForce(i: number): number | null;
}

/**
 * Worst wheel as a 0 to 1 share of the grip it has: the combined side and forward impulse Rapier applied against friction slip times
 * suspension force times dt. The forward impulse only counts when `braking`, as it also carries the engine's drive.
 */
export function wheelSlip(c: SlipSource, frictionSlip: number, dt: number, braking: boolean): number {
  let worst = 0;
  for (let i = 0; i < c.numWheels(); i++) {
    const grip = frictionSlip * (c.wheelSuspensionForce(i) ?? 0) * dt;
    if (!(grip > 0)) continue;
    const side = Math.abs(c.wheelSideImpulse(i) ?? 0);
    const forward = braking ? Math.abs(c.wheelForwardImpulse(i) ?? 0) : 0;
    const ratio = Math.hypot(side, forward) / grip;
    if (ratio > worst) worst = ratio;
  }
  return Math.min(1, worst);
}

export interface Spawn { position: Vec2; heading: number }

export class Vehicle {
  readonly object: THREE.Group;
  readonly collider: RAPIER.Collider;
  private body: RAPIER.RigidBody;
  private controller: RAPIER.DynamicRayCastVehicleController;
  private wheels: THREE.Object3D[];
  private pivot: THREE.Group;
  private bodyLean = new BodyLean();
  private tilt = { pitch: 0, roll: 0 };
  private lastVel = new THREE.Vector3();
  private state: DrivetrainState;
  private slipNow = 0;

  /** `body` is the preloaded glb scene from loadCarBody; null builds the body in code. */
  constructor(world: RAPIER.World, spawn: Spawn, gearbox: Gearbox = 'auto', body: THREE.Object3D | null = null) {
    const model = createCarModel(body);
    this.object = model.root;
    this.wheels = model.wheels;
    this.pivot = model.lean;
    this.state = { gearbox, gear: gearbox === 'auto' ? 1 : 0, rpm: IDLE_RPM, running: true };

    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setAdditionalMass(0));
    const volume = 8 * HALF_EXTENTS.x * HALF_EXTENTS.y * HALF_EXTENTS.z;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(HALF_EXTENTS.x, HALF_EXTENTS.y, HALF_EXTENTS.z)
        .setDensity(MASS / volume)
        .setFriction(0.4)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    // Rapier names this setter setIndexForwardAxis, unlike indexUpAxis.
    this.controller.setIndexForwardAxis = 2;
    for (const [x, y, z] of WHEEL_POSITIONS) {
      const i = this.controller.numWheels();
      // Axle -x makes positive engine force drive toward +z (forward).
      this.controller.addWheel({ x, y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, REST_LENGTH, WHEEL_RADIUS);
      this.controller.setWheelSuspensionStiffness(i, 30);
      this.controller.setWheelSuspensionCompression(i, 4.4);
      this.controller.setWheelSuspensionRelaxation(i, 2.3);
      this.controller.setWheelMaxSuspensionForce(i, 12000);
      this.controller.setWheelFrictionSlip(i, WHEEL_FRICTION);
    }
    this.reset(spawn);
  }

  get speed(): number {
    return this.controller.currentVehicleSpeed();
  }

  get drivetrain(): DrivetrainState {
    return this.state;
  }

  set gearbox(g: Gearbox) {
    this.state = { gearbox: g, gear: g === 'auto' ? 1 : 0, rpm: IDLE_RPM, running: true };
  }

  /** 0 to 1 from the last physics step; read-only, it feeds the tyre sound. */
  get slip(): number {
    return this.slipNow;
  }

  /** Visual body pitch and roll in radians; the physics pose never sees it. */
  get lean(): { pitch: number; roll: number } {
    return { ...this.tilt };
  }

  get upright(): number {
    const q = this.body.rotation();
    return new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w)).y;
  }

  reset(spawn: Spawn): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.heading);
    this.body.setTranslation({ x: spawn.position[0], y: DRIVE_SURFACE_Y + SPAWN_HEIGHT, z: spawn.position[1] }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.state = { ...this.state, gear: this.state.gearbox === 'auto' ? 1 : 0, rpm: IDLE_RPM, running: true };
    this.lastVel.set(0, 0, 0);
    this.bodyLean.reset();
    this.tilt = { pitch: 0, roll: 0 };
    this.slipNow = 0;
  }

  /** One fixed physics step; call before world.step(). */
  update(c: Controls, dt: number): void {
    this.updateLean(dt);
    const speed = this.speed;
    const step = stepDrivetrain(this.state, c, speed, dt);
    this.state = step.state;

    // Rapier steers positive to the left; our steer input is positive to the right.
    const steer = (-c.steer * MAX_STEER) / (1 + Math.abs(speed) / STEER_FALLOFF_SPEED);
    for (const i of FRONT) {
      this.controller.setWheelSteering(i, steer);
      this.controller.setWheelEngineForce(i, step.wheelForce / FRONT.length);
    }
    const service = step.brake * BRAKE_FORCE + (step.wheelForce === 0 ? COAST_FORCE / 4 : 0);
    for (const i of FRONT) this.controller.setWheelBrake(i, service * dt);
    for (const i of REAR) this.controller.setWheelBrake(i, (service + (c.handbrake ? HANDBRAKE_FORCE : 0)) * dt);
    this.applyResistance();
    this.controller.updateVehicle(dt);
    this.slipNow = wheelSlip(this.controller, WHEEL_FRICTION, dt, c.brake >= HARD_BRAKE && Math.abs(speed) > HARD_BRAKE_MIN_SPEED);
  }

  private applyResistance(): void {
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    this.body.resetForces(true);
    if (speed < 0.1) return;
    const f = AERO_DRAG * speed * speed + ROLLING_RESISTANCE;
    this.body.addForce({ x: (-v.x / speed) * f, y: 0, z: (-v.z / speed) * f }, true);
  }

  private updateLean(dt: number): void {
    const v = this.body.linvel(), q = this.body.rotation();
    const accel = leanAccel.set(v.x, v.y, v.z).sub(this.lastVel).divideScalar(dt)
      .applyQuaternion(leanRot.set(q.x, q.y, q.z, q.w).invert());
    this.lastVel.set(v.x, v.y, v.z);
    this.tilt = this.bodyLean.update(accel.z, accel.x, dt);
  }

  /** Copies physics pose to the visual model. */
  sync(): void {
    const t = this.body.translation(), q = this.body.rotation();
    this.object.position.set(t.x, t.y, t.z);
    this.object.quaternion.set(q.x, q.y, q.z, q.w);
    this.pivot.rotation.set(this.tilt.pitch, 0, this.tilt.roll);
    this.wheels.forEach((w, i) => {
      w.position.y = WHEEL_POSITIONS[i][1] - (this.controller.wheelSuspensionLength(i) ?? REST_LENGTH);
      w.rotation.y = this.controller.wheelSteering(i) ?? 0;
      w.children[0].rotation.x = this.controller.wheelRotation(i) ?? 0;
    });
  }
}
