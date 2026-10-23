import type { Area, Building, CrossingKind, Road, Signal, Vec2, Waterway } from '../../src/shared/district';
import type { OsmData, OsmWay } from './osm';

export interface Overrides {
  removeWays: string[];
  roads: Record<string, Partial<Pick<Road, 'width' | 'lanes' | 'oneway' | 'maxspeed' | 'name'>>>;
  buildingHeights: Record<string, number>;
}

export interface ExtractResult {
  roads: Road[];
  buildings: Building[];
  areas: Area[];
  waterways: Waterway[];
  signals: Signal[];
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
const LEVEL_HEIGHT = 3.2;
const SLOW_KINDS = new Set(['living_street', 'service']);
const GREEN_LEISURE = new Set(['park', 'garden']);
const GREEN_LANDUSE = new Set(['grass', 'forest', 'recreation_ground']);
const WATERWAY_WIDTH: Record<string, number> = { canal: 9, river: 9, stream: 3 };

export const FOOT_KINDS = new Set(['footway', 'path', 'cycleway', 'pedestrian']);

function crossingKind(tag: string | undefined): CrossingKind {
  if (tag?.includes('traffic_signals')) return 'signal';
  if (tag === 'zebra' || tag === 'marked' || tag === 'uncontrolled') return 'zebra';
  return 'unmarked';
}

const leadingNumber = (v: string | undefined) => {
  const m = v?.match(/^\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : undefined;
};

function hash(s: string): number {
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

export function extractFeatures(
  osm: OsmData,
  project: (lat: number, lon: number) => Vec2,
  overrides: Overrides,
): ExtractResult {
  const removed = new Set(overrides.removeWays);
  const result: ExtractResult = { roads: [], buildings: [], areas: [], waterways: [], signals: [], roadNodeIds: new Map(), crossingNodes: [] };

  for (const n of osm.nodes.values()) {
    if (n.tags.highway === 'traffic_signals') result.signals.push({ id: n.id, position: project(n.lat, n.lon) });
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
        maxspeed: o.maxspeed ?? leadingNumber(t.maxspeed) ?? (SLOW_KINDS.has(kind) ? 20 : 60),
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
      result.buildings.push({ id: w.id, height, footprint });
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
