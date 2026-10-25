const HORN_S = 0.35;
const ATTACK_S = 0.02;
const RELEASE_S = 0.08;
const HORN_PEAK = 0.35;

/** Synthesised sound effects on a shared master bus, so later car sounds can mix through the same output. */
export class Sfx {
  /** Every sound goes through this gain, so a volume setting or later car sounds can share the bus. */
  readonly master: GainNode;
  private readonly live = new Set<OscillatorNode>();
  private readonly chains = new Set<AudioNode[]>();
  private readonly ownsMaster: boolean;

  /** With `master` given, sounds go into it and the caller owns its routing and teardown. */
  constructor(readonly ctx: AudioContext, master?: GainNode) {
    this.ownsMaster = !master;
    this.master = master ?? ctx.createGain();
    if (this.ownsMaster) this.master.connect(ctx.destination);
  }

  /** Two detuned saws near 400 and 500 Hz through a band-pass. `volume` is 0 to 1, `pan` -1 (left) to 1 (right). */
  horn(volume: number, pan: number): void {
    const voice = this.voice(volume, pan);
    if (!voice) return;
    voice.release(this.ctx.currentTime + HORN_S - RELEASE_S);
  }

  /** The horn voice held until the returned release is called. */
  holdHorn(volume: number, pan: number): () => void {
    const voice = this.voice(volume, pan);
    if (!voice) return () => {};
    let released = false;
    return () => {
      if (released) return;
      released = true;
      voice.release(Math.max(this.ctx.currentTime, voice.attackEnd));
    };
  }

  private voice(volume: number, pan: number): { attackEnd: number; release: (at: number) => void } | null {
    const { ctx } = this;
    if (ctx.state !== 'running') return null;
    const t0 = ctx.currentTime;
    const peak = HORN_PEAK * Math.max(0, Math.min(1, volume));
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + ATTACK_S);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 450;
    band.Q.value = 0.8;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    band.connect(gain);
    gain.connect(panner);
    panner.connect(this.master);
    const chain: AudioNode[] = [band, gain, panner];
    this.chains.add(chain);
    let running = 2;
    const oscs: OscillatorNode[] = [];
    for (const [freq, detune] of [[400, -6], [500, 6]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(band);
      this.live.add(osc);
      osc.onended = () => {
        this.live.delete(osc);
        osc.disconnect();
        if (--running === 0) {
          this.chains.delete(chain);
          for (const n of chain) n.disconnect();
        }
      };
      osc.start(t0);
      oscs.push(osc);
    }
    return {
      attackEnd: t0 + ATTACK_S,
      release: at => {
        gain.gain.setValueAtTime(peak, at);
        gain.gain.linearRampToValueAtTime(0, at + RELEASE_S);
        for (const osc of oscs) osc.stop(at + RELEASE_S);
      },
    };
  }

  dispose(): void {
    for (const osc of this.live) {
      try { osc.stop(); } catch { /* already stopped */ }
      osc.disconnect();
    }
    for (const chain of this.chains) for (const n of chain) n.disconnect();
    this.live.clear();
    this.chains.clear();
    if (this.ownsMaster) this.master.disconnect();
  }
}
