import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DistrictData, FurnitureKind } from '../shared/district';
import { SHELTER_LENGTH } from '../../tools/city/furniture';
import { paint } from './streetside';

export { SHELTER_LENGTH };

const SHELTER_DEPTH = 1.6;
const SHELTER_HEIGHT = 2.5;

export interface ShelterBox { x: number; z: number; heading: number; halfLength: number; halfDepth: number; halfHeight: number }

export function shelterBoxes(d: DistrictData): ShelterBox[] {
  return d.furniture
    .filter(f => f.kind === 'busStop')
    .map(f => ({ x: f.x, z: f.z, heading: f.heading, halfLength: SHELTER_LENGTH / 2, halfDepth: SHELTER_DEPTH / 2, halfHeight: SHELTER_HEIGHT / 2 }));
}

const box = (w: number, h: number, dp: number, x: number, y: number, z: number, hex: number) =>
  paint(new THREE.BoxGeometry(w, h, dp).translate(x, y, z), hex);

const merge = (parts: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(parts.map(p => (p.index ? p.toNonIndexed() : p)), false);
  parts.forEach(p => p.dispose());
  return g;
};

/** All furniture faces +z at heading 0: the shelter's open front and the bench seat look toward the road. */
export function shelterGeometry(): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const frame = 0x4a4f54, roof = 0x3b6ea5, panel = 0xc9c2b2, wood = 0x8a6a45;
  const body = merge([
    box(4.2, 0.1, 1.9, 0, 2.45, 0.1, roof),
    ...[-1.95, 1.95].flatMap(x => [-0.7, 0.7].map(z => box(0.08, 2.4, 0.08, x, 1.2, z, frame))),
    box(0.05, 1.9, 1.4, 1.95, 1.2, 0, panel),
    box(1.8, 0.06, 0.4, -0.5, 0.45, -0.45, wood),
    ...[-1.3, 0.3].map(x => box(0.06, 0.45, 0.4, x, 0.225, -0.45, frame)),
  ]);
  const glass = merge([box(3.8, 1.9, 0.03, 0, 1.2, -0.7, 0xaad4d8)]);
  return { body, glass };
}

export function benchGeometry(): THREE.BufferGeometry {
  const wood = 0x8b6b43, metal = 0x3d4044;
  return merge([
    ...[0.12, 0, -0.12].map(z => box(1.6, 0.04, 0.1, 0, 0.45, z, wood)),
    ...[0.7, 0.85].map(y => box(1.6, 0.1, 0.03, 0, y, -0.2, wood)),
    ...[-0.7, 0.7].map(x => box(0.06, 0.45, 0.4, x, 0.225, 0, metal)),
    ...[-0.7, 0.7].map(x => box(0.05, 0.4, 0.05, x, 0.65, -0.2, metal)),
  ]);
}

export function binGeometry(): THREE.BufferGeometry {
  return merge([
    paint(new THREE.CylinderGeometry(0.2, 0.17, 0.7, 10).translate(0, 0.35, 0), 0x2f4a3a),
    paint(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 10).translate(0, 0.725, 0), 0x777b7e),
  ]);
}

/** Four instanced meshes: shelter body, shelter glass (transparent, so its own mesh), benches and bins. */
export function addFurniture(scene: THREE.Scene, d: DistrictData): void {
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
  const glass = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false });
  const shelter = shelterGeometry();
  const parts: [FurnitureKind, THREE.BufferGeometry, THREE.Material, boolean][] = [
    ['busStop', shelter.body, solid, true],
    ['busStop', shelter.glass, glass, false],
    ['bench', benchGeometry(), solid, false],
    ['bin', binGeometry(), solid, false],
  ];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  for (const [kind, geometry, material, shadow] of parts) {
    const own = d.furniture.filter(f => f.kind === kind);
    if (!own.length) continue;
    const mesh = new THREE.InstancedMesh(geometry, material, own.length);
    own.forEach((f, i) => mesh.setMatrixAt(i, m.compose(p.set(f.x, 0, f.z), q.setFromAxisAngle(up, f.heading), one)));
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
}
