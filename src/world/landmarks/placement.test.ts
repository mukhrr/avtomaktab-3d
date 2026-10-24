import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import type { DistrictData } from '../../shared/district';
import { FOUNTAIN_HEIGHT, MONUMENT_PEDESTAL_HEIGHT, inLandmark, landmarkBuildingIds, landmarkColliders } from '../../shared/landmark';
import { createPhysics } from '../../physics/world';
import { addBuildings } from '../buildings';
import { wallGeometry } from '../buildingGeometry';
import { LAMP_SEED, lampPositions } from '../streetside';
import { TREE_SEED, treePositions } from '../vegetation';
import { addLandmarks, landmarkParts } from './index';

const d: DistrictData = JSON.parse(readFileSync(new URL('../../../public/districts/tashkent-center/district.json', import.meta.url), 'utf8'));
const vertexCount = (g: THREE.BufferGeometry) => g.getAttribute('position').count;

describe('landmarks in the world', () => {
  it('names the four landmark buildings', () => {
    expect([...landmarkBuildingIds(d)].sort()).toEqual(['31972619', '44351799', '44491343', '83581462']);
  });

  it('the landmark buildings are left out of the facade batch', () => {
    const walls = (skip?: Set<string>) => {
      const scene = new THREE.Scene();
      addBuildings(scene, d.buildings, new THREE.Texture(), 200, skip);
      return vertexCount((scene.children[0] as THREE.BatchedMesh).geometry);
    };
    const skipped = d.buildings.filter(b => landmarkBuildingIds(d).has(b.id)).reduce((n, b) => n + vertexCount(wallGeometry(b)), 0);
    expect(skipped).toBeGreaterThan(0);
    expect(walls() - walls(landmarkBuildingIds(d))).toBe(skipped);
  });

  it('physics keeps every building prism and adds the monument and fountain cylinders', async () => {
    const { world } = await createPhysics(d);
    let prisms = 0;
    const cylinders: { x: number; z: number; r: number; h: number; y: number }[] = [];
    world.colliders.forEach(c => {
      if (c.shapeType() === RAPIER_TRIMESH) prisms++;
      if (c.shapeType() === RAPIER_CYLINDER) cylinders.push({ ...c.translation(), r: c.radius(), h: c.halfHeight() * 2 });
    });
    expect(prisms).toBe(d.buildings.length);
    const colliders = landmarkColliders(d);
    expect(colliders.map(c => c.height).sort()).toEqual([FOUNTAIN_HEIGHT, FOUNTAIN_HEIGHT, FOUNTAIN_HEIGHT, FOUNTAIN_HEIGHT, MONUMENT_PEDESTAL_HEIGHT]);
    for (const l of colliders) {
      const hit = cylinders.find(c => Math.abs(c.x - l.x) < 1e-3 && Math.abs(c.z - l.z) < 1e-3 && Math.abs(c.h - l.height) < 1e-3);
      expect(hit, l.id).toBeDefined();
      expect(hit!.r).toBeCloseTo(l.radius, 3);
      expect(hit!.y - hit!.h / 2).toBeLessThan(0.1);
    }
    expect(colliders.find(c => c.height === MONUMENT_PEDESTAL_HEIGHT)!.radius).toBe(6);
  });

  it('no tree or lamp stands inside a landmark footprint or radius plus 1 m', () => {
    const poles = [...lampPositions(d, LAMP_SEED).map(l => [l.x, l.z]), ...treePositions(d, TREE_SEED)];
    expect(poles.length).toBeGreaterThan(100);
    for (const [x, z] of poles) for (const l of d.landmarks) expect(inLandmark(l, x, z, 1), `${l.id} ${x},${z}`).toBe(false);
  });

  it('inLandmark grows footprints and radii by the margin', () => {
    const monument = d.landmarks.find(l => l.kind === 'amirTemur')!;
    expect(inLandmark(monument, monument.x + 6.5, monument.z, 1)).toBe(true);
    expect(inLandmark(monument, monument.x + 7.5, monument.z, 1)).toBe(false);
    const kuranty = d.landmarks.find(l => l.kind === 'kuranty')!;
    expect(inLandmark(kuranty, 12, 165, 0)).toBe(true);
    expect(inLandmark(kuranty, 12, 156.2, 0)).toBe(false);
    expect(inLandmark(kuranty, 12, 156.2, 1)).toBe(true);
    expect(inLandmark(kuranty, 12, 150, 1)).toBe(false);
  });

  it('adds every landmark in at most five meshes with shared materials', () => {
    const scene = new THREE.Scene();
    addLandmarks(scene, d);
    const meshes: THREE.Mesh[] = [];
    scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(5);
    expect(new Set(meshes.map(m => m.material)).size).toBe(meshes.length);
    const expected = d.landmarks.reduce((n, l) => {
      const p = landmarkParts(l);
      return n + [p.solid, p.textured?.geometry, p.transparent].reduce((s, g) => s + (g ? (g.index ? g.index.count : vertexCount(g)) : 0), 0);
    }, 0);
    expect(meshes.reduce((n, m) => n + vertexCount(m.geometry), 0)).toBe(expected);
  });
});

const RAPIER_CYLINDER = 10;
const RAPIER_TRIMESH = 6;
