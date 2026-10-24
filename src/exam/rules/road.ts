import type { DistrictData, Sign } from '../../shared/district';
import type { SignSystem } from '../../sim/signs';
import type { LaneNetwork, LaneRef } from '../../traffic/lanes';
import { approachRank } from '../../traffic/trafficSim';
import { turnBetween, type Turn } from '../../traffic/turns';
import { NO_ENTRY_REACH } from './thresholds';

type Approach = Pick<LaneRef, 'edgeId' | 'dir'>;

/** Static road facts the snapshot does not carry: lane counts, junction signs, turn geometry. */
export class RoadInfo {
  private readonly edges: Map<string, DistrictData['graph']['edges'][number]>;
  private readonly lengths = new Map<string, number>();

  constructor(d: DistrictData, private readonly net: LaneNetwork, private readonly signs: SignSystem) {
    this.edges = new Map(d.graph.edges.map(e => [e.id, e]));
  }

  lanes({ edgeId, dir }: Approach): number {
    const e = this.edges.get(edgeId);
    return e ? (dir === 1 ? e.lanesForward : e.lanesBackward) : 0;
  }

  /** A noEntry sign stands within NO_ENTRY_REACH of where traffic travelling `dir` enters the edge. */
  noEntry({ edgeId, dir }: Approach): boolean {
    if (!this.edges.has(edgeId)) return false;
    const start = dir === 1 ? 0 : this.length(edgeId);
    return this.signs.ahead(edgeId, dir, start, NO_ENTRY_REACH).some(g => g.type === 'noEntry');
  }

  twoWay({ edgeId }: Approach): boolean {
    const e = this.edges.get(edgeId);
    return !!e && e.lanesForward > 0 && e.lanesBackward > 0;
  }

  /** Lateral of the line between the two directions, metres right of the edge centreline for traffic going `dir`. */
  divider(r: Approach): number {
    const e = this.edges.get(r.edgeId);
    if (!e) return 0;
    return e.width / 2 - (this.lanes(r) * e.width) / (e.lanesForward + e.lanesBackward);
  }

  /** Junction priority of the approach, ranked as TrafficSim ranks it. */
  rank(ref: LaneRef): number {
    return approachRank(this.signs.atJunction(ref));
  }

  junctionSigns(ref: LaneRef): Sign[] {
    return this.signs.atJunction(ref);
  }

  /** Edge distance where the approach lane ends at its junction, the line AI stops at. */
  laneEnd(ref: LaneRef): number {
    return this.net.path(ref).endAt;
  }

  turn(from: LaneRef, to: LaneRef): Turn {
    return turnBetween(this.net, from, to);
  }

  private length(edgeId: string): number {
    let l = this.lengths.get(edgeId);
    if (l === undefined) {
      const pts = this.edges.get(edgeId)!.points;
      l = 0;
      for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      this.lengths.set(edgeId, l);
    }
    return l;
  }
}
