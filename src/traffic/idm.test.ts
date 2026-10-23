import { DEFAULT_DRIVER, canStopBefore, idmAccel, turnSpeed } from './idm';

const DT = 1 / 60;
const params = (v0: number) => ({ v0, ...DEFAULT_DRIVER });

test('free road from standstill converges to v0 within 0.3 m/s in 40 s', () => {
  const p = params(16.7);
  let v = 0;
  for (let t = 0; t < 40; t += DT) v = Math.max(0, v + idmAccel(v, null, 0, p) * DT);
  expect(Math.abs(v - 16.7)).toBeLessThan(0.3);
});

test('stops behind a stationary obstacle 80 m ahead without passing it', () => {
  const p = params(16.7);
  const obstacle = 80;
  let v = 14;
  let travelled = 0;
  let minGap = Infinity;
  for (let t = 0; t < 60; t += DT) {
    const gap = obstacle - travelled;
    minGap = Math.min(minGap, gap);
    v = Math.max(0, v + idmAccel(v, gap, 0, p) * DT);
    travelled += v * DT;
  }
  const finalGap = obstacle - travelled;
  expect(minGap).toBeGreaterThan(0);
  expect(finalGap).toBeGreaterThanOrEqual(1.5);
  expect(finalGap).toBeLessThanOrEqual(3.5);
});

test('follower behind a leader at 10 m/s settles near s0 + 10·T', () => {
  const p = params(16.7);
  let v = 10;
  let x = 0;
  let leaderX = 30;
  for (let t = 0; t < 120; t += DT) {
    v = Math.max(0, v + idmAccel(v, leaderX - x, 10, p) * DT);
    x += v * DT;
    leaderX += 10 * DT;
  }
  expect(Math.abs(leaderX - x - 16.5)).toBeLessThan(1.5);
});

test('zero or negative gap brakes at the -9 m/s² floor instead of NaN or Infinity', () => {
  const p = params(16.7);
  expect(idmAccel(10, 0, 10, p)).toBe(-9);
  expect(idmAccel(10, -3, 10, p)).toBe(-9);
});

test('canStopBefore compares the required deceleration with maxDecel', () => {
  expect(canStopBefore(14, 20)).toBe(false);
  expect(canStopBefore(14, 30)).toBe(true);
  expect(canStopBefore(0, 0.1)).toBe(true);
});

test('turnSpeed caps by turn angle, with no cap below 25 degrees', () => {
  expect(turnSpeed(Math.PI / 2)).toBe(4.5);
  expect(turnSpeed((45 * Math.PI) / 180)).toBe(8);
  expect(turnSpeed((20 * Math.PI) / 180)).toBe(Infinity);
});
