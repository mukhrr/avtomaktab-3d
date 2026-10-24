import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DistrictData, Landmark, LandmarkKind } from '../../shared/district';
import type { LandmarkParts, LandmarkTexture } from './common';
import { amirTemurParts } from './amirTemur';
import { fountainParts } from './fountain';
import { hotelUzbekistanParts, createLatticeTexture } from './hotelUzbekistan';
import { kurantyParts, createClockTexture } from './kuranty';
import { forumsPalaceParts } from './forumsPalace';
import { timuridMuseumParts } from './timuridMuseum';

export type { LandmarkParts, LandmarkTexture } from './common';

const BUILDERS: Record<LandmarkKind, (l: Landmark) => LandmarkParts> = {
  amirTemur: amirTemurParts,
  fountain: fountainParts,
  hotelUzbekistan: hotelUzbekistanParts,
  kuranty: kurantyParts,
  forumsPalace: forumsPalaceParts,
  timuridMuseum: timuridMuseumParts,
};

export const landmarkParts = (l: Landmark): LandmarkParts => BUILDERS[l.kind](l);

export type LandmarkTextures = Record<LandmarkTexture, THREE.Texture>;

/** Needs a DOM canvas; call once in the browser and pass the result to every buildLandmark. */
export function createLandmarkTextures(): LandmarkTextures {
  return { lattice: createLatticeTexture(), clock: createClockTexture() };
}

/** Without textures the textured parts get their fallback colour, which keeps node tests canvas-free. */
export function buildLandmark(l: Landmark, textures?: LandmarkTextures): THREE.Group {
  const parts = landmarkParts(l);
  const group = new THREE.Group();
  group.name = `landmark:${l.id}`;
  group.position.set(l.x, 0, l.z);
  group.rotation.y = l.heading;

  const solid = new THREE.Mesh(parts.solid, new THREE.MeshLambertMaterial({ vertexColors: true }));
  solid.castShadow = solid.receiveShadow = true;
  group.add(solid);

  if (parts.textured) {
    const { geometry, texture, fallback } = parts.textured;
    const map = textures?.[texture];
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial(map ? { map } : { color: fallback }));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  if (parts.transparent) {
    const mesh = new THREE.Mesh(
      parts.transparent,
      new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    group.add(mesh);
  }
  return group;
}

const KEEP = { solid: ['position', 'normal', 'color'], textured: ['position', 'normal', 'uv'] };

function toWorld(l: Landmark, g: THREE.BufferGeometry, keep: string[]): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  for (const name of Object.keys(flat.attributes)) if (!keep.includes(name)) flat.deleteAttribute(name);
  return flat.applyMatrix4(new THREE.Matrix4().makeRotationY(l.heading).setPosition(l.x, 0, l.z));
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('landmark parts have mismatched attributes');
  parts.forEach(p => p.dispose());
  return g;
}

/** Every landmark merged in world space, one mesh per material, so all of them cost at most four draw calls. */
export function addLandmarks(scene: THREE.Scene, d: DistrictData, textures?: LandmarkTextures): void {
  const solid: THREE.BufferGeometry[] = [], transparent: THREE.BufferGeometry[] = [];
  const textured = new Map<LandmarkTexture, { parts: THREE.BufferGeometry[]; fallback: number }>();
  for (const l of d.landmarks) {
    const p = landmarkParts(l);
    solid.push(toWorld(l, p.solid, KEEP.solid));
    if (p.transparent) transparent.push(toWorld(l, p.transparent, KEEP.solid));
    if (p.textured) {
      const t = textured.get(p.textured.texture) ?? { parts: [], fallback: p.textured.fallback };
      t.parts.push(toWorld(l, p.textured.geometry, KEEP.textured));
      textured.set(p.textured.texture, t);
    }
  }
  if (!solid.length) return;

  const group = new THREE.Group();
  group.name = 'landmarks';
  const add = (g: THREE.BufferGeometry, m: THREE.Material, shadows: boolean) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
  };
  add(mergeAll(solid), new THREE.MeshLambertMaterial({ vertexColors: true }), true);
  for (const [texture, { parts, fallback }] of textured) {
    const map = textures?.[texture];
    add(mergeAll(parts), new THREE.MeshLambertMaterial(map ? { map } : { color: fallback }), true);
  }
  if (transparent.length) {
    add(mergeAll(transparent), new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }), false);
  }
  scene.add(group);
}
