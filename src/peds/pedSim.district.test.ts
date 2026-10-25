import { readFileSync } from 'node:fs';
import type { DistrictData } from '../shared/district';
import { SignalSystem } from '../sim/signals';
import type { AgentView, PlayerState } from '../traffic/trafficSim';
import { PedSim } from './pedSim';

const root = new URL('../../public/districts/tashkent-center/', import.meta.url);
const d: DistrictData = JSON.parse(readFileSync(new URL('district.json', root), 'utf8'));

// Zebra 5648893068 by the jam ring at (-230, 50): seed 1 used to keep it occupied for the whole jam.
const ZEBRA = '5648893068';
const DT = 1 / 60;
const player: PlayerState = { position: [-251, 44], heading: 1.22, speed: 0, length: 4.5, width: 1.8 };
// Where the car on the connector at node 3618822995 stood in that run, front about 2 m short of the stripes.
const waiting: AgentView = {
  id: 51, active: true, position: [-198, 62.5], heading: 1.23, carClass: 'nexia', colour: 0, braking: false, speed: 0, indicator: null,
};

test('the zebra by the jam ring frees within seconds of a car waiting at it', () => {
  const signals = new SignalSystem(d);
  const peds = new PedSim(d, { crossers: 40, walkers: 0, seed: 2 });
  const step = (cars: AgentView[]) => {
    signals.update(DT);
    peds.step(DT, player, cars, signals);
  };
  let busy = 0;
  for (let i = 0; i < 120 / DT; i++) {
    step([]);
    if (peds.occupied(ZEBRA)) busy += DT;
  }
  expect(busy / 120).toBeGreaterThan(0.6);

  let freedAfter = Infinity;
  for (let t = 0; t < 30; t += DT) {
    step([waiting]);
    if (!peds.occupied(ZEBRA)) {
      freedAfter = t;
      break;
    }
  }
  expect(freedAfter).toBeLessThan(15);
  for (let t = 0; t < 10; t += DT) {
    step([waiting]);
    expect(peds.occupied(ZEBRA)).toBe(false);
  }
});
