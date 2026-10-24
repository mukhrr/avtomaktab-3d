import { describe, expect, it } from 'vitest';
import type { LightState } from '../sim/signals';
import { HornMonitor, hornDecision, hornPan, hornVolume, type HornState } from './horn';
import type { AgentView } from './trafficSim';

const base: HornState = { greenFor: 3, playerSpeed: 0, playerAhead: true, honked: false, distance: 8 };

describe('hornDecision', () => {
  it('honks when first in queue at a fresh green with the player stopped', () => {
    expect(hornDecision(base)).toBe(true);
  });
  it('not before 2 s of green, nor after 6 s', () => {
    expect(hornDecision({ ...base, greenFor: 1.99 })).toBe(false);
    expect(hornDecision({ ...base, greenFor: 2 })).toBe(true);
    expect(hornDecision({ ...base, greenFor: 6 })).toBe(true);
    expect(hornDecision({ ...base, greenFor: 6.01 })).toBe(false);
    expect(hornDecision({ ...base, greenFor: 0 })).toBe(false);
  });
  it('not while the player moves 2 m/s or faster', () => {
    expect(hornDecision({ ...base, playerSpeed: 1.99 })).toBe(true);
    expect(hornDecision({ ...base, playerSpeed: 2 })).toBe(false);
    expect(hornDecision({ ...base, playerSpeed: -2.5 })).toBe(false);
  });
  it('not when the car is not directly behind the player', () => {
    expect(hornDecision({ ...base, playerAhead: false })).toBe(false);
  });
  it('once per stop', () => {
    expect(hornDecision({ ...base, honked: true })).toBe(false);
  });
});

describe('hornVolume and hornPan', () => {
  it('falls with distance', () => {
    expect(hornVolume(0)).toBe(1);
    expect(hornVolume(10)).toBeCloseTo(0.5);
    expect(hornVolume(30)).toBeLessThan(hornVolume(10));
  });
  it('is right-positive relative to the listener heading', () => {
    // heading 0 faces +z, whose right-hand side is -x
    expect(hornPan({ position: [0, 0], heading: 0 }, [-5, 0])).toBeCloseTo(1);
    expect(hornPan({ position: [0, 0], heading: 0 }, [5, 0])).toBeCloseTo(-1);
    expect(hornPan({ position: [0, 0], heading: 0 }, [0, -5])).toBeCloseTo(0);
    expect(hornPan({ position: [0, 0], heading: Math.PI / 2 }, [0, 5])).toBeCloseTo(1);
  });
});

/** Player at the origin heading +z (north of nothing in particular), queue stretching to -z. */
function setup() {
  let state: LightState = 'red';
  const signals = { time: 0, approachState: () => ({ state, stopAt: 30 }) };
  const matcher = { update: () => ({ ref: { edgeId: 'e', dir: 1 as const, lane: 0 }, edgeS: 10, lateral: 1, inJunction: null, onConnector: false, confidence: 1, held: 1 }) };
  const net = { path: () => ({ startAt: 0, endAt: 60 }) };
  const monitor = new HornMonitor({ matcher, signals, net } as never);
  const player = { position: [0, 0] as [number, number], heading: 0, speed: 0, length: 4.5, width: 1.8 };
  const car = (id: number, z: number, over: Partial<AgentView> = {}): AgentView => ({
    id, active: true, position: [0, z], heading: 0, carClass: 'nexia', colour: 0, braking: false, speed: 0, indicator: null, ...over,
  } as AgentView);
  const listener = { position: [0, 0] as [number, number], heading: 0 };
  const run = (secs: number, agents: AgentView[], speed = 0) => {
    const out: ReturnType<HornMonitor['update']> = [];
    for (let i = 0; i < secs * 10; i++) {
      signals.time += 0.1;
      out.push(...monitor.update(0.1, { ...player, speed }, agents, signals, listener));
    }
    return out;
  };
  return { run, setLight: (s: LightState) => { state = s; }, car, signals };
}

describe('HornMonitor', () => {
  it('honks the first car behind the player once, between 2 and 6 s into the green', () => {
    const w = setup();
    const agents = [w.car(1, -8), w.car(2, -14)];
    expect(w.run(5, agents)).toEqual([]);
    w.setLight('green');
    const before = w.signals.time;
    const horns = w.run(10, agents);
    expect(horns).toHaveLength(1);
    expect(horns[0].agentId).toBe(1);
    expect(horns[0].volume).toBeCloseTo(hornVolume(3.5), 5);
    expect(w.signals.time - before).toBeGreaterThan(2);
  });

  it('never honks within 2 s of the green', () => {
    const w = setup();
    w.setLight('green');
    expect(w.run(1.9, [w.car(1, -8)])).toEqual([]);
  });

  it('is silent when the player is moving', () => {
    const w = setup();
    w.setLight('green');
    expect(w.run(8, [w.car(1, -8)], 3)).toEqual([]);
  });

  it('is silent for a car in another lane, beyond range, or ahead of the player', () => {
    const w = setup();
    w.setLight('green');
    const agents = [w.car(1, -8, { position: [3.5, -8] }), w.car(2, -40), w.car(3, 8), w.car(4, -8, { heading: Math.PI })];
    expect(w.run(8, agents)).toEqual([]);
  });

  it('ignores inactive cars when picking the first in queue', () => {
    const w = setup();
    w.setLight('green');
    const horns = w.run(8, [w.car(1, -6, { active: false }), w.car(2, -12)]);
    expect(horns.map(h => h.agentId)).toEqual([2]);
  });

  it('honks again for a new stop at the next green', () => {
    const w = setup();
    const agents = [w.car(1, -8)];
    w.setLight('green');
    expect(w.run(8, agents)).toHaveLength(1);
    w.setLight('red');
    w.run(3, agents);
    w.setLight('green');
    expect(w.run(8, agents)).toHaveLength(1);
  });

  it('pans toward the side the car is on', () => {
    const w = setup();
    w.setLight('green');
    const horns = w.run(8, [w.car(1, -8, { position: [-1, -8] })]);
    expect(horns[0].pan).toBeGreaterThan(0);
  });
});
