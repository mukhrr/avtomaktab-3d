import { LaneNetwork, pointAt } from './lanes';
import { testNetwork } from './testNetwork';

const net = () => new LaneNetwork(testNetwork());

test('rightmost eastbound lane of a 7 m two-way arm sits 1.75 m south of the centreline', () => {
  const p = net().path({ edgeId: 'e', dir: 1, lane: 0 });
  for (const [, z] of p.points) expect(z).toBeCloseTo(1.75, 6);
  expect(p.points[0][0]).toBeLessThan(p.points[p.points.length - 1][0]);
});

test('westbound lane on the same arm sits on the north side and runs in travel order', () => {
  const p = net().path({ edgeId: 'e', dir: -1, lane: 0 });
  for (const [, z] of p.points) expect(z).toBeCloseTo(-1.75, 6);
  expect(p.points[0][0]).toBeGreaterThan(p.points[p.points.length - 1][0]);
});

test('path length is the trimmed edge length and start/end are edge distances', () => {
  const p = net().path({ edgeId: 'e', dir: 1, lane: 0 });
  expect(p.length).toBeCloseTo(p.endAt - p.startAt, 6);
  expect(p.startAt).toBeGreaterThan(0);
  expect(p.endAt).toBeLessThan(240);
  expect(p.length).toBeGreaterThan(220);
});

test('edgeS and pathS are inverses in both directions', () => {
  const n = net();
  for (const dir of [1, -1] as const) {
    const ref = { edgeId: 'e', dir, lane: 0 };
    const p = n.path(ref);
    expect(n.edgeS(ref, 0)).toBeCloseTo(p.startAt, 6);
    expect(n.edgeS(ref, p.length)).toBeCloseTo(p.endAt, 6);
    expect(n.pathS(ref, n.edgeS(ref, 17))).toBeCloseTo(17, 6);
  }
});

test('arriving on the west arm at the cross offers the other three arms', () => {
  const ex = net().exits({ edgeId: 'w', dir: -1, lane: 0 });
  expect(ex).toHaveLength(3);
  expect(ex.map(r => r.edgeId).sort()).toEqual(['e', 'n', 's']);
  for (const r of ex) expect(r.lane).toBe(0);
});

test('exit lane is capped at the lanes available on the target', () => {
  const ex = net().exits({ edgeId: 'tE', dir: -1, lane: 3 });
  expect(ex.length).toBeGreaterThan(0);
  for (const r of ex) expect(r.lane).toBe(0);
});

test('a dead-end stub exits by U-turn onto the reverse direction', () => {
  expect(net().exits({ edgeId: 'tStub', dir: 1, lane: 0 })).toEqual([{ edgeId: 'tStub', dir: -1, lane: 0 }]);
});

test('a oneway arrival with nothing ahead has no exits', () => {
  expect(net().exits({ edgeId: 'o1', dir: 1, lane: 0 })).toEqual([]);
});

test('a oneway edge against its direction is not an exit', () => {
  const ex = net().exits({ edgeId: 'tE', dir: 1, lane: 0 });
  expect(ex).toEqual([{ edgeId: 'o1', dir: 1, lane: 0 }]);
});

test('connector joins the end of one path to the start of the next', () => {
  const n = net();
  const from = { edgeId: 'w', dir: -1 as const, lane: 0 };
  for (const to of n.exits(from)) {
    const c = n.connector(from, to);
    const a = n.path(from).points, b = n.path(to).points;
    expect(c.length).toBeGreaterThanOrEqual(3);
    expect(c[0]).toEqual(a[a.length - 1]);
    expect(c[c.length - 1]).toEqual(b[0]);
    for (const [x, z] of c) expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
  }
});

test('connector for a U-turn has finite points', () => {
  const n = net();
  const from = { edgeId: 'tStub', dir: 1 as const, lane: 0 };
  const c = n.connector(from, n.exits(from)[0]);
  expect(c.length).toBeGreaterThanOrEqual(3);
  for (const [x, z] of c) expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true);
});

test('paths and connectors are cached', () => {
  const n = net();
  const ref = { edgeId: 'n', dir: 1 as const, lane: 0 };
  expect(n.path(ref)).toBe(n.path({ ...ref }));
});

test('pointAt returns position and heading, and clamps past the ends', () => {
  const pts: [number, number][] = [[0, 0], [0, 10], [10, 10]];
  expect(pointAt(pts, 5).position).toEqual([0, 5]);
  expect(pointAt(pts, 5).heading).toBeCloseTo(0);
  expect(pointAt(pts, 15).heading).toBeCloseTo(Math.PI / 2);
  expect(pointAt(pts, 999).position).toEqual([10, 10]);
  expect(pointAt(pts, -3).position).toEqual([0, 0]);
});
