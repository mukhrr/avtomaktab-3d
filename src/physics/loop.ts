import type { Controls } from '../vehicle/drivetrain';

export const STEP = 1 / 60;
const MAX_STEPS = 5;

/** Fixed-timestep bookkeeping; a backlog beyond maxSteps is dropped so a long pause never fast-forwards. */
export function fixedSteps(accumulator: number, dt: number, step = STEP, maxSteps = MAX_STEPS): { steps: number; accumulator: number } {
  const total = accumulator + dt;
  const steps = Math.floor(total / step + 1e-9);
  if (steps > maxSteps) return { steps: maxSteps, accumulator: 0 };
  return { steps, accumulator: Math.max(0, total - steps * step) };
}

export type Edges = Pick<Controls, 'shiftUp' | 'shiftDown' | 'ignition' | 'toggleLeft' | 'toggleRight' | 'toggleHazard' | 'toggleBelt'>;
export const NO_EDGES: Edges = { shiftUp: false, shiftDown: false, ignition: false, toggleLeft: false, toggleRight: false, toggleHazard: false, toggleBelt: false };

/**
 * One frame's controls spread over its physics substeps: one-shot presses (gear, ignition, indicators, hazard, belt) reach only the
 * first substep, and a press in a frame with no substeps (high refresh rates) waits for the next one.
 */
export function splitControls(c: Controls, pending: Edges, steps: number): { perStep: Controls[]; pending: Edges } {
  const edges: Edges = {
    shiftUp: c.shiftUp || pending.shiftUp,
    shiftDown: c.shiftDown || pending.shiftDown,
    ignition: c.ignition || pending.ignition,
    toggleLeft: c.toggleLeft || pending.toggleLeft,
    toggleRight: c.toggleRight || pending.toggleRight,
    toggleHazard: c.toggleHazard || pending.toggleHazard,
    toggleBelt: c.toggleBelt || pending.toggleBelt,
  };
  if (steps === 0) return { perStep: [], pending: edges };
  const perStep = Array.from({ length: steps }, (_, i) => ({ ...c, ...(i === 0 ? edges : NO_EDGES) }));
  return { perStep, pending: NO_EDGES };
}
