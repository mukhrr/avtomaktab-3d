import * as THREE from 'three';
import type { QualitySettings } from '../render/quality';

export type GroundSurface = 'asphalt' | 'sidewalk' | 'curb' | 'grass' | 'ground';

/** tile is the world-space size in metres of one texture repeat. */
const SURFACES: Record<GroundSurface, { color: number; tint: number; roughness: number; tile: number }> = {
  asphalt: { color: 0x3d4045, tint: 0x8c8c8c, roughness: 0.92, tile: 4 },
  sidewalk: { color: 0xc9bfae, tint: 0xffffff, roughness: 0.85, tile: 3 },
  curb: { color: 0xa8a39a, tint: 0xd8d4cc, roughness: 0.88, tile: 2 },
  grass: { color: 0x6f9a4a, tint: 0xffffff, roughness: 1, tile: 6 },
  ground: { color: 0xb8ab8c, tint: 0xffffff, roughness: 1, tile: 8 },
};

export const GROUND_TILE: Record<GroundSurface, number> = Object.fromEntries(
  Object.entries(SURFACES).map(([k, v]) => [k, v.tile]),
) as Record<GroundSurface, number>;

export function createGroundMaterial(q: QualitySettings, name: GroundSurface, loader: THREE.TextureLoader = new THREE.TextureLoader()): THREE.Material {
  const s = SURFACES[name];
  if (!q.groundTextures) return new THREE.MeshLambertMaterial({ color: s.color });
  const mat = new THREE.MeshStandardMaterial({ color: s.tint, roughness: s.roughness, metalness: 0 });
  // uv = (x, z) makes the tangent frame left-handed, so GL normal maps need green flipped.
  mat.normalScale.set(1, -1);
  let failed = false;
  const fallBack = () => {
    mat.map = null;
    mat.normalMap = null;
    mat.color.set(s.color);
    mat.needsUpdate = true;
  };
  const onError = () => {
    if (!failed) console.warn(`ground texture missing for ${name}, using flat colour`);
    failed = true;
    fallBack();
  };
  const tex = (kind: 'color' | 'normal') => {
    const t = loader.load(`/textures/${name}_${kind}.jpg`, undefined, undefined, onError);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    return t;
  };
  mat.map = tex('color');
  mat.normalMap = tex('normal');
  if (failed) fallBack();
  return mat;
}

export function createGroundMaterials(q: QualitySettings, loader?: THREE.TextureLoader): Record<GroundSurface, THREE.Material> {
  return Object.fromEntries((Object.keys(SURFACES) as GroundSurface[]).map(n => [n, createGroundMaterial(q, n, loader)])) as Record<GroundSurface, THREE.Material>;
}
