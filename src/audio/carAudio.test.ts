import { describe, expect, it } from 'vitest';
import { BUS_GAIN, CarAudio, CHIME_HZ, CLICK_HZ, engineParams, TYRE_MAX, tyreGain, type CarSound } from './carAudio';

import { stubContext, type Node, type Param } from './stubContext';
const idle: CarSound = { rpm: 800, throttle: 0, running: true, speed: 0, slip: 0, gear: 0, belt: true, blinker: null };
const lastTarget = (p: Param) => [...p.events].reverse().find(e => e.kind === 'target');

function setup(now = 10) {
  const stub = stubContext(now);
  const master = stub.ctx.createGain();
  const car = new CarAudio(stub.ctx, master);
  const lowpass = stub.nodes.find(n => n.kind === 'filter' && n.type === 'lowpass')!;
  const engineGain = lowpass?.connected[0] as Node;
  return { ...stub, master: master as unknown as Node, car, lowpass, engineGain };
}

describe('engineParams', () => {
  it('maps idle to the 4-cylinder firing frequency, a 600 Hz cutoff and a quiet gain', () => {
    const p = engineParams(idle);
    expect(p.base).toBeCloseTo(800 / 60 * 2, 3);
    expect(p.base).toBeCloseTo(26.7, 1);
    expect(p.cutoff).toBeCloseTo(600, 5);
    expect(p.gain).toBeCloseTo(0.15, 5);
  });

  it('opens the filter to 3500 Hz and the gain to 0.5 at 6200 rpm full throttle', () => {
    const p = engineParams({ ...idle, rpm: 6200, throttle: 1 });
    expect(p.cutoff).toBeCloseTo(3500, 5);
    expect(p.gain).toBeCloseTo(0.5, 5);
  });

  it('wobbles about 1.5% at idle and not at cruising rpm', () => {
    expect(engineParams(idle).wobbleCents).toBeGreaterThan(20);
    expect(engineParams(idle).wobbleCents).toBeLessThan(30);
    expect(engineParams({ ...idle, rpm: 3000, throttle: 0.4 }).wobbleCents).toBeLessThan(3);
  });

  it('is silent with the engine off', () => {
    const p = engineParams({ ...idle, running: false, rpm: 0 });
    expect(p.gain).toBe(0);
    expect(p.noiseGain).toBe(0);
  });
});

describe('tyreGain', () => {
  it('is zero below the slip threshold, grows above it and is capped', () => {
    expect(tyreGain(0.1)).toBe(0);
    expect(tyreGain(0.15)).toBe(0);
    expect(tyreGain(0.6)).toBeGreaterThan(0);
    expect(tyreGain(5)).toBe(TYRE_MAX);
  });
});

