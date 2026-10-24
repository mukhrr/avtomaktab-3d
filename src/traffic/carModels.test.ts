import * as THREE from 'three';
import { CAR_CLASSES, type CarClass } from './carClasses';
import { carGeometry } from './carModels';
import { trafficView } from './trafficView';

const CLASSES = Object.keys(CAR_CLASSES) as CarClass[];
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const attrs = (g: THREE.BufferGeometry) => Object.keys(g.attributes).sort().join();

describe('car models', () => {
  it.each(CLASSES)('%s fits inside its traffic box', c => {
    const { paint, fixed } = carGeometry(c);
    const box = new THREE.Box3().setFromBufferAttribute(paint.getAttribute('position') as THREE.BufferAttribute);
    box.union(new THREE.Box3().setFromBufferAttribute(fixed.getAttribute('position') as THREE.BufferAttribute));
    const { length, width } = CAR_CLASSES[c];
    const height = c === 'bus' ? 3.2 : 1.6;
    expect(box.min.x).toBeGreaterThanOrEqual(-width / 2 - 0.02);
    expect(box.max.x).toBeLessThanOrEqual(width / 2 + 0.02);
    expect(box.min.z).toBeGreaterThanOrEqual(-length / 2 - 0.02);
    expect(box.max.z).toBeLessThanOrEqual(length / 2 + 0.02);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.02);
    expect(box.max.y).toBeLessThanOrEqual(height + 0.02);
    expect(box.max.z - box.min.z).toBeGreaterThan(length * 0.95);
  });

  it.each(CLASSES)('%s has between 200 and 2000 triangles', c => {
    const { paint, fixed } = carGeometry(c);
    const n = tris(paint) + tris(fixed);
    expect(n).toBeGreaterThanOrEqual(200);
    expect(n).toBeLessThanOrEqual(2000);
  });

  it.each(CLASSES)('%s colours every fixed vertex', c => {
    const { fixed } = carGeometry(c);
    expect(fixed.getAttribute('color')?.count).toBe(fixed.getAttribute('position').count);
  });

  it('every class shares one attribute layout, so all fit one batch', () => {
    const layouts = new Set(CLASSES.flatMap(c => { const g = carGeometry(c); return [attrs(g.paint), attrs(g.fixed)]; }));
    expect(layouts.size).toBe(1);
  });

  it('draws all classes with at most 6 scene objects', () => {
    const scene = new THREE.Scene();
    trafficView(scene, 40);
    expect(scene.children.length).toBeGreaterThan(0);
    expect(scene.children.length).toBeLessThanOrEqual(6);
  });
});
