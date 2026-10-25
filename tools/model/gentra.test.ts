import { readFileSync } from 'node:fs';
import { wheelIndex } from './gentra';

interface Gltf {
  nodes: { name: string; mesh?: number; translation?: number[]; children?: number[] }[];
  meshes: { name: string; primitives: { indices: number; attributes: Record<string, number> }[] }[];
  materials: { name: string }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
  scenes: { extras: { bodyHalfWidth: number; wheels: { index: number; centre: number[]; radius: number }[] } }[];
}

function readGlb(path: string): Gltf {
  const b = readFileSync(path);
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
}

const gltf = readGlb('public/models/gentra.glb');

function bounds(filter: (name: string) => boolean = () => true) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const n of gltf.nodes) {
    if (n.mesh === undefined || !filter(n.name)) continue;
    const t = n.translation ?? [0, 0, 0];
    for (const p of gltf.meshes[n.mesh].primitives) {
      const a = gltf.accessors[p.attributes.POSITION];
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], a.min![k] + t[k]);
        max[k] = Math.max(max[k], a.max![k] + t[k]);
      }
    }
  }
  return { min, max };
}

describe('processed Gentra glb', () => {
  it('fits 4.5 x 2.1 x 1.7 m', () => {
    const { min, max } = bounds();
    expect(max[0] - min[0]).toBeLessThanOrEqual(2.1);
    expect(max[1] - min[1]).toBeLessThanOrEqual(1.7);
    expect(max[2] - min[2]).toBeLessThanOrEqual(4.5);
    expect(max[2] - min[2]).toBeGreaterThan(4.4);
  });

  it('has its origin at the footprint centre on the ground', () => {
    const { min, max } = bounds();
    expect(min[1]).toBeCloseTo(0, 2);
    expect((min[2] + max[2]) / 2).toBeCloseTo(0, 2);
    expect(Math.abs(min[0] + max[0]) / 2).toBeLessThan(0.02);
  });

  it('keeps the body without mirrors and the wheels inside the 1.74 m physics box width', () => {
    expect(gltf.scenes[0].extras.bodyHalfWidth).toBeLessThanOrEqual(0.87);
    const { min, max } = bounds(n => n.startsWith('wheel_'));
    expect(min[0]).toBeGreaterThanOrEqual(-0.871);
    expect(max[0]).toBeLessThanOrEqual(0.871);
  });

  it('stays under 25k triangles in at most 10 meshes', () => {
    const tris = gltf.meshes.flatMap(m => m.primitives).reduce((s, p) => s + gltf.accessors[p.indices].count / 3, 0);
    expect(tris).toBeLessThanOrEqual(25000);
    expect(gltf.meshes.length).toBeLessThanOrEqual(10);
  });

  it('has no badge nodes, meshes or materials', () => {
    const names = [...gltf.nodes, ...gltf.meshes, ...gltf.materials].map(x => x.name);
    expect(names.filter(n => /badge|logo|emblem|bowtie|chevrolet|aerial/i.test(n))).toEqual([]);
  });

  it('nose toward +z with four wheels in WHEEL_POSITIONS order', () => {
    const wheels = gltf.scenes[0].extras.wheels;
    expect(wheels.map(w => w.index)).toEqual([0, 1, 2, 3]);
    for (const w of wheels) {
      const node = gltf.nodes.find(n => n.name === `wheel_${w.index}`)!;
      expect(node.translation![0]).toBeCloseTo(w.centre[0], 2);
      expect(wheelIndex(w.centre[0], w.centre[2])).toBe(w.index);
      expect(w.radius).toBeGreaterThan(0.29);
      expect(w.radius).toBeLessThan(0.32);
    }
    const lights = gltf.nodes.find(n => n.name === 'lights')!;
    const a = gltf.accessors[gltf.meshes[lights.mesh!].primitives[0].attributes.POSITION];
    expect(a.max![2]).toBeGreaterThan(2);
  });
});

describe('wheelIndex', () => {
  it('numbers front right, front left, rear right, rear left with +x on the left', () => {
    expect(wheelIndex(-0.7, 1.3)).toBe(0);
    expect(wheelIndex(0.7, 1.3)).toBe(1);
    expect(wheelIndex(-0.7, -1.2)).toBe(2);
    expect(wheelIndex(0.7, -1.2)).toBe(3);
  });
});
