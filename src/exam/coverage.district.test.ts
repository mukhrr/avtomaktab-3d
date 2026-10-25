import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DistrictData, Vec2 } from '../shared/district';
import { CODE } from '../shared/signCatalogue';
import { LaneNetwork } from '../traffic/lanes';
import { pointAlong } from '../world/roadGeometry';
import { signSpots } from '../world/signMount';
import { routeConflicts } from '../../tools/signs/coverageSpots';
import { missingEntries, signsOnRoute } from './coverage';
import type { ExamRoute } from './route';

const root = new URL('../../public/districts/tashkent-center/', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const d: DistrictData = read('district.json');
const ids: string[] = read('routes/index.json').routes;
const routes: ExamRoute[] = ids.map(id => read(`routes/${id}.json`));
const net = new LaneNetwork(d);

/** Rule 3.24 mirrors the mapped limit, so only the manoeuvre checks apply to rule signs. */
const MANOEUVRE_CODES = new Set(['3.1', '3.2', '3.18.1', '3.18.2', '3.19', '4.1.1', '4.1.2', '4.1.3', '4.1.4', '4.1.5', '4.1.6', '4.3']);

describe('tashkent-center coverage', () => {
  it('meets every catalogue entry on at least one route', () => {
    expect(missingEntries(d, routes)).toEqual([]);
  });

  it('has between 2 and 6 routes, new ones 4 to 8 km', () => {
    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes.length).toBeLessThanOrEqual(6);
    for (const r of routes.filter(r => r.id !== 'route-1')) {
      expect(r.lengthM, r.id).toBeGreaterThanOrEqual(4000);
      expect(r.lengthM, r.id).toBeLessThanOrEqual(8000);
    }
  });

  // The examiner abandons a drive that leaves the district bounds.
  it('keeps every route and coverage sign inside the district bounds', () => {
    const b = d.bounds;
    const outside = ([x, z]: Vec2) => x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ;
    for (const r of routes) {
      const pts = r.steps.slice(1, -1).flatMap(s => net.path(s.ref).points);
      for (let i = 0; i < r.steps.length - 1; i++) pts.push(...net.connector(r.steps[i].ref, r.steps[i + 1].ref));
      expect(pts.filter(outside), r.id).toEqual([]);
    }
    const edges = new Map(d.graph.edges.map(e => [e.id, e]));
    const signsOutside = d.signs.filter(s => s.origin === 'coverage').filter(s => {
      const p = pointAlong(edges.get(s.edgeId)!.points, s.at);
      return outside([p.x, p.z]);
    });
    expect(signsOutside.map(s => s.id)).toEqual([]);
  });

  it('spreads coverage signs so no route carries more than 60', () => {
    for (const r of routes) expect(signsOnRoute(d, r).filter(s => s.origin === 'coverage').length, r.id).toBeLessThanOrEqual(60);
  });

  // speedLimitAt lets any passed 3.24 override a school zone, whatever the order.
  it('puts no coverage speed limit on an edge with a school sign', () => {
    const school = new Set(d.signs.filter(s => s.code === CODE.children).map(s => s.edgeId));
    expect(d.signs.filter(s => s.origin === 'coverage' && s.code === CODE.speedLimit && school.has(s.edgeId))).toEqual([]);
  });

  it('has no coverage or rule sign that conflicts with a route', () => {
    const conflicts = d.signs
      .filter(s => s.origin === 'coverage' || (s.origin === 'rule' && MANOEUVRE_CODES.has(s.code)))
      .flatMap(s => routeConflicts(s, routes, net, d));
    expect(conflicts).toEqual([]);
  });

  it('keeps every pole at 3 signs or fewer and coverage poles 15 m from others on one kerb', () => {
    const spots = signSpots(d.signs);
    expect(spots.filter(p => p.signs.length > 3).map(p => p.signs.map(s => s.id))).toEqual([]);
    // The left pole of one direction stands on the other direction's right kerb.
    const kerb = (p: (typeof spots)[number]) => `${p.edgeId}|${p.dir * (p.side === 'left' ? -1 : 1)}`;
    const crowded = spots
      .filter(p => p.signs.some(s => s.origin === 'coverage'))
      .flatMap(p => spots.filter(q => q !== p && kerb(q) === kerb(p) && Math.abs(q.at - p.at) < 15).map(q => `${p.signs[0].id} near ${q.signs[0].id}`));
    expect(crowded).toEqual([]);
  });
});
