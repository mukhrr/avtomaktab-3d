import type { DistrictData, Sign } from '../../shared/district';
import { SignSystem } from '../../sim/signs';
import { LaneNetwork, type LaneRef } from '../../traffic/lanes';
import { testNetwork } from '../../traffic/testNetwork';
import { RoadInfo } from './road';
import { repeat, type SnapOver } from './testSnap';

/** testNetwork with extra signs; `edit` may change lane counts before the network is built. */
export function testRoad(signs: Omit<Sign, 'id' | 'origin'>[] = [], edit?: (d: DistrictData) => void): RoadInfo {
  const d = testNetwork();
  d.signs.push(...signs.map((g, i) => ({ id: `t${i}`, origin: 'hand' as const, ...g })));
  edit?.(d);
  return new RoadInfo(d, new LaneNetwork(d), new SignSystem(d));
}

/** Arm w, travelling east (dir -1) into the cross, then the given exit; `extra` is applied to every frame. */
export const W_IN: LaneRef = { edgeId: 'w', dir: -1, lane: 0 };
export const N_OUT: LaneRef = { edgeId: 'n', dir: 1, lane: 0 };
export const S_OUT: LaneRef = { edgeId: 's', dir: -1, lane: 0 };
export const E_OUT: LaneRef = { edgeId: 'e', dir: 1, lane: 0 };
export const W_BACK: LaneRef = { edgeId: 'w', dir: 1, lane: 0 };

export function transit(from: LaneRef, to: LaneRef, extra: SnapOver = {}, n = { before: 20, inside: 15, after: 10 }): SnapOver[] {
  return [
    ...repeat(n.before, { speed: 5, ref: from, ...extra }),
    ...repeat(n.inside, { speed: 5, ref: from, ...extra, match: { inJunction: 'cross', onConnector: true } }),
    ...repeat(n.after, { speed: 5, ref: to, ...extra }),
  ];
}
