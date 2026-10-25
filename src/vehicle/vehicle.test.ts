import RAPIER from '@dimforge/rapier3d-compat';
import { STEP } from '../physics/loop';
import { DRIVE_SURFACE_Y } from '../physics/world';
import type { Controls } from './drivetrain';
import { Vehicle, wheelSlip } from './vehicle';

const idle: Controls = { throttle: 0, brake: 0, clutch: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, ignition: false, toggleLeft: false, toggleRight: false, toggleHazard: false, toggleBelt: false, glance: null };

async function flatWorld() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, DRIVE_SURFACE_Y - 0.5, 0));
  return world;
}

function drive(world: RAPIER.World, car: Vehicle, c: Controls, seconds: number) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    car.update(c, STEP);
    world.step();
  }
  car.sync();
}

test('auto reaches 100 km/h in 10 to 14 s (real Cobalt 1.5: 11.7 s) and moves along its heading', async () => {
  const world = await flatWorld();
  const car = new Vehicle(world, { position: [0, 0], heading: Math.PI / 2 }); // facing east (+x)
  drive(world, car, idle, 1);
  let t = 0;
  while (car.speed * 3.6 < 100 && t < 20) {
    drive(world, car, { ...idle, throttle: 1 }, 0.1);
    t += 0.1;
  }
  expect(t).toBeGreaterThan(10);
  expect(t).toBeLessThan(14);
  expect(car.object.position.x).toBeGreaterThan(50);
  expect(Math.abs(car.object.position.z)).toBeLessThan(5);
});

test('steering right turns the car to its right', async () => {
  const world = await flatWorld();
  const car = new Vehicle(world, { position: [0, 0], heading: 0 }); // facing south (+z), right is -x
  drive(world, car, { ...idle, throttle: 0.5, steer: 1 }, 3);
  expect(car.object.position.x).toBeLessThan(-2);
});

test('manual: releasing the clutch with no gas stalls the engine', async () => {
  const world = await flatWorld();
  const car = new Vehicle(world, { position: [0, 0], heading: 0 }, 'manual');
  drive(world, car, idle, 0.5);
  drive(world, car, { ...idle, clutch: 1, shiftUp: true }, STEP);
  drive(world, car, idle, 0.5);
  expect(car.drivetrain.running).toBe(false);
});

test('hitting a building at 50 km/h stops the car instead of passing through', async () => {
  const { buildingMesh } = await import('../physics/world');
  const world = await flatWorld();
  const { vertices, indices } = buildingMesh({ id: 'wall', height: 12, levels: 4, style: 'stucco', footprint: [[30, -20], [40, -20], [40, 20], [30, 20]] });
  world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices));
  const car = new Vehicle(world, { position: [0, 0], heading: Math.PI / 2 });
  drive(world, car, idle, 0.5);
  while (car.speed * 3.6 < 50) drive(world, car, { ...idle, throttle: 1 }, STEP);
  drive(world, car, { ...idle, throttle: 1 }, 4);
  expect(car.object.position.x).toBeLessThan(30);
});

async function at60(gearbox: 'auto' | 'manual' = 'auto') {
  const world = await flatWorld();
  const car = new Vehicle(world, { position: [0, 0], heading: Math.PI / 2 }, gearbox);
  drive(world, car, idle, 0.5);
  while (car.speed * 3.6 < 60) drive(world, car, { ...idle, throttle: 1 }, STEP);
  return { world, car };
}

test('lifting off at 60 km/h coasts gently (0.2 to 1.2 m/s^2)', async () => {
  const { world, car } = await at60();
  const v0 = car.speed;
  drive(world, car, idle, 1);
  const decel = v0 - car.speed;
  expect(decel).toBeGreaterThan(0.2);
  expect(decel).toBeLessThan(1.2);
});

test('full brake stops hard but a light brake is gentle', async () => {
  const full = await at60();
  let v0 = full.car.speed;
  drive(full.world, full.car, { ...idle, brake: 1 }, 0.5);
  const fullDecel = (v0 - full.car.speed) / 0.5;
  expect(fullDecel).toBeGreaterThan(6);
  expect(fullDecel).toBeLessThan(11);

  const light = await at60();
  v0 = light.car.speed;
  drive(light.world, light.car, { ...idle, brake: 0.2 }, 0.5);
  const lightDecel = (v0 - light.car.speed) / 0.5;
  expect(lightDecel).toBeLessThan(fullDecel / 2);
});

