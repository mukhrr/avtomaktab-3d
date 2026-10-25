import type { Area, Building, BuildingStyle, CrossingKind, FurnitureKind, LandmarkKind, Poi, PoiKind, Road, Signal, Vec2, Waterway } from '../../src/shared/district';
import type { OsmData, OsmWay } from './osm';
import { classifyBuilding, LEVEL_HEIGHT, levelsFor, minAreaRect } from './styles';

export interface Overrides {
  removeWays: string[];
  roads: Record<string, Partial<Pick<Road, 'width' | 'lanes' | 'oneway' | 'maxspeed' | 'name'>>>;
  buildingHeights: Record<string, number>;
  buildingStyles: Record<string, BuildingStyle>;
  landmarks?: Record<string, LandmarkKind>;
}

export type SignalDirection = 'forward' | 'backward' | 'both';

export interface RawFurniture { id: string; kind: FurnitureKind; position: Vec2 }

export interface ExtractResult {
  roads: Road[];
  buildings: Building[];
  areas: Area[];
  waterways: Waterway[];
  signals: (Signal & { direction?: SignalDirection })[];
  /** Bus stop, bench and bin nodes at their OSM positions; build.ts snaps them to the street. */
  furniture: RawFurniture[];
  pois: Poi[];
  /** OSM node ids per road, in order, for the graph builder. */
  roadNodeIds: Map<string, string[]>;
  /** Crossing nodes that lie on car roads. */
  crossingNodes: { id: string; kind: CrossingKind }[];
}

const DEFAULT_WIDTH: Record<string, number> = {
  motorway: 14, trunk: 14, primary: 12, secondary: 10, tertiary: 8,
  residential: 6, unclassified: 6, living_street: 5, service: 4,
  pedestrian: 4, footway: 2, cycleway: 2, path: 1.5,
};
const LINK_WIDTH = 6;
const LANE_WIDTH = 3.5;
const SLOW_KINDS = new Set(['living_street', 'service']);
/** Clause 78: 20 km/h in a residential zone, whatever the map says. */
const RESIDENTIAL_ZONE_LIMIT = 20;
const GREEN_LEISURE = new Set(['park', 'garden']);
const GREEN_LANDUSE = new Set(['grass', 'forest', 'recreation_ground']);
const WATERWAY_WIDTH: Record<string, number> = { canal: 9, river: 9, stream: 3 };

const POI_AMENITIES = new Set<string>(['school', 'kindergarten', 'parking', 'hospital', 'fuel']);

export const FOOT_KINDS = new Set(['footway', 'path', 'cycleway', 'pedestrian']);

const FURNITURE_TAGS: [string, string, FurnitureKind][] = [
  ['highway', 'bus_stop', 'busStop'], ['amenity', 'bench', 'bench'], ['amenity', 'waste_basket', 'bin'],
];

function crossingKind(tag: string | undefined): CrossingKind {
  if (tag?.includes('traffic_signals')) return 'signal';
  if (tag === 'zebra' || tag === 'marked' || tag === 'uncontrolled') return 'zebra';
  return 'unmarked';
}

