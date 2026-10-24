import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { PENALTY_IDS, validatePenalties } from '../exam/penalties';
import penaltyTable from '../../data/exam/penalties.json';
import lines from '../../data/exam/voice-lines.json';
import { HtmlAudioBackend, VoicePlayer, spokenLineId, type AudioBackend } from './voice';

class FakeBackend implements AudioBackend {
  played: string[] = [];
  active = 0;
  maxActive = 0;
  stops = 0;
  missing = new Set<string>();
  private resolvers: Array<() => void> = [];

  play(url: string): Promise<void> {
    this.played.push(url);
    if (this.missing.has(url)) return Promise.reject(new Error('404'));
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    return new Promise<void>(res => this.resolvers.push(() => { this.active--; res(); }));
  }
  stop(): void {
    this.stops++;
    this.finish();
  }
  finish(): void {
    this.resolvers.shift()?.();
  }
}

const tick = () => new Promise(r => setTimeout(r, 0));
const setup = (lang: 'uz' | 'ru' = 'uz') => {
  const backend = new FakeBackend();
  const player = new VoicePlayer(lang, '/audio', backend);
  const subs: string[] = [];
  player.onSubtitle = s => subs.push(s);
  return { backend, player, subs };
};

describe('VoicePlayer', () => {
  it('plays queued lines in order, one at a time', async () => {
    const { backend, player, subs } = setup();
    player.say({ key: 'exam.brief' });
    player.say({ key: 'exam.start' });
    player.say({ key: 'exam.reroute' });
    await tick();
    expect(backend.played).toEqual(['/audio/uz/exam.brief.mp3']);
    backend.finish();
    await tick();
    backend.finish();
    await tick();
    expect(backend.played).toEqual(['/audio/uz/exam.brief.mp3', '/audio/uz/exam.start.mp3', '/audio/uz/exam.reroute.mp3']);
    expect(backend.maxActive).toBe(1);
    expect(subs).toEqual([t('uz', 'exam.brief'), t('uz', 'exam.start'), t('uz', 'exam.reroute')]);
  });

  it('drops an ahead prompt whose now prompt for the same junction is queued', async () => {
    const { backend, player, subs } = setup('ru');
    player.say({ key: 'exam.start' });
    player.say({ key: 'exam.turnLeftAhead', vars: { junction: 3 } });
    player.say({ key: 'exam.turnLeftNow', vars: { junction: 3 } });
    await tick();
    backend.finish();
    await tick();
    backend.finish();
    await tick();
    expect(backend.played).toEqual(['/audio/ru/exam.start.mp3', '/audio/ru/exam.turnLeftNow.mp3']);
    expect(subs).not.toContain(t('ru', 'exam.turnLeftAhead'));
  });

  it('keeps an ahead prompt when the queued now prompt is for another junction', async () => {
    const { backend, player } = setup();
    player.say({ key: 'exam.start' });
    player.say({ key: 'exam.turnLeftAhead', vars: { junction: 3 } });
    player.say({ key: 'exam.turnRightNow', vars: { junction: 4 } });
    await tick();
    backend.finish();
    await tick();
    backend.finish();
    await tick();
    expect(backend.played).toContain('/audio/uz/exam.turnLeftAhead.mp3');
  });

  it('falls back to subtitle only when the file is missing, and carries on', async () => {
    const { backend, player, subs } = setup();
    backend.missing.add('/audio/uz/exam.brief.mp3');
    expect(() => {
      player.say({ key: 'exam.brief' });
      player.say({ key: 'exam.start' });
    }).not.toThrow();
    await tick();
    await tick();
    expect(subs).toEqual([t('uz', 'exam.brief'), t('uz', 'exam.start')]);
    expect(backend.played).toEqual(['/audio/uz/exam.brief.mp3', '/audio/uz/exam.start.mp3']);
  });

  it('plays the ahead of the next junction while the previous now is still queued', async () => {
    const { backend, player } = setup();
    player.say({ key: 'exam.start' });
    player.say({ key: 'exam.turnLeftNow', vars: { junction: 1 } });
    player.say({ key: 'exam.turnRightAhead', vars: { junction: 2 } });
    await tick();
    for (let i = 0; i < 3; i++) {
      backend.finish();
      await tick();
    }
    expect(backend.played).toEqual(['/audio/uz/exam.start.mp3', '/audio/uz/exam.turnLeftNow.mp3', '/audio/uz/exam.turnRightAhead.mp3']);
  });

  it('keeps going when the subtitle callback throws', async () => {
    const { backend, player } = setup();
    player.onSubtitle = () => { throw new Error('ui gone'); };
    player.say({ key: 'exam.brief' });
    player.say({ key: 'exam.start' });
    await tick();
    backend.finish();
    await tick();
    expect(backend.played).toEqual(['/audio/uz/exam.brief.mp3', '/audio/uz/exam.start.mp3']);
  });

  it('moves on when a clip never ends', async () => {
    const backend = new FakeBackend();
    const player = new VoicePlayer('uz', '/audio', backend, 20);
    player.say({ key: 'exam.brief' });
    player.say({ key: 'exam.start' });
    await new Promise(r => setTimeout(r, 60));
    expect(backend.played).toEqual(['/audio/uz/exam.brief.mp3', '/audio/uz/exam.start.mp3']);
  });

  it('treats a throwing backend as subtitle only', async () => {
    const subs: string[] = [];
    const player = new VoicePlayer('uz', '/audio', { play: () => { throw new Error('blocked'); }, stop: () => {} });
    player.onSubtitle = s => subs.push(s);
    expect(() => player.say({ key: 'exam.brief' })).not.toThrow();
    await tick();
    expect(subs).toEqual([t('uz', 'exam.brief')]);
  });

  it('speaks a spoken violation by penalty name and subtitles name plus points', async () => {
    const { backend, player, subs } = setup();
    player.say({ key: 'exam.violation', vars: { id: 'noIndicator', points: 20, tier: 'high', spoken: 1 } });
    await tick();
    expect(backend.played).toEqual(['/audio/uz/penalty.noIndicator.mp3']);
    expect(subs[0]).toContain(t('uz', 'penalty.noIndicator'));
    expect(subs[0]).toContain('20');
  });

  it('shows an unspoken violation as subtitle only', async () => {
    const { backend, player, subs } = setup();
    player.say({ key: 'exam.violation', vars: { id: 'harshBraking', points: 5, tier: 'low', spoken: 0 } });
    await tick();
    expect(backend.played).toEqual([]);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toContain(t('uz', 'penalty.harshBraking'));
  });

  it('stop clears the queue and silences the current line', async () => {
    const { backend, player } = setup();
    player.say({ key: 'exam.brief' });
    player.say({ key: 'exam.start' });
    await tick();
    player.stop();
    await tick();
    expect(backend.stops).toBe(1);
    expect(backend.played).toEqual(['/audio/uz/exam.brief.mp3']);
  });
});

