// Headless sim cost: traffic.step + peds.step per fixed step on the real district. No rendering, no browser.
import { readFileSync } from 'node:fs';
import type { DistrictData, Vec2 } from '../../src/shared/district';
import { SignalSystem } from '../../src/sim/signals';
import { LaneNetwork, pointAt, type LaneRef } from '../../src/traffic/lanes';
import { TrafficSim, type PlayerState } from '../../src/traffic/trafficSim';
import { PedSim } from '../../src/peds/pedSim';
import { nearestLane } from '../../src/world/spawn';

const DT = 1 / 60, STEPS = 60 * 120, WARMUP = 300, SPEED = 12;
const d: DistrictData = JSON.parse(readFileSync('public/districts/tashkent-center/district.json', 'utf8'));
const net = new LaneNetwork(d);

// Polyline of ~2 km: successive first exits from the spawn lane, connectors ignored.
function route(): Vec2[] {
  const lane = nearestLane(d, -53, 105)!;
  // Pick the travel direction whose nearest path segment points the way the spawn lane faces.
  const dirError = (dir: 1 | -1) => {
    const pts = net.path({ edgeId: lane.edge.id, dir, lane: 0 }).points;
    let best = Infinity, err = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const dist = Math.hypot(pts[i][0] - lane.position[0], pts[i][1] - lane.position[1]);
      if (dist < best) {
        best = dist;
        const h = Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        err = Math.abs(Math.atan2(Math.sin(h - lane.heading), Math.cos(h - lane.heading)));
      }
    }
    return err;
  };
  let ref: LaneRef = { edgeId: lane.edge.id, dir: dirError(1) <= dirError(-1) ? 1 : -1, lane: 0 };
  const pts: Vec2[] = [];
  for (let len = 0, n = 0; len < 2000 && n < 40; n++) {
    const p = net.path(ref);
    pts.push(...p.points);
    len += p.length;
    const next = net.exits(ref)[0];
    if (!next) break;
    ref = next;
  }
  return pts;
}

function run(label: string, drive: boolean) {
  const signals = new SignalSystem(d);
  const traffic = new TrafficSim(d, net, signals, { count: 60, seed: 1 });
  const peds = new PedSim(d, { crossers: 40, walkers: 80, seed: 2 });
  const pts = drive ? route() : [];
  const total = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  const player: PlayerState = { position: [-53, 105], heading: 0, speed: drive ? SPEED : 0, length: 4.48, width: 1.74 };
  let s = 0;
  const times: number[] = [];
  for (let i = 0; i < STEPS; i++) {
    if (drive) {
      s = Math.min(s + SPEED * DT, total - 1);
      const q = pointAt(pts, s);
      player.position = q.position;
      player.heading = q.heading;
    }
    signals.update(DT);
    const t0 = performance.now();
    traffic.step(DT, player, peds);
    peds.step(DT, player, traffic.agents, signals);
    const t = performance.now() - t0;
    if (i >= WARMUP) times.push(t);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`${label}: mean ${mean.toFixed(3)} ms, p99 ${sorted[Math.floor(sorted.length * 0.99)].toFixed(3)} ms, max ${sorted[sorted.length - 1].toFixed(3)} ms (${times.length} steps, ${drive ? `player driven ${Math.round(s)} m at ${SPEED} m/s` : 'player parked at spawn'}, ${traffic.agents.filter(a => a.active).length} cars, ${peds.peds.filter(p => p.active).length} peds)`);
}

run('parked', false);
run('driving', true);
