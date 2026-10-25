import { describe, expect, it } from 'vitest';
import { Sfx } from './sfx';

interface Param { value: number; ramps: [number, number][]; setValueAtTime: (v: number, t: number) => void; linearRampToValueAtTime: (v: number, t: number) => void }
interface Node { kind: string; params: Record<string, Param>; connected: Node[]; started?: number; stopped?: number; stopCalls?: number; disconnects?: number; type?: string; frequency?: Param; onended?: () => void; connect: (n: Node) => Node; disconnect: () => void; start?: (t: number) => void; stop?: (t?: number) => void }

function param(): Param {
  const p: Param = { value: 0, ramps: [], setValueAtTime(v, t) { p.ramps.push([t, v]); }, linearRampToValueAtTime(v, t) { p.ramps.push([t, v]); } };
  return p;
}

function stubContext(now = 10, state = 'running') {
  const nodes: Node[] = [];
  const make = (kind: string, extra: Partial<Node> = {}): Node => {
    const n: Node = {
      kind, params: {}, connected: [],
      connect(to) { n.connected.push(to); return to; },
      disconnect() { n.disconnects = (n.disconnects ?? 0) + 1; },
      ...extra,
    };
    nodes.push(n);
    return n;
  };
  const ctx = {
    currentTime: now,
    state,
    destination: make('destination'),
    createGain() { const n = make('gain'); n.params.gain = param(); (n as unknown as { gain: Param }).gain = n.params.gain; return n; },
    createBiquadFilter() { const n = make('filter'); (n as unknown as { frequency: Param; Q: Param }).frequency = param(); (n as unknown as { Q: Param }).Q = param(); return n; },
    createStereoPanner() { const n = make('panner'); (n as unknown as { pan: Param }).pan = param(); return n; },
    createOscillator() {
      const n = make('osc', { start(t) { n.started = t; }, stop(t) { n.stopCalls = (n.stopCalls ?? 0) + 1; if (t !== undefined) n.stopped = t; } });
      (n as unknown as { frequency: Param; detune: Param }).frequency = param();
      (n as unknown as { detune: Param }).detune = param();
      return n;
    },
  };
  return { ctx: ctx as unknown as AudioContext, nodes };
}

describe('Sfx.horn', () => {
  it('starts two oscillators now and stops them within 0.5 s', () => {
    const { ctx, nodes } = stubContext(10);
    new Sfx(ctx).horn(0.8, 0);
    const oscs = nodes.filter(n => n.kind === 'osc');
    expect(oscs).toHaveLength(2);
    for (const o of oscs) {
      expect(o.started).toBe(10);
      expect(o.stopped! - o.started!).toBeGreaterThan(0.2);
      expect(o.stopped! - o.started!).toBeLessThanOrEqual(0.5);
    }
    const freqs = oscs.map(o => (o as unknown as { frequency: Param }).frequency.value).sort();
    expect(freqs).toEqual([400, 500]);
  });

  it('ramps the gain up and back to silence by the stop time, scaled by volume', () => {
    const { ctx, nodes } = stubContext(0);
    new Sfx(ctx).horn(0.5, 0);
    const gain = nodes.filter(n => n.kind === 'gain')[1].params.gain;
    const peak = Math.max(...gain.ramps.map(r => r[1]));
    expect(peak).toBeGreaterThan(0);
    const loud = stubContext(0);
    new Sfx(loud.ctx).horn(1, 0);
    expect(Math.max(...loud.nodes.filter(n => n.kind === 'gain')[1].params.gain.ramps.map(r => r[1]))).toBeGreaterThan(peak);
    const last = gain.ramps[gain.ramps.length - 1];
    expect(last[1]).toBe(0);
    expect(last[0]).toBeLessThanOrEqual(0.5);
  });

  it('pans and clamps, and routes through a shared master when given one', () => {
    const { ctx, nodes } = stubContext();
    const sfx = new Sfx(ctx);
    sfx.horn(1, 3);
    const panner = nodes.find(n => n.kind === 'panner')! as unknown as { pan: Param; connected: unknown[] };
    expect(panner.pan.value).toBe(1);
    expect(panner.connected).toContain(sfx.master);
  });

  it('owns a master gain routed to the destination', () => {
    const { ctx, nodes } = stubContext();
    const sfx = new Sfx(ctx);
    const master = sfx.master as unknown as Node;
    expect(master.kind).toBe('gain');
    expect(master.connected).toContain(ctx.destination);
    expect(nodes.filter(n => n.kind === 'gain')).toHaveLength(1);
  });

  it('makes no nodes while the context is not running', () => {
    const { ctx, nodes } = stubContext(0, 'suspended');
    new Sfx(ctx).horn(1, 0);
    expect(nodes.filter(n => n.kind === 'osc')).toHaveLength(0);
    expect(nodes.filter(n => n.kind === 'panner')).toHaveLength(0);
  });

  it('disconnects its nodes once both oscillators have ended', () => {
    const { ctx, nodes } = stubContext();
    new Sfx(ctx).horn(1, 0);
    const [a, b] = nodes.filter(n => n.kind === 'osc');
    const chain = nodes.filter(n => ['filter', 'panner'].includes(n.kind));
    a.onended!();
    expect(chain.every(n => !n.disconnects)).toBe(true);
    b.onended!();
    expect(a.disconnects).toBe(1);
    expect(b.disconnects).toBe(1);
    expect(chain.every(n => n.disconnects === 1)).toBe(true);
  });

  it('dispose stops running oscillators', () => {
    const { ctx, nodes } = stubContext(5);
    const sfx = new Sfx(ctx);
    sfx.horn(1, 0);
    sfx.dispose();
    for (const o of nodes.filter(n => n.kind === 'osc')) expect(o.stopCalls).toBe(2);
  });

  it('uses a given master without creating or disconnecting one', () => {
    const { ctx, nodes } = stubContext();
    const bus = ctx.createGain();
    const sfx = new Sfx(ctx, bus);
    expect(sfx.master).toBe(bus);
    expect(nodes.filter(n => n.kind === 'gain')).toHaveLength(1);
    sfx.dispose();
    expect((bus as unknown as Node).disconnects ?? 0).toBe(0);
  });
});

describe('Sfx.holdHorn', () => {
  it('sustains until released, then fades out and tears down', () => {
    const { ctx, nodes } = stubContext(10);
    const release = new Sfx(ctx).holdHorn(1, 0);
    const oscs = nodes.filter(n => n.kind === 'osc');
    expect(oscs).toHaveLength(2);
    expect(oscs.every(o => o.started === 10 && o.stopped === undefined)).toBe(true);
    release();
    for (const o of oscs) {
      expect(o.stopped).toBeGreaterThan(10);
      expect(o.stopped).toBeLessThanOrEqual(10.2);
    }
    const gain = nodes.filter(n => n.kind === 'gain')[1].params.gain;
    expect(gain.ramps[gain.ramps.length - 1][1]).toBe(0);
    for (const o of oscs) o.onended!();
    expect(nodes.filter(n => n.kind === 'panner').every(n => n.disconnects === 1)).toBe(true);
  });
});