const leadingNumber = (v: string | undefined) => {
  const m = v?.match(/^\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
};

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function signedArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

function roadWidth(kind: string): number | undefined {
  return DEFAULT_WIDTH[kind] ?? (kind.endsWith('_link') ? LINK_WIDTH : undefined);
}

/** Drops a closing duplicate and consecutive duplicates; returns a counter-clockwise ring or null if degenerate. */
function ring(pts: Vec2[]): Vec2[] | null {
  const out = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (out.length > 1 && out[0][0] === out.at(-1)![0] && out[0][1] === out.at(-1)![1]) out.pop();
  if (out.length < 3) return null;
  const a = signedArea(out);
  if (Math.abs(a) < 4) return null;
  return a > 0 ? out : out.reverse();
}

function centroid(poly: Vec2[]): Vec2 {
  const a = signedArea(poly);
  let cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
    const f = x0 * z1 - x1 * z0;
    cx += (x0 + x1) * f;
    cz += (z0 + z1) * f;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

export function extractFeatures(
  osm: OsmData,
  project: (lat: number, lon: number) => Vec2,
  overrides: Overrides,
): ExtractResult {
  const removed = new Set(overrides.removeWays);
  const result: ExtractResult = { roads: [], buildings: [], areas: [], waterways: [], signals: [], furniture: [], pois: [], roadNodeIds: new Map(), crossingNodes: [] };

  for (const n of osm.nodes.values()) {
    const furniture = FURNITURE_TAGS.find(([k, v]) => n.tags[k] === v);
    if (furniture) result.furniture.push({ id: n.id, kind: furniture[2], position: project(n.lat, n.lon) });
    if (POI_AMENITIES.has(n.tags.amenity)) result.pois.push({ id: n.id, kind: n.tags.amenity as PoiKind, position: project(n.lat, n.lon) });
    if (n.tags.highway !== 'traffic_signals') continue;
    const dir = n.tags['traffic_signals:direction'];
    result.signals.push({
      id: n.id,
      position: project(n.lat, n.lon),
      ...(dir === 'forward' || dir === 'backward' || dir === 'both' ? { direction: dir } : {}),
    });
  }

  const resolve = (w: OsmWay): Vec2[] | null => {
    const pts: Vec2[] = [];
    for (const id of w.nodeIds) {
      const n = osm.nodes.get(id);
      if (!n) return null;
      pts.push(project(n.lat, n.lon));
    }
    return pts.length >= 2 ? pts : null;
  };

  for (const w of osm.ways) {
    if (removed.has(w.id)) continue;
    const t = w.tags;
    const pts = resolve(w);
    if (!pts) continue;

    if (POI_AMENITIES.has(t.amenity)) {
      const outline = ring(pts);
      if (outline) result.pois.push({ id: w.id, kind: t.amenity as PoiKind, position: centroid(outline) });
    }

    const kind = t.highway;
    const baseWidth = kind ? roadWidth(kind) : undefined;
    if (kind && baseWidth !== undefined) {
      const o = overrides.roads[w.id] ?? {};
      const taggedLanes = t.lanes && /^\d+$/.test(t.lanes) ? Number(t.lanes) : undefined;
      const lanesIn = o.lanes ?? taggedLanes;
      const width = o.width ?? (lanesIn ? Math.max(baseWidth, lanesIn * LANE_WIDTH) : baseWidth);
      result.roads.push({
        id: w.id,
        kind,
        width,
        lanes: lanesIn ?? Math.max(1, Math.round(width / LANE_WIDTH)),
        oneway: o.oneway ?? ['yes', 'true', '1'].includes(t.oneway ?? ''),
        name: o.name ?? t['name:uz'] ?? t.name ?? '',
        maxspeed: Math.min(o.maxspeed ?? leadingNumber(t.maxspeed) ?? (SLOW_KINDS.has(kind) ? 20 : 60), kind === 'living_street' ? RESIDENTIAL_ZONE_LIMIT : Infinity),
        points: pts,
      });
      result.roadNodeIds.set(w.id, w.nodeIds);
      continue;
    }

    if (t.building) {
      const footprint = ring(pts);
      if (!footprint) continue;
      const tagged = leadingNumber(t.height) ?? (leadingNumber(t['building:levels']) ?? NaN) * LEVEL_HEIGHT;
      const height = overrides.buildingHeights[w.id] ?? (Number.isFinite(tagged) ? tagged : 8 + (hash(w.id) % 5) * LEVEL_HEIGHT);
      const { longSide, shortSide } = minAreaRect(footprint);
      const style = overrides.buildingStyles[w.id] ?? classifyBuilding({
        tags: t, height, footprintArea: Math.abs(signedArea(footprint)), longSide, shortSide,
      });
      const roof = t['roof:shape'] === 'hipped' || t['roof:shape'] === 'gabled' ? t['roof:shape'] : undefined;
      result.buildings.push({ id: w.id, height, levels: levelsFor(height), style, ...(roof ? { roof } : {}), footprint });
      continue;
    }

    const green = GREEN_LEISURE.has(t.leisure) || GREEN_LANDUSE.has(t.landuse) || t.natural === 'wood';
    if (green || t.natural === 'water') {
      const outline = ring(pts);
      if (outline) result.areas.push({ id: w.id, kind: green ? 'green' : 'water', outline });
      continue;
    }

    const ww = WATERWAY_WIDTH[t.waterway];
    if (ww) result.waterways.push({ id: w.id, width: ww, points: pts });
  }

  const onCarRoad = new Set<string>();
  for (const r of result.roads) {
    if (FOOT_KINDS.has(r.kind)) continue;
    for (const id of result.roadNodeIds.get(r.id) ?? []) onCarRoad.add(id);
  }
  for (const n of osm.nodes.values()) {
    if (n.tags.highway === 'crossing' && onCarRoad.has(n.id)) {
      result.crossingNodes.push({ id: n.id, kind: crossingKind(n.tags.crossing) });
    }
  }
  return result;
}
