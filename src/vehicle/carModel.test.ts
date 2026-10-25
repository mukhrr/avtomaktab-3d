import * as THREE from 'three';
import { createCarModel, GROUND_Y, loadCarBody, WHEEL_POSITIONS } from './carModel';
import { LAMP_GROUPS, newLampState } from './lamps';

const meshes = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.traverse(c => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); });
  return out;
};

describe('player car model', () => {
  it('puts the body under the lean pivot and keeps the wheels outside it', () => {
    const { root, lean, wheels } = createCarModel();
    expect(lean.parent).toBe(root);
    expect(meshes(lean).length).toBeGreaterThan(0);
    expect(wheels).toHaveLength(WHEEL_POSITIONS.length);
    for (const w of wheels) {
      expect(w.parent).toBe(root);
      expect(w.children[0].children.length).toBeGreaterThan(0);
    }
  });

  it('fits the 4.48 x 1.74 m physics box and stays under 1.5 m tall', () => {
    const { lean } = createCarModel();
    const box = new THREE.Box3().setFromObject(lean);
    expect(box.min.x).toBeGreaterThanOrEqual(-0.871);
    expect(box.max.x).toBeLessThanOrEqual(0.871);
    expect(box.min.z).toBeGreaterThanOrEqual(-2.241);
    expect(box.max.z).toBeLessThanOrEqual(2.241);
    expect(box.max.z - box.min.z).toBeGreaterThan(4.4);
    expect(box.max.y - GROUND_Y).toBeLessThan(1.5);
    expect(box.max.y - GROUND_Y).toBeGreaterThan(1.38);
    expect(box.min.y).toBeGreaterThan(GROUND_Y + 0.1);
  });

  it('sits its wheels on the ground at the settled ride height', () => {
    const { wheels } = createCarModel();
    const settled = WHEEL_POSITIONS[0][1] - 0.227;
    const tyre = new THREE.Box3().setFromObject(wheels[0]);
    expect(settled - 0.31).toBeCloseTo(GROUND_Y, 2);
    expect(tyre.max.y - tyre.min.y).toBeCloseTo(0.62, 1);
  });

  it('has 15 inch rims inside the 0.31 m tyres', () => {
    const { wheels } = createCarModel();
    const rim = (wheels[0].children[0].children[1] as THREE.Mesh).geometry;
    rim.computeBoundingBox();
    expect(rim.boundingBox!.max.y).toBeCloseTo(15 * 0.0254 / 2, 2);
  });

  it('has one mesh per lamp group, front and rear, and draws in at most 15 calls', () => {
    const { root, lean } = createCarModel();
    root.updateMatrixWorld(true);
    const lamp = (name: string) => new THREE.Box3().setFromObject(lean.getObjectByName(name)!);
    expect(lamp('head').min.z).toBeGreaterThan(2.0);
    expect(lamp('tail').max.z).toBeLessThan(-2.0);
    expect(lamp('reverse').max.z).toBeLessThan(-2.0);
    for (const [name, sign] of [['indicatorLeft', 1], ['indicatorRight', -1]] as const) {
      const b = lamp(name);
      expect(b.max.z).toBeGreaterThan(2.0);
      expect(b.min.z).toBeLessThan(-2.0);
      expect(Math.sign(b.min.x)).toBe(sign);
      expect(Math.sign(b.max.x)).toBe(sign);
    }
    expect(meshes(root).length).toBeLessThanOrEqual(15);
  });

  it('pitches about a low point ahead of centre, so 3 degrees of brake dive drops the nose under 9 cm', () => {
    const { root, lean } = createCarModel();
    const nose = () => {
      root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(lean);
      return b.min.y;
    };
    const level = nose();
    lean.rotation.x = 3 * Math.PI / 180;
    const drop = level - nose();
    expect(drop).toBeGreaterThan(0.05);
    expect(drop).toBeLessThan(0.09);
  });
});


