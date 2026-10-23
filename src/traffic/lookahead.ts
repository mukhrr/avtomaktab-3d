import type { Crossing, Vec2 } from '../shared/district';
import type { SignalSystem } from '../sim/signals';
import { canStopBefore } from './idm';
import type { LaneNetwork, LaneRef } from './lanes';
import { CAR_CLASSES, type Agent, type Conn, type CrossingOccupancy, type PlayerState } from './trafficSim';

export const LOOKAHEAD = 80;
const STOP_LINE_SETBACK = 1;
const CROSSING_SETBACK = 3;
/** Deceleration a driver accepts to give way; closer than that to the line a car is committed to the junction. */
const COMFORT_DECEL = 3.5;
const MOVING = 0.5;
/** Clearance kept around a standing player's box. */
const PLAYER_MARGIN = 0.3;
const SWEEP_STEP = 0.5;

export const laneKey = (r: LaneRef) => `${r.edgeId}|${r.dir}|${r.lane}`;
export const approachKey = (r: LaneRef) => `${r.edgeId}|${r.dir}`;

export interface Obstacle {
  gap: number;
  speed: number;
  /** Unsignalled junction the agent is held at, when that is the nearest obstacle. */
  gate?: string;
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
  /**
   * With `next`, also whether that exit lane has room for a car of `length` to clear the junction. A `committed` car is
   * already inside the junction before this lane, so priority at the next one waits until it reaches the lane end.
   */
  canEnter(node: string, ref: LaneRef, next: LaneRef | null, length: number, committed: boolean): boolean;
  /** Whether the agent must wait at the end of this lane: a stop sign, or a left turn across oncoming traffic. */
  mustHold(a: Agent, ref: LaneRef, committed: boolean): boolean;
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
  const consider = (gap: number, speed: number, gate?: string) => {
    if (gap <= LOOKAHEAD && (!best || gap < best.gap)) best = { gap, speed, gate };
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
    const lane = w.net.path(ref);
    // Not clamped to the piece: a car still short of the lane must see a line that acts at the lane start.
    const front = half - p.base;

    const light = w.signals.approachState(ref.edgeId, ref.dir, w.net.edgeS(ref, front), [lane.startAt, lane.endAt]);
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
      const toCrossing = cx + p.base - half;
      if (toCrossing > 0 && crossings.occupied(c.id)) consider(Math.max(0, toCrossing - CROSSING_SETBACK), 0);
    }

    const node = w.gatedNode(ref);
    const current = p === route[0] && !a.conn;
    const exit = current ? a.next : null;
    const toEnd = p.length + p.base - half;
    const late = current && a.speed > MOVING && (toEnd <= 0 || !canStopBefore(a.speed, toEnd, COMFORT_DECEL));
    if (node && !w.canEnter(node, ref, exit, a.length, !!a.conn || late)) consider(toEnd, 0, node);
    else if (w.mustHold(a, ref, late)) consider(toEnd, 0);
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
      if (hit.lateral >= p.laneWidth / 2 + across) continue;
      // The lane-wide corridor is a margin for a player who may move; one standing still is judged by its real box,
      // or a player angled just beside the path and a car waiting for it hold each other forever.
      if (Math.abs(player.speed) < MOVING && !sweepHitsPlayer(p, a, player, hit.d)) continue;
      consider(hit.d - half - along, Math.max(0, player.speed * Math.cos(rel)));
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

/** Whether the agent's box, slid along the piece through the stretch nearest the player, touches the player's box. */
function sweepHitsPlayer(p: Piece, a: Agent, player: PlayerState, d: number): boolean {
  const reach = a.length / 2 + player.length / 2 + PLAYER_MARGIN;
  const width = CAR_CLASSES[a.carClass].width;
  const u0 = d - reach - p.base, u1 = d + reach - p.base;
  let run = 0;
  for (let i = 1; i < p.points.length && run <= u1; i++) {
    const [ax, az] = p.points[i - 1], [bx, bz] = p.points[i];
    const seg = Math.hypot(bx - ax, bz - az);
    if (seg > 0 && run + seg >= u0) {
      const h = Math.atan2(bx - ax, bz - az);
      for (let u = Math.max(u0, run); u <= Math.min(u1, run + seg); u += SWEEP_STEP) {
        const t = (u - run) / seg;
        if (boxesTouch([ax + (bx - ax) * t, az + (bz - az) * t], h, a.length, width, player)) return true;
      }
    }
    run += seg;
  }
  return false;
}

function boxesTouch(c: Vec2, h: number, length: number, width: number, player: PlayerState): boolean {
  const pl = player.length + 2 * PLAYER_MARGIN, pw = player.width + 2 * PLAYER_MARGIN;
  const dx = player.position[0] - c[0], dz = player.position[1] - c[1];
  const ext = (bh: number, l: number, w: number, ax: number, az: number) =>
    (l / 2) * Math.abs(Math.sin(bh) * ax + Math.cos(bh) * az) + (w / 2) * Math.abs(Math.cos(bh) * ax - Math.sin(bh) * az);
  return [h, h + Math.PI / 2, player.heading, player.heading + Math.PI / 2].every(axis => {
    const ax = Math.sin(axis), az = Math.cos(axis);
    return Math.abs(dx * ax + dz * az) <= ext(h, length, width, ax, az) + ext(player.heading, pl, pw, ax, az);
  });
}
