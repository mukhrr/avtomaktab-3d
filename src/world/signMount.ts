import type { GraphEdge, Sign } from '../shared/district';
import { entry, loadCatalogue } from '../shared/signCatalogue';
import { pointAlong } from './roadGeometry';

const CURB_GAP = 1;
const SPOT_SPAN = 1;
const FACE_GAP = 0.05;
const LOWEST_EDGE = 2.2;
const GROUP_ORDER = [2, 1, 3, 4, 5, 6, 7];

export interface Pole { x: number; z: number; height: number }
/** `pole` indexes the poles returned beside the faces. */
export interface MountedFaceAt { sign: Sign; plateIndex: number | null; y: number; pole: number }

/** Where a sign's pole stands and which way its face points (toward oncoming traffic). */
export function signPose(edge: GraphEdge, s: Sign): { x: number; z: number; heading: number } {
  const pose = pointAlong(edge.points, s.at);
  const travel = s.dir === 1 ? pose.heading : pose.heading + Math.PI;
  const dx = Math.sin(travel), dz = Math.cos(travel), off = (s.side === 'left' ? -1 : 1) * (edge.width / 2 + CURB_GAP);
  return { x: pose.x - dz * off, z: pose.z + dx * off, heading: travel + Math.PI };
}

/** Signs that share one pole: same edge, direction and side, within 1 m of the spot's first sign. */
export function signSpots(signs: Sign[]): { edgeId: string; dir: 1 | -1; side: 'right' | 'left'; at: number; signs: Sign[] }[] {
  const byCurb = new Map<string, Sign[]>();
  for (const s of signs) {
    const key = `${s.edgeId}|${s.dir}|${s.side ?? 'right'}`;
    byCurb.set(key, [...(byCurb.get(key) ?? []), s]);
  }
  const spots: ReturnType<typeof signSpots> = [];
  for (const curb of byCurb.values()) {
    let spot: (typeof spots)[number] | null = null;
    for (const s of [...curb].sort((a, b) => a.at - b.at)) {
      if (spot && s.at - spot.at <= SPOT_SPAN) spot.signs.push(s);
      else spots.push((spot = { edgeId: s.edgeId, dir: s.dir, side: s.side ?? 'right', at: s.at, signs: [s] }));
    }
  }
  return spots;
}

const rank = (code: string): number => {
  const e = entry(code);
  return GROUP_ORDER.indexOf(e.group) * 10000 + loadCatalogue().indexOf(e);
};

/** One pole per spot; on it, top to bottom by group (2, 1, 3, 4, 5, 6), each sign with its plates under it. */
export function mountSigns(signs: Sign[], edges: Map<string, GraphEdge>): { poles: Pole[]; faces: MountedFaceAt[] } {
  const poles: Pole[] = [], faces: MountedFaceAt[] = [];
  for (const spot of signSpots(signs.filter(s => edges.has(s.edgeId)))) {
    const stack = [...spot.signs].sort((a, b) => rank(a.code) - rank(b.code)).flatMap(sign => [
      { sign, plateIndex: null, h: entry(sign.code).size[1] },
      ...(sign.plates ?? []).map((p, i) => ({ sign, plateIndex: i, h: entry(p.code).size[1] })),
    ]);
    let bottom = LOWEST_EDGE;
    const placed = stack.reverse().map(f => {
      const y = bottom + f.h / 2;
      bottom += f.h + FACE_GAP;
      return { sign: f.sign, plateIndex: f.plateIndex, y, pole: poles.length };
    });
    faces.push(...placed.reverse());
    const pose = signPose(edges.get(spot.edgeId)!, spot.signs[0]);
    poles.push({ x: pose.x, z: pose.z, height: bottom - FACE_GAP });
  }
  return { poles, faces };
}