test('hard braking dips the body nose-down while the physics pose and upright stay untouched', async () => {
  const THREE = await import('three');
  const world = await flatWorld();
  const car = new Vehicle(world, { position: [0, 0], heading: 0 });
  drive(world, car, idle, 1);
  while (car.speed * 3.6 < 50) drive(world, car, { ...idle, throttle: 1 }, 0.1);
  drive(world, car, { ...idle, brake: 1 }, 0.4);
  expect(car.lean.pitch).toBeGreaterThan(1 * Math.PI / 180);
  expect(car.lean.pitch).toBeLessThanOrEqual(3 * Math.PI / 180 + 1e-9);

  const body = (car as unknown as { body: RAPIER.RigidBody }).body;
  const q = body.rotation();
  expect(car.object.quaternion.toArray()).toEqual([q.x, q.y, q.z, q.w]);
  expect(car.upright).toBeCloseTo(new THREE.Vector3(0, 1, 0).applyQuaternion(car.object.quaternion).y, 6);

  car.object.updateMatrixWorld(true);
  const pivot = car.object.getObjectByName('lean')!;
  expect(pivot.rotation.x).toBeCloseTo(car.lean.pitch, 9);
  expect(new THREE.Box3().setFromObject(pivot).min.y).toBeGreaterThan(DRIVE_SURFACE_Y + 0.02);
});

test('reset zeroes the lean at once, so R and the exam start show a level car', async () => {
  const world = await flatWorld();
  const car = new Vehicle(world, { position: [0, 0], heading: 0 });
  drive(world, car, idle, 1);
  drive(world, car, { ...idle, throttle: 1, steer: 1 }, 2);
  expect(Math.abs(car.lean.roll) + Math.abs(car.lean.pitch)).toBeGreaterThan(0.2 * Math.PI / 180);
  car.reset({ position: [10, 10], heading: 1 });
  car.sync();
  expect(car.lean).toEqual({ pitch: 0, roll: 0 });
  drive(world, car, idle, STEP);
  expect(Math.abs(car.lean.pitch)).toBeLessThan(0.05 * Math.PI / 180);
});

describe('wheelSlip', () => {
  const stub = (wheels: { side: number; forward: number; force: number }[]) => ({
    numWheels: () => wheels.length,
    wheelSideImpulse: (i: number) => wheels[i].side,
    wheelForwardImpulse: (i: number) => wheels[i].forward,
    wheelSuspensionForce: (i: number) => wheels[i].force,
  });
  const dt = 1 / 60;
  const full = 2.2 * 3000 * dt;

  it('is the largest side impulse as a share of friction slip times suspension force', () => {
    const c = stub([{ side: 0, forward: 0, force: 3000 }, { side: full * 0.5, forward: 0, force: 3000 }, { side: full * 0.2, forward: 0, force: 3000 }, { side: 0, forward: 0, force: 3000 }]);
    expect(wheelSlip(c, 2.2, dt, false)).toBeCloseTo(0.5, 5);
  });

  it('caps at 1 and is 0 for a wheel with no load', () => {
    expect(wheelSlip(stub([{ side: full * 4, forward: 0, force: 3000 }]), 2.2, dt, false)).toBe(1);
    expect(wheelSlip(stub([{ side: 50, forward: 50, force: 0 }]), 2.2, dt, true)).toBe(0);
  });

  it('counts the forward impulse only under hard braking', () => {
    const c = stub([{ side: 0, forward: full * 0.8, force: 3000 }]);
    expect(wheelSlip(c, 2.2, dt, false)).toBe(0);
    expect(wheelSlip(c, 2.2, dt, true)).toBeCloseTo(0.8, 5);
  });

  it('treats null and NaN readings as no slip', () => {
    const c = { numWheels: () => 2, wheelSideImpulse: () => null, wheelForwardImpulse: () => NaN, wheelSuspensionForce: () => 3000 };
    expect(wheelSlip(c, 2.2, dt, true)).toBe(0);
  });
});

test('Vehicle.slip is 0 at rest and stays within 0 to 1 while cornering hard', async () => {
  const world = await flatWorld();
  const car = new Vehicle(world, { position: [0, 0], heading: 0 });
  drive(world, car, idle, 1);
  expect(car.slip).toBeLessThan(0.15);
  drive(world, car, { ...idle, throttle: 1 }, 3);
  drive(world, car, { ...idle, throttle: 1, steer: 1 }, 2);
  expect(car.slip).toBeGreaterThanOrEqual(0);
  expect(car.slip).toBeLessThanOrEqual(1);
});
