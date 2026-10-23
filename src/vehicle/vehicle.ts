import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Vec2 } from '../shared/district';
import { DRIVE_SURFACE_Y } from '../physics/world';
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

export interface Spawn { position: Vec2; heading: number }

export class Vehicle {
  readonly object: THREE.Group;
  private body: RAPIER.RigidBody;
  private controller: RAPIER.DynamicRayCastVehicleController;
  private wheels: THREE.Object3D[];
  private state: DrivetrainState;

  constructor(world: RAPIER.World, spawn: Spawn, gearbox: Gearbox = 'auto') {
    const model = createCarModel();
    this.object = model.root;
    this.wheels = model.wheels;
    this.state = { gearbox, gear: gearbox === 'auto' ? 1 : 0, rpm: IDLE_RPM, running: true };

    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setAdditionalMass(0));
    const volume = 8 * HALF_EXTENTS.x * HALF_EXTENTS.y * HALF_EXTENTS.z;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(HALF_EXTENTS.x, HALF_EXTENTS.y, HALF_EXTENTS.z).setDensity(MASS / volume).setFriction(0.4),
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
      this.controller.setWheelFrictionSlip(i, 2.2);
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
  }

  /** One fixed physics step; call before world.step(). */
  update(c: Controls, dt: number): void {
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
  }

  private applyResistance(): void {
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    this.body.resetForces(true);
    if (speed < 0.1) return;
    const f = AERO_DRAG * speed * speed + ROLLING_RESISTANCE;
    this.body.addForce({ x: (-v.x / speed) * f, y: 0, z: (-v.z / speed) * f }, true);
  }

  /** Copies physics pose to the visual model. */
  sync(): void {
    const t = this.body.translation(), q = this.body.rotation();
    this.object.position.set(t.x, t.y, t.z);
    this.object.quaternion.set(q.x, q.y, q.z, q.w);
    this.wheels.forEach((w, i) => {
      w.position.y = WHEEL_POSITIONS[i][1] - (this.controller.wheelSuspensionLength(i) ?? REST_LENGTH);
      w.rotation.y = this.controller.wheelSteering(i) ?? 0;
      w.children[0].rotation.x = this.controller.wheelRotation(i) ?? 0;
    });
  }
}
