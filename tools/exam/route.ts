import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { DistrictData, Vec2 } from '../../src/shared/district';
import { LaneNetwork } from '../../src/traffic/lanes';
import { planRoute, turnBetween } from '../../src/exam/route';

function buildRoute(district: string, id: string, d: DistrictData, net: LaneNetwork) {
  const waypoints: Vec2[] = JSON.parse(readFileSync(`data/districts/${district}/routes/${id}.waypoints.json`, 'utf8'));
  const route = planRoute(net, d, waypoints, id, d.name);

  const edges = new Map(d.graph.edges.map(e => [e.id, e]));
  for (const [i, s] of route.steps.entries()) {
    const e = edges.get(s.ref.edgeId)!;
    console.info(`${String(i).padStart(3)} ${s.maneuver.padEnd(8)} ${e.name || '(unnamed)'} ${e.maxspeed} km/h -> wp ${s.waypointIndex}`);
  }
  // The examiner reads the start step as "pull off", so a turn at the end of the start lane would go unannounced.
  const first = turnBetween(net, route.steps[0].ref, route.steps[1].ref);
  if (first !== 'straight') console.warn(`warning: the start lane ends in a ${first} turn that the examiner will not announce`);

  const outDir = `public/districts/${district}/routes`;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/${id}.json`, JSON.stringify(route, null, 1));
  console.info(`${id}: ${route.steps.length} steps, ${(route.lengthM / 1000).toFixed(2)} km`, route.features);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [district, id] = process.argv.slice(2);
  if (!district) throw new Error('usage: npm run exam:route -- <district> [route-id]');
  const d: DistrictData = JSON.parse(readFileSync(`public/districts/${district}/district.json`, 'utf8'));
  const net = new LaneNetwork(d);
  if (id) buildRoute(district, id, d, net);
  else {
    const index = readFileSync(`data/districts/${district}/routes/index.json`, 'utf8');
    for (const routeId of (JSON.parse(index) as { routes: string[] }).routes) buildRoute(district, routeId, d, net);
    writeFileSync(`public/districts/${district}/routes/index.json`, index);
  }
}
