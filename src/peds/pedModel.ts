import * as THREE from 'three';

export const LIMB_SWING = THREE.MathUtils.degToRad(25);
export const STEP_LENGTH = 0.7;
export const HIP_Y = 0.86;
export const HIP_X = 0.09;
export const SHOULDER_Y = 1.42;
export const SHOULDER_X = 0.23;

/** Leg angle about the hip for a ped that has walked `distance` metres; arms swing opposite. One step per STEP_LENGTH. */
export function limbSwing(distance: number, walking: boolean): number {
  return walking ? LIMB_SWING * Math.sin((Math.PI * distance) / STEP_LENGTH) : 0;
}

/** Stylised ped in local space, +z forward, feet at y = 0. Arm and leg hang from their pivot at the origin. */
export function pedGeometry(): { torso: THREE.BufferGeometry; head: THREE.BufferGeometry; arm: THREE.BufferGeometry; leg: THREE.BufferGeometry } {
  return {
    torso: new THREE.CylinderGeometry(0.2, 0.15, 0.62, 8).scale(1, 1, 0.62).translate(0, HIP_Y + 0.29, 0),
    head: new THREE.SphereGeometry(0.11, 8, 6).translate(0, 1.6, 0),
    arm: new THREE.BoxGeometry(0.08, 0.62, 0.09).translate(0, -0.3, 0),
    leg: new THREE.BoxGeometry(0.13, HIP_Y, 0.15).translate(0, -HIP_Y / 2, 0),
  };
}
