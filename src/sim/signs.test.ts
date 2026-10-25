import { testNetwork } from '../traffic/testNetwork';
import type { DistrictData, Sign } from '../shared/district';
import { SignSystem } from './signs';
import { CODE } from '../shared/signCatalogue';

// Edge e runs from the cross (0,0) to the T (240,0), 240 m, 60 km/h, two-way.
function withSigns(signs: Sign[]): DistrictData {
  return { ...testNetwork(), signs };
}
const sign = (id: string, code: string, at: number, dir: 1 | -1 = 1, extra: Partial<Sign> = {}): Sign =>
  ({ id, code, edgeId: 'e', dir, at, origin: 'hand', ...extra });

describe('ahead', () => {
  const sys = new SignSystem(withSigns([
    sign('far', CODE.pedestrianCrossing, 180),
    sign('near', CODE.giveWay, 100),
    sign('back', CODE.stop, 20),
    sign('opposite', CODE.noEntry, 120, -1),
  ]));

  it('lists signs in travel order within range and ignores the other direction', () => {
    expect(sys.ahead('e', 1, 50, 200).map(s => s.id)).toEqual(['near', 'far']);
    expect(sys.ahead('e', 1, 50, 60).map(s => s.id)).toEqual(['near']);
  });

  it('counts down from the far end when travelling backward', () => {
    expect(sys.ahead('e', -1, 200, 100).map(s => s.id)).toEqual(['opposite']);
    expect(sys.ahead('e', -1, 100, 100)).toEqual([]);
  });

  it('includes a sign exactly at the position and excludes one just passed', () => {
    expect(sys.ahead('e', 1, 100, 10).map(s => s.id)).toEqual(['near']);
    expect(sys.ahead('e', 1, 100.5, 10)).toEqual([]);
  });

  it('is empty on an edge without signs', () => {
    expect(sys.ahead('w', 1, 0, 500)).toEqual([]);
  });
});

describe('atJunction', () => {
  const sys = new SignSystem(withSigns([
    sign('give', CODE.giveWay, 228),
    sign('left', CODE.noLeftTurn, 226),
    sign('speed', CODE.speedLimit, 230, 1, { value: 40 }),
    sign('crossing', CODE.pedestrianCrossing, 200),
    sign('early', CODE.stop, 100),
    sign('other', CODE.stop, 228, -1),
  ]));

  it('returns the junction signs near the end of the lane in its travel direction', () => {
    expect(sys.atJunction({ edgeId: 'e', dir: 1, lane: 0 }).map(s => s.id).sort()).toEqual(['give', 'left']);
  });

  it('measures from the edge start when travelling backward', () => {
    const near = new SignSystem(withSigns([sign('b', CODE.stop, 12, -1), sign('f', CODE.stop, 12, 1)]));
    expect(near.atJunction({ edgeId: 'e', dir: -1, lane: 0 }).map(s => s.id)).toEqual(['b']);
  });
});

describe('speedLimitAt', () => {
  const sys = new SignSystem(withSigns([
    sign('fifty', CODE.speedLimit, 40, 1, { value: 50 }),
    sign('forty', CODE.speedLimit, 120, 1, { value: 40 }),
    sign('oppositeTen', CODE.speedLimit, 10, -1, { value: 10 }),
  ]));

  it('is the edge maxspeed before any sign', () => {
    expect(sys.speedLimitAt('e', 1, 10)).toBe(60);
  });

  it('picks the latest speed limit sign passed', () => {
    expect(sys.speedLimitAt('e', 1, 40)).toBe(50);
    expect(sys.speedLimitAt('e', 1, 119)).toBe(50);
    expect(sys.speedLimitAt('e', 1, 200)).toBe(40);
  });

  it('reads signs for the direction of travel only', () => {
    expect(sys.speedLimitAt('e', -1, 230)).toBe(60);
    expect(sys.speedLimitAt('e', -1, 5)).toBe(10);
  });

  it('applies a school zone of 30 for 150 m after the sign', () => {
    const school = new SignSystem(withSigns([sign('sch', CODE.children, 20)]));
    expect(school.speedLimitAt('e', 1, 19)).toBe(60);
    expect(school.speedLimitAt('e', 1, 20)).toBe(30);
    expect(school.speedLimitAt('e', 1, 170)).toBe(30);
    expect(school.speedLimitAt('e', 1, 171)).toBe(60);
  });

  it('never raises a lower limit with a school zone', () => {
    const d = withSigns([sign('sch', CODE.children, 20)]);
    d.graph.edges = d.graph.edges.map(e => (e.id === 'e' ? { ...e, maxspeed: 20 } : e));
    expect(new SignSystem(d).speedLimitAt('e', 1, 50)).toBe(20);
  });

  it('lets an explicit speed limit sign win over a school zone', () => {
    const both = new SignSystem(withSigns([sign('sch', CODE.children, 20), sign('lim', CODE.speedLimit, 60, 1, { value: 50 })]));
    expect(both.speedLimitAt('e', 1, 100)).toBe(50);
  });
});
