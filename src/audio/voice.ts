import { t, type Lang } from '../i18n';
import type { Prompt } from '../exam/directions';

export interface AudioBackend {
  /** Resolves when the clip ends, rejects when it is missing or cannot play. */
  play(url: string): Promise<void>;
  stop(): void;
}

const AHEAD_KEYS = new Set(['exam.turnLeftAhead', 'exam.turnRightAhead', 'exam.straight', 'exam.uturn', 'exam.finishAhead']);
const NOW_KEYS = new Set(['exam.turnLeftNow', 'exam.turnRightNow', 'exam.stopHere']);

/** The clip id for a prompt, or null when it is shown but not spoken. */
export function spokenLineId(p: Prompt): string | null {
  if (p.key !== 'exam.violation') return p.key;
  return p.vars?.spoken === 1 ? `penalty.${p.vars.id}` : null;
}

export function subtitle(lang: Lang, p: Prompt): string {
  if (p.key !== 'exam.violation') return t(lang, p.key, p.vars);
  return `${t(lang, `penalty.${p.vars?.id}`, p.vars)}. ${t(lang, p.key, p.vars)}`;
}

let voiceMuted = false;
let voiceVolume = 1;
let playing: HTMLAudioElement | null = null;

/** The examiner's clips are HTML audio outside the Web Audio graph, so the sound setting has to reach them here. */
export function setVoiceMuted(muted: boolean): void {
  voiceMuted = muted;
  if (playing) playing.muted = muted;
}

export function setVoiceVolume(volume: number): void {
  voiceVolume = Math.max(0, Math.min(1, volume));
  if (playing) playing.volume = voiceVolume;
}

const MIN_CLIP_WAIT_MS = 8000;
const CLIP_SLACK_MS = 1000;

export class HtmlAudioBackend implements AudioBackend {
  private release: (() => void) | null = null;

  play(url: string): Promise<void> {
    this.stop();
    return new Promise<void>((resolve, reject) => {
      const el = new Audio(url);
      el.muted = voiceMuted;
      el.volume = voiceVolume;
      playing = el;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const release = () => {
        clearTimeout(timer);
        el.onended = el.onerror = el.onloadedmetadata = null;
        el.pause();
        if (playing === el) playing = null;
        if (this.release === release) this.release = null;
      };
      const arm = () => {
        clearTimeout(timer);
        const known = Number.isFinite(el.duration) ? el.duration * 1000 + CLIP_SLACK_MS : 0;
        timer = setTimeout(() => { release(); resolve(); }, Math.max(known, MIN_CLIP_WAIT_MS));
      };
      this.release = () => { release(); resolve(); };
      el.onended = () => { release(); resolve(); };
      el.onerror = () => { release(); reject(new Error(`audio: cannot load ${url}`)); };
      el.onloadedmetadata = arm;
      arm();
      el.play().catch(e => { release(); reject(e); });
    });
  }

  stop(): void {
    this.release?.();
  }
}

export class VoicePlayer {
  onSubtitle?: (text: string) => void;
  private queue: Prompt[] = [];
  private busy = false;
  private epoch = 0;
  private subtitleFailed = false;

  constructor(
    private readonly lang: Lang,
    private readonly baseUrl: string,
    private readonly backend: AudioBackend = new HtmlAudioBackend(),
    /** Backstop for a backend that never settles. */
    private readonly maxClipMs = 60000,
  ) {}

  say(prompt: Prompt): void {
    this.queue.push(prompt);
    if (!this.busy) void this.pump();
  }

  stop(): void {
    this.epoch++;
    this.queue = [];
    this.busy = false;
    try {
      this.backend.stop();
    } catch {
      // nothing is playing that we could still silence
    }
  }

  private stale(p: Prompt): boolean {
    const j = p.vars?.junction;
    return AHEAD_KEYS.has(p.key) && j !== undefined && this.queue.some(q => NOW_KEYS.has(q.key) && q.vars?.junction === j);
  }

  private emit(text: string): void {
    try {
      this.onSubtitle?.(text);
    } catch (e) {
      if (!this.subtitleFailed) console.warn('voice: subtitle callback threw', e);
      this.subtitleFailed = true;
    }
  }

  private playWithBackstop(url: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout>;
    const backstop = new Promise<void>(res => { timer = setTimeout(() => { try { this.backend.stop(); } catch { /* already gone */ } res(); }, this.maxClipMs); });
    return Promise.race([this.backend.play(url), backstop]).finally(() => clearTimeout(timer));
  }

  private async pump(): Promise<void> {
    const epoch = this.epoch;
    this.busy = true;
    while (epoch === this.epoch) {
      const p = this.queue.shift();
      if (!p) break;
      if (this.stale(p)) continue;
      this.emit(subtitle(this.lang, p));
      const id = spokenLineId(p);
      if (!id) continue;
      try {
        await this.playWithBackstop(`${this.baseUrl}/${this.lang}/${id}.mp3`);
      } catch {
        // blocked before the first gesture or file missing: the subtitle already went out
      }
    }
    if (epoch === this.epoch) this.busy = false;
  }
}
