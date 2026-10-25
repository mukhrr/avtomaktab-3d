import * as THREE from 'three';
import { CAR_CLASSES, type CarClass } from './carClasses';
import { BUS_GREEN, carGeometry, lampMounts } from './carModels';
import type { AgentView } from './trafficSim';

const TAIL_DIM = new THREE.Color(0x4a0d0d);
const TAIL_BRAKE = new THREE.Color(0xff2a1a);
const AMBER_DIM = new THREE.Color(0x4f3208);
const AMBER_ON = new THREE.Color(0xffa21a);
const WHITE = new THREE.Color(0xffffff);
const BLINK_HZ = 1.5;
const ROAD_Y = 0.09;
const LAMPS = 6;
const BRAKE_SIZE = new THREE.Vector3(0.24, 0.13, 1);
const BLINKER_SIZE = new THREE.Vector3(0.1, 0.09, 1);

const CLASSES = Object.keys(CAR_CLASSES) as CarClass[];
type Variant = CarClass | 'busGreen';
const VARIANTS: Variant[] = [...CLASSES, 'busGreen'];

/**
 * Draws the traffic pool: one BatchedMesh holds every class's paint and fixed parts (two instances per car),
 * plus one instanced mesh for brake and indicator lamps. Call `update` once per frame with the sim time for the blink.
 */
export function trafficView(scene: THREE.Scene, count: number): { update(agents: readonly AgentView[], time?: number): void } {
  const geoms = VARIANTS.map(v => (v === 'busGreen' ? carGeometry('bus', BUS_GREEN) : carGeometry(v)));
  const all = geoms.flatMap(g => [g.paint, g.fixed]);
  const vertices = all.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const cars = new THREE.BatchedMesh(2 * count, vertices, 0, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const ids = geoms.map(g => ({ paint: cars.addGeometry(g.paint), fixed: cars.addGeometry(g.fixed) }));
  for (const g of all) g.dispose();
  for (let i = 0; i < 2 * count; i++) {
    cars.addInstance(i % 2 ? ids[0].fixed : ids[0].paint);
    cars.setColorAt(i, WHITE);
    cars.setVisibleAt(i, false);
  }
  cars.castShadow = true;
  // BatchedMesh re-culls, re-sorts and re-uploads in onBeforeShadow for every cascade unless both are off.
  cars.frustumCulled = false;
  cars.perObjectFrustumCulled = false;
  cars.sortObjects = false;

  // Per car: two brake lamps, then four indicators, all one unit box sized by the instance matrix.
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.05), new THREE.MeshBasicMaterial(), LAMPS * count);
  lamps.frustumCulled = false;
  for (let i = 0; i < lamps.count; i++) lamps.setColorAt(i, WHITE);
  scene.add(cars, lamps);

  const variantIndex = (a: AgentView) => (a.carClass === 'bus' && a.id % 2 ? VARIANTS.length - 1 : CLASSES.indexOf(a.carClass));
  const shown = new Array<number>(count).fill(-1);
  const base = new THREE.Matrix4(), m = new THREE.Matrix4(), t = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), noRot = new THREE.Quaternion();
  const colour = new THREE.Color();
  const lamp = (i: number, size: THREE.Vector3, x: number, y: number, z: number, c: THREE.Color) => {
    t.compose(pos.set(x, y, z), noRot, size);
    lamps.setMatrixAt(i, m.multiplyMatrices(base, t));
    lamps.setColorAt(i, c);
  };

  return {
    update(agents, time = 0) {
      const blinkOn = (time * BLINK_HZ) % 1 < 0.5;
      for (let k = 0; k < count; k++) {
        const a = agents[k];
        if (!a?.active) {
          if (shown[k] !== -1) {
            cars.setVisibleAt(2 * k, false).setVisibleAt(2 * k + 1, false);
            shown[k] = -1;
          }
          for (let j = 0; j < LAMPS; j++) lamps.setMatrixAt(LAMPS * k + j, zero);
          continue;
        }
        const v = variantIndex(a);
        if (shown[k] !== v) {
          cars.setGeometryIdAt(2 * k, ids[v].paint).setGeometryIdAt(2 * k + 1, ids[v].fixed);
          cars.setVisibleAt(2 * k, true).setVisibleAt(2 * k + 1, true);
          shown[k] = v;
        }
        base.compose(pos.set(a.position[0], ROAD_Y, a.position[1]), q.setFromAxisAngle(up, a.heading), one);
        cars.setMatrixAt(2 * k, base).setMatrixAt(2 * k + 1, base);
        cars.setColorAt(2 * k, colour.setHex(a.colour));

        const { length, width } = CAR_CLASSES[a.carClass];
        const { headY, tailY } = lampMounts(a.carClass);
        const rear = -length / 2 + 0.025, front = length / 2 - 0.01;
        const tail = a.braking ? TAIL_BRAKE : TAIL_DIM;
        const i = LAMPS * k;
        lamp(i, BRAKE_SIZE, -(width / 2 - 0.24), tailY, rear, tail);
        lamp(i + 1, BRAKE_SIZE, width / 2 - 0.24, tailY, rear, tail);
        // Left is +x for a car facing +z.
        const left = a.indicator === 'left' && blinkOn ? AMBER_ON : AMBER_DIM;
        const right = a.indicator === 'right' && blinkOn ? AMBER_ON : AMBER_DIM;
        const ix = width / 2 - 0.06;
        lamp(i + 2, BLINKER_SIZE, ix, headY, front, left);
        lamp(i + 3, BLINKER_SIZE, ix, tailY, rear, left);
        lamp(i + 4, BLINKER_SIZE, -ix, headY, front, right);
        lamp(i + 5, BLINKER_SIZE, -ix, tailY, rear, right);
      }
      lamps.instanceMatrix.needsUpdate = true;
      lamps.instanceColor!.needsUpdate = true;
    },
  };
}
