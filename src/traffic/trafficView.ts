import * as THREE from 'three';
import { CAR_CLASSES, type AgentView } from './trafficSim';

const TAIL_DIM = new THREE.Color(0x4a0d0d);
const TAIL_BRAKE = new THREE.Color(0xff2a1a);
const BODY_HEIGHT = 0.7;
const BODY_Y = 0.2;
const TAIL_Y = 0.75;
const TAIL_HEIGHT = 0.14;
const BUS_CABIN = 1.1;
const CAR_CABIN = 0.55;

/** Unit box with its base on y = 0, so a y scale grows it upward. */
const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

/** Draws the traffic pool as three instanced meshes (body, cabin, brake lights) shared by every car class; call `update` once per frame. */
export function trafficView(scene: THREE.Scene, count: number): { update(agents: readonly AgentView[]): void } {
  const body = new THREE.InstancedMesh(unitBox(), new THREE.MeshLambertMaterial(), count);
  const cabin = new THREE.InstancedMesh(unitBox(), new THREE.MeshLambertMaterial({ color: 0x9fb4c4 }), count);
  const tail = new THREE.InstancedMesh(unitBox(), new THREE.MeshBasicMaterial(), count);
  const meshes = [body, cabin, tail];
  body.castShadow = true;
  for (const mesh of meshes) {
    mesh.frustumCulled = false;
    mesh.count = 0;
  }
  scene.add(...meshes);

  const base = new THREE.Matrix4(), local = new THREE.Matrix4(), m = new THREE.Matrix4();
  const q = new THREE.Quaternion(), noRot = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3(), off = new THREE.Vector3(), size = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const colour = new THREE.Color();

  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    local.compose(off.set(x, y, z), noRot, size.set(sx, sy, sz));
    mesh.setMatrixAt(i, m.multiplyMatrices(base, local));
  };

  return {
    update(agents) {
      let n = 0;
      for (let k = 0; k < agents.length; k++) {
        const a = agents[k];
        if (!a.active) continue;
        const { length, width } = CAR_CLASSES[a.carClass];
        const bus = a.carClass === 'bus';
        base.compose(pos.set(a.position[0], 0.09, a.position[1]), q.setFromAxisAngle(up, a.heading), one);
        place(body, n, 0, BODY_Y, 0, width, BODY_HEIGHT, length);
        place(cabin, n, 0, BODY_Y + BODY_HEIGHT, bus ? 0 : -length * 0.05, width * 0.9, bus ? BUS_CABIN : CAR_CABIN, bus ? length * 0.96 : length * 0.55);
        place(tail, n, 0, TAIL_Y - TAIL_HEIGHT / 2, -length / 2 - 0.02, width * 0.85, TAIL_HEIGHT, 0.06);
        body.setColorAt(n, colour.setHex(a.colour));
        tail.setColorAt(n, a.braking ? TAIL_BRAKE : TAIL_DIM);
        n++;
      }
      for (const mesh of meshes) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
  };
}
