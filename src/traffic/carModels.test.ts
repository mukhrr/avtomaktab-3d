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

  describe('lacetti is a Gentra sedan', () => {
    const verts = () => {
      const { paint, fixed } = carGeometry('lacetti');
      const out: THREE.Vector3[] = [];
      for (const g of [paint, fixed]) {
        const a = g.getAttribute('position');
        for (let i = 0; i < a.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(a, i));
      }
      return out;
    };

    it('has a long flat roof, at least 1.4 m of it above 1.3 m', () => {
      const high = verts().filter(v => v.y > 1.3).map(v => v.z);
      expect(Math.max(...high) - Math.min(...high)).toBeGreaterThan(1.4);
    });

    it('narrows the greenhouse to a roof cap above 1.25 m and widens the shoulder above the sill', () => {
      const w = CAR_CLASSES.lacetti.width;
      const vs = verts();
      const halfAt = (lo: number, hi: number) => Math.max(...vs.filter(v => v.y > lo && v.y < hi && Math.abs(v.z) < 0.9).map(v => Math.abs(v.x)));
      expect(halfAt(1.27, 1.6)).toBeLessThanOrEqual((0.74 * w) / 2 + 0.011);
      expect(halfAt(1.0, 1.24)).toBeGreaterThan((0.8 * w) / 2);
      expect(halfAt(0.24, 0.44)).toBeLessThanOrEqual((w - 0.16) / 2 + 0.001);
      expect(halfAt(0.44, 1.0)).toBeGreaterThanOrEqual((w - 0.06) / 2 - 0.001);
    });

    it('ends in a flat high boot with a near-upright C-pillar', () => {
      const vs = verts();
      const deck = vs.filter(v => v.z < -1.5 && v.z > -2.0).map(v => v.y);
      expect(Math.max(...deck)).toBeGreaterThan(0.98);
      expect(Math.max(...deck)).toBeLessThan(1.05);
      const pillar = vs.filter(v => v.y > 1.3).map(v => v.z);
      expect(Math.min(...pillar)).toBeLessThan(-0.95);
    });
  });
});

