import { XMLParser } from 'fast-xml-parser';

export interface OsmNode {
  id: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

export interface OsmWay {
  id: string;
  nodeIds: string[];
  tags: Record<string, string>;
}

export interface OsmData {
  nodes: Map<string, OsmNode>;
  ways: OsmWay[];
}

interface RawTag { k: string; v: string }
interface RawNode { id: string; lat: string; lon: string; tag?: RawTag[] }
interface RawWay { id: string; nd?: { ref: string }[]; tag?: RawTag[] }

const ARRAYS = new Set(['node', 'way', 'nd', 'tag']);

const toTags = (tags: RawTag[] = []) => Object.fromEntries(tags.map(t => [String(t.k), String(t.v)]));

export function parseOsm(xml: string): OsmData {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    isArray: name => ARRAYS.has(name),
  });
  const root = parser.parse(xml).osm as { node?: RawNode[]; way?: RawWay[] };
  const nodes = new Map<string, OsmNode>();
  for (const n of root.node ?? []) {
    nodes.set(String(n.id), { id: String(n.id), lat: Number(n.lat), lon: Number(n.lon), tags: toTags(n.tag) });
  }
  const ways = (root.way ?? []).map(w => ({
    id: String(w.id),
    nodeIds: (w.nd ?? []).map(nd => String(nd.ref)),
    tags: toTags(w.tag),
  }));
  return { nodes, ways };
}
