import type { Building, Landmark, LandmarkKind, Vec2 } from '../../src/shared/district';
import type { OsmData } from './osm';

const PLINTH_RADIUS = 6;
/** Landmark id to the OSM node its model is built around: the Kuranty clock stands at the west end, not the centroid. */
export const LANDMARK_ANCHORS: Record<string, string> = { '83581462': '565346454' };
const round = (v: number, n: number) => Math.round(v * 10 ** n) / 10 ** n;

function areaCentroid(pts: Vec2[]): { c: Vec2; area: number } {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    const cross = x0 * z1 - x1 * z0;
    a += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  return a === 0 ? { c: pts[0], area: 0 } : { c: [cx / (3 * a), cz / (3 * a)], area: Math.abs(a / 2) };
}

/** Resolves the override ids against the raw OSM, so a landmark that vanished from the data fails the build. */
export function extractLandmarks(
  osm: OsmData,
  project: (lat: number, lon: number) => Vec2,
  kinds: Record<string, LandmarkKind>,
  buildings: Building[],
  anchors: Record<string, string> = LANDMARK_ANCHORS,
): Landmark[] {
  const toCentre = (x: number, z: number, kind: LandmarkKind) => (kind === 'fountain' ? 0 : round(Math.atan2(-x, -z), 3));
  const out: Landmark[] = [];
  for (const [id, kind] of Object.entries(kinds)) {
    const n = osm.nodes.get(id);
    const way = n ? undefined : osm.ways.find(w => w.id === id);
    if (n) {
      const [x, z] = project(n.lat, n.lon);
      out.push({ id, kind, x: round(x, 2), z: round(z, 2), heading: toCentre(x, z, kind), radius: PLINTH_RADIUS });
      continue;
    }
    if (!way) throw new Error(`landmark ${id} (${kind}) is not in the OSM data`);
    const pts: Vec2[] = way.nodeIds.map(nid => {
      const p = osm.nodes.get(nid);
      if (!p) throw new Error(`landmark ${id} (${kind}) uses missing node ${nid}`);
      return project(p.lat, p.lon);
    });
    if (kind === 'fountain') {
      const { c, area } = areaCentroid(pts.length > 1 && pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1] ? pts.slice(0, -1) : pts);
      out.push({ id, kind, x: round(c[0], 2), z: round(c[1], 2), heading: 0, radius: round(Math.sqrt(area / Math.PI), 2) });
      continue;
    }
    const b = buildings.find(bb => bb.id === id);
    if (!b) throw new Error(`landmark ${id} (${kind}) is not an extracted building`);
    const { c } = areaCentroid(b.footprint);
    const landmark: Landmark = { id, kind, x: round(c[0], 2), z: round(c[1], 2), heading: toCentre(c[0], c[1], kind), buildingId: b.id, footprint: b.footprint };
    const anchorId = anchors[id];
    if (anchorId) {
      const a = osm.nodes.get(anchorId);
      if (!a) throw new Error(`landmark ${id} (${kind}) anchor node ${anchorId} is not in the OSM data`);
      const [ax, az] = project(a.lat, a.lon);
      landmark.anchor = [round(ax, 2), round(az, 2)];
    }
    out.push(landmark);
  }
  return out;
}
