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
}

const RADIUS = 12;
/** Cost of a heading perpendicular to the road, in metres of distance. */
const HEADING_WEIGHT = 6;
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

const NO_MATCH: LaneMatch = { ref: null, edgeS: 0, lateral: 0, inJunction: null, onConnector: false, confidence: 0 };

export class MapMatcher {
  private readonly grid = new Grid<Seg>();
  private readonly junctions: { id: string; poly: Vec2[] }[] = [];
  private cur: { edgeId: string; dir: 1 | -1; lane: number } | null = null;
  private challenger: { edgeId: string; held: number } | null = null;
  private wasInJunction: string | null = null;

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
      if (n.edges.length < 3) continue;
      this.junctions.push({ id: n.id, poly: junctionPolygon(n, n.edges.map(id => edges.get(id)).filter((e): e is GraphEdge => !!e)) });
    }
  }

  /** `heading` is the direction of travel, so a reversing car passes its heading turned half a circle. */
  update(position: Vec2, heading: number, dt: number): LaneMatch {
    const inJunction = this.junctions.find(j => pointInPolygon(position[0], position[1], j.poly))?.id ?? null;
    const cands = this.candidates(position, heading);
    const best = cands[0];

    if (inJunction && this.cur && cands.some(c => c.edge.id === this.cur!.edgeId)) {
      this.wasInJunction = inJunction;
      const held = cands.find(c => c.edge.id === this.cur!.edgeId)!;
      return this.describe({ ...held, dir: this.cur.dir }, position, inJunction, 1);
    }
    if (!best) {
      this.cur = null;
      this.challenger = null;
      this.wasInJunction = inJunction;
      return { ...NO_MATCH, inJunction, onConnector: inJunction !== null };
    }

    const current = this.cur && cands.find(c => c.edge.id === this.cur!.edgeId);
    let chosen: Candidate = best;
    let rival: Candidate | undefined = cands.find(c => c !== best);
    if (current && !this.wasInJunction) {
      chosen = current;
      rival = cands.find(c => c !== current && c.cost < Infinity);
      const challenger = cands.find(c => c !== current && c.cost < current.cost - MARGIN);
      if (challenger) {
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
    return this.describe(chosen, position, inJunction, rival ? Math.max(0, 1 - Math.max(0, rival.cost - chosen.cost) / (2 * MARGIN)) : 0);
  }

  private candidates(position: Vec2, heading: number): Candidate[] {
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
      out.push({ edge: seg.edge, dir, d, seg, t, cost: d + HEADING_WEIGHT * (1 - Math.cos(delta)) });
    }
    return out.sort((x, y) => x.cost - y.cost || (x.edge.id < y.edge.id ? -1 : 1));
  }

  private describe(c: Candidate, position: Vec2, inJunction: string | null, rivalFactor: number): LaneMatch {
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
    const band = LANE_BAND / laneW;
    let lane = Math.min(lanes - 1, Math.max(0, Math.floor(u)));
    if (sameEdge && this.cur!.lane < lanes && u >= this.cur!.lane - band && u < this.cur!.lane + 1 + band) lane = this.cur!.lane;
    this.cur = { edgeId: edge.id, dir, lane };
    const ref: LaneRef = { edgeId: edge.id, dir, lane };
    const confidence = Math.max(0, 1 - c.d / RADIUS) * (1 - 0.5 * rivalFactor);
    return {
      ref, edgeS: seg.base + t * segLen, lateral, inJunction, onConnector: inJunction !== null, confidence,
    };
  }
}
