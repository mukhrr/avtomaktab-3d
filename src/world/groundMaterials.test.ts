import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { QUALITY } from '../render/quality';
import { createGroundMaterials } from './groundMaterials';
import { ribbonGeometry, worldUVs } from './meshes';

const uvAt = (g: THREE.BufferGeometry, i: number) => {
  const uv = g.getAttribute('uv');
  return [uv.getX(i), uv.getY(i)];
};

describe('worldUVs', () => {
  it('maps world x and z to u and v', () => {
    const g = worldUVs(ribbonGeometry([[0, 0], [10, 0]], 2, 0), 5);
    const us = Array.from(g.getAttribute('uv').array).filter((_, i) => i % 2 === 0);
    expect(Math.min(...us)).toBeCloseTo(0);
    expect(Math.max(...us)).toBeCloseTo(2);
  });

  it('gives the same UV where two ribbons share an endpoint', () => {
    const a = worldUVs(ribbonGeometry([[0, 0], [10, 0]], 2, 0), 5);
    const b = worldUVs(ribbonGeometry([[10, 0], [20, 0]], 2, 0), 5);
    const [ua, va] = uvAt(a, 2);
    const [ub, vb] = uvAt(b, 0);
    expect(a.getAttribute('position').getX(2)).toBeCloseTo(b.getAttribute('position').getX(0));
    expect(a.getAttribute('position').getZ(2)).toBeCloseTo(b.getAttribute('position').getZ(0));
    expect(ua).toBeCloseTo(ub);
    expect(va).toBeCloseTo(vb);
  });
});

describe('createGroundMaterials', () => {
  it('returns plain Lambert colours on low', () => {
    const m = createGroundMaterials(QUALITY.low);
    const hex = (k: keyof typeof m) => (m[k] as THREE.MeshLambertMaterial);
    for (const k of Object.keys(m) as (keyof typeof m)[]) expect(hex(k)).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(hex('asphalt').color.getHex()).toBe(0x3d4045);
    expect(hex('sidewalk').color.getHex()).toBe(0xc9bfae);
    expect(hex('curb').color.getHex()).toBe(0xa8a39a);
    expect(hex('grass').color.getHex()).toBe(0x6f9a4a);
    expect(hex('ground').color.getHex()).toBe(0xb8ab8c);
  });

  it('returns textured Standard materials on high', () => {
    const loaded: string[] = [];
    const stubLoader = { load: (url: string) => { loaded.push(url); return new THREE.Texture(); } } as unknown as THREE.TextureLoader;
    const m = createGroundMaterials(QUALITY.high, stubLoader);
    for (const k of Object.keys(m) as (keyof typeof m)[]) {
      const mat = m[k] as THREE.MeshStandardMaterial;
      expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(mat.map!.wrapS).toBe(THREE.RepeatWrapping);
      expect(mat.map!.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(mat.normalScale.toArray()).toEqual([1, -1]);
      expect(mat.normalMap!.wrapT).toBe(THREE.RepeatWrapping);
      expect(mat.normalMap!.colorSpace).toBe(THREE.LinearSRGBColorSpace);
    }
    const names = ['asphalt', 'sidewalk', 'curb', 'grass', 'ground'];
    expect([...loaded].sort()).toEqual(names.flatMap(n => [`/textures/${n}_color.jpg`, `/textures/${n}_normal.jpg`]).sort());
  });

  it('falls back to the flat colour when a texture fails to load', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = { load: (_u: string, _l: unknown, _p: unknown, onError: () => void) => { onError(); return new THREE.Texture(); } } as unknown as THREE.TextureLoader;
    const m = createGroundMaterials(QUALITY.high, failing);
    const a = m.asphalt as THREE.MeshStandardMaterial;
    expect(a.map).toBeNull();
    expect(a.normalMap).toBeNull();
    expect(a.color.getHex()).toBe(0x3d4045);
    expect(warn).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });
});
