import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { DistrictData, Landmark, LandmarkKind, Vec2 } from '../../shared/district';
import { pointInPolygon, segmentDistance } from '../spatial';
import { buildLandmark } from './index';

const d: DistrictData = JSON.parse(readFileSync(new URL('../../../public/districts/tashkent-center/district.json', import.meta.url), 'utf8'));
const heightOf = new Map(d.buildings.map(b => [b.id, b.height]));
const TOL = 0.05;
const OVER_ROOF = new Set<LandmarkKind>(['kuranty', 'forumsPalace', 'timuridMuseum']);

function meshes(g: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  g.updateMatrixWorld(true);
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}

function worldVertices(g: THREE.Object3D): THREE.Vector3[] {
  return meshes(g).flatMap(m => {
    const pos = m.geometry.getAttribute('position');
    return Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  });
}

const triangles = (g: THREE.Object3D) => meshes(g).reduce((s, m) => {
  const idx = m.geometry.index;
  return s + (idx ? idx.count : m.geometry.getAttribute('position').count) / 3;
}, 0);

function insideFootprint(x: number, z: number, poly: Vec2[]): boolean {
  if (pointInPolygon(x, z, poly)) return true;
  return poly.some((a, i) => segmentDistance(x, z, a, poly[(i + 1) % poly.length]).d <= TOL);
}

const top = (g: THREE.Object3D) => new THREE.Box3().setFromObject(g).max.y;
const byKind = (k: LandmarkKind) => d.landmarks.filter(l => l.kind === k);

describe('landmark models', () => {
  it('covers every kind in the district', () => {
    expect(new Set(d.landmarks.map(l => l.kind)).size).toBe(6);
  });

  it.each(d.landmarks.map(l => [l.kind, l] as [LandmarkKind, Landmark]))('%s builds at least one non-empty mesh', (_k, l) => {
    const g = buildLandmark(l);
    const ms = meshes(g);
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every(m => m.geometry.getAttribute('position')?.count > 0)).toBe(true);
  });

  it('stays under 120k triangles for the whole district', () => {
    const total = d.landmarks.reduce((s, l) => s + triangles(buildLandmark(l)), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(120_000);
  });

  it.each(d.landmarks.filter(l => l.footprint).map(l => [l.kind, l] as [LandmarkKind, Landmark]))(
    '%s stays inside its footprint prism',
    (kind, l) => {
      const height = heightOf.get(l.buildingId!)!;
      const outside = worldVertices(buildLandmark(l)).filter(v => {
        if (v.y < -TOL) return true;
        if (v.y > height + TOL) return !OVER_ROOF.has(kind);
        return !insideFootprint(v.x, v.z, l.footprint!);
      });
      expect(outside.slice(0, 3)).toEqual([]);
    },
  );

  it('keeps free-standing landmarks within their radius', () => {
    for (const l of d.landmarks.filter(l => !l.footprint)) {
      const far = worldVertices(buildLandmark(l)).filter(v => Math.hypot(v.x - l.x, v.z - l.z) > l.radius! + TOL);
      expect(far.slice(0, 3)).toEqual([]);
    }
  });

  it('puts the monument top between 10 and 12 m', () => {
    const t = top(buildLandmark(byKind('amirTemur')[0]));
    expect(t).toBeGreaterThanOrEqual(10);
    expect(t).toBeLessThanOrEqual(12);
  });

  it('puts the Kuranty top between 30 and 34 m', () => {
    const t = top(buildLandmark(byKind('kuranty')[0]));
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThanOrEqual(34);
  });

  it('tops the Forums palace dome at 40.2 m and the hotel at 71.5 m', () => {
    expect(top(buildLandmark(byKind('forumsPalace')[0]))).toBeCloseTo(40.2, 1);
    expect(top(buildLandmark(byKind('hotelUzbekistan')[0]))).toBeCloseTo(71.5, 1);
  });

  it('puts the museum dome near 20 m', () => {
    const t = top(buildLandmark(byKind('timuridMuseum')[0]));
    expect(t).toBeGreaterThan(18);
    expect(t).toBeLessThan(23);
  });

  it('is deterministic', () => {
    for (const l of d.landmarks) {
      const a = meshes(buildLandmark(l)).map(m => Array.from(m.geometry.getAttribute('position').array));
      const b = meshes(buildLandmark(l)).map(m => Array.from(m.geometry.getAttribute('position').array));
      expect(a).toEqual(b);
    }
  });

  it('gives the hotel and Kuranty textured parts with uvs', () => {
    for (const k of ['hotelUzbekistan', 'kuranty'] as const) {
      const ms = meshes(buildLandmark(byKind(k)[0]));
      expect(ms.some(m => m.geometry.getAttribute('uv') && !(m.material as THREE.MeshLambertMaterial).vertexColors)).toBe(true);
    }
  });
});
