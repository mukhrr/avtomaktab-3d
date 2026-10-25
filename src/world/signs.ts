import * as THREE from 'three';
import type { DistrictData } from '../shared/district';
import { plateKey } from '../shared/signCatalogue';
import type { Atlas } from '../../tools/signs/atlas';
import { mountSigns, signPose } from './signMount';

export { signPose };

export type SignArt = { atlas: Atlas; texture: THREE.Texture };

const FACE_OFFSET = 0.06;
const POLE_RADIUS = 0.04;
const ANISOTROPY = 8;

/** The sign atlas and its texture, or null (logged once) when either is missing. */
export async function loadSignAtlas(url = '/signs/atlas.json'): Promise<SignArt | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const atlas = (await res.json()) as Atlas;
    const texture = await new THREE.TextureLoader().loadAsync(url.replace(/\.json$/, '.png'));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = ANISOTROPY;
    return { atlas, texture };
  } catch (err) {
    console.error(`signs: could not load the sign atlas ${url}, the city starts without signs`, err);
    return null;
  }
}

const facePatch = (shader: THREE.WebGLProgramParametersWithUniforms) => {
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'attribute vec4 aCell;\nvoid main() {')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = uv * aCell.zw + aCell.xy;');
  // The back of a sign is plain metal cut to the sign's outline.
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    'vec4 sampledDiffuseColor = texture2D( map, vMapUv );\nif ( !gl_FrontFacing ) sampledDiffuseColor.rgb = vec3( 0.55, 0.57, 0.6 );\ndiffuseColor *= sampledDiffuseColor;',
  );
};

/** Every sign and plate as one instanced quad mesh from the atlas, on one instanced pole mesh. */
export function addSigns(scene: THREE.Scene, d: DistrictData, art: SignArt | null): void {
  if (!art || !d.signs.length) return;
  const keysOf = (s: DistrictData['signs'][number]) => [plateKey(s.code, s.value), ...(s.plates ?? []).map(p => plateKey(p.code, p.value))];
  const drawable = d.signs.filter(s => keysOf(s).every(k => art.atlas.cells[k]));
  if (drawable.length < d.signs.length) {
    const missing = d.signs.filter(s => !drawable.includes(s)).map(s => `${s.id} (${keysOf(s).filter(k => !art.atlas.cells[k]).join(', ')})`);
    console.error(`signs: no atlas cell for ${missing.length} sign(s), skipped: ${missing.join('; ')}`);
  }
  const edges = new Map(d.graph.edges.map(e => [e.id, e]));
  const { poles, faces } = mountSigns(drawable, edges);
  if (!faces.length) return;

  const material = new THREE.MeshLambertMaterial({ map: art.texture, alphaTest: 0.5, side: THREE.DoubleSide });
  material.userData.patchShader = facePatch;
  const quad = new THREE.PlaneGeometry(1, 1);
  const cells = new Float32Array(faces.length * 4);
  const quads = new THREE.InstancedMesh(quad, material, faces.length);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  faces.forEach((f, i) => {
    const key = f.plateIndex === null ? keysOf(f.sign)[0] : keysOf(f.sign)[f.plateIndex + 1];
    const cell = art.atlas.cells[key];
    cells.set([cell.u, cell.v, cell.w, cell.h], i * 4);
    const pole = poles[f.pole];
    const { heading } = signPose(edges.get(f.sign.edgeId)!, f.sign);
    q.setFromAxisAngle(up, heading);
    p.set(pole.x + Math.sin(heading) * FACE_OFFSET, f.y, pole.z + Math.cos(heading) * FACE_OFFSET);
    quads.setMatrixAt(i, m.compose(p, q, s.set(cell.size[0], cell.size[1], 1)));
  });
  quad.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 4));

  const posts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, 1, 8).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: 0x8a8d91 }),
    poles.length,
  );
  q.identity();
  poles.forEach((pole, i) => posts.setMatrixAt(i, m.compose(p.set(pole.x, 0, pole.z), q, s.set(1, pole.height, 1))));

  for (const mesh of [quads, posts]) {
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
}
