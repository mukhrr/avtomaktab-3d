import { describe, expect, it } from 'vitest';
import { Sfx } from './sfx';

interface Param { value: number; ramps: [number, number][]; setValueAtTime: (v: number, t: number) => void; linearRampToValueAtTime: (v: number, t: number) => void }
interface Node { kind: string; params: Record<string, Param>; connected: Node[]; started?: number; stopped?: number; stopCalls?: number; type?: string; frequency?: Param; onended?: () => void; connect: (n: Node) => Node; disconnect: () => void; start?: (t: number) => void; stop?: (t?: number) => void }

function param(): Param {
  const p: Param = { value: 0, ramps: [], setValueAtTime(v, t) { p.ramps.push([t, v]); }, linearRampToValueAtTime(v, t) { p.ramps.push([t, v]); } };
  return p;
}

function stubContext(now = 10) {
  const nodes: Node[] = [];
  const make = (kind: string, extra: Partial<Node> = {}): Node => {
    const n: Node = {
      kind, params: {}, connected: [],
      connect(to) { n.connected.push(to); return to; },
      disconnect() {},
      ...extra,
    };
    nodes.push(n);
    return n;
  };
  const ctx = {
    currentTime: now,
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
    const gain = nodes.find(n => n.kind === 'gain')!.params.gain;
    const peak = Math.max(...gain.ramps.map(r => r[1]));
    expect(peak).toBeGreaterThan(0);
    const loud = stubContext(0);
    new Sfx(loud.ctx).horn(1, 0);
    expect(Math.max(...loud.nodes.find(n => n.kind === 'gain')!.params.gain.ramps.map(r => r[1]))).toBeGreaterThan(peak);
    const last = gain.ramps[gain.ramps.length - 1];
    expect(last[1]).toBe(0);
    expect(last[0]).toBeLessThanOrEqual(0.5);
  });

  it('pans and clamps, and routes through a shared master when given one', () => {
    const { ctx, nodes } = stubContext();
    const master = { connect() {}, disconnect() {} } as unknown as AudioNode;
    const sfx = new Sfx(ctx, master);
    expect(sfx.master).toBe(master);
    sfx.horn(1, 3);
    const panner = nodes.find(n => n.kind === 'panner')! as unknown as { pan: Param; connected: unknown[] };
    expect(panner.pan.value).toBe(1);
    expect(panner.connected).toContain(master);
  });

  it('defaults the master to the context destination', () => {
    const { ctx } = stubContext();
    expect(new Sfx(ctx).master).toBe(ctx.destination);
  });

  it('dispose stops running oscillators', () => {
    const { ctx, nodes } = stubContext(5);
    const sfx = new Sfx(ctx);
    sfx.horn(1, 0);
    sfx.dispose();
    for (const o of nodes.filter(n => n.kind === 'osc')) expect(o.stopCalls).toBe(2);
  });
});
