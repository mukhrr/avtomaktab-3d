import * as THREE from 'three';
import { LIMB_SWING, STEP_LENGTH, limbSwing, pedGeometry } from './pedModel';
import { pedView } from './pedView';

describe('ped model', () => {
  it('has a torso, head, arm and leg', () => {
    const g = pedGeometry();
    for (const part of [g.torso, g.head, g.arm, g.leg]) expect(part.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('swings 25 degrees at most and steps every 0.7 m', () => {
    expect(LIMB_SWING).toBeCloseTo(THREE.MathUtils.degToRad(25));
    expect(STEP_LENGTH).toBe(0.7);
    let peak = 0;
    for (let d = 0; d < 5; d += 0.01) peak = Math.max(peak, Math.abs(limbSwing(d, true)));
    expect(peak).toBeLessThanOrEqual(LIMB_SWING + 1e-9);
    expect(peak).toBeGreaterThan(LIMB_SWING * 0.95);
    expect(limbSwing(STEP_LENGTH / 2, true)).toBeCloseTo(LIMB_SWING);
    expect(limbSwing(STEP_LENGTH * 1.5, true)).toBeCloseTo(-LIMB_SWING);
  });

  it('does not swing when standing', () => {
    for (const d of [0, 0.35, 1.2, 3.3]) expect(limbSwing(d, false)).toBe(0);
  });

  it('uses at most 4 scene objects', () => {
    const scene = new THREE.Scene();
    pedView(scene, 20);
    expect(scene.children.length).toBeLessThanOrEqual(4);
  });
});
