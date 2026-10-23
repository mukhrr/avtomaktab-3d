import type { Approach, DistrictData, SignalController } from '../shared/district';

export type LightState = 'green' | 'flashingGreen' | 'yellow' | 'red' | 'redYellow';
export type WalkState = 'walk' | 'flashingWalk' | 'dontWalk';

export const GREEN = 18, FLASH = 3, YELLOW = 3, ALL_RED = 2, PED_ONLY_GREEN = 12;

/** Seconds a phase takes; an empty phase is pedestrian-only. */
export function phaseLength(phase: Approach[]): number {
  return phase.length === 0 ? PED_ONLY_GREEN + FLASH + ALL_RED : GREEN + FLASH + YELLOW + ALL_RED;
}

export function cycleLength(phases: Approach[][]): number {
  return phases.reduce((sum, p) => sum + phaseLength(p), 0);
}

interface Ctrl {
  phases: Approach[][];
  starts: number[];
  cycle: number;
  offset: number;
}

interface Stop {
  ctrl: Ctrl;
  phase: number;
  stopAt: number;
}

const key = (edgeId: string, dir: number): string => `${edgeId}:${dir}`;

/** State of a phase at local time `u`, or null once the phase is over. */
function inPhase(phase: Approach[], u: number): LightState | null {
  const green = phase.length === 0 ? PED_ONLY_GREEN : GREEN;
  if (u < green) return 'green';
  if (u < green + FLASH) return 'flashingGreen';
  if (phase.length > 0 && u < green + FLASH + YELLOW) return 'yellow';
  return null;
}

export class SignalSystem {
  time = 0;
  private ctrls = new Map<string, Ctrl>();
  private byEdge = new Map<string, Stop[]>();
  private bySignal = new Map<string, Stop>();
  private crossings = new Map<string, { ctrl: Ctrl; phase: number }>();

  constructor(d: DistrictData) {
    for (const c of d.controllers as SignalController[]) {
      const starts: number[] = [];
      let t = 0;
      for (const p of c.phases) {
        starts.push(t);
        t += phaseLength(p);
      }
      const ctrl: Ctrl = { phases: c.phases, starts, cycle: t, offset: c.offset };
      this.ctrls.set(c.id, ctrl);
      c.phases.forEach((phase, k) => {
        for (const a of phase) {
          const k2 = key(a.edgeId, a.dir);
          const list = this.byEdge.get(k2) ?? [];
          list.push({ ctrl, phase: k, stopAt: a.stopAt });
          this.byEdge.set(k2, list);
        }
      });
    }
    for (const s of d.signals) {
      const ctrl = s.controllerId ? this.ctrls.get(s.controllerId) : undefined;
      if (!ctrl || !s.approach) continue;
      const a = s.approach;
      const phase = ctrl.phases.findIndex(p =>
        p.some(q => q.edgeId === a.edgeId && q.dir === a.dir && q.stopAt === a.stopAt));
      if (phase >= 0) this.bySignal.set(s.id, { ctrl, phase, stopAt: a.stopAt });
    }
    for (const x of d.crossings) {
      const ctrl = x.controllerId ? this.ctrls.get(x.controllerId) : undefined;
      if (ctrl && x.walkPhase !== undefined) this.crossings.set(x.id, { ctrl, phase: x.walkPhase });
    }
  }

  update(dt: number): void {
    this.time += dt;
  }

  private phaseState(ctrl: Ctrl, phase: number): LightState {
    const c = (((this.time + ctrl.offset) % ctrl.cycle) + ctrl.cycle) % ctrl.cycle;
    const u = c - ctrl.starts[phase];
    if (u >= 0 && u < phaseLength(ctrl.phases[phase])) {
      const own = inPhase(ctrl.phases[phase], u);
      if (own) return ctrl.phases[phase].length > 0 ? own : 'red';
    }
    const n = ctrl.phases.length;
    const prev = (phase + n - 1) % n;
    const prevLen = phaseLength(ctrl.phases[prev]);
    const uPrev = (c - ctrl.starts[prev] + ctrl.cycle) % ctrl.cycle;
    return uPrev >= prevLen - ALL_RED && uPrev < prevLen ? 'redYellow' : 'red';
  }

  approachState(edgeId: string, dir: 1 | -1, s: number): { state: LightState; stopAt: number } | null {
    const list = this.byEdge.get(key(edgeId, dir));
    if (!list) return null;
    let best: Stop | null = null;
    for (const st of list) {
      const ahead = dir === 1 ? s < st.stopAt : s > st.stopAt;
      if (!ahead) continue;
      if (!best || Math.abs(st.stopAt - s) < Math.abs(best.stopAt - s)) best = st;
    }
    return best ? { state: this.phaseState(best.ctrl, best.phase), stopAt: best.stopAt } : null;
  }

  headState(signalId: string): LightState | null {
    const st = this.bySignal.get(signalId);
    return st ? this.phaseState(st.ctrl, st.phase) : null;
  }

  walkState(crossingId: string): WalkState | null {
    const x = this.crossings.get(crossingId);
    if (!x) return null;
    const { ctrl, phase } = x;
    const c = (((this.time + ctrl.offset) % ctrl.cycle) + ctrl.cycle) % ctrl.cycle;
    const u = c - ctrl.starts[phase];
    const green = ctrl.phases[phase].length === 0 ? PED_ONLY_GREEN : GREEN;
    if (u < 0 || u >= green + FLASH) return 'dontWalk';
    return u < green ? 'walk' : 'flashingWalk';
  }

  lampOn(state: LightState): boolean {
    return state !== 'flashingGreen' || this.time % 1 < 0.5;
  }
}
