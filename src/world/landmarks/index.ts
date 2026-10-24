import * as THREE from 'three';
import type { Landmark, LandmarkKind } from '../../shared/district';
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
