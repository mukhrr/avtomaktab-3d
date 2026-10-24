import type { ExamResult } from '../exam/examiner';
import type { Tier } from '../exam/penalties';
import type { Maneuver } from '../exam/route';
import type { Lang } from '../i18n';
import type { Vec2 } from '../shared/district';
import type { Gearbox } from '../vehicle/drivetrain';

export type Screen = 'menu' | 'drive' | 'debrief';

export interface ExamHudState {
  lang: Lang;
  maneuver: Maneuver | null;
  distance: number;
  total: number;
}

/** `seq` changes on every new toast or subtitle, so the same text twice still restarts its timer. */
export interface Toast { seq: number; id: string; vars: Record<string, string | number>; points: number; tier: Tier }
export interface Subtitle { seq: number; text: string }

export interface DebriefData {
  lang: Lang;
  result: ExamResult;
  startT: number;
  routeLine: Vec2[];
  penalties: Record<string, { tier: Tier; points: number }>;
}

export interface HudState {
  speedKmh: number;
  gear: string;
  rpm: number;
  running: boolean;
  gearbox: Gearbox;
  street: string;
  fps: number;
  drawCalls: number;
  mainCalls: number;
  mainTris: number;
  cpuP50: number;
  cpuP95: number;
  gpuP50: number | null;
  gpuP95: number | null;
  activeCars?: number;
  activePeds?: number;
  controllers?: number;
  simMs?: number;
  indicator: 'left' | 'right' | null;
  hazard: boolean;
  belt: boolean;
  glance: 'left' | 'rear' | 'right' | null;
  screen: Screen;
  exam: ExamHudState | null;
  toast: Toast | null;
  subtitle: Subtitle | null;
  debrief: DebriefData | null;
}

export interface HudStore {
  set(p: Partial<HudState>): void;
  subscribe(fn: () => void): () => void;
  get(): HudState;
}

export const gearLabel = (gearbox: Gearbox, gear: number): string =>
  gear === -1 ? 'R' : gear === 0 ? 'N' : gearbox === 'auto' ? `D${gear}` : String(gear);

export function createHudStore(): HudStore {
  let state: HudState = { speedKmh: 0, gear: 'N', rpm: 0, running: true, gearbox: 'auto', street: '', fps: 0, drawCalls: 0, mainCalls: 0, mainTris: 0, cpuP50: 0, cpuP95: 0, gpuP50: null, gpuP95: null, indicator: null, hazard: false, belt: false, glance: null, screen: 'menu', exam: null, toast: null, subtitle: null, debrief: null };
  const listeners = new Set<() => void>();
  return {
    set(p) {
      state = { ...state, ...p };
      listeners.forEach(fn => fn());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get: () => state,
  };
}
