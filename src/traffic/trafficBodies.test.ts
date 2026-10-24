import RAPIER from '@dimforge/rapier3d-compat';
import { STEP } from '../physics/loop';
import { DRIVE_SURFACE_Y } from '../physics/world';
import type { Controls } from '../vehicle/drivetrain';
import { Vehicle } from '../vehicle/vehicle';
import type { AgentView } from './trafficSim';
import { approachSpeeds, closingSpeed, TrafficBodies } from './trafficBodies';

const idle: Controls = { throttle: 0, brake: 0, clutch: 0, steer: 0, handbrake: false, shiftUp: false, shiftDown: false, ignition: false, toggleLeft: false, toggleRight: false, toggleHazard: false, toggleBelt: false, glance: null };

const agent = (over: Partial<AgentView>): AgentView => ({
  id: 0, active: true, position: [0, 0], heading: 0, carClass: 'cobalt', colour: 0, braking: false, speed: 0, indicator: null, ...over,
});

async function flatWorld() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, DRIVE_SURFACE_Y - 0.5, 0));
  return world;
}

test('a car driven at 30 km/h into a stationary traffic body is reported and stopped by it', async () => {
  const world = await flatWorld();
  const car = new Vehicle(world, { position: [0, 0], heading: Math.PI / 2 });
  const bodies = new TrafficBodies(world, 2);
  const parked = [agent({ position: [25, 0], heading: Math.PI / 2 }), agent({ id: 1, active: false })];
  const queue = new RAPIER.EventQueue(true);
  const started: [number, number][] = [];

  for (let i = 0; i < 6 / STEP; i++) {
    bodies.sync(parked);
    car.update(car.speed * 3.6 < 30 ? { ...idle, throttle: 1 } : idle, STEP);
    world.step(queue);
    queue.drainCollisionEvents((a, b, s) => {
      if (s && (a === car.collider.handle || b === car.collider.handle)) started.push([a, b]);
    });
  }
  car.sync();

  expect(started.length).toBeGreaterThan(0);
  const other = started[0][0] === car.collider.handle ? started[0][1] : started[0][0];
  expect(bodies.isTrafficCollider(other)).toBe(true);
  expect(bodies.isTrafficCollider(car.collider.handle)).toBe(false);
  // Cobalt rear is at 25 - 2.25; the chassis front is 2.24 ahead of its centre.
  expect(car.object.position.x).toBeLessThan(21);
});

test('an AI car at 10 m/s hitting a stationary player reports a closing speed near 10', async () => {
  const world = await flatWorld();
  const car = new Vehicle(world, { position: [0, 0], heading: Math.PI / 2 });
  const bodies = new TrafficBodies(world, 1);
  const queue = new RAPIER.EventQueue(true);
  const ai = agent({ position: [-30, 0], heading: Math.PI / 2, speed: 10 });
  let reported: number | null = null;

  for (let i = 0; i < 6 / STEP && reported === null; i++) {
    ai.position = [ai.position[0] + 10 * STEP, 0];
    bodies.sync([ai]);
    car.update(idle, STEP);
    world.step(queue);
    queue.drainCollisionEvents((a, b, s) => {
      const other = a === car.collider.handle ? b : b === car.collider.handle ? a : null;
      const hitAgent = other === null || !s ? null : bodies.agentFor(other);
      if (!hitAgent) return;
      const player = { position: [0, 0] as [number, number], heading: Math.PI / 2, speed: 0, length: 4.48, width: 1.74 };
      reported = closingSpeed(player, hitAgent);
    });
  }
  expect(reported).not.toBeNull();
  expect(reported!).toBeGreaterThan(8);
  expect(reported!).toBeLessThan(12);
});

test('approachSpeeds tells a rear-ending AI car from the player driving into one', () => {
  const player = { position: [0, 0] as [number, number], heading: 0, speed: 1.5, length: 4.48, width: 1.74 };
  const behind = { position: [0, -4.5] as [number, number], heading: 0, speed: 5 };
  const ahead = { position: [0, 4.5] as [number, number], heading: 0, speed: 0 };
  const r = approachSpeeds(player, behind as never);
  expect(r.player).toBeCloseTo(-1.5, 5);
  expect(r.other).toBeCloseTo(5, 5);
  const into = approachSpeeds(player, ahead as never);
  expect(into.player).toBeCloseTo(1.5, 5);
  expect(into.other).toBeCloseTo(0, 5);
});
