import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DistrictData, Vec2 } from '../shared/district';
import { CODE } from '../shared/signCatalogue';
import { LaneNetwork } from '../traffic/lanes';
import { junctionPolygon, pointAlong } from '../world/roadGeometry';
import { signPose, signSpots } from '../world/signMount';
import { distanceToPolyline } from '../../tools/city/controllers';
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

  // The examiner keeps the mapped limit for these, so they must not stand on a lane a route drives.
  it('puts no limit-changing or dead-end coverage sign on a lane a route drives', () => {
    const driven = new Set(routes.flatMap(r => r.steps.map(s => `${s.ref.edgeId}|${s.ref.dir}`)));
    const onDriven = d.signs.filter(s => s.origin === 'coverage' && ['5.22', '5.23', '5.24', '5.25', '5.19.1'].includes(s.code) && driven.has(`${s.edgeId}|${s.dir}`));
    expect(onDriven.map(s => s.id)).toEqual([]);
  });

  // speedLimitAt honours 3.25, so it must end a 3.24 of its value that a route passes first.
  it('ends a real speed limit with each coverage end-of-limit sign, on a route', () => {
    const ends = d.signs.filter(s => s.origin === 'coverage' && s.code === '3.25');
    expect(ends.length).toBeGreaterThan(0);
    for (const end of ends) {
      const start = d.signs.find(s => s.code === CODE.speedLimit && s.edgeId === end.edgeId && s.dir === end.dir && s.value === end.value && (end.at - s.at) * s.dir > 0);
      expect(start, end.id).toBeDefined();
      expect(routes.some(r => signsOnRoute(d, r).some(s => s.id === start!.id) && signsOnRoute(d, r).some(s => s.id === end.id)), end.id).toBe(true);
    }
  });

  it('stands every pole outside the junction areas', () => {
    const edges = new Map(d.graph.edges.map(e => [e.id, e]));
    const polys = d.graph.nodes.filter(n => n.edges.length >= 3).map(n => ({ id: n.id, poly: junctionPolygon(n, n.edges.map(id => edges.get(id)!)) }));
    const inside = ([x, z]: Vec2, p: Vec2[]) => {
      let c = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
      }
      return c;
    };
    const inJunction = d.signs.flatMap(s => {
      const p = signPose(edges.get(s.edgeId)!, s);
      return polys.filter(j => inside([p.x, p.z], j.poly)).map(j => `${s.id} in ${j.id}`);
    });
    expect(inJunction).toEqual([]);
  });

  // Half a metre of slack: a pole on the kerb of a road that meets another at a shallow angle grazes its edge line.
  it('stands no pole inside another road\'s carriageway', () => {
    const inRoad = d.signs.flatMap(s => {
      const p = signPose(d.graph.edges.find(e => e.id === s.edgeId)!, s);
      return d.graph.edges
        .filter(e => e.id !== s.edgeId && distanceToPolyline(e.points, [p.x, p.z]).dist < e.width / 2 - 0.5)
        .map(e => `${s.id} in ${e.id}`);
    });
    expect(inRoad).toEqual([]);
  });

  it('spreads coverage signs so no route carries more than 60', () => {
    for (const r of routes) expect(signsOnRoute(d, r).filter(s => s.origin === 'coverage').length, r.id).toBeLessThanOrEqual(60);
  });

  // A coverage 3.24 passed after a school sign would lift the school zone.
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
