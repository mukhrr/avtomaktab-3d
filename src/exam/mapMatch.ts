import type { DistrictData, GraphEdge, Vec2 } from '../shared/district';
import type { LaneNetwork, LaneRef } from '../traffic/lanes';
import { wrapAngle } from '../traffic/turns';
import { junctionPolygon } from '../world/roadGeometry';
import { Grid, pointInPolygon, segmentDistance } from '../world/spatial';

export interface LaneMatch {
  ref: LaneRef | null;
  /** Metres from `edge.from` along the edge centreline. */
  edgeS: number;
  /** Metres right of the road centreline in the travel direction. */
  lateral: number;
  /** Node id while inside a junction polygon. */
  inJunction: string | null;
  onConnector: boolean;
  confidence: number;
  /** Seconds the current edge and dir have been matched without a break. */
  held: number;
}

const RADIUS = 12;
/** Cost of a heading perpendicular to the road, in metres of distance. */
const HEADING_WEIGHT = 6;
/**
 * Where two road surfaces overlap (forks, slip roads) the edge whose lane centres the car follows wins the tie.
 * Kept well under MARGIN so it never forces a switch on its own.
 */
const LANE_WEIGHT = 0.3;
/** Matching against a oneway's direction needs this much more evidence, since a divided road's other carriageway is right beside. */
const AGAINST_ONEWAY = 3;
/** Leaving a junction, an edge that does not touch it must be this much closer to be picked over one that does. */
const FOREIGN_EXIT = 2;
/** How much cheaper a rival must be, and for how long, before it replaces the current edge. */
const MARGIN = 1;
const HOLD = 0.5;
/** The current edge keeps its dir until the heading is this far from travel along it. */
const DIR_KEEP = (115 * Math.PI) / 180;
/** Metres past a lane boundary before the lane index changes. */
const LANE_BAND = 0.3;

interface Seg { edge: GraphEdge; a: Vec2; b: Vec2; base: number }

interface Candidate {
  edge: GraphEdge;
  dir: 1 | -1;
  cost: number;
  d: number;
  seg: Seg;
  t: number;
}

const NO_MATCH: LaneMatch = { ref: null, edgeS: 0, lateral: 0, inJunction: null, onConnector: false, confidence: 0, held: 0 };

export class MapMatcher {
  private readonly grid = new Grid<Seg>();
  private readonly junctions: { id: string; poly: Vec2[] }[] = [];
  private cur: { edgeId: string; dir: 1 | -1; lane: number } | null = null;
  private challenger: { edgeId: string; held: number } | null = null;
  private wasInJunction: string | null = null;
  private heldFor = 0;
  private readonly degree = new Map<string, number>();
  private readonly nodeEdges = new Map<string, Set<string>>();