const EXAM_KEYS = [
  'exam.brief', 'exam.start', 'exam.turnLeftAhead', 'exam.turnLeftNow', 'exam.turnRightAhead', 'exam.turnRightNow',
  'exam.straight', 'exam.uturn', 'exam.reroute', 'exam.finishAhead', 'exam.stopHere', 'exam.passed', 'exam.failed',
];

describe('voice lines', () => {
  const table = validatePenalties(penaltyTable);
  const spokenPenalties = PENALTY_IDS.filter(id => table[id].tier !== 'low').map(id => `penalty.${id}`);
  const book = lines as Record<string, { uz: string; ru: string }>;

  it('has a plain uz and ru text for every spoken key', () => {
    for (const key of [...EXAM_KEYS, ...spokenPenalties]) {
      for (const lang of ['uz', 'ru'] as const) {
        const text = book[key]?.[lang];
        expect(text, `${key} ${lang}`).toBeTruthy();
        expect(text).not.toMatch(/[{}]/);
      }
    }
  });

  it('spoken text comes from the i18n strings', () => {
    for (const key of [...EXAM_KEYS, ...spokenPenalties]) {
      for (const lang of ['uz', 'ru'] as const) {
        expect(t(lang, key, { speed: 0 }).startsWith(book[key][lang].replace(/[.:]$/, ''))).toBe(true);
      }
    }
  });

  it('maps every spoken violation to a line that exists', () => {
    for (const id of PENALTY_IDS) {
      const spoken = table[id].tier !== 'low';
      const lineId = spokenLineId({ key: 'exam.violation', vars: { id, points: table[id].points, tier: table[id].tier, spoken: spoken ? 1 : 0 } });
      expect(lineId !== null).toBe(spoken);
      if (lineId) expect(book[lineId]).toBeDefined();
    }
  });
});

describe('HtmlAudioBackend', () => {
  class StubAudio {
    static last: StubAudio;
    duration = NaN;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onloadedmetadata: (() => void) | null = null;
    paused = false;
    constructor(public src: string) { StubAudio.last = this; }
    play() { return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('gives up on a clip that never fires ended and releases the element', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Audio', StubAudio);
    let done = false;
    const p = new HtmlAudioBackend().play('/x.mp3').then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(7900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(done).toBe(true);
    expect(StubAudio.last.onended).toBeNull();
    expect(StubAudio.last.paused).toBe(true);
  });

  it('allows a long clip its duration plus a second', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Audio', StubAudio);
    let done = false;
    const p = new HtmlAudioBackend().play('/x.mp3').then(() => { done = true; });
    StubAudio.last.duration = 12;
    StubAudio.last.onloadedmetadata?.();
    await vi.advanceTimersByTimeAsync(12500);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(800);
    await p;
    expect(done).toBe(true);
  });
});
