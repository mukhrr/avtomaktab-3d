import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Crossing, DistrictConfig, DistrictData, Sign } from '../../src/shared/district';
import { edgeLength, locateNode } from './attach';
import { buildControllers } from './controllers';
import { crossingsOffJunctions } from './crossings';
import { placeFurniture } from './furniture';
import { extractFeatures, type Overrides } from './extract';
import { buildRoadGraph } from './graph';
import { parseOsm } from './osm';
import { makeProjection } from './projection';

export function validateSigns(signs: Sign[], edges: DistrictData['graph']['edges']): void {
  const byId = new Map(edges.map(e => [e.id, e]));
  const ids = new Set<string>();
  for (const s of signs) {
    if (ids.has(s.id)) throw new Error(`duplicate sign id ${s.id}`);
    ids.add(s.id);
    const e = byId.get(s.edgeId);
    if (!e) throw new Error(`sign ${s.id} refers to missing edge ${s.edgeId}`);
    if (!(s.at >= 0 && s.at <= edgeLength(e))) throw new Error(`sign ${s.id} is ${s.at} m along ${e.id}, outside its length`);
    if ((s.dir === 1 ? e.lanesForward : e.lanesBackward) === 0) throw new Error(`sign ${s.id} faces a direction ${e.id} has no lanes in`);
    if (s.type === 'speedLimit' && !(s.value && s.value > 0)) throw new Error(`speed limit sign ${s.id} needs a value`);
  }
}

export function buildDistrict(xml: string, config: DistrictConfig, overrides: Overrides, signs: Sign[] = [], log: (message: string) => void = () => {}): DistrictData {
  const osm = parseOsm(xml);
  const project = makeProjection(config.origin);
  const { roadNodeIds, crossingNodes, furniture: rawFurniture, ...features } = extractFeatures(osm, project, overrides);
  const graph = buildRoadGraph(features.roads, roadNodeIds, id => {
    const n = osm.nodes.get(id)!;
    return project(n.lat, n.lon);
  });
  const crossings: Crossing[] = [];
  for (const c of crossingNodes) {
    const [hit] = locateNode(graph.edges, c.id);
    if (!hit) continue;
    const edge = graph.edges.find(e => e.id === hit.edgeId)!;
    crossings.push({ id: c.id, position: edge.points[hit.index], kind: c.kind, edgeId: hit.edgeId, at: hit.at, width: edge.width });
  }
  validateSigns(signs, graph.edges);
  const built = buildControllers(features.signals, graph.edges, graph.nodes, crossingsOffJunctions(crossings, graph.edges, graph.nodes));
  const furniture = placeFurniture(rawFurniture, graph.edges, graph.nodes, built.crossings, new Map(features.roads.map(r => [r.id, r.kind])), features.buildings.map(b => b.footprint));
  for (const kind of ['busStop', 'bench', 'bin'] as const) {
    const n = furniture.items.filter(i => i.kind === kind).length;
    log(`${kind}: ${n} placed, ${furniture.moved[kind]} moved, ${furniture.dropped[kind]} dropped`);
  }
  const [minLon, minLat, maxLon, maxLat] = config.bbox;
  const [minX, maxZ] = project(minLat, minLon);
  const [maxX, minZ] = project(maxLat, maxLon);
  return {
    name: config.name, origin: config.origin, bounds: { minX, maxX, minZ, maxZ }, ...features,
    signals: built.signals, crossings: built.crossings, controllers: built.controllers, signs, furniture: furniture.items, graph,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const district = process.argv[2];
  if (!district) throw new Error('usage: npm run city:build -- <district>');
  const dir = `data/districts/${district}`;
  const d = buildDistrict(
    readFileSync(`data/raw/${district}.osm.xml`, 'utf8'),
    JSON.parse(readFileSync(`${dir}/district.config.json`, 'utf8')),
    JSON.parse(readFileSync(`${dir}/overrides.json`, 'utf8')),
    existsSync(`${dir}/signs.json`) ? JSON.parse(readFileSync(`${dir}/signs.json`, 'utf8')) : [],
    console.info,
  );
  const outDir = `public/districts/${district}`;
  mkdirSync(outDir, { recursive: true });
  const json = JSON.stringify(d);
  writeFileSync(`${outDir}/district.json`, json);
  console.info(
    `${d.roads.length} roads, ${d.buildings.length} buildings, ${d.areas.length} areas, ${d.signals.length} signals, ${d.crossings.length} crossings, ${d.signs.length} signs, ` +
      `${d.controllers.length} controllers, ${d.signals.filter(s => s.approach).length} signals with an approach, ` +
      `${d.graph.nodes.length} graph nodes, ${d.graph.edges.length} edges, ${(json.length / 1e6).toFixed(2)} MB`,
  );
}
