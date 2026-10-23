export const STEP = 1 / 60;
const MAX_STEPS = 5;

/** Fixed-timestep bookkeeping; a backlog beyond maxSteps is dropped so a long pause never fast-forwards. */
export function fixedSteps(accumulator: number, dt: number, step = STEP, maxSteps = MAX_STEPS): { steps: number; accumulator: number } {
  const total = accumulator + dt;
  const steps = Math.floor(total / step + 1e-9);
  if (steps > maxSteps) return { steps: maxSteps, accumulator: 0 };
  return { steps, accumulator: Math.max(0, total - steps * step) };
}
