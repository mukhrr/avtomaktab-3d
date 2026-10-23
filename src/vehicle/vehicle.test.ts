import RAPIER from '@dimforge/rapier3d-compat';
import { STEP } from '../physics/loop';
import { DRIVE_SURFACE_Y } from '../physics/world';
import type { Controls } from './drivetrain';
import { Vehicle } from './vehicle';

const idle: Controls = { throttle: 0, brake: 0, clutch: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, ignition: false };

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
  const { vertices, indices } = buildingMesh({ id: 'wall', height: 12, footprint: [[30, -20], [40, -20], [40, 20], [30, 20]] });
  world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices));
  const car = new Vehicle(world, { position: [0, 0], heading: Math.PI / 2 });
  drive(world, car, idle, 0.5);
  while (car.speed * 3.6 < 50) drive(world, car, { ...idle, throttle: 1 }, STEP);
  drive(world, car, { ...idle, throttle: 1 }, 4);
  expect(car.object.position.x).toBeLessThan(30);
});
