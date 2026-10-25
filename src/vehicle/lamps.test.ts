import * as THREE from 'three';
import { newCabin, toggleHeadlights } from './cabin';
import { createLampControl, lampMaterials, lampState, LAMP_GROUPS, newLampState } from './lamps';

const cabin = newCabin();

describe('lampState', () => {
  it('blinks the indicated side with the dashboard phase only', () => {
    const left = { ...cabin, indicator: 'left' as const };
    expect(lampState(left, 0, 1, true, 'noon')).toMatchObject({ left: true, right: false });
    expect(lampState(left, 0, 1, false, 'noon')).toMatchObject({ left: false, right: false });
    expect(lampState({ ...cabin, indicator: 'right' }, 0, 1, true, 'noon')).toMatchObject({ left: false, right: true });
  });

  it('flashes both sides on hazards, over an indicator', () => {
    expect(lampState({ ...cabin, indicator: 'left', hazard: true }, 0, 1, true, 'noon')).toMatchObject({ left: true, right: true });
  });

  it('lights the brake lamps above 5% pedal, not for the handbrake', () => {
    expect(lampState(cabin, 0.05, 1, false, 'noon').brake).toBe(false);
    expect(lampState(cabin, 0.06, 1, false, 'noon').brake).toBe(true);
  });

  it('lights the reverse lamps in reverse only', () => {
    expect(lampState(cabin, 0, -1, false, 'noon').reverse).toBe(true);
    expect(lampState(cabin, 0, 0, false, 'noon').reverse).toBe(false);
    expect(lampState(cabin, 0, 1, false, 'noon').reverse).toBe(false);
  });

  it('turns the headlights on by itself in the evening', () => {
    expect(lampState(cabin, 0, 1, false, 'evening').head).toBe(true);
    expect(lampState(cabin, 0, 1, false, 'noon').head).toBe(false);
    expect(lampState(cabin, 0, 1, false, 'morning').head).toBe(false);
  });

  it('L flips the headlights from whatever they show now', () => {
    const onAtNoon = toggleHeadlights(cabin, 'noon');
    expect(lampState(onAtNoon, 0, 1, false, 'noon').head).toBe(true);
    const offAtEvening = toggleHeadlights(cabin, 'evening');
    expect(lampState(offAtEvening, 0, 1, false, 'evening').head).toBe(false);
    expect(lampState(toggleHeadlights(offAtEvening, 'evening'), 0, 1, false, 'evening').head).toBe(true);
  });

  it('fills the object it is given instead of allocating', () => {
    const out = newLampState();
    expect(lampState(cabin, 1, -1, false, 'noon', out)).toBe(out);
    expect(out).toEqual({ left: false, right: false, brake: true, reverse: true, head: false });
  });
});

describe('lamp materials', () => {
  const read = (m: THREE.MeshStandardMaterial) => m.emissiveIntensity;

  it('one emissive material per lamp group, all dark when off', () => {
    const mats = lampMaterials();
    expect(Object.keys(mats).sort()).toEqual([...LAMP_GROUPS].sort());
    createLampControl(mats).set(newLampState());
    for (const g of LAMP_GROUPS) expect(read(mats[g])).toBe(0);
  });

  it('brake is brighter than tail, tail follows the headlights', () => {
    const mats = lampMaterials();
    const lamps = createLampControl(mats);
    lamps.set({ ...newLampState(), head: true });
    const tail = read(mats.tail);
    expect(tail).toBeGreaterThan(0);
    expect(read(mats.head)).toBeGreaterThan(0);
    lamps.set({ ...newLampState(), head: true, brake: true });
    expect(read(mats.tail)).toBeGreaterThan(tail * 2);
    lamps.set({ ...newLampState(), brake: true });
    expect(read(mats.tail)).toBeGreaterThan(tail * 2);
  });

  it('indicators and reverse light their own group only', () => {
    const mats = lampMaterials();
    const lamps = createLampControl(mats);
    lamps.set({ ...newLampState(), left: true });
    expect(read(mats.indicatorLeft)).toBeGreaterThan(0);
    expect(read(mats.indicatorRight)).toBe(0);
    lamps.set({ ...newLampState(), reverse: true });
    expect(read(mats.reverse)).toBeGreaterThan(0);
    expect(read(mats.indicatorLeft)).toBe(0);
  });

  it('amber indicators, red tail, white reverse, warm white headlights', () => {
    const mats = lampMaterials();
    const hsl = (g: keyof typeof mats) => mats[g].emissive.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
    expect(hsl('indicatorLeft').h * 360).toBeGreaterThan(20);
    expect(hsl('indicatorLeft').h * 360).toBeLessThan(45);
    expect(hsl('tail').h * 360 < 10 || hsl('tail').h * 360 > 350).toBe(true);
    expect(hsl('reverse').s).toBeLessThan(0.1);
    const head = mats.head.emissive;
    expect(head.r).toBeGreaterThanOrEqual(head.b);
  });
});
