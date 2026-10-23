import type { Approach } from '../shared/district';

export const GREEN = 18, FLASH = 3, YELLOW = 3, ALL_RED = 2, PED_ONLY_GREEN = 12;

/** Seconds a phase takes; an empty phase is pedestrian-only. */
export function phaseLength(phase: Approach[]): number {
  return phase.length === 0 ? PED_ONLY_GREEN + FLASH + ALL_RED : GREEN + FLASH + YELLOW + ALL_RED;
}

export function cycleLength(phases: Approach[][]): number {
  return phases.reduce((sum, p) => sum + phaseLength(p), 0);
}
