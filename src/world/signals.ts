import * as THREE from 'three';
import type { DistrictData } from '../shared/district';
import { pointAlong } from './roadGeometry';

const CURB_GAP = 1;
const LAMP_OFF = new THREE.Color(0x333333);
const LAMP_OFFSETS = [4.8, 4.43, 4.06];

/**
 * Signal heads as instanced meshes (one draw call per part instead of five per signal).
 * Lamps stay off for now; M2 sets per-instance colours from intersection phases via `lamps[i].setColorAt`.
 */
export function addSignals(scene: THREE.Scene, d: DistrictData): { lamps: THREE.InstancedMesh[] } {
  const n = d.signals.length;
  const dark = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.1, 4).translate(0, 2, 0), dark, n);
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1.1, 0.35).translate(0, 4.4, 0), dark, n);
  const lamps = LAMP_OFFSETS.map(y => {
    const m = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6).translate(0, y, 0.19), new THREE.MeshBasicMaterial(), n);
    for (let i = 0; i < n; i++) m.setColorAt(i, LAMP_OFF);
    return m;
  });

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const edges = new Map(d.graph.edges.map(e => [e.id, e]));
  d.signals.forEach((s, i) => {
    let [x, z] = s.position, heading = 0;
    const edge = s.approach && edges.get(s.approach.edgeId);
    if (s.approach && edge) {
      const pose = pointAlong(edge.points, s.approach.stopAt);
      const travel = s.approach.dir === 1 ? pose.heading : pose.heading + Math.PI;
      const dx = Math.sin(travel), dz = Math.cos(travel), off = edge.width / 2 + CURB_GAP;
      x = pose.x - dz * off;
      z = pose.z + dx * off;
      // Lamps face drivers approaching along the lane.
      heading = travel + Math.PI;
    }
    m.compose(p.set(x, 0, z), q.setFromAxisAngle(up, heading), one);
    for (const mesh of [poles, boxes, ...lamps]) mesh.setMatrixAt(i, m);
  });
  scene.add(poles, boxes, ...lamps);
  return { lamps };
}
