import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Building, DistrictData } from '../shared/district';

/** Road surface height; the ground collider top sits here so wheels rest on the asphalt. */
export const DRIVE_SURFACE_Y = 0.09;
const GROUND_MARGIN = 500;

export async function createPhysics(d: DistrictData): Promise<{ world: RAPIER.World }> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  const { minX, maxX, minZ, maxZ } = d.bounds;
  const hx = (maxX - minX) / 2 + GROUND_MARGIN, hz = (maxZ - minZ) / 2 + GROUND_MARGIN;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, 0.5, hz).setTranslation((minX + maxX) / 2, DRIVE_SURFACE_Y - 0.5, (minZ + maxZ) / 2),
  );
  for (const b of d.buildings) {
    const { vertices, indices } = buildingMesh(b);
    world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(0.3));
  }
  return { world };
}

/** Closed prism of a footprint: walls, roof and floor. Exact for concave footprints, unlike a convex hull. */
export function buildingMesh(b: Building): { vertices: Float32Array; indices: Uint32Array } {
  const n = b.footprint.length;
  const v: number[] = [];
  for (const [x, z] of b.footprint) v.push(x, 0, z);
  for (const [x, z] of b.footprint) v.push(x, b.height, z);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + j, i, n + j, n + i);
  }
  const caps = THREE.ShapeUtils.triangulateShape(b.footprint.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [a, c, e] of caps) idx.push(n + a, n + c, n + e, a, e, c);
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx) };
}
