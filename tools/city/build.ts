import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Crossing, DistrictConfig, DistrictData } from '../../src/shared/district';
import { locateNode } from './attach';
import { extractFeatures, type Overrides } from './extract';
import { buildRoadGraph } from './graph';
import { parseOsm } from './osm';
import { makeProjection } from './projection';

export function buildDistrict(xml: string, config: DistrictConfig, overrides: Overrides): DistrictData {
  const osm = parseOsm(xml);
  const project = makeProjection(config.origin);
  const { roadNodeIds, crossingNodes, ...features } = extractFeatures(osm, project, overrides);
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
  const [minLon, minLat, maxLon, maxLat] = config.bbox;
  const [minX, maxZ] = project(minLat, minLon);
  const [maxX, minZ] = project(maxLat, maxLon);
  return { name: config.name, origin: config.origin, bounds: { minX, maxX, minZ, maxZ }, ...features, crossings, graph };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const district = process.argv[2];
  if (!district) throw new Error('usage: npm run city:build -- <district>');
  const dir = `data/districts/${district}`;
  const d = buildDistrict(
    readFileSync(`data/raw/${district}.osm.xml`, 'utf8'),
    JSON.parse(readFileSync(`${dir}/district.config.json`, 'utf8')),
    JSON.parse(readFileSync(`${dir}/overrides.json`, 'utf8')),
  );
  const outDir = `public/districts/${district}`;
  mkdirSync(outDir, { recursive: true });
  const json = JSON.stringify(d);
  writeFileSync(`${outDir}/district.json`, json);
  console.info(
    `${d.roads.length} roads, ${d.buildings.length} buildings, ${d.areas.length} areas, ${d.signals.length} signals, ${d.crossings.length} crossings, ` +
      `${d.graph.nodes.length} graph nodes, ${d.graph.edges.length} edges, ${(json.length / 1e6).toFixed(2)} MB`,
  );
}
