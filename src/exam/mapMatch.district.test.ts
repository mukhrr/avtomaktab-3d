import { readFileSync } from 'node:fs';
import type { DistrictData, Vec2 } from '../shared/district';
import { LaneNetwork, pointAt, type LaneRef } from '../traffic/lanes';
import { MapMatcher } from './mapMatch';

const root = new URL('../../public/districts/tashkent-center/', import.meta.url);
const d: DistrictData = JSON.parse(readFileSync(new URL('district.json', root), 'utf8'));
const net = new LaneNetwork(d);
const STEP = 0.5;
const DT = STEP / 10;

/** Some lane of another road that leads into `to` through a junction. */
function approachTo(to: LaneRef): LaneRef {
  for (const e of d.graph.edges) {
    for (const dir of [1, -1] as const) {
      const n = dir === 1 ? e.lanesForward : e.lanesBackward;
      for (let lane = 0; lane < n; lane++) {
        const ref = { edgeId: e.id, dir, lane };
        if (e.id !== to.edgeId && net.exits(ref).some(x => x.edgeId === to.edgeId && x.dir === to.dir)) return ref;
      }
    }
  }
  throw new Error(`nothing leads into ${to.edgeId}`);
}

/**
 * Drives `from`, its connector and `to` at lane centre; returns the longest stretch, in metres, of `to` (outside
 * junctions) matched to another edge or dir, and what it was matched to.
 */
function wrongOn(to: LaneRef, from: LaneRef = approachTo(to)): { metres: number; other: string } {
  const m = new MapMatcher(d, net);
  const line: Vec2[] = [...net.path(from).points, ...net.connector(from, to), ...net.path(to).points];
  const target = net.path(to);
  const startTarget = line.length - target.points.length;
  let s = 0, run = 0, metres = 0, other = '';
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const end = cum[cum.length - 1] - 2;
  for (; s < end; s += STEP) {
    const { position, heading } = pointAt(line, s);
    const r = m.update(position, heading, DT);
    if (s < cum[startTarget] || r.inJunction) {
      run = 0;
      continue;
    }
    if (r.ref?.edgeId === to.edgeId && r.ref.dir === to.dir) run = 0;
    else {
      run += STEP;
      if (run > metres) [metres, other] = [run, `${r.ref?.edgeId}:${r.ref?.dir}`];
    }
  }
  return { metres, other };
}

const lanes = (edgeId: string, dir: 1 | -1): LaneRef[] => {
  const e = d.graph.edges.find(x => x.id === edgeId)!;
  return Array.from({ length: dir === 1 ? e.lanesForward : e.lanesBackward }, (_, lane) => ({ edgeId, dir, lane }));
};

describe('the matcher keeps a car in an outer lane of a wide road on that road', () => {
  // Pairs from the M3 review: a nearby edge's centreline was closer than the car's own in an outer lane.
  test.each([
    ['22813507:0', 1], ['138601197:0', 1], ['138601201:0', 1], ['138601200:0', 1], ['1508201092:0', 1],
    ['421734890:0', 1], ['633891186:0', 1], ['1183926779:1', 1], ['1452127844:0', 1], ['518933912:0', 1],
  ] as const)('every lane of %s', (edgeId, dir) => {
    // 1 m of slack: past a degree-2 node the previous edge is kept until the car projects beyond its end.
    for (const lane of lanes(edgeId, dir)) {
      const { metres, other } = wrongOn(lane);
      expect(metres, `lane ${lane.lane} matched ${other}`).toBeLessThanOrEqual(1);
    }
  });

  test('the rightmost lane of 183822026:0 into 138601200:0 stays on 138601200:0', () => {
    const from = { edgeId: '183822026:0', dir: 1 as const, lane: 0 };
    expect(wrongOn({ edgeId: '138601200:0', dir: 1, lane: 0 }, from).metres).toBe(0);
  });
});
