import type { Crossing, Vec2 } from '../shared/district';
import type { SignalSystem } from '../sim/signals';
import { canStopBefore } from './idm';
import type { LaneNetwork, LaneRef } from './lanes';
import type { Agent, Conn, CrossingOccupancy, PlayerState } from './trafficSim';

export const LOOKAHEAD = 80;
const STOP_LINE_SETBACK = 1;
const CROSSING_SETBACK = 3;

export const laneKey = (r: LaneRef) => `${r.edgeId}|${r.dir}|${r.lane}`;
export const approachKey = (r: LaneRef) => `${r.edgeId}|${r.dir}`;

export interface Obstacle {
  gap: number;
  speed: number;
}

export interface LookaheadWorld {
  net: LaneNetwork;
  signals: SignalSystem;
  laneWidth(edgeId: string): number;
  crossingsOn(edgeId: string): readonly Crossing[];
  /** Agents on lane paths keyed by laneKey, and on connectors keyed by Conn.key, sorted by s. */
  onPiece(key: string): readonly Agent[] | undefined;
  /** Agents on any connector leaving the lane `laneKey`, sorted by s. */
  leaving(laneKey: string): readonly Agent[] | undefined;
  /** Unsignalled junction at the end of this lane, or null. */
  gatedNode(ref: LaneRef): string | null;
  canEnter(node: string, approach: string): boolean;
}

interface Piece {
  points: Vec2[];
  length: number;
  /** Distance from the agent's centre to the start of this piece. */
  base: number;
  ref: LaneRef | null;
  laneWidth: number;
  leaders: readonly Agent[] | undefined;
}

function pieces(a: Agent, w: LookaheadWorld): Piece[] {
  const out: Piece[] = [];
  const path = (ref: LaneRef, base: number): Piece => {
    const p = w.net.path(ref);
    return { points: p.points, length: p.length, base, ref, laneWidth: w.laneWidth(ref.edgeId), leaders: w.onPiece(laneKey(ref)) };
  };
  const conn = (c: Conn, base: number, leaders: readonly Agent[] | undefined): Piece =>
    ({ points: c.points, length: c.length, base, ref: null, laneWidth: w.laneWidth(c.from.edgeId), leaders });

  if (a.conn) {
    out.push(conn(a.conn, -a.s, w.onPiece(a.conn.key)));
    out.push(path(a.conn.to, a.conn.length - a.s));
  } else {
    const first = path(a.ref, -a.s);
    out.push(first);
    const rest = first.length - a.s;
    const leaving = w.leaving(laneKey(a.ref));
    if (a.nextConn && a.next) {
      out.push(conn(a.nextConn, rest, leaving));
      out.push(path(a.next, rest + a.nextConn.length));
    } else if (leaving) {
      out.push({ points: [], length: 0, base: rest, ref: null, laneWidth: 0, leaders: leaving });
    }
  }
  return out.filter(p => p.base <= LOOKAHEAD);
}

/** Nearest thing the agent must not drive into, as a bumper-to-bumper gap and its speed along the lane. */
export function nearestObstacle(a: Agent, w: LookaheadWorld, player: PlayerState, crossings: CrossingOccupancy): Obstacle | null {
  let best: Obstacle | null = null;
  const consider = (gap: number, speed: number) => {
    if (gap <= LOOKAHEAD && (!best || gap < best.gap)) best = { gap, speed };
  };
  const half = a.length / 2;
  const route = pieces(a, w);

  for (const p of route) {
    if (p.leaders) {
      for (const b of p.leaders) {
        const d = b.s + p.base;
        if (b === a || d < 0 || (d === 0 && b.id < a.id)) continue;
        consider(d - half - b.length / 2, b.speed);
        break;
      }
    }
    if (!p.ref) continue;
    const ref = p.ref;
    const frontX = Math.max(0, half - p.base);

    const light = w.signals.approachState(ref.edgeId, ref.dir, w.net.edgeS(ref, frontX));
    if (light) {
      const toLine = w.net.pathS(ref, light.stopAt) + p.base - half;
      if (toLine > 0) {
        const s = light.state;
        const stop = s === 'red' || s === 'redYellow' || (s === 'yellow' && canStopBefore(a.speed, toLine));
        if (stop) consider(toLine - STOP_LINE_SETBACK, 0);
      }
    }

    for (const c of w.crossingsOn(ref.edgeId)) {
      const cx = w.net.pathS(ref, c.at);
      if (cx < 0 || cx > p.length) continue;
      const gap = cx - CROSSING_SETBACK + p.base - half;
      if (gap > 0 && crossings.occupied(c.id)) consider(gap, 0);
    }

    const node = w.gatedNode(ref);
    if (node && !w.canEnter(node, approachKey(ref))) consider(p.length + p.base - half, 0);
  }

  const reach = LOOKAHEAD + player.length;
  if (Math.abs(player.position[0] - a.position[0]) < reach && Math.abs(player.position[1] - a.position[1]) < reach) {
    for (const p of route) {
      const hit = projectPlayer(p, player, p === route[0] ? a.s : 0);
      if (!hit || hit.d <= 0) continue;
      const rel = player.heading - hit.heading;
      const c = Math.abs(Math.cos(rel)), s = Math.abs(Math.sin(rel));
      const along = (player.length * c + player.width * s) / 2;
      const across = (player.length * s + player.width * c) / 2;
      if (hit.lateral < p.laneWidth / 2 + across) {
        consider(hit.d - half - along, Math.max(0, player.speed * Math.cos(rel)));
      }
    }
  }
  return best;
}

/** Closest point of the piece to the player at or beyond `minX`, as distance ahead of the agent's centre. */
function projectPlayer(p: Piece, player: PlayerState, minX: number): { d: number; lateral: number; heading: number } | null {
  const [px, pz] = player.position;
  let best: { d: number; lateral: number; heading: number } | null = null;
  let x = 0;
  for (let i = 1; i < p.points.length; i++) {
    const [ax, az] = p.points[i - 1], [bx, bz] = p.points[i];
    const dx = bx - ax, dz = bz - az;
    const seg = Math.hypot(dx, dz);
    if (seg === 0 || x + seg < minX) {
      x += seg;
      continue;
    }
    const t0 = Math.max(0, (minX - x) / seg);
    const t = Math.min(1, Math.max(t0, ((px - ax) * dx + (pz - az) * dz) / (seg * seg)));
    const lateral = Math.hypot(ax + dx * t - px, az + dz * t - pz);
    if (!best || lateral < best.lateral) best = { d: x + seg * t + p.base, lateral, heading: Math.atan2(dx, dz) };
    x += seg;
  }
  return best;
}
