import * as THREE from 'three';
import type { TimeOfDay } from '../render/timeOfDay';
import { headlightsOn, type CabinState } from './cabin';

/** One mesh and one material each on the player car. Left is +x, the driver's side. */
export const LAMP_GROUPS = ['head', 'tail', 'reverse', 'indicatorLeft', 'indicatorRight'] as const;
export type LampGroup = (typeof LAMP_GROUPS)[number];

export interface LampState { left: boolean; right: boolean; brake: boolean; reverse: boolean; head: boolean }

const BRAKE_LAMP_PEDAL = 0.05;

export const newLampState = (): LampState => ({ left: false, right: false, brake: false, reverse: false, head: false });

/** Lamps from the cabin and pedals; indicators follow the dashboard's blink phase so both flash together. */
export function lampState(cabin: CabinState, brake: number, gear: number, blinkOn: boolean, tod: TimeOfDay, out = newLampState()): LampState {
  out.left = blinkOn && (cabin.hazard || cabin.indicator === 'left');
  out.right = blinkOn && (cabin.hazard || cabin.indicator === 'right');
  out.brake = brake > BRAKE_LAMP_PEDAL;
  out.reverse = gear === -1;
  out.head = headlightsOn(cabin, tod);
  return out;
}

// Lens colour when off, emissive colour when lit.
const LOOK: Record<LampGroup, { lens: number; glow: number }> = {
  head: { lens: 0xf4f0dc, glow: 0xfff1d6 },
  tail: { lens: 0x8a1414, glow: 0xff2010 },
  reverse: { lens: 0xd8d8d8, glow: 0xffffff },
  indicatorLeft: { lens: 0xb06a10, glow: 0xff8a10 },
  indicatorRight: { lens: 0xb06a10, glow: 0xff8a10 },
};

const HEAD = 2.5, TAIL = 1, BRAKE = 6, REVERSE = 5, INDICATOR = 6;

/** Materials for the code-built body's lamps. */
export function lampMaterials(): Record<LampGroup, THREE.MeshStandardMaterial> {
  const out = {} as Record<LampGroup, THREE.MeshStandardMaterial>;
  for (const g of LAMP_GROUPS) {
    out[g] = new THREE.MeshStandardMaterial({ name: g, color: LOOK[g].lens, roughness: 0.3, emissiveIntensity: 0 });
    glow(out[g]);
    // No lens texture to dim the glow here, and at full strength tone mapping turns the red brake lamps orange.
    out[g].emissive.multiplyScalar(0.4);
  }
  return out;
}

/**
 * Sets the lit colour on a lamp material. Indicator and reverse cells are small and sit under the model's red tail
 * lamp glass, so they glow evenly instead of through their dark lens texture.
 */
export function glow(m: THREE.MeshStandardMaterial): void {
  const g = m.name as LampGroup;
  m.emissive.setHex(LOOK[g].glow);
  m.emissiveIntensity = 0;
  if (g !== 'head' && g !== 'tail') m.emissiveMap = null;
}

/** Switches lamps by emissive intensity alone, so no shader recompiles and no allocations. */
export function createLampControl(mats: Record<LampGroup, THREE.MeshStandardMaterial>) {
  return {
    set(s: LampState): void {
      mats.head.emissiveIntensity = s.head ? HEAD : 0;
      mats.tail.emissiveIntensity = s.brake ? BRAKE : s.head ? TAIL : 0;
      mats.reverse.emissiveIntensity = s.reverse ? REVERSE : 0;
      mats.indicatorLeft.emissiveIntensity = s.left ? INDICATOR : 0;
      mats.indicatorRight.emissiveIntensity = s.right ? INDICATOR : 0;
    },
  };
}

export type LampControl = ReturnType<typeof createLampControl>;

const BEAM_CANDELA = 400;

/**
 * Two spot lights on the road ahead, children of the car. They stay in the scene at zero intensity when off, as adding
 * or removing a light recompiles every lit shader. They keep layer 0 so the cockpit camera still sees their light.
 */
export function createHeadlightBeams(car: THREE.Object3D, groundY: number) {
  const beams = [-1, 1].map(side => {
    const spot = new THREE.SpotLight(0xfff1d6, 0, 70, 0.42, 0.5, 2);
    spot.position.set(side * 0.55, groundY + 0.65, 2.1);
    spot.target.position.set(side * 0.9, groundY, 22);
    spot.castShadow = false;
    car.add(spot, spot.target);
    return spot;
  });
  return {
    set(on: boolean): void {
      for (const b of beams) b.intensity = on ? BEAM_CANDELA : 0;
    },
  };
}
