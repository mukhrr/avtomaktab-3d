import type { Approach, DistrictData } from '../shared/district';
import { SignalSystem, cycleLength, phaseLength } from './signals';

const a = { edgeId: 'e', dir: 1 as const, stopAt: 5 };

test('phase and cycle lengths', () => {
  expect(phaseLength([a])).toBe(26);
  expect(phaseLength([])).toBe(17);
  expect(cycleLength([[a], [a], []])).toBe(69);
});

const p0: Approach = { edgeId: 'e0', dir: 1, stopAt: 20 };
const p1: Approach = { edgeId: 'e1', dir: -1, stopAt: 10 };

function make(phases: Approach[][], offset = 0): SignalSystem {
  const d = {
    controllers: [{ id: 'c', phases, offset }],
    signals: [
      { id: 's0', position: { x: 0, z: 0 }, controllerId: 'c', approach: p0 },
      { id: 's1', position: { x: 0, z: 0 }, controllerId: 'c', approach: p1 },
      { id: 'sx', position: { x: 0, z: 0 } },
    ],
    crossings: [
      { id: 'x', controllerId: 'c', walkPhase: 1 },
      { id: 'z' },
    ],
  } as unknown as DistrictData;
  return new SignalSystem(d);
}

function at(sys: SignalSystem, t: number): void {
  sys.time = t;
}

test('CIS sequence across two vehicle phases', () => {
  const sys = make([[p0], [p1]]);
  expect(cycleLength([[p0], [p1]])).toBe(52);
  const st = (e: string, dir: 1 | -1, s: number) => sys.approachState(e, dir, s)?.state;
  at(sys, 0);
  expect(st('e0', 1, 0)).toBe('green');
  expect(st('e1', -1, 50)).toBe('red');
  at(sys, 19);
  expect(st('e0', 1, 0)).toBe('flashingGreen');
  at(sys, 22);
  expect(st('e0', 1, 0)).toBe('yellow');
  at(sys, 24.5);
  expect(st('e0', 1, 0)).toBe('red');
  expect(st('e1', -1, 50)).toBe('redYellow');
  at(sys, 26);
  expect(st('e1', -1, 50)).toBe('green');
  expect(st('e0', 1, 0)).toBe('red');
  at(sys, 51);
  expect(st('e0', 1, 0)).toBe('redYellow');
});

test('update advances time and headState follows the approach', () => {
  const sys = make([[p0], [p1]]);
  sys.update(19);
  expect(sys.time).toBe(19);
  expect(sys.headState('s0')).toBe('flashingGreen');
  expect(sys.headState('s1')).toBe('red');
  expect(sys.headState('sx')).toBeNull();
  expect(sys.headState('nope')).toBeNull();
});

test('pedestrian-only phase and walk states', () => {
  const sys = make([[p0], []]);
  const st = () => sys.approachState('e0', 1, 0)?.state;
  at(sys, 0);
  expect(sys.walkState('x')).toBe('dontWalk');
  at(sys, 26);
  expect(sys.walkState('x')).toBe('walk');
  expect(st()).toBe('red');
  at(sys, 38);
  expect(sys.walkState('x')).toBe('flashingWalk');
  at(sys, 41);
  expect(sys.walkState('x')).toBe('dontWalk');
  at(sys, 42.5);
  expect(st()).toBe('redYellow');
  expect(sys.walkState('z')).toBeNull();
  expect(sys.walkState('nope')).toBeNull();
});

test('approachState returns the nearest stop line ahead', () => {
  const sys = make([[p0], [p1]]);
  expect(sys.approachState('e0', 1, 5)?.stopAt).toBe(20);
  expect(sys.approachState('e0', 1, 25)).toBeNull();
  expect(sys.approachState('e1', -1, 5)).toBeNull();
  expect(sys.approachState('e1', -1, 50)?.stopAt).toBe(10);
  expect(sys.approachState('missing', 1, 0)).toBeNull();

  const near: Approach = { edgeId: 'e0', dir: 1, stopAt: 12 };
  const multi = make([[p0, near], [p1]]);
  expect(multi.approachState('e0', 1, 5)?.stopAt).toBe(12);
  expect(multi.approachState('e0', 1, 15)?.stopAt).toBe(20);
});

test('offset shifts the timeline', () => {
  const sys = make([[p0], [p1]], 26);
  at(sys, 0);
  expect(sys.approachState('e1', -1, 50)?.state).toBe('green');
  expect(sys.approachState('e0', 1, 0)?.state).toBe('red');
});

test('flashing lamps blink at 1 Hz', () => {
  const sys = make([[p0]]);
  at(sys, 0.2);
  expect(sys.lampOn('flashingGreen')).toBe(true);
  at(sys, 0.7);
  expect(sys.lampOn('flashingGreen')).toBe(false);
  expect(sys.lampOn('red')).toBe(true);
});

test('headState matches a signal whose stopAt was deduped away', () => {
  const d = {
    controllers: [{ id: 'c', phases: [[p0], [p1]], offset: 0 }],
    signals: [{ id: 'late', position: { x: 0, z: 0 }, controllerId: 'c', approach: { ...p1, stopAt: 14 } }],
    crossings: [],
  } as unknown as DistrictData;
  const sys = new SignalSystem(d);
  sys.time = 26;
  expect(sys.headState('late')).toBe('green');
  sys.time = 0;
  expect(sys.headState('late')).toBe('red');
});
