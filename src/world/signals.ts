import * as THREE from 'three';
import type { DistrictData } from '../shared/district';
import type { LightState, SignalSystem } from '../sim/signals';
import { pointAlong } from './roadGeometry';

const CURB_GAP = 1;
const LAMP_OFF = new THREE.Color(0x333333);
const LAMP_COLOURS = [new THREE.Color(0xff2a1a), new THREE.Color(0xffb020), new THREE.Color(0x2aff5a)];
const LAMP_OFFSETS = [4.8, 4.43, 4.06];
const WALK_OFFSETS = [2.75, 2.4];
const WALK_COLOURS = [new THREE.Color(0xff2a1a), new THREE.Color(0x2aff5a)];
const WALK_SIDE_GAP = 0.8;

/** Lamps lit (red, yellow, green) for a state; a flashing green is dark during its off half. */
function lit(state: LightState | null, on: boolean): [boolean, boolean, boolean] {
  switch (state) {
    case 'red': return [true, false, false];
    case 'redYellow': return [true, true, false];
    case 'yellow': return [false, true, false];
    case 'green': return [false, false, true];
    case 'flashingGreen': return [false, false, on];
    default: return [false, false, false];
  }
}

export interface SignalLamps {
  /** Colours every head and pedestrian lamp from the current signal state. */
  update(signals: SignalSystem): void;
}

/**
 * Signal heads as instanced meshes (one draw call per part instead of five per signal), plus
 * pedestrian heads at both ends of every signalised crossing.
 */
export function addSignals(scene: THREE.Scene, d: DistrictData): SignalLamps {
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

  const walks = d.crossings.filter(c => c.kind === 'signal' && c.controllerId !== undefined && c.walkPhase !== undefined);
  const pn = walks.length * 2;
  const walkPoles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6).translate(0, 1.3, 0), dark, pn);
  const walkBoxes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.7, 0.25).translate(0, 2.58, 0), dark, pn);
  const walkLamps = WALK_OFFSETS.map(y => {
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6).translate(0, y + 0.1, 0.14), new THREE.MeshBasicMaterial(), pn);
    for (let i = 0; i < pn; i++) mesh.setColorAt(i, LAMP_OFF);
    return mesh;
  });
  walks.forEach((c, k) => {
    const edge = edges.get(c.edgeId);
    if (!edge) return;
    const h = pointAlong(edge.points, c.at).heading;
    const nx = -Math.cos(h), nz = Math.sin(h), off = c.width / 2 + WALK_SIDE_GAP;
    for (const side of [1, -1]) {
      // Each head stands on one kerb and faces across the road toward the other.
      m.compose(p.set(c.position[0] + nx * off * side, 0, c.position[1] + nz * off * side), q.setFromAxisAngle(up, Math.atan2(-nx * side, -nz * side)), one);
      for (const mesh of [walkPoles, walkBoxes, ...walkLamps]) mesh.setMatrixAt(k * 2 + (side === 1 ? 0 : 1), m);
    }
  });
  scene.add(walkPoles, walkBoxes, ...walkLamps);

  const colour = new THREE.Color();
  return {
    update(signals) {
      const on = signals.lampOn('flashingGreen');
      d.signals.forEach((s, i) => {
        const flags = lit(signals.headState(s.id), on);
        lamps.forEach((mesh, k) => mesh.setColorAt(i, flags[k] ? LAMP_COLOURS[k] : LAMP_OFF));
      });
      walks.forEach((c, k) => {
        const walk = signals.walkState(c.id);
        const flags = [walk === 'dontWalk', walk === 'walk' || (walk === 'flashingWalk' && on)];
        for (let side = 0; side < 2; side++) {
          walkLamps.forEach((mesh, j) => mesh.setColorAt(k * 2 + side, flags[j] ? colour.copy(WALK_COLOURS[j]) : LAMP_OFF));
        }
      });
      for (const mesh of [...lamps, ...walkLamps]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}
