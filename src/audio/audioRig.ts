import { CarAudio, type CarSound } from './carAudio';
import { Sfx } from './sfx';
import { setVoiceVolume } from './voice';

export interface AudioSettings { sound: boolean; volume: number }

const FADE_S = 0.3;
const MAX_DT = 0.1;
const DEFAULT_VOLUME = 0.7;

/** One AudioContext's worth of game audio: the shared master, the car sounds and the settings that drive them. */
export class AudioRig {
  readonly sfx: Sfx;
  readonly car: CarAudio;
  private wasRunning: boolean | null = null;

  /** `onVoice` gets false when the examiner's HTML audio must be muted, which the Web Audio master cannot do. */
  constructor(readonly ctx: AudioContext, settings: AudioSettings, private readonly onVoice?: (audible: boolean) => void) {
    this.sfx = new Sfx(ctx);
    this.car = new CarAudio(ctx, this.sfx.master);
    this.sfx.master.gain.value = this.level(settings);
    this.onVoice?.(settings.sound);
    setVoiceVolume(this.level({ sound: true, volume: settings.volume }));
    this.car.fade(0, 0.01);
  }

  apply(settings: AudioSettings): void {
    this.sfx.master.gain.setTargetAtTime(this.level(settings), this.ctx.currentTime, 0.02);
    this.onVoice?.(settings.sound);
    setVoiceVolume(this.level({ sound: true, volume: settings.volume }));
  }

  /** Entering the drive: fade in, and the next frame only records the engine state so a reset never plays a starter. */
  enter(): void {
    this.wasRunning = null;
    this.car.fade(1, FADE_S);
  }

  leave(): void {
    this.car.horn(false);
    this.car.fade(0, FADE_S);
  }

  frame(s: CarSound, dt: number, horn: boolean): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this.wasRunning !== null && s.running !== this.wasRunning) this.car.event(s.running ? 'start' : 'stall');
    this.wasRunning = s.running;
    this.car.update(s, Math.min(dt, MAX_DT));
    this.car.horn(horn);
  }

  visibility(hidden: boolean): void {
    const { ctx } = this;
    if (hidden && ctx.state === 'running') void ctx.suspend();
    else if (!hidden && ctx.state !== 'running') void ctx.resume();
  }

  private level({ sound, volume }: AudioSettings): number {
    if (!sound) return 0;
    return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : DEFAULT_VOLUME;
  }
}
