const HORN_S = 0.35;
const ATTACK_S = 0.02;
const RELEASE_S = 0.08;
const HORN_PEAK = 0.35;

/** Synthesised sound effects on a shared master bus, so later car sounds can mix through the same output. */
export class Sfx {
  readonly master: AudioNode;
  private readonly live = new Set<OscillatorNode>();

  constructor(readonly ctx: AudioContext, master?: AudioNode) {
    this.master = master ?? ctx.destination;
  }

  /** Two detuned saws near 400 and 500 Hz through a band-pass. `volume` is 0 to 1, `pan` -1 (left) to 1 (right). */
  horn(volume: number, pan: number): void {
    const { ctx } = this;
    const t0 = ctx.currentTime;
    const end = t0 + HORN_S;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(HORN_PEAK * Math.max(0, Math.min(1, volume)), t0 + ATTACK_S);
    gain.gain.setValueAtTime(HORN_PEAK * Math.max(0, Math.min(1, volume)), end - RELEASE_S);
    gain.gain.linearRampToValueAtTime(0, end);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 450;
    band.Q.value = 0.8;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    band.connect(gain);
    gain.connect(panner);
    panner.connect(this.master);
    let running = 2;
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
          band.disconnect();
          gain.disconnect();
          panner.disconnect();
        }
      };
      osc.start(t0);
      osc.stop(end);
    }
  }

  dispose(): void {
    for (const osc of this.live) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    this.live.clear();
  }
}
