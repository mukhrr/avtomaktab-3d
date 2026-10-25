import { IDLE_RPM, REDLINE_RPM } from '../vehicle/drivetrain';
import { Sfx } from './sfx';

export interface CarSound {
  rpm: number;
  throttle: number;
  running: boolean;
  /** m/s, as `Vehicle.speed`; the sign is ignored. */
  speed: number;
  /** Largest wheel side-impulse ratio, or longitudinal slip under hard braking. */
  slip: number;
  gear: number;
  /** Unbelted above 10 km/h chimes. Omitted counts as belted. */
  belt?: boolean;
  /** Which HUD lamp is blinking. A change restarts the blink phase, as the HUD's CSS animation restarts. */
  blinker?: 'left' | 'right' | 'hazard' | null;
}

export interface EngineParams { base: number; cutoff: number; gain: number; noiseGain: number; noiseFreq: number; wobbleCents: number }

export const TYRE_MAX = 0.25;
export const BUS_GAIN = 0.8;
export const CHIME_HZ = [880, 660] as const;
export const CLICK_HZ = 2400;

const TAU = 0.05;
const HARMONICS = [
  { mult: 0.5, type: 'sine', mix: 0.35, detune: -4 },
  { mult: 1, type: 'sawtooth', mix: 0.5, detune: 3 },
  { mult: 2, type: 'triangle', mix: 0.3, detune: 7 },
] as const;
const IDLE_WOBBLE_CENTS = 26;
const WOBBLE_HZ = 0.6;
const DRIFT_CENTS = 6;
const STALL_S = 0.4;
const CRANK_S = 0.4;
const WHIRR_S = 0.6;
const WHIRR_AM_HZ = 12;
const CLICK_S = 0.025;
const CHIME_TONE_S = 0.2;
const CHIME_EVERY_S = 2;
const CHIME_MIN_SPEED = 10 / 3.6;
// hud.css runs `hud-blink` at 0.667 s with the lamp lit for the first half.
const BLINK_HALF_S = 0.667 / 2;
// Slip is grip utilisation, so heavy braking or a firm corner sits at 0.8 to 0.9 without skidding.
const TYRE_SLIP_MIN = 0.9;
const TYRE_PER_SLIP = 2.5;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function engineParams(s: CarSound): EngineParams {
  const rpmN = clamp01((s.rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM));
  const load = clamp01(0.65 * s.throttle + 0.35 * rpmN);
  const base = (s.rpm / 60) * 2;
  const idleness = s.running ? clamp01(1 - (s.rpm - IDLE_RPM) / 600) * (1 - clamp01(s.throttle)) : 0;
  return {
    base,
    cutoff: 600 + 2900 * load,
    gain: s.running ? 0.15 + 0.35 * load : 0,
    noiseGain: s.running ? 0.03 + 0.09 * load : 0,
    noiseFreq: Math.max(250, Math.min(2500, base * 6)),
    wobbleCents: IDLE_WOBBLE_CENTS * idleness,
  };
}

const ok = Number.isFinite;

/** Param setters throw on NaN and Infinity, so a bad frame from the sim must not reach them. */
function finiteSound(s: CarSound): CarSound {
  if (ok(s.rpm) && ok(s.throttle) && ok(s.slip) && ok(s.speed)) return s;
  return { ...s, rpm: ok(s.rpm) ? s.rpm : IDLE_RPM, throttle: ok(s.throttle) ? s.throttle : 0, slip: ok(s.slip) ? s.slip : 0, speed: ok(s.speed) ? s.speed : 0 };
}

export const tyreGain = (slip: number): number => Math.min(TYRE_MAX, Math.max(0, slip - TYRE_SLIP_MIN) * TYRE_PER_SLIP);

interface Transient { sources: AudioScheduledSourceNode[]; nodes: AudioNode[] }

/**
 * Synthesised engine, tyres, starter, stall, indicator click, belt chime and held horn, all through one bus and a
 * soft limiter into `master`. Persistent nodes are made once; only one-shot sounds make nodes, and they tear down on end.
 */
export class CarAudio {
  private readonly bus: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly noise: AudioBuffer;
  private readonly oscs: OscillatorNode[] = [];
  private readonly lowpass: BiquadFilterNode;
  private readonly engineGain: GainNode;
  private readonly noiseBand: BiquadFilterNode;
  private readonly noiseGain: GainNode;
  private readonly wobble: GainNode;
  private readonly tyreGain: GainNode;
  private readonly persistent: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly transients = new Set<Transient>();
  private readonly sfx: Sfx;
  private clock = 0;
  private stallUntil = -1;
  private crankUntil = -1;
  private driftIn = 0;
  private chimeIn = 0;
  private blinkKey: CarSound['blinker'] = null;
  private blinkPhase = 0;
  private nextEdge = 0;
  private lastBase = 0;
  private lastGain = 0;
  private lastNoise = 0;
  private releaseHorn: (() => void) | null = null;
  private disposed = false;

