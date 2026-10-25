import type { DistrictData, GraphEdge, Sign } from '../shared/district';
import { CODE } from '../shared/signCatalogue';
import type { LaneRef } from '../traffic/lanes';

const SCHOOL_ZONE_LIMIT = 30;
const SCHOOL_ZONE_LENGTH = 150;
/** How close to the end of an edge a sign must stand to govern its junction. */
const JUNCTION_REACH = 40;
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

  /** km/h: the latest speed limit sign passed, else a school zone, else the edge's own limit. */
  speedLimitAt(edgeId: string, dir: 1 | -1, s: number): number {
    const passed = (this.lists.get(key(edgeId, dir)) ?? []).filter(g => (s - g.at) * dir >= 0);
    const limit = passed.filter(g => g.code === CODE.speedLimit).at(-1);
    if (limit?.value !== undefined) return limit.value;
    if (passed.some(g => g.code === CODE.children && (s - g.at) * dir <= SCHOOL_ZONE_LENGTH)) return SCHOOL_ZONE_LIMIT;
    return this.edges.get(edgeId)?.maxspeed ?? 0;
  }

  private length(e: GraphEdge): number {
    let l = this.lengths.get(e.id);
    if (l === undefined) this.lengths.set(e.id, l = polyLength(e.points));
    return l;
  }
}
