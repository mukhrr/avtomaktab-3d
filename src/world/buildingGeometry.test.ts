import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { Building, BuildingStyle, DistrictData, Vec2 } from '../shared/district';
import { BAY_WIDTH, FACADE_CELL, FACADE_VARIANT } from './facadeAtlas';
import { insetPolygon, roofGeometry, roofShape, wallGeometry } from './buildingGeometry';
import { facadePatch } from './buildings';
import { pointInPolygon, segmentDistance } from './spatial';

const building = (footprint: Vec2[], style: BuildingStyle = 'stucco', height = 16, extra: Partial<Building> = {}): Building => ({
  id: 'w1', height, levels: Math.round(height / 3.2), style, footprint, ...extra,
});
const rect = (w: number, d: number): Vec2[] => [[0, 0], [w, 0], [w, d], [0, d]];
const L: Vec2[] = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];

const attr = (g: THREE.BufferGeometry, name: string) => g.getAttribute(name);
const values = (g: THREE.BufferGeometry, name: string, comp: number): number[] => {
  const a = attr(g, name);
  return Array.from({ length: a.count }, (_, i) => Math.round(a.getComponent(i, comp) * 1e4) / 1e4);
};

function insideOrOn(x: number, z: number, poly: Vec2[], tol = 0.01): boolean {
  if (pointInPolygon(x, z, poly)) return true;
  for (let i = 0; i < poly.length; i++) if (segmentDistance(x, z, poly[i], poly[(i + 1) % poly.length]).d <= tol) return true;
  return false;
}

describe('wallGeometry', () => {
  test('a 30 m stucco wall has u from 0 to 8 bays', () => {
    const g = wallGeometry(building([[0, 0], [30, 0], [30, 20], [0, 20]]));
    expect(BAY_WIDTH.stucco).toBe(3.6);
    const pos = attr(g, 'position');
    const us: number[] = [];
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) === 0) us.push(attr(g, 'uv').getX(i));
    expect(Math.min(...us)).toBe(0);
    expect(Math.max(...us)).toBe(8);
  });

  test('a 1.5 m segment is plain for its full height', () => {
    const g = wallGeometry(building([[0, 0], [20, 0], [20, 10], [1.5, 10], [0, 9]]));
    const cells = values(g, 'facade', 0);
    expect(new Set(cells.slice(3 * 8, 4 * 8))).toEqual(new Set([FACADE_CELL.stucco.plain]));
    expect(cells.some(c => c === FACADE_CELL.stucco.upper || c === FACADE_VARIANT.stuccoRail.cell)).toBe(true);
  });

  test('a shed is plain everywhere', () => {
    const g = wallGeometry(building(rect(30, 20), 'shed', 6.5));
    expect(new Set(values(g, 'facade', 0))).toEqual(new Set([FACADE_CELL.shed.plain]));
  });

  test('ground strip ends at the first floor height, upper strip at the roof', () => {
    expect(new Set(values(wallGeometry(building(rect(30, 20))), 'position', 1))).toEqual(new Set([0, 3.2, 16]));
    expect(new Set(values(wallGeometry(building(rect(30, 20), 'public', 20)), 'position', 1))).toEqual(new Set([0, 4.5, 20]));
  });

  test('ground and upper strips carry their cells', () => {
    const g = wallGeometry(building(rect(30, 20), 'panel'));
    const ys = values(g, 'position', 1), cells = values(g, 'facade', 0);
    ys.forEach((y, i) => {
      if (y === 0) expect(cells[i]).toBe(FACADE_CELL.panel.ground);
    });
    expect(cells.some(c => c !== FACADE_CELL.panel.ground)).toBe(true);
  });

  test('upper strip v is a whole number of floors', () => {
    const g = wallGeometry(building(rect(30, 20), 'stucco', 17));
    for (const v of values(g, 'uv', 1)) expect(Number.isInteger(v)).toBe(true);
  });

  test('8 vertices per segment', () => {
    expect(attr(wallGeometry(building(rect(30, 20))), 'position').count).toBe(4 * 8);
    expect(attr(wallGeometry(building(L)), 'position').count).toBe(6 * 8);
  });

  test('faces point outward', () => {
    const g = wallGeometry(building(L));
    const pos = attr(g, 'position'), nor = attr(g, 'normal'), idx = g.getIndex()!;
    for (let t = 0; t < idx.count; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a);
      const vx = pos.getX(c) - pos.getX(a), vy = pos.getY(c) - pos.getY(a), vz = pos.getZ(c) - pos.getZ(a);
      const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
      if (Math.hypot(nx, nz) < 1e-9) continue;
      expect(nx * nor.getX(a) + nz * nor.getZ(a)).toBeGreaterThan(0);
      const mx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, mz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      expect(pointInPolygon(mx + nor.getX(a) * 0.1, mz + nor.getZ(a) * 0.1, L)).toBe(false);
    }
  });
});