  constructor(readonly ctx: AudioContext, readonly master: GainNode) {
    const keep = <T extends AudioNode>(n: T): T => { this.persistent.push(n); return n; };
    this.bus = keep(ctx.createGain());
    this.bus.gain.value = BUS_GAIN;
    this.limiter = keep(ctx.createDynamicsCompressor());
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.2;
    this.bus.connect(this.limiter);
    this.limiter.connect(master);

    const length = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    this.lowpass = keep(ctx.createBiquadFilter());
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 600;
    this.lowpass.Q.value = 0.7;
    this.engineGain = keep(ctx.createGain());
    this.engineGain.gain.value = 0;
    this.lowpass.connect(this.engineGain);
    this.engineGain.connect(this.bus);

    this.wobble = keep(ctx.createGain());
    this.wobble.gain.value = 0;
    const lfo = keep(ctx.createOscillator());
    lfo.frequency.value = WOBBLE_HZ;
    lfo.connect(this.wobble);
    this.sources.push(lfo);

    for (const h of HARMONICS) {
      const osc = keep(ctx.createOscillator());
      osc.type = h.type;
      osc.detune.value = h.detune;
      const mix = keep(ctx.createGain());
      mix.gain.value = h.mix;
      osc.connect(mix);
      mix.connect(this.lowpass);
      this.wobble.connect(osc.detune);
      this.oscs.push(osc);
      this.sources.push(osc);
    }

    this.noiseBand = keep(ctx.createBiquadFilter());
    this.noiseBand.type = 'bandpass';
    this.noiseBand.frequency.value = 400;
    this.noiseBand.Q.value = 0.9;
    this.noiseGain = keep(ctx.createGain());
    this.noiseGain.gain.value = 0;
    this.loopNoise(1, keep).connect(this.noiseBand);
    this.noiseBand.connect(this.noiseGain);
    this.noiseGain.connect(this.bus);

    const tyreBand = keep(ctx.createBiquadFilter());
    tyreBand.type = 'bandpass';
    tyreBand.frequency.value = 900;
    tyreBand.Q.value = 1.5;
    this.tyreGain = keep(ctx.createGain());
    this.tyreGain.gain.value = 0;
    // A different rate from the engine noise so the two loops never line up audibly.
    this.loopNoise(0.93, keep).connect(tyreBand);
    tyreBand.connect(this.tyreGain);
    this.tyreGain.connect(this.bus);

    for (const s of this.sources) s.start();
    this.sfx = new Sfx(ctx, this.bus);
  }

  private loopNoise(rate: number, keep: <T extends AudioNode>(n: T) => T): AudioBufferSourceNode {
    const src = keep(this.ctx.createBufferSource());
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    this.sources.push(src);
    return src;
  }

  update(sound: CarSound, dt: number): void {
    if (this.disposed || !ok(dt) || dt < 0) return;
    const s = finiteSound(sound);
    this.clock += dt;
    const now = this.ctx.currentTime;
    if (this.clock >= this.stallUntil) {
      const p = engineParams(s);
      HARMONICS.forEach((h, i) => this.oscs[i].frequency.setTargetAtTime(p.base * h.mult, now, TAU));
      this.lowpass.frequency.setTargetAtTime(p.cutoff, now, TAU);
      this.noiseBand.frequency.setTargetAtTime(p.noiseFreq, now, TAU);
      const cranking = this.clock < this.crankUntil;
      const gain = cranking ? 0 : p.gain;
      const noise = cranking ? 0 : p.noiseGain;
      this.engineGain.gain.setTargetAtTime(gain, now, TAU);
      this.noiseGain.gain.setTargetAtTime(noise, now, TAU);
      this.wobble.gain.setTargetAtTime(p.wobbleCents, now, 0.3);
      this.lastBase = p.base;
      this.lastGain = gain;
      this.lastNoise = noise;
    }
    this.driftIn -= dt;
    if (this.driftIn <= 0) {
      this.driftIn = 0.25 + Math.random() * 0.3;
      HARMONICS.forEach((h, i) => this.oscs[i].detune.setTargetAtTime(h.detune + (Math.random() - 0.5) * 2 * DRIFT_CENTS, now, 0.4));
    }
    this.tyreGain.gain.setTargetAtTime(tyreGain(s.slip), now, TAU);

    if (s.belt === false && Math.abs(s.speed) > CHIME_MIN_SPEED) {
      if (this.chimeIn <= 0) {
        this.event('chime');
        this.chimeIn += CHIME_EVERY_S;
      }
      this.chimeIn -= dt;
    } else {
      this.chimeIn = 0;
    }

    const key = s.blinker ?? null;
    if (key !== this.blinkKey) {
      this.blinkKey = key;
      if (key) {
        this.blinkPhase = 0;
        this.nextEdge = BLINK_HALF_S;
        this.event('click');
      }
    } else if (key) {
      this.blinkPhase += dt;
      while (this.blinkPhase >= this.nextEdge) {
        this.event('click');
        this.nextEdge += BLINK_HALF_S;
      }
    }
  }