/** Same node layout as public/models/gentra.glb: a body node with one mesh per material group, and wheel_0..3 at their axles. */
function fakeGlb(): THREE.Group {
  const scene = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  for (const name of ['paint', 'chrome', 'shell', 'interior', 'glass', ...LAMP_GROUPS]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.74, 1.4, 4.48).translate(0, 0.7, 0), new THREE.MeshStandardMaterial({ name, color: 0xff0000 }));
    m.name = name;
    body.add(m);
  }
  scene.add(body);
  const axles = [[-0.713, 1.352], [0.713, 1.352], [-0.733, -1.222], [0.733, -1.222]];
  axles.forEach(([x, z], i) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.2).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ name: 'wheel' }));
    w.name = `wheel_${i}`;
    w.position.set(x, 0.305, z);
    scene.add(w);
  });
  return scene;
}

describe('player car from the glb', () => {
  it('hangs the model body under the lean pivot with its ground on the settled road', () => {
    const { root, lean } = createCarModel(fakeGlb());
    const body = lean.getObjectByName('body')!;
    expect(body).toBeDefined();
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(body);
    expect(box.min.y).toBeCloseTo(GROUND_Y, 3);
    expect(box.max.x).toBeLessThanOrEqual(0.871);
    expect(box.max.z).toBeLessThanOrEqual(2.241);
  });

  it('puts each model wheel in a steer and spin group at its own axle, in WHEEL_POSITIONS order', () => {
    const { root, wheels } = createCarModel(fakeGlb());
    expect(wheels).toHaveLength(4);
    wheels.forEach((steer, i) => {
      expect(steer.parent).toBe(root);
      expect(Math.sign(steer.position.x)).toBe(Math.sign(WHEEL_POSITIONS[i][0]));
      expect(Math.sign(steer.position.z)).toBe(Math.sign(WHEEL_POSITIONS[i][2]));
      expect(Math.abs(steer.position.z - WHEEL_POSITIONS[i][2])).toBeLessThan(0.1);
      expect(steer.position.y).toBe(WHEEL_POSITIONS[i][1]);
      const wheel = steer.children[0].children[0];
      expect(wheel.name).toBe(`wheel_${i}`);
      expect(wheel.position.toArray()).toEqual([0, 0, 0]);
    });
  });

  it('paints the body white, casts shadows from the paint only, and draws in at most 15 meshes', () => {
    const { root } = createCarModel(fakeGlb());
    const all = meshes(root);
    expect(all.length).toBeLessThanOrEqual(15);
    const byName = (n: string) => all.find(m => m.name === n)!;
    expect((byName('paint').material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xf4f4f2);
    expect((byName('glass').material as THREE.Material).depthWrite).toBe(false);
    expect(all.filter(m => m.castShadow).map(m => m.name)).toEqual(['paint']);
  });

  it('drives the model lamp materials', () => {
    const { root, lamps } = createCarModel(fakeGlb());
    const mat = (n: string) => (root.getObjectByName(n) as THREE.Mesh).material as THREE.MeshStandardMaterial;
    lamps.set({ ...newLampState(), left: true, brake: true });
    expect(mat('indicatorLeft').emissiveIntensity).toBeGreaterThan(0);
    expect(mat('indicatorRight').emissiveIntensity).toBe(0);
    expect(mat('tail').emissiveIntensity).toBeGreaterThan(0);
    expect(mat('tail').emissive.getHex()).not.toBe(0);
  });
});

describe('loadCarBody', () => {
  it('returns the glb scene', async () => {
    const scene = fakeGlb();
    expect(await loadCarBody('x.glb', { loadAsync: async () => ({ scene }) } as never)).toBe(scene);
  });

  it('returns null when the glb fails to load, and the car falls back to the code-built body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const model = await loadCarBody('missing.glb', { loadAsync: async () => { throw new Error('404'); } });
    expect(model).toBeNull();
    expect(warn).toHaveBeenCalled();
    const { lean, wheels } = createCarModel(model);
    expect(lean.getObjectByName('body')).toBeUndefined();
    expect(meshes(lean)).toHaveLength(2 + LAMP_GROUPS.length);
    expect(wheels[0].position.x).toBe(WHEEL_POSITIONS[0][0]);
    warn.mockRestore();
  });
});