describe('roofGeometry', () => {
  const cases: Array<[string, Vec2[]]> = [['rectangle', rect(30, 20)], ['L shape', L], ['thin 3 m', rect(40, 3)]];
  for (const [name, fp] of cases) {
    for (const style of ['panel', 'stucco', 'public'] as const) {
      test(`every roof vertex of a ${style} ${name} lies inside or on the footprint`, () => {
        for (let seed = 0; seed < 20; seed++) {
          const pos = attr(roofGeometry(building(fp, style), seed), 'position');
          for (let i = 0; i < pos.count; i++) expect(insideOrOn(pos.getX(i), pos.getZ(i), fp)).toBe(true);
        }
      });
    }
  }

  test('a flat roof has a 0.6 m parapet and up to 3 boxes', () => {
    let boxes = 0;
    for (let seed = 0; seed < 20; seed++) {
      const ys = values(roofGeometry(building(rect(30, 20), 'panel'), seed), 'position', 1);
      expect(Math.max(...ys)).toBeGreaterThanOrEqual(16.6 - 1e-6);
      expect(ys).toContain(16.6);
      if (ys.some(y => y > 16.6 + 1e-6)) boxes++;
    }
    expect(boxes).toBeGreaterThan(0);
  });

  test('the thin footprint gets no parapet', () => {
    const ys = values(roofGeometry(building(rect(40, 3), 'stucco'), 1), 'position', 1);
    expect(Math.max(...ys)).toBeCloseTo(16, 6);
  });

  test('the inward offset of the L shape stays inside it', () => {
    const inset = insetPolygon(L, 0.25)!;
    expect(inset).toHaveLength(6);
    for (const [x, z] of inset) expect(pointInPolygon(x, z, L)).toBe(true);
    expect(insetPolygon(rect(40, 3), 2)).toBeNull();
  });

  test('brick and shed roofs have no boxes', () => {
    for (let seed = 0; seed < 20; seed++) {
      const ys = values(roofGeometry(building(L, 'brick', 9), seed), 'position', 1);
      expect(Math.max(...ys)).toBeLessThanOrEqual(9.6 + 1e-6);
    }
  });

  test('hipped roofs only on convex 4-corner brick footprints', () => {
    expect(roofShape(building(rect(12, 10), 'brick', 6))).toBe('hipped');
    expect(roofShape(building([[0, 0], [6, 0.004], [12, 0], [12, 10], [0, 10]], 'brick', 6))).toBe('hipped');
    expect(roofShape(building(L, 'brick', 6))).toBe('flat');
    expect(roofShape(building(rect(40, 10), 'brick', 6))).toBe('flat');
    expect(roofShape(building(rect(12, 10), 'stucco', 6))).toBe('flat');
    expect(roofShape(building(rect(12, 10), 'stucco', 6, { roof: 'hipped' }))).toBe('hipped');
    expect(roofShape(building(L, 'public', 6, { roof: 'hipped' }))).toBe('flat');
  });

  test('a hipped roof is 2 m high and inside the footprint', () => {
    const fp = rect(12, 10);
    const pos = attr(roofGeometry(building(fp, 'brick', 6), 3), 'position');
    const ys = values(roofGeometry(building(fp, 'brick', 6), 3), 'position', 1);
    expect(Math.max(...ys)).toBeCloseTo(8, 6);
    for (let i = 0; i < pos.count; i++) expect(insideOrOn(pos.getX(i), pos.getZ(i), fp)).toBe(true);
  });
});

describe('real district', () => {
  const root = new URL('../../public/districts/tashkent-center/', import.meta.url);
  const d: DistrictData = JSON.parse(readFileSync(new URL('district.json', root), 'utf8'));

  test('walls and roofs stay under 250k triangles', () => {
    let tris = 0;
    for (const b of d.buildings) {
      const w = wallGeometry(b);
      tris += w.getIndex()!.count / 3;
      tris += attr(roofGeometry(b, 1), 'position').count / 3;
    }
    expect(tris).toBeLessThan(250_000);
  });

  test('every roof vertex lies inside or on its footprint', () => {
    for (const b of d.buildings) {
      const pos = attr(roofGeometry(b, 1), 'position');
      for (let i = 0; i < pos.count; i++) expect(insideOrOn(pos.getX(i), pos.getZ(i), b.footprint, 0.02)).toBe(true);
    }
  });
});

describe('facadePatch', () => {
  for (const lib of ['lambert', 'physical'] as const) {
    test(`maps uv into the atlas cell on ${lib}`, () => {
      const shader = { vertexShader: THREE.ShaderLib[lib].vertexShader, fragmentShader: THREE.ShaderLib[lib].fragmentShader } as THREE.WebGLProgramParametersWithUniforms;
      facadePatch(shader);
      expect(shader.vertexShader).toContain('attribute float facade;');
      expect(shader.vertexShader).toContain('vFacade = facade;');
      expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
      expect(shader.fragmentShader).toContain('fract( vMapUv )');
    });
  }
});
