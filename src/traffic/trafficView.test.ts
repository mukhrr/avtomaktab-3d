import * as THREE from 'three';
import { trafficView } from './trafficView';

const batch = (scene: THREE.Scene) => scene.children.find((o): o is THREE.BatchedMesh => o instanceof THREE.BatchedMesh)!;

describe('trafficView', () => {
  it('the car batch skips per-object culling and sorting, which three redoes for every shadow cascade', () => {
    const scene = new THREE.Scene();
    trafficView(scene, 4);
    const cars = batch(scene);
    expect(cars.perObjectFrustumCulled).toBe(false);
    expect(cars.sortObjects).toBe(false);
    expect(cars.frustumCulled).toBe(false);
  });
});
