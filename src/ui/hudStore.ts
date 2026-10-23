import type { Gearbox } from '../vehicle/drivetrain';

export interface HudState {
  speedKmh: number;
  gear: string;
  rpm: number;
  running: boolean;
  gearbox: Gearbox;
  street: string;
  fps: number;
  drawCalls: number;
}

export interface HudStore {
  set(p: Partial<HudState>): void;
  subscribe(fn: () => void): () => void;
  get(): HudState;
}

export const gearLabel = (gearbox: Gearbox, gear: number): string =>
  gear === -1 ? 'R' : gear === 0 ? 'N' : gearbox === 'auto' ? `D${gear}` : String(gear);

export function createHudStore(): HudStore {
  let state: HudState = { speedKmh: 0, gear: 'N', rpm: 0, running: true, gearbox: 'auto', street: '', fps: 0, drawCalls: 0 };
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
