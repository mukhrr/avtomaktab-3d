import type { AgentView } from '../traffic/trafficSim';
import { loadWorld, ScriptedDriver } from './testDriver';

const DT = 1 / 60;

/** Drives off on an empty district, then meets a car standing nose to nose on its path 10 m ahead. */
function noseToNose(heldByPlayer: boolean) {
  const w = loadWorld({ cars: 0, crossers: 0, walkers: 0 });
  const driver = new ScriptedDriver(w, { indicators: true, obeyLights: true });
  driver.place();
  let t = 0;
  const tick = () => {
    w.signals.update(DT);
    t += DT;
    return driver.step(t, DT);
  };
  while (driver.v < 5) tick();
  const at = driver.line.at(driver.s + 10 + driver.v * driver.v / 4);
  const car: AgentView = {
    id: 0, active: true, position: at.position, heading: at.heading + Math.PI, carClass: 'nexia', colour: 0,
    braking: false, speed: 0, indicator: null,
  };
  const ref = driver.pieces.find(p => p.s0 <= driver.s + 10 && p.s1 > driver.s + 10)!.ref;
  const inspect = () => ({ ref, s: 0, connectorNode: null, generation: 1, turn: 'left', changing: null, heldByPlayer });
  (w as { traffic: unknown }).traffic = { agents: [car], inspect };
  let stoppedAt = -1, minV = 0, minS = Infinity, reversedGear = false;
  for (let i = 0; i < 20 / DT; i++) {
    const f = tick();
    if (stoppedAt < 0 && driver.v === 0) stoppedAt = driver.s;
    minV = Math.min(minV, f.speed);
    if (stoppedAt >= 0) minS = Math.min(minS, driver.s);
    if (f.speed < 0) reversedGear ||= f.drivetrain.gear === -1;
  }
  return { driver, stoppedAt, minV, backed: stoppedAt - minS, reversedGear };
}

describe('ScriptedDriver backing off', () => {
  it('backs off about 2.5 m, once, from a standing car that waits for it', () => {
    const { driver, stoppedAt, minV, backed, reversedGear } = noseToNose(true);
    expect(stoppedAt).toBeGreaterThan(0);
    expect(minV).toBeLessThan(0);
    expect(reversedGear).toBe(true);
    expect(backed).toBeGreaterThan(2);
    expect(backed).toBeLessThan(3);
    expect(driver.backOffs).toBe(1);
  }, 30_000);

  it('just waits behind a standing car that does not wait for it', () => {
    const { driver, stoppedAt, minV, backed } = noseToNose(false);
    expect(stoppedAt).toBeGreaterThan(0);
    expect(minV).toBe(0);
    expect(backed).toBeLessThan(0.1);
    expect(driver.backOffs).toBe(0);
  }, 30_000);
});
