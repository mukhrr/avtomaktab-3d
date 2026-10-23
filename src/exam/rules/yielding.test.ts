import type { DriveSnapshot } from '../snapshot';
import { E_OUT, N_OUT, S_OUT, W_IN, testRoad, transit } from './testRoad';
import { DT, drive, ids, repeat, type SnapOver } from './testSnap';
import { PedestrianYieldRule, VehicleYieldRule } from './yielding';

type Crossing = DriveSnapshot['crossingsAhead'][number];
type Conflict = DriveSnapshot['junctionConflicts'][number];

describe('pedestrianNotYielded', () => {
  const xing = (distance: number, over: Partial<Crossing> = {}): Crossing =>
    ({ id: 'z1', distance, occupied: false, kind: 'zebra', pedOnCarriageway: false, pedAtCurb: false, ...over });
  /** Drives at `speed` from crossing distance `from` until the centre is 4 m past it; `ped` says who is there at each distance. */
  const approach = (from: number, speed: number, ped: (distance: number) => Partial<Crossing>, kind: Crossing['kind'] = 'zebra'): SnapOver[] => {
    const n = Math.ceil((from + 4) / (speed * DT));
    return repeat(n, i => {
      const distance = from - i * speed * DT;
      const p = ped(distance);
      return { speed, crossingsAhead: [xing(distance, { kind, ...p, occupied: !!p.pedOnCarriageway })] };
    });
  };
  const onRoad = { pedOnCarriageway: true };

  test('driving through a zebra with a pedestrian on it since far away gives one', () => {
    const vs = drive(new PedestrianYieldRule(), approach(60, 10, () => onRoad));
    expect(ids(vs)).toEqual(['pedestrianNotYielded']);
    expect(vs[0].detail).toEqual({ crossing: 'z1' });
  });

  test('a pedestrian stepping out 5 m ahead at 40 km/h gives nothing (RF3)', () => {
    const v = 40 / 3.6;
    expect(drive(new PedestrianYieldRule(), approach(60, v, d => (d - 2.24 - 1.5 <= 5 ? onRoad : {})))).toEqual([]);
  });

  test('a pedestrian stepping out 30 m ahead at 40 km/h, outside the stopping distance, gives one', () => {
    const v = 40 / 3.6;
    expect(ids(drive(new PedestrianYieldRule(), approach(60, v, d => (d - 2.24 - 1.5 <= 30 ? onRoad : {}))))).toEqual(['pedestrianNotYielded']);
  });

  test('a pedestrian waiting at the curb of a zebra since far away gives one', () => {
    expect(ids(drive(new PedestrianYieldRule(), approach(60, 8, () => ({ pedAtCurb: true }))))).toEqual(['pedestrianNotYielded']);
  });

  test('at a signal crossing only a pedestrian on the carriageway counts, not one waiting for the walk light', () => {
    expect(drive(new PedestrianYieldRule(), approach(60, 8, () => ({ pedAtCurb: true }), 'signal'))).toEqual([]);
    expect(ids(drive(new PedestrianYieldRule(), approach(60, 8, () => onRoad, 'signal')))).toEqual(['pedestrianNotYielded']);
  });

  test('unmarked crossings are not judged', () => {
    expect(drive(new PedestrianYieldRule(), approach(60, 8, () => onRoad, 'unmarked'))).toEqual([]);
  });

  test('stopping and going once the pedestrian has crossed is fine', () => {
    const frames = [
      ...approach(60, 8, () => onRoad).filter(f => f.crossingsAhead![0].distance > 6),
      ...repeat(30, { speed: 0, crossingsAhead: [xing(6, { pedOnCarriageway: true, occupied: true })] }),
      ...repeat(20, i => ({ speed: 2, crossingsAhead: [xing(6 - i * 0.2)] })),
    ];
    expect(drive(new PedestrianYieldRule(), frames)).toEqual([]);
  });

  test('a second pedestrian stepping out once the car is close does not reopen the first one', () => {
    const frames = approach(40, 8, d => (d > 20 ? onRoad : d > 8 ? {} : onRoad));
    expect(drive(new PedestrianYieldRule(), frames)).toEqual([]);
  });

  test('a crossing just past a junction is judged from when it appears, with its pedestrian (ruling 2)', () => {
    expect(ids(drive(new PedestrianYieldRule(), approach(15, 4, () => onRoad)))).toEqual(['pedestrianNotYielded']);
    expect(drive(new PedestrianYieldRule(), approach(7, 8, () => onRoad))).toEqual([]);
  });

  test('reversing over a crossing is not judged', () => {
    const frames = repeat(40, i => ({ speed: -2, crossingsAhead: [xing(-3 + i * 0.2, { pedOnCarriageway: true, occupied: true })] }));
    expect(drive(new PedestrianYieldRule(), frames)).toEqual([]);
  });
});

