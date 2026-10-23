import * as THREE from 'three';
import type { DistrictData, GraphEdge, Road } from '../shared/district';
import { FOOT_KINDS } from '../../tools/city/extract';
import { addBuildings } from './buildings';
import { dashes, edgeMarkings } from './markings';
import { addMerged, polygonGeometry, ribbonGeometry } from './meshes';
import { junctionPolygon, junctionTrim, trimEdge } from './roadGeometry';
import { addSignals } from './signals';
import { treePositions } from './vegetation';

const Y = { green: 0.03, water: 0.05, sidewalk: 0.06, curb: 0.07, asphalt: 0.09, marking: 0.11 };
const CURB_EXTRA = 1.2;
const MARKING_WIDTH = 0.15;
const TREE_SEED = 7;

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });

export function buildWorld(scene: THREE.Scene, d: DistrictData): void {
  const roads = new Map(d.roads.map(r => [r.id, r]));
  const edges = new Map(d.graph.edges.map(e => [e.id, e]));

  const trimAt = new Map<string, { start: number; end: number }>();
  const junctions: THREE.BufferGeometry[] = [];
  for (const node of d.graph.nodes) {
    const touching = node.edges.map(id => edges.get(id)!);
    const trims = junctionTrim(node, touching);
    if (!trims.size) continue;
    junctions.push(polygonGeometry(junctionPolygon(node, touching), Y.asphalt));
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
    asphalt.push(ribbonGeometry(pts, e.width, Y.asphalt));
    curbs.push(ribbonGeometry(e.points, e.width + CURB_EXTRA, Y.curb));
    addMarkings(marks, e, roads.get(e.roadId), pts);
  }

  const footways = d.roads.filter((r: Road) => FOOT_KINDS.has(r.kind));
  addMerged(scene, d.areas.filter(a => a.kind === 'green').map(a => polygonGeometry(a.outline, Y.green)), lambert(0x6f9a4a));
  addMerged(scene, [
    ...d.areas.filter(a => a.kind === 'water').map(a => polygonGeometry(a.outline, Y.water)),
    ...d.waterways.map(w => ribbonGeometry(w.points, w.width, Y.water)),
  ], lambert(0x4f8fb0));
  addMerged(scene, footways.map(r => ribbonGeometry(r.points, r.width, Y.sidewalk)), lambert(0xc9bfae));
  addMerged(scene, curbs, lambert(0xa8a39a));
  addMerged(scene, [...asphalt, ...junctions], lambert(0x3d4045));
  const markMesh = addMerged(scene, marks, new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
  if (markMesh) markMesh.receiveShadow = false;

  addBuildings(scene, d.buildings);
  addTrees(scene, d);
  addSignals(scene, d);
}

function addMarkings(out: THREE.BufferGeometry[], e: GraphEdge, road: Road | undefined, pts: GraphEdge['points']) {
  for (const line of edgeMarkings(e, road, pts)) {
    if (line.dashed) for (const dash of dashes(line.points)) out.push(ribbonGeometry(dash, MARKING_WIDTH, Y.marking));
    else out.push(ribbonGeometry(line.points, MARKING_WIDTH, Y.marking));
  }
}

function addTrees(scene: THREE.Scene, d: DistrictData) {
  const trees = treePositions(d, TREE_SEED);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 3, 6).translate(0, 1.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, lambert(0x6b5138), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x4f7d34, flatShading: true }), trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  trees.forEach(([x, z], i) => {
    // Scale and rotation derived from position so they're stable between loads.
    const k = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    q.setFromAxisAngle(up, k * Math.PI * 2);
    const scale = 0.8 + k * 0.6;
    m.compose(p.set(x, 0, z), q, s.set(scale, scale, scale));
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
  });
  crowns.castShadow = true;
  scene.add(trunks, crowns);
}
