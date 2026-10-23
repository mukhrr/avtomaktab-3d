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

function subtitle(lang: Lang, p: Prompt): string {
  if (p.key !== 'exam.violation') return t(lang, p.key, p.vars);
  return `${t(lang, `penalty.${p.vars?.id}`, p.vars)}. ${t(lang, p.key, p.vars)}`;
}

export class HtmlAudioBackend implements AudioBackend {
  private el: HTMLAudioElement | null = null;
  private abort: (() => void) | null = null;

  play(url: string): Promise<void> {
    this.stop();
    return new Promise<void>((resolve, reject) => {
      const el = new Audio(url);
      this.el = el;
      this.abort = resolve;
      el.onended = () => resolve();
      el.onerror = () => reject(new Error(`audio: cannot load ${url}`));
      el.play().catch(reject);
    });
  }

  stop(): void {
    this.el?.pause();
    this.el = null;
    this.abort?.();
    this.abort = null;
  }
}

export class VoicePlayer {
  onSubtitle?: (text: string) => void;
  private queue: Prompt[] = [];
  private busy = false;
  private epoch = 0;

  constructor(
    private readonly lang: Lang,
    private readonly baseUrl: string,
    private readonly backend: AudioBackend = new HtmlAudioBackend(),
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

  private async pump(): Promise<void> {
    const epoch = this.epoch;
    this.busy = true;
    while (epoch === this.epoch) {
      const p = this.queue.shift();
      if (!p) break;
      if (this.stale(p)) continue;
      this.onSubtitle?.(subtitle(this.lang, p));
      const id = spokenLineId(p);
      if (!id) continue;
      try {
        await this.backend.play(`${this.baseUrl}/${this.lang}/${id}.mp3`);
      } catch {
        // blocked before the first gesture or file missing: the subtitle already went out
      }
    }
    if (epoch === this.epoch) this.busy = false;
  }
}
