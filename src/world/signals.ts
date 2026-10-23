import * as THREE from 'three';
import type { DistrictData } from '../shared/district';
import { nearestLane } from './spawn';

const CURB_GAP = 1;
const SEARCH_RADIUS = 30;

/** Static poles for now; M2 drives the lamps from intersection phases. */
export function addSignals(scene: THREE.Scene, d: DistrictData): void {
  const dark = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const lampOff = new THREE.MeshBasicMaterial({ color: 0x333333 });
  const pole = new THREE.CylinderGeometry(0.1, 0.1, 4).translate(0, 2, 0);
  const box = new THREE.BoxGeometry(0.4, 1.1, 0.35).translate(0, 4.4, 0);
  const lamp = new THREE.SphereGeometry(0.12, 8, 6);

  for (const s of d.signals) {
    const lane = nearestLane(d, s.position[0], s.position[1], SEARCH_RADIUS);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(pole, dark), new THREE.Mesh(box, dark));
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(lamp, lampOff);
      m.position.set(0, 4.8 - i * 0.37, 0.19);
      g.add(m);
    }
    if (lane) {
      const dx = Math.sin(lane.heading), dz = Math.cos(lane.heading);
      const off = lane.edge.width / 2 + CURB_GAP;
      const [cx, cz] = s.position;
      g.position.set(cx - dz * off, 0, cz + dx * off);
      // Lamps face drivers approaching along the lane.
      g.rotation.y = lane.heading + Math.PI;
    } else {
      g.position.set(s.position[0], 0, s.position[1]);
    }
    g.userData.signalId = s.id;
    scene.add(g);
  }
}