describe('vehicleNotYielded', () => {
  const car = (over: Partial<Conflict> = {}): Conflict =>
    ({ agentId: 7, fromRight: true, oncoming: false, tta: 2, speed: 8, rank: 1, turn: 'straight', ...over });
  /** Every frame of a w-to-exit transit sees `c`. */
  const through = (road: ReturnType<typeof testRoad>, c: Conflict[], to = E_OUT, extra: SnapOver = {}) =>
    drive(new VehicleYieldRule(road), transit(W_IN, to, { junctionConflicts: c, ...extra }));

  test('a car from the right 2 s away when entering gives one; 5 s away gives none', () => {
    const vs = through(testRoad(), [car()]);
    expect(ids(vs)).toEqual(['vehicleNotYielded']);
    expect(vs[0].t).toBeCloseTo(2, 5);
    expect(through(testRoad(), [car({ tta: 5 })])).toEqual([]);
  });

  test('on a priority road the car from the right gives none', () => {
    expect(through(testRoad([{ type: 'priorityRoad', edgeId: 'w', dir: -1, at: 10 }]), [car()])).toEqual([]);
  });

  test('a car from the left has no priority, unless the player has a giveWay or stop sign', () => {
    expect(through(testRoad(), [car({ fromRight: false })])).toEqual([]);
    expect(ids(through(testRoad([{ type: 'giveWay', edgeId: 'w', dir: -1, at: 10 }]), [car({ fromRight: false })]))).toEqual(['vehicleNotYielded']);
    expect(ids(through(testRoad([{ type: 'stop', edgeId: 'w', dir: -1, at: 10 }]), [car({ fromRight: false, oncoming: true })]))).toEqual(['vehicleNotYielded']);
  });

  test('a car from the right with a giveWay sign has no priority; one on a priority road from the left has', () => {
    expect(through(testRoad(), [car({ rank: 0 })])).toEqual([]);
    expect(ids(through(testRoad(), [car({ fromRight: false, rank: 2 })]))).toEqual(['vehicleNotYielded']);
  });

  test('a car standing at its line is no threat until it moves off', () => {
    expect(through(testRoad(), [car({ speed: 0, tta: 0.5 })])).toEqual([]);
  });

  test('one per junction, and a car that turns up after entry is not judged', () => {
    const frames = transit(W_IN, E_OUT).map((f, i) => (i >= 22 ? { ...f, junctionConflicts: [car({ tta: 1 })] } : f));
    expect(drive(new VehicleYieldRule(testRoad()), frames)).toEqual([]);
    expect(ids(through(testRoad(), [car(), car({ agentId: 8, tta: 1 })]))).toEqual(['vehicleNotYielded']);
  });

  describe('at a signalled junction on green', () => {
    const road = testRoad();
    const green: SnapOver = { signalAhead: { state: 'green', distance: 10, stopAt: road.laneEnd(W_IN) } };
    const lit = (frames: SnapOver[]) => frames.map(f => (f.match?.inJunction ? f : { ...f, ...green }));
    const oncoming = car({ fromRight: false, oncoming: true });
    const run = (to: typeof N_OUT, c: Conflict[]) => drive(new VehicleYieldRule(road), lit(transit(W_IN, to, { junctionConflicts: c })));

    test('turning left across oncoming straight traffic 2 s away gives one, judged at the exit with the moment it happened', () => {
      const vs = run(N_OUT, [oncoming]);
      expect(ids(vs)).toEqual(['vehicleNotYielded']);
      expect(vs[0].t).toBeCloseTo(2, 5);
    });

    test('going straight or right, or the oncoming car turning left itself, gives none', () => {
      expect(run(E_OUT, [oncoming])).toEqual([]);
      expect(run(S_OUT, [oncoming])).toEqual([]);
      expect(run(N_OUT, [car({ fromRight: false, oncoming: true, turn: 'left' })])).toEqual([]);
    });

    test('the right-hand rule is left to the lights', () => {
      expect(run(E_OUT, [car()])).toEqual([]);
    });

    test('waiting in the junction until the oncoming car has passed is fine', () => {
      const frames = lit([
        ...repeat(20, { speed: 5, ref: W_IN }),
        ...repeat(5, { speed: 3, ref: W_IN, match: { inJunction: 'cross', onConnector: true } }),
        ...repeat(20, { speed: 0, ref: W_IN, match: { inJunction: 'cross', onConnector: true }, junctionConflicts: [oncoming] }),
        ...repeat(10, i => ({ speed: 4, heading: -i * 0.15, ref: W_IN, match: { inJunction: 'cross', onConnector: true } })),
        ...repeat(10, { speed: 5, ref: N_OUT }),
      ]);
      expect(drive(new VehicleYieldRule(road), frames)).toEqual([]);
    });

    test('an oncoming car arriving once the turn is past 45 degrees is not judged', () => {
      const frames = lit([
        ...repeat(20, { speed: 5, ref: W_IN }),
        ...repeat(15, i => ({ speed: 5, heading: -i * 0.12, ref: W_IN, match: { inJunction: 'cross', onConnector: true }, junctionConflicts: i >= 8 ? [oncoming] : [] })),
        ...repeat(10, { speed: 5, ref: N_OUT }),
      ]);
      expect(drive(new VehicleYieldRule(road), frames)).toEqual([]);
    });
  });
});
