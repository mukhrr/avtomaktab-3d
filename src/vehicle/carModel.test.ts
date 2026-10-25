import * as THREE from 'three';
import { createCarModel, GROUND_Y, WHEEL_POSITIONS } from './carModel';

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

  it('keeps headlights and tail lights and draws in at most 11 calls', () => {
    const { root, lean } = createCarModel();
    const lamps = meshes(lean).filter(m => (m.material as THREE.Material).type === 'MeshBasicMaterial');
    expect(lamps).toHaveLength(1);
    const box = new THREE.Box3().setFromObject(lamps[0]);
    expect(box.max.z).toBeGreaterThan(2.0);
    expect(box.min.z).toBeLessThan(-2.0);
    expect(meshes(root).length).toBeLessThanOrEqual(11);
  });
});
