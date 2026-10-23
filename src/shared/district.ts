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
export interface Building {
  id: string;
  height: number;
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

export interface Signal {
  id: string;
  position: Vec2;
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
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

export interface DistrictConfig {
  name: string;
  bbox: [minLon: number, minLat: number, maxLon: number, maxLat: number];
  origin: { lat: number; lon: number };
}
