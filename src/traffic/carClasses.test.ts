import { describe, expect, it } from 'vitest';
import { SignalSystem } from '../sim/signals';
import { rng } from '../sim/rng';
import { CAR_CLASSES, PAINT, TAXI_YELLOW, pickClass, pickPaint, type CarClass } from './carClasses';
import { LaneNetwork } from './lanes';
import { testNetwork } from './testNetwork';
import { TrafficSim } from './trafficSim';

const SHARES: Record<CarClass, number> = {
  cobalt: 26, nexia: 18, spark: 14, lacetti: 12, damas: 8, taxi: 14, bus: 8,
};

describe('car mix', () => {
  it('has the Lacetti and taxi sizes', () => {
    expect(CAR_CLASSES.lacetti).toMatchObject({ length: 4.5, width: 1.73 });
    expect(CAR_CLASSES.taxi).toMatchObject({ length: 4.5, width: 1.74 });
  });

  it('spawns classes in the Tashkent shares', () => {
    const rand = rng(5);
    const n = 10000;
    const count: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const c = pickClass(rand());
      count[c] = (count[c] ?? 0) + 1;
    }
    for (const [c, pct] of Object.entries(SHARES)) {
      expect(Math.abs((count[c] ?? 0) / n * 100 - pct), c).toBeLessThanOrEqual(2);
    }
  });

  it('paints 40% of cars white', () => {
    const rand = rng(6);
    const n = 10000;
    let white = 0;
    for (let i = 0; i < n; i++) if (pickPaint(rand(), 'cobalt') === 0xf2f2ef) white++;
    expect(Math.abs(white / n * 100 - 40)).toBeLessThanOrEqual(3);
  });

  it('weights the paint table to 100', () => {
    expect(PAINT.reduce((s, p) => s + p.weight, 0)).toBe(100);
  });

  it('always paints taxis yellow and buses white', () => {
    const rand = rng(7);
    for (let i = 0; i < 500; i++) {
      expect(pickPaint(rand(), 'taxi')).toBe(TAXI_YELLOW);
      expect(pickPaint(rand(), 'bus')).toBe(0xf2f2ef);
    }
    expect(TAXI_YELLOW).toBe(0xf3c623);
  });
});

describe('spawn sequence', () => {
  // Captured from the five-class code before the Tashkent mix, seed 1, count 20.
  const BEFORE: [string, number, number, number][] = [
    ['e', -1, 234.87, -1.75], ['s', -1, -1.75, 75.28], ['e', 1, 117.41, 1.75], ['s', 1, 1.75, 63.5],
    ['s', -1, -1.75, 26.55], ['tE', -1, 323.83, -1.75], ['tE', 1, 266.19, 1.75], ['o2', 1, 372, -60.59],
    ['w', -1, -91.22, 1.75], ['n', -1, -1.75, -89.43], ['s', -1, -1.75, 118.77], ['e', -1, 15.44, -1.75],
    ['tE', -1, 251.94, -1.75], ['w', 1, -106.28, -1.75], ['s', 1, 1.75, 41.83], ['n', -1, -1.75, -73.66],
    ['w', 1, -21.1, -1.75], ['n', -1, -1.75, -103.67], ['e', -1, 208.51, -1.75], ['o2', 1, 366.32, -5.27],
  ];

  it('keeps the first 20 lanes and positions of seed 1', () => {
    const d = testNetwork();
    const sim = new TrafficSim(d, new LaneNetwork(d), new SignalSystem(d), { count: 20, seed: 1 });
    sim.step(1e-9, { position: [100, 60], heading: 0, speed: 0, length: 4.5, width: 1.8 }, { occupied: () => false });
    const now = sim.agents.slice(0, 20).map(a => {
      const { edgeId, dir } = (a as unknown as { ref: { edgeId: string; dir: number } }).ref;
      return [edgeId, dir, Math.round(a.position[0] * 100) / 100, Math.round(a.position[1] * 100) / 100];
    });
    expect(now).toEqual(BEFORE);
  });
});
