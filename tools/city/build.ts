import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Crossing, DistrictConfig, DistrictData, Sign } from '../../src/shared/district';
import { edgeLength, locateNode } from './attach';
import { buildControllers } from './controllers';
import { crossingsOffJunctions } from './crossings';
import { placeFurniture } from './furniture';
import { extractFeatures, type Overrides } from './extract';
import { CODE, entry } from '../../src/shared/signCatalogue';
import { signSpots } from '../../src/world/signMount';
import { checkAtlasCovers, type Atlas } from '../signs/atlas';
import { buildRoadGraph } from './graph';
import { extractLandmarks } from './landmarks';
import { parseOsm } from './osm';
import { placeRuleSigns } from './signRules';
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
    // 3.1 at a one-way's end faces the direction nobody may drive.
    if ((s.dir === 1 ? e.lanesForward : e.lanesBackward) === 0 && s.code !== CODE.noEntry) throw new Error(`sign ${s.id} faces a direction ${e.id} has no lanes in`);
    const checkValue = (code: string, value: number | string | undefined, what: string) => {
      const kind = entry(code).valueKind;
      if (!kind) return;
      const text = kind === 'time' || kind === 'text';
      const ok = text ? typeof value === 'string' && value !== '' : typeof value === 'number' && Number.isFinite(value) && value > 0;
      if (!ok) throw new Error(`${what} ${s.id} (${code}) needs ${text ? 'a text' : 'a positive numeric'} value (${kind})`);
    };
    checkValue(s.code, s.value, 'sign');
    for (const p of s.plates ?? []) {
      if (entry(p.code).group !== 7) throw new Error(`sign ${s.id}: ${p.code} is not a group 7 plate`);
      checkValue(p.code, p.value, 'plate on sign');
    }
  }
  for (const spot of signSpots(signs)) {
    if (spot.signs.length > 3) {
      throw new Error(`${spot.signs.length} signs on one pole at ${spot.at} m along ${spot.edgeId} (dir ${spot.dir}, ${spot.side}): ${spot.signs.map(s => s.id).join(', ')}; at most 3`);
    }
  }
}

export function buildDistrict(
  xml: string, config: DistrictConfig, overrides: Overrides, hand: Sign[] = [], log: (message: string) => void = () => {}, coverage: Sign[] = [],
): DistrictData {
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
  validateSigns([...hand, ...coverage], graph.edges);
  const built = buildControllers(features.signals, graph.edges, graph.nodes, crossingsOffJunctions(crossings, graph.edges, graph.nodes));
  const signs = placeRuleSigns({ graph, crossings: built.crossings, controllers: built.controllers, pois: features.pois }, hand, log, coverage);
  validateSigns(signs, graph.edges);
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
    signals: built.signals, crossings: built.crossings, controllers: built.controllers, signs, furniture: furniture.items,
    landmarks: extractLandmarks(osm, project, overrides.landmarks ?? {}, features.buildings), graph,
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
    existsSync(`${dir}/coverage.json`) ? JSON.parse(readFileSync(`${dir}/coverage.json`, 'utf8')) : [],
  );
  checkAtlasCovers(d.signs, JSON.parse(readFileSync('public/signs/atlas.json', 'utf8')) as Atlas);
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
