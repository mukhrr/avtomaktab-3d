import * as THREE from 'three';
import type { DistrictData, Vec2 } from '../shared/district';
import { addMerged, ribbonGeometry } from './meshes';
import { pointAlong } from './roadGeometry';

const MARKING_Y = 0.11;
const BAR = 0.5;
const GAP = 0.5;
export const ZEBRA_LENGTH = 3;
const STOP_LINE = 0.4;

/** Flat rectangle `across` wide and `along` long, centred on `c`, with `along` pointing the way of `heading`. */
function patch(c: Vec2, heading: number, across: number, along: number): THREE.BufferGeometry {
  const dx = Math.sin(heading) * along / 2, dz = Math.cos(heading) * along / 2;
  return ribbonGeometry([[c[0] - dx, c[1] - dz], [c[0] + dx, c[1] + dz]], across, MARKING_Y);
}

/** Zebra stripes at zebra and signalised crossings, and a stop line at every signal approach, as one mesh. */
export function addCrossings(scene: THREE.Scene, d: DistrictData): void {
  const edges = new Map(d.graph.edges.map(e => [e.id, e]));
  const geoms: THREE.BufferGeometry[] = [];

  for (const c of d.crossings) {
    const edge = edges.get(c.edgeId);
    if (!edge || c.kind === 'unmarked') continue;
    const h = pointAlong(edge.points, c.at).heading;
    const nx = -Math.cos(h), nz = Math.sin(h);
    for (let off = -c.width / 2 + BAR / 2; off <= c.width / 2 - BAR / 2 + 1e-6; off += BAR + GAP) {
      geoms.push(patch([c.position[0] + nx * off, c.position[1] + nz * off], h, BAR, ZEBRA_LENGTH));
    }
  }

  const seen = new Set<string>();
  for (const a of d.controllers.flatMap(c => c.phases.flat())) {
    const id = `${a.edgeId}:${a.dir}:${a.stopAt.toFixed(1)}`;
    const edge = edges.get(a.edgeId);
    if (!edge || seen.has(id)) continue;
    seen.add(id);
    const lanes = a.dir === 1 ? edge.lanesForward : edge.lanesBackward;
    if (!lanes) continue;
    const pose = pointAlong(edge.points, a.stopAt);
    const travel = a.dir === 1 ? pose.heading : pose.heading + Math.PI;
    const span = (lanes * edge.width) / (edge.lanesForward + edge.lanesBackward);
    // Right of travel is (-cos, sin); the travel lanes run from the right kerb inward.
    const centre = edge.width / 2 - span / 2;
    geoms.push(patch([pose.x - Math.cos(travel) * centre, pose.z + Math.sin(travel) * centre], travel, span, STOP_LINE));
  }

  const mesh = addMerged(scene, geoms, new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
  if (mesh) mesh.receiveShadow = false;
}
