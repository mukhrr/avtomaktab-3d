/** Metres in the district frame: +x east, +z south. */
export type Vec2 = [number, number];

export interface Road {
  id: string;
  kind: string;
  width: number;
  lanes: number;
  oneway: boolean;
  name: string;
  maxspeed: number;
  points: Vec2[];
}

export type BuildingStyle = 'panel' | 'brick' | 'stucco' | 'public' | 'tower' | 'shed';

/** Footprint is counter-clockwise in x/z with no closing duplicate. */
export interface Building {
  id: string;
  height: number;
  levels: number;
  style: BuildingStyle;
  /** From OSM roof:shape, only for the two shapes the renderer draws. */
  roof?: 'hipped' | 'gabled';
  footprint: Vec2[];
}

export interface Area {
  id: string;
  kind: 'green' | 'water';
  outline: Vec2[];
}

export interface Waterway {
  id: string;
  width: number;
  points: Vec2[];
}

/** A car travelling `dir` along `edgeId` (1 toward `edge.to`) must stop before `stopAt` metres from `edge.from`. */
export interface Approach {
  edgeId: string;
  dir: 1 | -1;
  stopAt: number;
}

export interface SignalController {
  id: string;
  phases: Approach[][];
  /** Seconds into the cycle at t = 0. */
  offset: number;
}

export interface Signal {
  id: string;
  position: Vec2;
  controllerId?: string;
  approach?: Approach;
}

export interface GraphNode {
  id: string;
  position: Vec2;
  edges: string[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  roadId: string;
  points: Vec2[];
  /** OSM node ids, same length and order as `points`. */
  nodeIds: string[];
  lanesForward: number;
  lanesBackward: number;
  width: number;
  maxspeed: number;
  name: string;
}

export type CrossingKind = 'signal' | 'zebra' | 'unmarked';

export interface Crossing {
  id: string;
  position: Vec2;
  kind: CrossingKind;
  edgeId: string;
  /** Metres along the edge from `edge.from`. */
  at: number;
  width: number;
  controllerId?: string;
  walkPhase?: number;
}

/** Stands beside the lane travelling `dir` on `edgeId`, `at` metres from `edge.from`, facing that traffic. */
export interface Sign {
  id: string;
  /** Uzbek catalogue number, e.g. '2.5'. */
  code: string;
  edgeId: string;
  dir: 1 | -1;
  at: number;
  /** Required when the catalogue entry has a valueKind; km/h for a speed limit. A string for time ('8-19') and text kinds, a number otherwise. */
  value?: number | string;
  /** Group 7 plates under the sign, top to bottom. */
  plates?: { code: string; value?: number | string }[];
  /** Side of the road the pole stands on, relative to travel. Defaults to right. */
  side?: 'right' | 'left';
  origin: 'hand' | 'rule' | 'coverage';
}

export type FurnitureKind = 'busStop' | 'bench' | 'bin';

/** `heading` is the way the item faces, as atan2(dx, dz): toward the nearest road. */
export interface Furniture {
  id: string;
  kind: FurnitureKind;
  x: number;
  z: number;
  heading: number;
}

export type LandmarkKind = 'amirTemur' | 'fountain' | 'hotelUzbekistan' | 'kuranty' | 'forumsPalace' | 'timuridMuseum';

/** `heading` is atan2(dx, dz) toward the square centre; fountains are round and keep 0. */
export interface Landmark {
  id: string;
  kind: LandmarkKind;
  x: number;
  z: number;
  heading: number;
  buildingId?: string;
  footprint?: Vec2[];
  radius?: number;
  /** A point the model is built around instead of x/z, such as the Kuranty clock node. */
  anchor?: Vec2;
}

export interface DistrictData {
  name: string;
  origin: { lat: number; lon: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  roads: Road[];
  buildings: Building[];
  areas: Area[];
  waterways: Waterway[];
  signals: Signal[];
  crossings: Crossing[];
  controllers: SignalController[];
  signs: Sign[];
  furniture: Furniture[];
  landmarks: Landmark[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

export interface DistrictConfig {
  name: string;
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
  origin: { lat: number; lon: number };
}
