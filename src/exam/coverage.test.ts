import { describe, expect, it } from 'vitest';
import { LaneNetwork } from '../traffic/lanes';
import { testNetwork } from '../traffic/testNetwork';
import type { DistrictData, Sign } from '../shared/district';
import { CODE, loadCatalogue } from '../shared/signCatalogue';
import { entriesOnRoute, missingEntries, signsOnRoute } from './coverage';
import { planRoute } from './route';

const sign = (id: string, code: string, edgeId: string, dir: 1 | -1, at: number, extra: Partial<Sign> = {}): Sign =>
  ({ id, code, edgeId, dir, at, origin: 'hand', ...extra });

// Starts 100 m up w toward the cross, crosses it onto e, finishes on tStub.
function setup(signs: Sign[]) {
  const d: DistrictData = testNetwork();
  d.signs = signs;
  return { d, route: planRoute(new LaneNetwork(d), d, [[-100, 3], [120, 3], [237, 30]]) };
}
const ids = (d: DistrictData, route: ReturnType<typeof setup>['route']) => signsOnRoute(d, route).map(s => s.id);

describe('signsOnRoute', () => {
  it('counts a sign on a lane the route drives', () => {
    const { d, route } = setup([sign('a', CODE.speedLimit, 'e', 1, 100)]);
    expect(ids(d, route)).toEqual(['a']);
  });

  it('does not count a sign on the opposite direction of a route edge', () => {
    const { d, route } = setup([sign('a', CODE.speedLimit, 'e', -1, 100)]);
    expect(ids(d, route)).toEqual([]);
  });

  it('counts a no-entry on a side street at a junction the route crosses', () => {
    const { d, route } = setup([
      sign('near', CODE.noEntry, 'n', -1, 10),
      sign('far', CODE.noEntry, 'n', -1, 90),
      sign('away', CODE.noEntry, 'n', 1, 10),
    ]);
    expect(ids(d, route)).toEqual(['near']);
  });

  it('does not count a sign before the start or after the finish', () => {
    const { d, route } = setup([
      sign('behind', CODE.speedLimit, 'w', -1, 150),
      sign('ahead', CODE.speedLimit, 'w', -1, 50),
      sign('past', CODE.speedLimit, 'tStub', 1, 36),
      sign('before-finish', CODE.speedLimit, 'tStub', 1, 20),
    ]);
    expect(ids(d, route)).toEqual(['ahead', 'before-finish']);
  });

  it('lists signs in route order', () => {
    const { d, route } = setup([
      sign('c', CODE.speedLimit, 'tStub', 1, 20),
      sign('b', CODE.speedLimit, 'e', 1, 100),
      sign('a', CODE.speedLimit, 'w', -1, 50),
    ]);
    expect(ids(d, route)).toEqual(['a', 'b', 'c']);
  });
});

describe('entriesOnRoute', () => {
  it('counts the plates under a counted sign', () => {
    const { d, route } = setup([
      sign('a', CODE.speedLimit, 'e', 1, 100, { plates: [{ code: '7.2.1' }, { code: '7.1.1', value: 50 }] }),
      sign('off', CODE.stop, 'e', -1, 100, { plates: [{ code: '7.4.1' }] }),
    ]);
    expect(entriesOnRoute(d, route)).toEqual(new Set([CODE.speedLimit, '7.2.1', '7.1.1']));
  });
});

describe('missingEntries', () => {
  it('lists catalogue numbers no route passes', () => {
    const { d, route } = setup([sign('a', CODE.stop, 'e', 1, 100)]);
    const missing = missingEntries(d, [route]);
    expect(missing).toHaveLength(loadCatalogue().length - 1);
    expect(missing).not.toContain(CODE.stop);
  });
});
