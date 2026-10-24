import type { LaneMatch } from '../exam/mapMatch';
import type { LightState } from '../sim/signals';
import type { Vec2 } from '../shared/district';
import { wrapAngle } from './turns';
import { CAR_CLASSES, type AgentView } from './trafficSim';

export interface HornState {
  /** Seconds the player's approach light has been green. */
  greenFor: number;
  playerSpeed: number;
  /** The car is the first one queued directly behind the player. */
  playerAhead: boolean;
  /** This car already honked during the current stop. */
  honked: boolean;
  distance: number;
}

const MIN_GREEN_S = 2;
const MAX_GREEN_S = 6;
const STOPPED_BELOW = 2;
const QUEUE_RANGE = 25;
const LANE_HALF_WIDTH = 1.8;
const SAME_WAY = Math.PI / 3;
const LIGHT_RANGE = 40;

export function hornDecision(s: HornState): boolean {
  return s.playerAhead && !s.honked && s.greenFor >= MIN_GREEN_S && s.greenFor <= MAX_GREEN_S && Math.abs(s.playerSpeed) < STOPPED_BELOW;
}

export const hornVolume = (distance: number): number => 1 / (1 + Math.max(0, distance) / 10);

export interface Listener {
  position: Vec2;
  heading: number;
}

/** -1 (left) to 1 (right) for a source seen from a listener facing `heading` (0 faces +z, whose right is -x). */
export function hornPan(l: Listener, source: Vec2): number {
  const dx = source[0] - l.position[0], dz = source[1] - l.position[1];
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 0;
  return (-dx * Math.cos(l.heading) + dz * Math.sin(l.heading)) / d;
}

export interface HornEvent {
  agentId: number;
  volume: number;
  pan: number;
}

export interface HornDeps {
  matcher: { update(position: Vec2, heading: number, dt: number): LaneMatch };
  signals: { time: number; approachState(edgeId: string, dir: 1 | -1, s: number, within?: [number, number]): { state: LightState; stopAt: number } | null };
  net: { path(ref: NonNullable<LaneMatch['ref']>): { startAt: number; endAt: number } };
}

interface PlayerPose {
  position: Vec2;
  heading: number;
  speed: number;
  length: number;
}

const isGreen = (s: LightState) => s === 'green' || s === 'flashingGreen';

/** Decides, from public traffic and signal state only, when the first AI car behind a stopped player honks. */
export class HornMonitor {
  private greenSince: number | null = null;
  private readonly honked = new Set<number>();

  constructor(private readonly deps: HornDeps) {}

  update(dt: number, player: PlayerPose, agents: readonly AgentView[], signals: HornDeps['signals'], listener: Listener): HornEvent[] {
    const light = this.lightAhead(dt, player);
    if (!light || !isGreen(light)) {
      this.greenSince = null;
      this.honked.clear();
      return [];
    }
    this.greenSince ??= signals.time;
    if (Math.abs(player.speed) >= STOPPED_BELOW) {
      this.honked.clear();
      return [];
    }
    const first = this.firstBehind(player, agents);
    if (!first) return [];
    const { agent, gap } = first;
    const fire = hornDecision({
      greenFor: signals.time - this.greenSince, playerSpeed: player.speed, playerAhead: true,
      honked: this.honked.has(agent.id), distance: gap,
    });
    if (!fire) return [];
    this.honked.add(agent.id);
    return [{ agentId: agent.id, volume: hornVolume(gap), pan: hornPan(listener, agent.position) }];
  }

  private lightAhead(dt: number, player: PlayerPose): LightState | null {
    const m = this.deps.matcher.update(player.position, player.heading, dt);
    if (!m.ref || m.inJunction) return null;
    const lane = this.deps.net.path(m.ref);
    const l = this.deps.signals.approachState(m.ref.edgeId, m.ref.dir, m.edgeS, [lane.startAt, lane.endAt]);
    if (!l || (l.stopAt - m.edgeS) * m.ref.dir > LIGHT_RANGE) return null;
    return l.state;
  }

  private firstBehind(player: PlayerPose, agents: readonly AgentView[]): { agent: AgentView; gap: number } | null {
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    let best: { agent: AgentView; gap: number } | null = null;
    for (const a of agents) {
      if (!a.active) continue;
      const dx = a.position[0] - player.position[0], dz = a.position[1] - player.position[1];
      const behind = -(dx * fx + dz * fz), across = dx * fz - dz * fx;
      if (behind <= 0 || behind > QUEUE_RANGE || Math.abs(across) > LANE_HALF_WIDTH) continue;
      if (Math.abs(wrapAngle(a.heading - player.heading)) > SAME_WAY) continue;
      const gap = Math.max(0, behind - player.length / 2 - CAR_CLASSES[a.carClass].length / 2);
      if (!best || gap < best.gap) best = { agent: a, gap };
    }
    return best;
  }
}
