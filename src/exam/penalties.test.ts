import { PENALTY_IDS, loadPenalties } from './penalties';
import { t } from '../i18n';

const POINTS = { fail: 100, high: 20, low: 5 } as const;

test('every penalty id has an entry', () => {
  const table = loadPenalties();
  expect(PENALTY_IDS).toHaveLength(25);
  for (const id of PENALTY_IDS) {
    expect(table[id], id).toBeDefined();
    expect(table[id].id).toBe(id);
  }
  expect(Object.keys(table).sort()).toEqual([...PENALTY_IDS].sort());
});

test('points follow the tier', () => {
  for (const e of Object.values(loadPenalties())) {
    expect(e.points, e.id).toBe(POINTS[e.tier]);
  }
});

test('tier membership matches the spec', () => {
  const table = loadPenalties();
  const ids = (tier: string) => PENALTY_IDS.filter((i) => table[i].tier === tier).sort();
  expect(ids('fail')).toEqual(
    ['redLight', 'pedestrianNotYielded', 'vehicleNotYielded', 'oncomingLane', 'wrongWayOneway', 'noEntry',
      'collisionCar', 'collisionPedestrian', 'collisionObstacle', 'speedingSevere'].sort(),
  );
  expect(ids('high')).toEqual(
    ['yellowEntry', 'stopLinePast', 'noFullStopAtStopSign', 'turnRestriction', 'noIndicator', 'noMirrorCheck',
      'wrongLaneForTurn', 'stoppedOnCrossing'].sort(),
  );
  expect(ids('low')).toEqual(
    ['speeding', 'tailgating', 'harshBraking', 'stall', 'rollBack', 'noSeatBelt', 'noIndicatorPullOff'].sort(),
  );
});

test('every entry has clause and source, or is marked unverified', () => {
  for (const e of Object.values(loadPenalties())) {
    if (e.unverified) {
      expect(e.clause, e.id).toBeNull();
    } else {
      expect(e.clause, e.id).toBeTruthy();
      expect(e.source, e.id).toMatch(/^https:\/\/lex\.uz\//);
    }
  }
});

test('every id has uz and ru text', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  for (const id of PENALTY_IDS) {
    for (const lang of ['uz', 'ru'] as const) {
      const text = t(lang, `penalty.${id}`);
      expect(text, `${lang}.${id}`).not.toBe(`penalty.${id}`);
      expect(text.trim().length, `${lang}.${id}`).toBeGreaterThan(0);
    }
  }
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});
