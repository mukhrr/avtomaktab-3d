import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bodyGeometry } from '../traffic/carModels';

export const WHEEL_POSITIONS: [number, number, number][] = [
  [-0.74, -0.25, 1.31], [0.74, -0.25, 1.31], [-0.74, -0.25, -1.31], [0.74, -0.25, -1.31],
];

/** The road under the chassis centre once the car has settled on its springs. */
export const GROUND_Y = -0.787;

// Brake dive pivots near the front axle at wheel-centre height, as a real car's nose dips on its front springs.
const LEAN_PIVOT = new THREE.Vector3(0, -0.477, 0.7);

const LENGTH = 4.48;
const WIDTH = 1.74;
const TYRE_RADIUS = 0.31;
const TYRE_WIDTH = 0.2;
const RIM_RADIUS = (15 * 0.0254) / 2;

function rimGeometry(side: number): THREE.BufferGeometry {
  const disc = new THREE.CylinderGeometry(RIM_RADIUS, RIM_RADIUS, 0.02, 16).rotateZ(Math.PI / 2);
  // Dark slots between five spokes, so the spin shows.
  const slots = Array.from({ length: 5 }, (_, i) =>
    new THREE.BoxGeometry(0.012, 0.11, 0.04).translate(side * 0.008, 0.11, 0).rotateX((i * 2 * Math.PI) / 5));
  const parts = [disc, ...slots].map((g, i) => {
    const flat = g.toNonIndexed();
    g.dispose();
    flat.deleteAttribute('uv');
    const c = new THREE.Color(i === 0 ? 0xb4b8bc : 0x2a2b2e);
    const colours = new Float32Array(flat.getAttribute('position').count * 3);
    for (let k = 0; k < colours.length; k += 3) colours.set([c.r, c.g, c.b], k);
    flat.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    return flat;
  });
  const rim = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  return rim.translate((side * TYRE_WIDTH) / 2, 0, 0);
}

export const MODEL_URL = '/models/gentra.glb';

/** The processed Gentra glb (tools/model/gentra.ts), or null when it fails to load so the code-built body stands in. */
export async function loadCarBody(url = MODEL_URL, loader: Pick<GLTFLoader, 'loadAsync'> = new GLTFLoader()): Promise<THREE.Object3D | null> {
  try {
    const gltf = await loader.loadAsync(url);
    return gltf.scene;
  } catch (e) {
    console.warn(`car model ${url} failed to load, using the built-in body`, e);
    return null;
  }
}

/**
 * White Chevrolet Gentra sedan facing +z, centred on the physics box. The body hangs in `lean`, a visual-only
 * pivot; the wheels hang on `root` so they stay on the road while the body pitches and rolls. `model` is the loaded
 * glb scene; without it the body and wheels are built in code.
 */
export function createCarModel(model: THREE.Object3D | null = null): { root: THREE.Group; lean: THREE.Group; wheels: THREE.Object3D[] } {
  const root = new THREE.Group();
  const lean = new THREE.Group();
  lean.name = 'lean';
  lean.position.copy(LEAN_PIVOT);
  const body = new THREE.Group();
  body.position.copy(LEAN_PIVOT).negate();
  lean.add(body);
  root.add(lean);
  const wheels = model ? fitModel(model, root, body) : buildBody(root, body);
  return { root, lean, wheels };
}

function fitModel(model: THREE.Object3D, root: THREE.Group, body: THREE.Group): THREE.Object3D[] {
  const shell = model.getObjectByName('body');
  if (!shell) throw new Error('car model has no body node');
  shell.position.set(0, GROUND_Y, 0);
  body.add(shell);
  shell.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (m.name === 'paint') m.color.setHex(0xf4f4f2);
    if (m.name === 'glass') m.depthWrite = false;
    // Every caster is drawn once per shadow cascade; the painted shell alone gives the car's shadow.
    mesh.castShadow = m.name === 'paint';
  });

  return WHEEL_POSITIONS.map(([, y], i) => {
    const wheel = model.getObjectByName(`wheel_${i}`);
    if (!wheel) throw new Error(`car model has no wheel_${i}`);
    // The model's axles sit up to 9 cm from the physics wheels; drawing them where the arches are hides that.
    const steer = new THREE.Group();
    steer.position.set(wheel.position.x, y, wheel.position.z);
    const spin = new THREE.Group();
    wheel.position.set(0, 0, 0);
    spin.add(wheel);
    steer.add(spin);
    root.add(steer);
    return steer;
  });
}

function buildBody(root: THREE.Group, body: THREE.Group): THREE.Object3D[] {
  const geo = bodyGeometry('lacetti', LENGTH, WIDTH);
  for (const g of [geo.paint, geo.fixed, geo.lamps]) g.translate(0, GROUND_Y, 0);
  const paint = new THREE.Mesh(geo.paint, new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.35, metalness: 0.3 }));
  const fixed = new THREE.Mesh(geo.fixed, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.4 }));
  const lamps = new THREE.Mesh(geo.lamps, new THREE.MeshBasicMaterial({ vertexColors: true }));
  paint.castShadow = fixed.castShadow = true;
  body.add(paint, fixed, lamps);

  const tyre = new THREE.CylinderGeometry(TYRE_RADIUS, TYRE_RADIUS, TYRE_WIDTH, 18).rotateZ(Math.PI / 2);
  const rubber = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const rimMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const rims = { [-1]: rimGeometry(-1), [1]: rimGeometry(1) } as Record<number, THREE.BufferGeometry>;
  const wheels = WHEEL_POSITIONS.map(([x, y, z]) => {
    const steer = new THREE.Group();
    steer.position.set(x, y, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(tyre, rubber), new THREE.Mesh(rims[Math.sign(x)], rimMaterial));
    steer.add(spin);
    root.add(steer);
    return steer;
  });
  return wheels;
}
