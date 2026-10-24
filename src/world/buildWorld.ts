import * as THREE from 'three';
import type { DistrictData, GraphEdge, Road } from '../shared/district';
import { FOOT_KINDS } from '../../tools/city/extract';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { addBuildings } from './buildings';
import { batchChunks, groupByChunk } from './chunks';
import { dashes, edgeMarkings } from './markings';
import { GROUND_TILE, type GroundSurface } from './groundMaterials';
import { addMerged, polygonGeometry, ribbonGeometry, worldUVs } from './meshes';
import { junctionPolygon, junctionTrim, trimEdge } from './roadGeometry';
import { addCrossings } from './crossings';
import { addSigns } from './signs';
import { addSignals, type SignalLamps } from './signals';
import { addFurniture } from './furniture';
import { addStreetside } from './streetside';
import { TREE_SEED, treePositions } from './vegetation';
import { addLandmarks, type LandmarkTextures } from './landmarks';
import { landmarkBuildingIds } from '../shared/landmark';

const Y = { green: 0.03, water: 0.05, sidewalk: 0.06, curb: 0.07, asphalt: 0.09, marking: 0.11 };
const CURB_EXTRA = 1.2;
const MARKING_WIDTH = 0.15;
const CHUNK_SIZE = 200;

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });

export function buildWorld(scene: THREE.Scene, d: DistrictData, mats: Record<GroundSurface, THREE.Material>, facadeAtlas: THREE.Texture, landmarkTextures?: LandmarkTextures): { signalLamps: SignalLamps } {
  const uv = (g: THREE.BufferGeometry, k: keyof typeof GROUND_TILE) => worldUVs(g, GROUND_TILE[k]);
  const roads = new Map(d.roads.map(r => [r.id, r]));
  const edges = new Map(d.graph.edges.map(e => [e.id, e]));

  const trimAt = new Map<string, { start: number; end: number }>();
  const junctions: THREE.BufferGeometry[] = [];
  for (const node of d.graph.nodes) {
    const touching = node.edges.map(id => edges.get(id)!);
    const trims = junctionTrim(node, touching);
    if (!trims.size) continue;
    junctions.push(uv(polygonGeometry(junctionPolygon(node, touching), Y.asphalt), 'asphalt'));
    for (const e of touching) {
      const t = trimAt.get(e.id) ?? { start: 0, end: 0 };
      if (e.from === node.id) t.start = trims.get(e.id)!;
      if (e.to === node.id) t.end = trims.get(e.id)!;
      trimAt.set(e.id, t);
    }
  }

  const asphalt: THREE.BufferGeometry[] = [], curbs: THREE.BufferGeometry[] = [], marks: THREE.BufferGeometry[] = [];
  for (const e of d.graph.edges) {
    const t = trimAt.get(e.id);
    const pts = t ? trimEdge(e, t.start, t.end) : e.points;
    asphalt.push(uv(ribbonGeometry(pts, e.width, Y.asphalt), 'asphalt'));
    curbs.push(uv(ribbonGeometry(e.points, e.width + CURB_EXTRA, Y.curb), 'curb'));
    addMarkings(marks, e, roads.get(e.roadId), pts);
  }

  const footways = d.roads.filter((r: Road) => FOOT_KINDS.has(r.kind));
  addMerged(scene, d.areas.filter(a => a.kind === 'green').map(a => uv(polygonGeometry(a.outline, Y.green), 'grass')), mats.grass);
  addMerged(scene, [
    ...waterAreas(d).map(a => polygonGeometry(a.outline, Y.water)),
    ...d.waterways.map(w => ribbonGeometry(w.points, w.width, Y.water)),
  ], lambert(0x4f8fb0));
  addMerged(scene, footways.map(r => uv(ribbonGeometry(r.points, r.width, Y.sidewalk), 'sidewalk')), mats.sidewalk);
  addMerged(scene, curbs, mats.curb);
  addMerged(scene, [...asphalt, ...junctions], mats.asphalt);
  const markMesh = addMerged(scene, marks, new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
  if (markMesh) markMesh.receiveShadow = false;

  addBuildings(scene, d.buildings, facadeAtlas, CHUNK_SIZE, landmarkBuildingIds(d));
  addLandmarks(scene, d, landmarkTextures);
  addTrees(scene, d);
  addStreetside(scene, d, CHUNK_SIZE);
  addFurniture(scene, d);
  addCrossings(scene, d);
  addSigns(scene, d);
  return { signalLamps: addSignals(scene, d) };
}

function addMarkings(out: THREE.BufferGeometry[], e: GraphEdge, road: Road | undefined, pts: GraphEdge['points']) {
  for (const line of edgeMarkings(e, road, pts)) {
    if (line.dashed) for (const dash of dashes(line.points)) out.push(ribbonGeometry(dash, MARKING_WIDTH, Y.marking));
    else out.push(ribbonGeometry(line.points, MARKING_WIDTH, Y.marking));
  }
}

function treeGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, hex: number) => {
    const c = new THREE.Color(hex);
    g.deleteAttribute('uv');
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.getAttribute('position').count }, () => [c.r, c.g, c.b]).flat(), 3));
    return g;
  };
  const trunk = paint(new THREE.CylinderGeometry(0.18, 0.25, 3, 6, 1, true).translate(0, 1.5, 0), 0x6b5138);
  // Flat shading takes face normals from screen derivatives, so the crown can share vertices.
  const crown = paint(mergeVertices(new THREE.IcosahedronGeometry(2.6, 0).deleteAttribute('normal').deleteAttribute('uv')).translate(0, 5, 0), 0x4f7d34);
  crown.computeVertexNormals();
  return mergeGeometries([trunk, crown], false);
}

function addTrees(scene: THREE.Scene, d: DistrictData) {
  const tree = treeGeometry();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const chunks = [...groupByChunk(treePositions(d, TREE_SEED), t => t, CHUNK_SIZE).values()].map(trees => mergeGeometries(trees.map(([x, z]) => {
    // Scale and rotation derived from position so they're stable between loads.
    const k = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    q.setFromAxisAngle(up, k * Math.PI * 2);
    const scale = 0.8 + k * 0.6;
    return tree.clone().applyMatrix4(m.compose(p.set(x, 0, z), q, s.set(scale, scale, scale)));
  }), false));
  tree.dispose();
  scene.add(batchChunks(chunks, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
}

/** Fountain basins draw their own water, and the OSM polygon would show past the round rim. */
export function waterAreas(d: DistrictData): DistrictData['areas'] {
  const fountains = new Set(d.landmarks.filter(l => l.kind === 'fountain').map(l => l.id));
  return d.areas.filter(a => a.kind === 'water' && !fountains.has(a.id));
}
