import * as THREE from 'three';
import type { PedView } from './pedSim';

const SKIN = new THREE.Color(0xd9b38c);

/** Draws the pedestrian pool as instanced capsules with heads; call `update` once per frame. */
export function pedView(scene: THREE.Scene, count: number): { update(peds: readonly PedView[]): void } {
  const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 0.9, 3, 8).translate(0, 0.67, 0), new THREE.MeshLambertMaterial(), count);
  const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.58, 0), new THREE.MeshLambertMaterial({ color: SKIN }), count);
  for (const m of [body, head]) {
    m.frustumCulled = false;
    m.count = 0;
  }
  body.castShadow = true;
  scene.add(body, head);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  return {
    update(peds) {
      let n = 0;
      for (const p of peds) {
        if (!p.active) continue;
        m.compose(pos.set(p.position[0], 0.09, p.position[1]), q.setFromAxisAngle(up, p.heading), one);
        body.setMatrixAt(n, m);
        head.setMatrixAt(n, m);
        body.setColorAt(n, colour.setHex(p.colour));
        n++;
      }
      body.count = head.count = n;
      body.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = true;
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
    },
  };
}
