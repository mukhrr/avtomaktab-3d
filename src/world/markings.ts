import type { Road, Vec2 } from '../shared/district';
import type { GraphEdge } from '../shared/district';

const DASH = 3;
const GAP = 6;
const SOLID_CENTRE_MIN_WIDTH = 10;
const NO_MARKING_KINDS = new Set(['service', 'living_street']);

export interface MarkingLine { points: Vec2[]; dashed: boolean }

/** Polyline shifted sideways; positive offset is to the right of travel direction. */
function offsetLine(points: Vec2[], off: number): Vec2[] {
  return points.map((p, i) => {
    const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, points.length - 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    return [p[0] - dz * off, p[1] + dx * off];
  });
}

/** Splits a polyline into dash pieces. */
export function dashes(points: Vec2[]): Vec2[][] {
  const out: Vec2[][] = [];
  let phase = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const len = Math.hypot(bx - ax, bz - az);
    let s = 0;
    while (s < len) {
      const inDash = phase < DASH;
      const step = Math.min(len - s, inDash ? DASH - phase : DASH + GAP - phase);
      if (inDash && step > 0.05) {
        const t0 = s / len, t1 = (s + step) / len;
        out.push([[ax + (bx - ax) * t0, az + (bz - az) * t0], [ax + (bx - ax) * t1, az + (bz - az) * t1]]);
      }
      s += step;
      phase = (phase + step) % (DASH + GAP);
    }
  }
  return out;
}

/** Centre and lane-divider lines for one trimmed edge. */
export function edgeMarkings(edge: GraphEdge, road: Road | undefined, points: Vec2[]): MarkingLine[] {
  if (!road || NO_MARKING_KINDS.has(road.kind) || edge.width < 5 || points.length < 2) return [];
  const lanes = edge.lanesForward + edge.lanesBackward;
  const lw = edge.width / lanes;
  const at = (k: number) => -edge.width / 2 + k * lw;
  const lines: MarkingLine[] = [];
  if (edge.lanesBackward > 0) {
    lines.push({ points: offsetLine(points, at(edge.lanesBackward)), dashed: edge.width <= SOLID_CENTRE_MIN_WIDTH });
    for (let k = 1; k < edge.lanesBackward; k++) lines.push({ points: offsetLine(points, at(k)), dashed: true });
  }
  for (let k = 1; k < edge.lanesForward; k++) lines.push({ points: offsetLine(points, at(edge.lanesBackward + k)), dashed: true });
  return lines;
}
