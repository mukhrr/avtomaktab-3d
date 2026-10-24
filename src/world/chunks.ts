import * as THREE from 'three';
import type { Vec2 } from '../shared/district';

export function chunkKey(x: number, z: number, size = 200): string {
  return `${Math.floor(x / size)},${Math.floor(z / size)}`;
}

export function groupByChunk<T>(items: T[], pos: (t: T) => Vec2, size = 200): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const [x, z] = pos(item);
    const key = chunkKey(x, z, size);
    const list = out.get(key);
    if (list) list.push(item);
    else out.set(key, [item]);
  }
  return out;
}

export function centroid(poly: Vec2[]): Vec2 {
  let x = 0, z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

/** One BatchedMesh for all chunks: one draw call per pass on WEBGL_multi_draw, still culled chunk by chunk. */
export function batchChunks(chunks: THREE.BufferGeometry[], material: THREE.Material): THREE.BatchedMesh {
  const indexed = chunks[0].getIndex() !== null;
  const vertices = chunks.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const indices = indexed ? chunks.reduce((n, g) => n + g.getIndex()!.count, 0) : 0;
  const batch = new THREE.BatchedMesh(chunks.length, vertices, indices, material);
  for (const g of chunks) {
    batch.addInstance(batch.addGeometry(g));
    g.dispose();
  }
  batch.computeBoundingSphere();
  batch.castShadow = true;
  batch.receiveShadow = true;
  return batch;
}