  constructor(d: DistrictData, _net?: LaneNetwork) {
    const edges = new Map(d.graph.edges.map(e => [e.id, e]));
    for (const edge of d.graph.edges) {
      let base = 0;
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1], b = edge.points[i];
        this.grid.add(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), { edge, a, b, base });
        base += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
    }
    for (const n of d.graph.nodes) {
      this.degree.set(n.id, n.edges.length);
      this.nodeEdges.set(n.id, new Set(n.edges));
      if (n.edges.length < 3) continue;
      this.junctions.push({ id: n.id, poly: junctionPolygon(n, n.edges.map(id => edges.get(id)).filter((e): e is GraphEdge => !!e)) });
    }
  }

  /** `heading` is the way the car faces; a reversing car keeps its lane, and callers gate on the sign of speed. */
  update(position: Vec2, heading: number, dt: number): LaneMatch {
    const inJunction = this.junctions.find(j => pointInPolygon(position[0], position[1], j.poly))?.id ?? null;
    const cands = this.candidates(position, heading, inJunction ? null : this.wasInJunction);
    const best = cands[0];

    if (inJunction && this.cur && cands.some(c => c.edge.id === this.cur!.edgeId)) {
      this.wasInJunction = inJunction;
      const held = cands.find(c => c.edge.id === this.cur!.edgeId)!;
      return this.describe({ ...held, dir: this.cur.dir }, position, inJunction, 1, dt);
    }
    if (!best) {
      this.cur = null;
      this.challenger = null;
      this.heldFor = 0;
      this.wasInJunction = inJunction;
      return { ...NO_MATCH, inJunction, onConnector: inJunction !== null };
    }

    const current = this.cur && cands.find(c => c.edge.id === this.cur!.edgeId);
    let chosen: Candidate = best;
    let rival: Candidate | undefined = cands.find(c => c !== best);
    if (current && !this.wasInJunction) {
      chosen = current;
      rival = cands.find(c => c !== current && c.cost < Infinity);
      const next = cands.find(c => c !== current && c.cost <= current.cost && this.continues(current, c));
      const challenger = cands.find(c => c !== current && c.cost < current.cost - MARGIN);
      if (next) {
        chosen = next;
        this.challenger = null;
      } else if (challenger) {
        const same = this.challenger?.edgeId === challenger.edge.id;
        const held = (same ? this.challenger!.held : 0) + dt;
        this.challenger = { edgeId: challenger.edge.id, held };
        if (held >= HOLD) {
          chosen = challenger;
          this.challenger = null;
        }
      } else this.challenger = null;
    } else this.challenger = null;
    this.wasInJunction = inJunction;
    return this.describe(chosen, position, inJunction, rival ? Math.max(0, 1 - Math.max(0, rival.cost - chosen.cost) / (2 * MARGIN)) : 0, dt);
  }

  /** `next` carries on from the end of `from` through a node with no other road, and the car is past that end. */
  private continues(from: Candidate, next: Candidate): boolean {
    const e = from.edge, n = next.edge;
    const node = from.dir === 1 ? e.to : e.from;
    if (this.degree.get(node) !== 2 || n.id === e.id) return false;
    if (next.dir === 1 ? n.from !== node : n.to !== node) return false;
    const last = from.dir === 1;
    const atEnd = last ? from.seg.b === e.points[e.points.length - 1] && from.t >= 1 : from.seg.a === e.points[0] && from.t <= 0;
    return atEnd;
  }

  /** `leftJunction`: the node the car has just driven out of, whose edges are preferred. */
  private candidates(position: Vec2, heading: number, leftJunction: string | null): Candidate[] {
    const nearest = new Map<string, { seg: Seg; d: number; t: number }>();
    for (const seg of this.grid.query(position[0], position[1], RADIUS)) {
      const r = segmentDistance(position[0], position[1], seg.a, seg.b);
      if (r.d > RADIUS) continue;
      const prev = nearest.get(seg.edge.id);
      if (!prev || r.d < prev.d) nearest.set(seg.edge.id, { seg, ...r });
    }
    const out: Candidate[] = [];
    for (const [, { seg, d, t }] of nearest) {
      const along = Math.atan2(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
      const off = Math.abs(wrapAngle(heading - along));
      let dir: 1 | -1 = off <= Math.PI / 2 ? 1 : -1;
      if (this.cur?.edgeId === seg.edge.id) {
        const kept = Math.abs(wrapAngle(heading - along - (this.cur.dir === 1 ? 0 : Math.PI)));
        if (kept <= DIR_KEEP) dir = this.cur.dir;
      }
      const delta = Math.abs(wrapAngle(heading - along - (dir === 1 ? 0 : Math.PI)));
      const e = seg.edge;
      const half = e.width / 2;
      const laneW = e.width / Math.max(1, e.lanesForward + e.lanesBackward);
      const fromRight = half - segmentSide(position, seg.a, seg.b) * dir;
      const offCentre = Math.abs(fromRight - laneW * (Math.min(Math.max(Math.floor(fromRight / laneW), 0), e.lanesForward + e.lanesBackward - 1) + 0.5));
      const foreign = leftJunction && !this.nodeEdges.get(leftJunction)?.has(e.id) ? FOREIGN_EXIT : 0;
      const against = (dir === 1 ? e.lanesForward : e.lanesBackward) === 0 ? AGAINST_ONEWAY : 0;
      const cost = Math.max(0, d - half) + LANE_WEIGHT * Math.min(offCentre, laneW / 2) + HEADING_WEIGHT * (1 - Math.cos(delta)) + foreign + against;
      out.push({ edge: e, dir, d, seg, t, cost });
    }
    return out.sort((x, y) => x.cost - y.cost || (x.edge.id < y.edge.id ? -1 : 1));
  }

  private describe(c: Candidate, position: Vec2, inJunction: string | null, rivalFactor: number, dt: number): LaneMatch {
    const { edge, dir, seg, t } = c;
    const segLen = Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]) || 1;
    const ux = ((seg.b[0] - seg.a[0]) / segLen) * dir, uz = ((seg.b[1] - seg.a[1]) / segLen) * dir;
    const cx = seg.a[0] + (seg.b[0] - seg.a[0]) * t, cz = seg.a[1] + (seg.b[1] - seg.a[1]) * t;
    const lateral = (position[0] - cx) * -uz + (position[1] - cz) * ux;
    const avail = dir === 1 ? edge.lanesForward : edge.lanesBackward;
    const lanes = Math.max(1, avail);
    const laneW = edge.width / (edge.lanesForward + edge.lanesBackward);
    const u = (edge.width / 2 - lateral) / laneW;
    const sameEdge = this.cur && this.cur.edgeId === edge.id && this.cur.dir === dir;
    this.heldFor = sameEdge ? this.heldFor + dt : 0;
    const band = LANE_BAND / laneW;
    let lane = Math.min(lanes - 1, Math.max(0, Math.floor(u)));
    if (sameEdge && this.cur!.lane < lanes && u >= this.cur!.lane - band && u < this.cur!.lane + 1 + band) lane = this.cur!.lane;
    this.cur = { edgeId: edge.id, dir, lane };
    const ref: LaneRef = { edgeId: edge.id, dir, lane };
    const confidence = Math.max(0, 1 - c.d / RADIUS) * (1 - 0.5 * rivalFactor);
    return {
      ref, edgeS: seg.base + t * segLen, lateral, inJunction, onConnector: inJunction !== null, confidence, held: this.heldFor,
    };
  }
}

/** Signed metres of `p` to the right of the line a to b, looking from a to b. */
function segmentSide(p: Vec2, a: Vec2, b: Vec2): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
  return (p[0] - a[0]) * -uz + (p[1] - a[1]) * ux;
}
