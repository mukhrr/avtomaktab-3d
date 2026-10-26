import type { DistrictData, GraphEdge, Sign } from '../shared/district';
import { CODE } from '../shared/signCatalogue';
import type { LaneRef } from '../traffic/lanes';

const SCHOOL_ZONE_LIMIT = 30;
const SCHOOL_ZONE_LENGTH = 150;
const SETTLEMENT_LIMIT = 60;
const END_OF_LIMIT = '3.25';
/** How close to the end of an edge a sign must stand to govern its junction. */
export const JUNCTION_REACH = 40;
const JUNCTION_CODES = new Set<string>([CODE.stop, CODE.giveWay, CODE.priorityRoad, CODE.noEntry, CODE.noLeftTurn, CODE.noRightTurn, CODE.noUTurn]);

const key = (edgeId: string, dir: number) => `${edgeId}:${dir}`;

const polyLength = (pts: GraphEdge['points']) => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
};

/** Signs by edge and direction, each list in travel order. Positions are metres from `edge.from`. */
export class SignSystem {
  private lists = new Map<string, Sign[]>();
  private edges = new Map<string, GraphEdge>();
  private lengths = new Map<string, number>();

  constructor(d: DistrictData) {
    for (const e of d.graph.edges) this.edges.set(e.id, e);
    for (const s of d.signs) {
      const k = key(s.edgeId, s.dir);
      const list = this.lists.get(k) ?? [];
      list.push(s);
      this.lists.set(k, list);
    }
    for (const list of this.lists.values()) list.sort((a, b) => (a.dir === 1 ? a.at - b.at : b.at - a.at));
  }

  /** Signs from position `s` onward within `range` metres, nearest first. */
  ahead(edgeId: string, dir: 1 | -1, s: number, range: number): Sign[] {
    return (this.lists.get(key(edgeId, dir)) ?? []).filter(g => {
      const d = (g.at - s) * dir;
      return d >= 0 && d <= range;
    });
  }

  /** Junction signs standing near the end of the lane's edge in its travel direction. */
  atJunction(ref: LaneRef): Sign[] {
    const e = this.edges.get(ref.edgeId);
    if (!e) return [];
    const len = this.length(e);
    return (this.lists.get(key(ref.edgeId, ref.dir)) ?? []).filter(g => {
      const left = ref.dir === 1 ? len - g.at : g.at;
      return JUNCTION_CODES.has(g.code) && left <= JUNCTION_REACH;
    });
  }

  /** km/h: the latest of a passed speed limit, end of limit (back to 60) or school zone (30, never a raise), else the edge's own limit. */
  speedLimitAt(edgeId: string, dir: 1 | -1, s: number): number {
    let limit = this.edges.get(edgeId)?.maxspeed ?? 0;
    let signed = false, school: number | null = null;
    for (const g of this.lists.get(key(edgeId, dir)) ?? []) {
      if ((s - g.at) * dir < 0) break;
      if (g.code === CODE.speedLimit && typeof g.value === 'number') {
        limit = g.value;
        signed = true;
        school = null;
      } else if (g.code === END_OF_LIMIT && signed) {
        limit = SETTLEMENT_LIMIT;
        signed = false;
        school = null;
      } else if (g.code === CODE.children) school = g.at;
    }
    return school !== null && (s - school) * dir <= SCHOOL_ZONE_LENGTH ? Math.min(SCHOOL_ZONE_LIMIT, limit) : limit;
  }

  private length(e: GraphEdge): number {
    let l = this.lengths.get(e.id);
    if (l === undefined) this.lengths.set(e.id, l = polyLength(e.points));
    return l;
  }
}
