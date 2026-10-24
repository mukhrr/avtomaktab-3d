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

/** Footprint is counter-clockwise in x/z with no closing duplicate. */
export type BuildingStyle = 'panel' | 'brick' | 'stucco' | 'public' | 'tower' | 'shed';

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

export type SignType =
  | 'stop' | 'giveWay' | 'priorityRoad' | 'noEntry' | 'noLeftTurn' | 'noRightTurn' | 'noUTurn'
  | 'speedLimit' | 'pedestrianCrossing' | 'school';

/** Stands beside the lane travelling `dir` on `edgeId`, `at` metres from `edge.from`, facing that traffic. */
export interface Sign {
  id: string;
  type: SignType;
  edgeId: string;
  dir: 1 | -1;
  at: number;
  /** km/h, for speedLimit only. */
  value?: number;
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
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

export interface DistrictConfig {
  name: string;
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
  origin: { lat: number; lon: number };
}
