import * as THREE from 'three';
import { CAR_CLASSES, type AgentView, type CarClass } from './trafficSim';

const TAIL_DIM = new THREE.Color(0x4a0d0d);
const TAIL_BRAKE = new THREE.Color(0xff2a1a);
const BODY_HEIGHT = 0.7;
const BODY_Y = 0.2;
const TAIL_Y = 0.75;

interface Parts {
  body: THREE.InstancedMesh;
  cabin: THREE.InstancedMesh;
  tail: THREE.InstancedMesh;
}

function classParts(carClass: CarClass, capacity: number): Parts {
  const { length, width } = CAR_CLASSES[carClass];
  const bus = carClass === 'bus';
  const lit = new THREE.MeshLambertMaterial();
  const cabinH = bus ? 1.1 : 0.55;
  const cabinLength = bus ? length * 0.96 : length * 0.55;
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(width, BODY_HEIGHT, length).translate(0, BODY_Y + BODY_HEIGHT / 2, 0), lit, capacity);
  const cabin = new THREE.InstancedMesh(
    new THREE.BoxGeometry(width * 0.9, cabinH, cabinLength).translate(0, BODY_Y + BODY_HEIGHT + cabinH / 2, bus ? 0 : -length * 0.05),
    new THREE.MeshLambertMaterial({ color: 0x9fb4c4 }),
    capacity,
  );
  const tail = new THREE.InstancedMesh(
    new THREE.BoxGeometry(width * 0.85, 0.14, 0.06).translate(0, TAIL_Y, -length / 2 - 0.02),
    new THREE.MeshBasicMaterial(),
    capacity,
  );
  body.castShadow = true;
  for (const m of [body, cabin, tail]) {
    m.frustumCulled = false;
    m.count = 0;
  }
  return { body, cabin, tail };
}

/** Draws the traffic pool as instanced boxes; call `update` once per frame. */
export function trafficView(scene: THREE.Scene, count: number): { update(agents: readonly AgentView[]): void } {
  const parts = new Map<CarClass, Parts>();
  for (const c of Object.keys(CAR_CLASSES) as CarClass[]) {
    const p = classParts(c, count);
    parts.set(c, p);
    scene.add(p.body, p.cabin, p.tail);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  const used = new Map<CarClass, number>();

  return {
    update(agents) {
      used.clear();
      for (const a of agents) {
        if (!a.active) continue;
        const p = parts.get(a.carClass)!;
        const i = used.get(a.carClass) ?? 0;
        used.set(a.carClass, i + 1);
        m.compose(pos.set(a.position[0], 0.09, a.position[1]), q.setFromAxisAngle(up, a.heading), one);
        p.body.setMatrixAt(i, m);
        p.cabin.setMatrixAt(i, m);
        p.tail.setMatrixAt(i, m);
        p.body.setColorAt(i, colour.setHex(a.colour));
        p.tail.setColorAt(i, a.braking ? TAIL_BRAKE : TAIL_DIM);
      }
      for (const [c, p] of parts) {
        const n = used.get(c) ?? 0;
        for (const mesh of [p.body, p.cabin, p.tail]) {
          mesh.count = n;
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
    },
  };
}