describe('CarAudio', () => {
  it('smooths the three harmonics and the cutoff towards the idle mapping', () => {
    const { car, nodes, lowpass } = setup();
    car.update(idle, 1 / 60);
    const base = 800 / 60 * 2;
    const targets = nodes.filter(n => n.kind === 'osc').map(n => lastTarget(n.frequency)).filter(e => e !== undefined);
    const freqs = targets.map(e => e.v).sort((a, b) => a - b);
    expect(freqs).toHaveLength(3);
    expect(freqs[0]).toBeCloseTo(base * 0.5, 3);
    expect(freqs[1]).toBeCloseTo(base, 3);
    expect(freqs[2]).toBeCloseTo(base * 2, 3);
    for (const e of targets) expect(e.tau).toBe(0.05);
    expect(lastTarget(lowpass.frequency)!.v).toBeCloseTo(600, 5);
  });

  it('targets engine gain 0 with the engine off', () => {
    const { car, engineGain } = setup();
    expect(engineGain).toBeDefined();
    car.update(idle, 1 / 60);
    expect(lastTarget(engineGain.gain)!.v).toBeCloseTo(0.15, 5);
    car.update({ ...idle, running: false, rpm: 0 }, 1 / 60);
    const e = lastTarget(engineGain.gain)!;
    expect(e.v).toBe(0);
    expect(e.tau).toBe(0.05);
  });

  it('sweeps the engine down to 0 within 0.4 s on stall and goes quiet within 0.5 s', () => {
    const { car, nodes, engineGain } = setup(10);
    car.update({ ...idle, rpm: 1200, throttle: 0.2 }, 1 / 60);
    car.event('stall');
    const oscs = nodes.filter(n => n.kind === 'osc' && n.frequency.events.some(e => e.kind === 'target'));
    expect(oscs).toHaveLength(3);
    for (const o of oscs) {
      const ramp = o.frequency.events.find(e => e.kind === 'linear')!;
      expect(ramp.v).toBe(0);
      expect(ramp.t).toBeGreaterThan(10);
      expect(ramp.t).toBeLessThanOrEqual(10.4);
    }
    const quiet = engineGain.gain.events.find(e => e.kind === 'linear')!;
    expect(quiet.v).toBe(0);
    expect(quiet.t).toBeLessThanOrEqual(10.5);
    const before = oscs.map(o => o.frequency.events.length);
    car.update({ ...idle, running: false, rpm: 0 }, 0.1);
    expect(oscs.map(o => o.frequency.events.length)).toEqual(before);
  });

  it('gives the tyres no gain at slip 0.1 and some at 0.6', () => {
    const { car, nodes } = setup();
    const band = nodes.find(n => n.kind === 'filter' && n.type === 'bandpass' && n.frequency.value === 900)!;
    expect(band).toBeDefined();
    const tyre = band.connected[0] as Node;
    car.update({ ...idle, slip: 0.1 }, 1 / 60);
    expect(lastTarget(tyre.gain)!.v).toBe(0);
    car.update({ ...idle, slip: 0.6 }, 1 / 60);
    expect(lastTarget(tyre.gain)!.v).toBeGreaterThan(0);
  });

  const chimes = (nodes: Node[]) => nodes.filter(n => n.kind === 'osc' && n.frequency.value === CHIME_HZ[0]).length;

  it('chimes every 2 s while unbelted above 10 km/h', () => {
    const { car, nodes } = setup();
    for (let i = 0; i < 59; i++) car.update({ ...idle, rpm: 2000, speed: 5, belt: false }, 0.1);
    expect(chimes(nodes)).toBe(3);
  });

  it('never chimes below 10 km/h or with the belt on', () => {
    const { car, nodes } = setup();
    for (let i = 0; i < 100; i++) car.update({ ...idle, speed: 2.7, belt: false }, 0.1);
    for (let i = 0; i < 100; i++) car.update({ ...idle, speed: 15, belt: true }, 0.1);
    expect(chimes(nodes)).toBe(0);
  });

  const clicks = (nodes: Node[]) => nodes.filter(n => n.kind === 'filter' && n.frequency.value === CLICK_HZ).length;

  it('clicks on every on and off edge of the HUD blink, starting at activation', () => {
    const { car, nodes } = setup();
    car.update(idle, 0.1);
    expect(clicks(nodes)).toBe(0);
    for (let i = 0; i < 100; i++) car.update({ ...idle, blinker: 'left' }, 0.01);
    expect(clicks(nodes)).toBe(3);
    car.update({ ...idle, blinker: 'right' }, 0.01);
    expect(clicks(nodes)).toBe(4);
    car.update(idle, 0.01);
    for (let i = 0; i < 50; i++) car.update(idle, 0.01);
    expect(clicks(nodes)).toBe(4);
  });

  it('makes a starter whirr on start with 12 Hz modulation, and holds the engine silent while it cranks', () => {
    const { car, nodes, engineGain } = setup(10);
    car.event('start');
    const am = nodes.find(n => n.kind === 'osc' && n.frequency.value === 12)!;
    expect(am).toBeDefined();
    expect(am.stopped! - 10).toBeCloseTo(0.6, 5);
    car.update(idle, 0.1);
    expect(lastTarget(engineGain.gain)!.v).toBe(0);
    for (let i = 0; i < 5; i++) car.update(idle, 0.1);
    expect(lastTarget(engineGain.gain)!.v).toBeCloseTo(0.15, 5);
  });

  it('plays nothing short-lived while the context is suspended', () => {
    const stub = stubContext(0, 'suspended');
    const car = new CarAudio(stub.ctx, stub.ctx.createGain());
    const count = stub.nodes.length;
    car.event('start');
    car.event('click');
    car.event('chime');
    car.horn(true);
    expect(stub.nodes.length).toBe(count);
  });

  it('holds the horn while on and releases it on off', () => {
    const { car, nodes } = setup();
    const count = nodes.length;
    car.horn(true);
    car.horn(true);
    const horn = nodes.slice(count).filter(n => n.kind === 'osc');
    expect(horn).toHaveLength(2);
    expect(horn.every(o => o.stopped === undefined)).toBe(true);
    car.horn(false);
    expect(horn.every(o => o.stopped !== undefined && o.stopped <= 10.2)).toBe(true);
  });

  it('runs everything through a limiter into the master bus with headroom at redline', () => {
    const { car, nodes, master, lowpass } = setup();
    const comp = nodes.find(n => n.kind === 'compressor')!;
    expect(comp).toBeDefined();
    expect(comp.connected).toContain(master);
    expect(comp.threshold.value).toBeLessThanOrEqual(-6);
    const bus = nodes.find(n => n.kind === 'gain' && n.connected.includes(comp))!;
    expect(bus.gain.value).toBe(BUS_GAIN);
    const mix = nodes.filter(n => n.kind === 'gain' && n.connected.includes(lowpass)).reduce((a, n) => a + n.gain.value, 0);
    const peak = engineParams({ ...idle, rpm: 6200, throttle: 1 });
    expect((mix * peak.gain + peak.noiseGain + TYRE_MAX) * BUS_GAIN).toBeLessThan(1);
    car.fade(0, 0.3);
    expect(lastTarget(bus.gain)!.v).toBe(0);
  });

  it('disconnects every node it created on dispose, transient ones included', () => {
    const { car, nodes, raw, master } = setup();
    car.update(idle, 0.1);
    car.event('start');
    car.event('chime');
    car.event('click');
    car.horn(true);
    car.dispose();
    const created = nodes.filter(n => n !== (raw.destination as unknown) && n !== master);
    expect(created.length).toBeGreaterThan(10);
    for (const n of created) expect(n.disconnects ?? 0, n.kind).toBeGreaterThanOrEqual(1);
    for (const n of created.filter(n => n.kind === 'osc' || n.kind === 'buffer')) expect(n.stopCalls ?? 0, n.kind).toBeGreaterThanOrEqual(1);
    expect(master.disconnects ?? 0).toBe(0);
  });
});

describe('non-finite inputs', () => {
  const values = (n: Node) => (['frequency', 'gain', 'detune'] as const).flatMap(k => n[k]?.events ?? []);

  it('never schedules NaN or Infinity when rpm, throttle, slip or speed are not finite', () => {
    const { car, nodes } = setup();
    car.update({ ...idle, rpm: NaN, throttle: Infinity, slip: NaN, speed: -Infinity }, 1 / 60);
    car.update({ ...idle, rpm: Infinity, throttle: NaN, slip: Infinity }, 1 / 60);
    for (const n of nodes) for (const e of values(n)) {
      expect(Number.isFinite(e.v)).toBe(true);
      expect(Number.isFinite(e.t)).toBe(true);
    }
  });

  it('ignores a non-finite or negative dt so the clock and timers stay usable', () => {
    const { car, nodes } = setup();
    car.update(idle, NaN);
    car.update(idle, Infinity);
    car.update(idle, -1);
    car.update({ ...idle, blinker: 'left' }, 1 / 60);
    car.update(idle, 1 / 60);
    for (const n of nodes) for (const e of values(n)) expect(Number.isFinite(e.v)).toBe(true);
  });
});
