// Hand-rolled Web Audio stand-in recording connections and scheduled parameter events; shared by the audio tests.
type Ev = { kind: 'target' | 'set' | 'linear' | 'exp' | 'cancel'; v: number; t: number; tau?: number };
export interface Param { value: number; events: Ev[]; setTargetAtTime: (v: number, t: number, tau: number) => void; setValueAtTime: (v: number, t: number) => void; linearRampToValueAtTime: (v: number, t: number) => void; exponentialRampToValueAtTime: (v: number, t: number) => void; cancelScheduledValues: (t: number) => void }
export interface Node {
  kind: string; type?: string; connected: unknown[]; disconnects?: number; started?: number; stopped?: number; stopCalls?: number;
  onended?: (() => void) | null; frequency: Param; gain: Param; detune: Param; threshold: Param;
  connect: (n: unknown) => unknown; disconnect: () => void;
}

function param(): Param {
  const p: Param = {
    value: 0, events: [],
    setTargetAtTime(v, t, tau) { p.events.push({ kind: 'target', v, t, tau }); },
    setValueAtTime(v, t) { p.value = v; p.events.push({ kind: 'set', v, t }); },
    linearRampToValueAtTime(v, t) { p.events.push({ kind: 'linear', v, t }); },
    exponentialRampToValueAtTime(v, t) { p.events.push({ kind: 'exp', v, t }); },
    cancelScheduledValues(t) { p.events.push({ kind: 'cancel', v: 0, t }); },
  };
  return p;
}

export function stubContext(now = 10, state = 'running') {
  const nodes: Node[] = [];
  const make = (kind: string, params: string[] = [], source = false): Node => {
    const n = { kind, connected: [] as unknown[] } as unknown as Node;
    n.connect = to => { n.connected.push(to); return to; };
    n.disconnect = () => { n.disconnects = (n.disconnects ?? 0) + 1; };
    for (const k of params) (n as unknown as Record<string, Param>)[k] = param();
    if (source) {
      (n as unknown as { start: (t?: number) => void }).start = t => { n.started = t ?? 0; };
      (n as unknown as { stop: (t?: number) => void }).stop = t => { n.stopCalls = (n.stopCalls ?? 0) + 1; if (t !== undefined) n.stopped = t; };
    }
    nodes.push(n);
    return n;
  };
  const ctx = {
    currentTime: now,
    sampleRate: 48000,
    state,
    destination: make('destination'),
    createGain: () => make('gain', ['gain']),
    createBiquadFilter: () => make('filter', ['frequency', 'Q', 'gain']),
    createStereoPanner: () => make('panner', ['pan']),
    createOscillator: () => make('osc', ['frequency', 'detune'], true),
    createBufferSource: () => make('buffer', ['playbackRate', 'detune'], true),
    createDynamicsCompressor: () => make('compressor', ['threshold', 'knee', 'ratio', 'attack', 'release']),
    createBuffer: (_c: number, length: number) => ({ length, getChannelData: () => new Float32Array(length) }),
  };
  return { ctx: ctx as unknown as AudioContext, nodes, raw: ctx };
}
