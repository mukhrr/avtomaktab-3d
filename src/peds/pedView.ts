import * as THREE from 'three';
import { HIP_X, HIP_Y, SHOULDER_X, SHOULDER_Y, limbSwing, pedGeometry } from './pedModel';
import type { PedView } from './pedSim';

const SKIN = new THREE.Color(0xd9b38c);
const TROUSERS = new THREE.Color(0x2b2f38);
const ROAD_Y = 0.09;
/** A ped slot that moves further than this in one frame was reused for a new ped. */
const RESPAWN_JUMP = 2;

/** Draws the pedestrian pool as instanced torsos, heads, arms and legs, swinging limbs by distance walked; call `update` once per frame. */
export function pedView(scene: THREE.Scene, count: number): { update(peds: readonly PedView[]): void } {
  const g = pedGeometry();
  const torso = new THREE.InstancedMesh(g.torso, new THREE.MeshLambertMaterial(), count);
  const head = new THREE.InstancedMesh(g.head, new THREE.MeshLambertMaterial({ color: SKIN }), count);
  const arms = new THREE.InstancedMesh(g.arm, new THREE.MeshLambertMaterial(), 2 * count);
  const legs = new THREE.InstancedMesh(g.leg, new THREE.MeshLambertMaterial({ color: TROUSERS }), 2 * count);
  const meshes = [torso, head, arms, legs];
  for (const mesh of meshes) {
    mesh.frustumCulled = false;
    if (mesh === torso || mesh === arms) for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, SKIN);
    mesh.count = 0;
  }
  scene.add(...meshes);

  const walked = new Map<number, { x: number; z: number; d: number }>();
  const base = new THREE.Matrix4(), m = new THREE.Matrix4(), t = new THREE.Matrix4(), r = new THREE.Matrix4();
  const q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  const limb = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, angle: number) => {
    t.makeTranslation(x, y, 0).multiply(r.makeRotationX(angle));
    mesh.setMatrixAt(i, m.multiplyMatrices(base, t));
  };

  return {
    update(peds) {
      let n = 0;
      for (const p of peds) {
        if (!p.active) {
          walked.delete(p.id);
          continue;
        }
        const [x, z] = p.position;
        let w = walked.get(p.id);
        if (!w) walked.set(p.id, (w = { x, z, d: 0 }));
        const step = Math.hypot(x - w.x, z - w.z);
        w.d = step > RESPAWN_JUMP ? 0 : w.d + step;
        w.x = x;
        w.z = z;
        const swing = limbSwing(w.d, p.walking);

        base.compose(pos.set(x, ROAD_Y, z), q.setFromAxisAngle(up, p.heading), one);
        torso.setMatrixAt(n, base);
        head.setMatrixAt(n, base);
        colour.setHex(p.colour);
        torso.setColorAt(n, colour);
        limb(legs, 2 * n, HIP_X, HIP_Y, swing);
        limb(legs, 2 * n + 1, -HIP_X, HIP_Y, -swing);
        limb(arms, 2 * n, SHOULDER_X, SHOULDER_Y, -swing);
        limb(arms, 2 * n + 1, -SHOULDER_X, SHOULDER_Y, swing);
        arms.setColorAt(2 * n, colour);
        arms.setColorAt(2 * n + 1, colour);
        n++;
      }
      torso.count = head.count = n;
      arms.count = legs.count = 2 * n;
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
  };
}