  horn(on: boolean): void {
    if (on && !this.releaseHorn && this.ctx.state === 'running') {
      this.releaseHorn = this.sfx.holdHorn(0.8, 0);
    } else if (!on && this.releaseHorn) {
      this.releaseHorn();
      this.releaseHorn = null;
    }
  }

  event(e: 'start' | 'stall' | 'click' | 'chime'): void {
    if (this.disposed) return;
    if (e === 'stall') return this.stall();
    if (this.ctx.state !== 'running') return;
    if (e === 'start') this.start();
    else if (e === 'click') this.click();
    else this.chime();
  }

  /** `to` is a level from 0 to 1, reached in about `seconds`. */
  fade(to: number, seconds: number): void {
    const now = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(clamp01(to) * BUS_GAIN, now, Math.max(0.01, seconds / 3));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.horn(false);
    this.sfx.dispose();
    for (const s of this.sources) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    for (const t of this.transients) {
      for (const s of t.sources) {
        try { s.stop(); } catch { /* already stopped */ }
        s.disconnect();
      }
      for (const n of t.nodes) n.disconnect();
    }
    this.transients.clear();
    for (const n of this.persistent) n.disconnect();
  }

  private stall(): void {
    const now = this.ctx.currentTime;
    this.stallUntil = this.clock + STALL_S;
    this.crankUntil = -1;
    HARMONICS.forEach((h, i) => {
      const f = this.oscs[i].frequency;
      f.cancelScheduledValues(now);
      f.setValueAtTime(this.lastBase * h.mult, now);
      f.linearRampToValueAtTime(0, now + STALL_S);
    });
    for (const [param, from] of [[this.engineGain.gain, this.lastGain], [this.noiseGain.gain, this.lastNoise]] as const) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(from, now);
      param.linearRampToValueAtTime(0, now + STALL_S);
    }
    this.lastGain = 0;
    this.lastNoise = 0;
  }

  private start(): void {
    const { ctx } = this;
    const t0 = ctx.currentTime;
    this.stallUntil = -1;
    this.crankUntil = this.clock + CRANK_S;
    for (const osc of this.oscs) osc.frequency.cancelScheduledValues(t0);
    this.engineGain.gain.cancelScheduledValues(t0);
    this.noiseGain.gain.cancelScheduledValues(t0);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 350;
    band.Q.value = 1.2;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = WHIRR_AM_HZ;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.35, t0 + 0.05);
    env.gain.setValueAtTime(0.35, t0 + WHIRR_S - 0.15);
    env.gain.linearRampToValueAtTime(0, t0 + WHIRR_S);
    src.connect(band);
    band.connect(am);
    lfo.connect(depth);
    depth.connect(am.gain);
    am.connect(env);
    env.connect(this.bus);
    this.play([src, lfo], [band, am, depth, env], t0, t0 + WHIRR_S);
  }

  private click(): void {
    const { ctx } = this;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = CLICK_HZ;
    band.Q.value = 4;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.25, t0 + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + CLICK_S);
    src.connect(band);
    band.connect(env);
    env.connect(this.bus);
    this.play([src], [band, env], t0, t0 + CLICK_S);
  }

  private chime(): void {
    const { ctx } = this;
    const t0 = ctx.currentTime;
    CHIME_HZ.forEach((hz, i) => {
      const start = t0 + i * CHIME_TONE_S;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(0.18, start + 0.005);
      env.gain.exponentialRampToValueAtTime(0.001, start + CHIME_TONE_S);
      osc.connect(env);
      env.connect(this.bus);
      this.play([osc], [env], start, start + CHIME_TONE_S);
    });
  }

  private play(sources: AudioScheduledSourceNode[], nodes: AudioNode[], start: number, end: number): void {
    const t: Transient = { sources, nodes };
    this.transients.add(t);
    let left = sources.length;
    for (const s of sources) {
      s.onended = () => {
        s.disconnect();
        if (--left > 0) return;
        this.transients.delete(t);
        for (const n of nodes) n.disconnect();
      };
      s.start(start);
      s.stop(end);
    }
  }
}
