import type { Vec2 } from '../shared/district';
import { SignalSystem } from '../sim/signals';
import { SignSystem } from '../sim/signs';
import { LaneNetwork, pointAt } from '../traffic/lanes';
import { testNetwork } from '../traffic/testNetwork';
import { TrafficSim } from '../traffic/trafficSim';
import { newCabin } from '../vehicle/cabin';
import type { AudioBackend } from '../audio/voice';
import { t } from '../i18n';
import { loadPenalties } from './penalties';
import { planRoute, type Pose } from './route';
import type { Rule, Violation } from './rules/types';
import { ExamSession, type SessionFrame } from './session';

const DT = 1 / 60;

class FakeAudio implements AudioBackend {
  urls: string[] = [];
  play(url: string): Promise<void> {
    this.urls.push(url);
    return Promise.resolve();
  }
  stop(): void {}
}

/** Emits `v` on the step nearest `t`, stamped with that step's time. */
const at = (t: number, v: Omit<Violation, 't'>[]): Rule => ({
  id: 'scripted',
  update: s => (Math.abs(s.t - t) < DT / 2 ? v.map(x => ({ ...x, t: s.t })) : []),
  reset: () => {},
});

function setup(rules?: Rule[]) {
  const d = testNetwork();
  const net = new LaneNetwork(d);
  const signals = new SignalSystem(d);
  const route = planRoute(net, d, [[-100, 3], [3, -100]]);
  const placed: { pose: Pose; gearbox: string }[] = [];
  const audio = new FakeAudio();
  const session = new ExamSession({
    d, net, signals, signs: new SignSystem(d),
    peds: { occupied: () => false, curbWaiting: () => false },
    traffic: new TrafficSim(d, net, signals, { count: 0, seed: 1 }),
    route, penalties: loadPenalties(), playerLength: 4.5,
    placeCar: (pose, gearbox) => placed.push({ pose, gearbox }),
    rules, audio,
  });
  const lane = net.path(route.steps[0].ref);
  let t = 0;
  const frame = (pathS: number, speed: number): SessionFrame => {
    const p = pointAt(lane.points, pathS);
    t += DT;
    return {
      t, dt: DT, position: p.position as Vec2, heading: p.heading, speed,
      drivetrain: { gearbox: 'auto', gear: 1, rpm: 800, running: true }, cabin: { ...newCabin(), belt: true }, steer: 0, events: [],
    };
  };
  return { session, route, placed, audio, frame };
}

describe('ExamSession', () => {
  it('start puts the examiner in briefing and the car at the route start', () => {
    const { session, route, placed } = setup();
    expect(session.phase).toBeNull();
    session.start('uz', 'manual');
    expect(session.phase).toBe('briefing');
    expect(placed).toEqual([{ pose: route.start, gearbox: 'manual' }]);
  });

  it('speaks the brief, then starts the drive', () => {
    const { session, audio, frame } = setup([]);
    session.start('ru', 'auto');
    session.step(frame(10, 0));
    expect(session.phase).toBe('driving');
    session.step(frame(10, 0));
    expect(session.prompts.map(p => p.key)).toEqual(['exam.brief', 'exam.start']);
    expect(audio.urls[0]).toBe('/audio/ru/exam.brief.mp3');
  });

  it('a fail-tier violation ends the drive with a failed result, once', () => {
    const ends: unknown[] = [];
    const { session, frame } = setup([at(0.5, [{ id: 'redLight', position: [1, 2] }])]);
    session.onEnd = r => ends.push(r);
    session.start('uz', 'auto');
    for (let i = 0; i < 60; i++) session.step(frame(10 + i * 0.1, 6));
    expect(session.phase).toBe('failed');
    expect(session.active).toBe(false);
    const r = session.result!;
    expect(r.passed).toBe(false);
    expect(r.violations.map(v => v.id)).toEqual(['redLight']);
    expect(r.total).toBe(100);
    expect(ends).toHaveLength(1);
    expect(session.prompts.map(p => p.key)).toContain('exam.failed');
  });

  it('abandon ends a live drive as abandoned and silences the voice', () => {
    const { session, frame } = setup([]);
    session.start('uz', 'auto');
    session.step(frame(10, 0));
    session.abandon();
    expect(session.phase).toBe('abandoned');
    expect(session.result!.passed).toBe(false);
  });

  it('a second start begins a fresh drive', () => {
    const { session, frame, placed } = setup([at(0.5, [{ id: 'redLight', position: [1, 2] }])]);
    session.start('uz', 'auto');
    for (let i = 0; i < 60; i++) session.step(frame(10, 0));
    expect(session.phase).toBe('failed');
    session.start('ru', 'auto');
    expect(session.phase).toBe('briefing');
    expect(session.prompts).toEqual([]);
    expect(placed).toHaveLength(2);
  });

  it('reports the route as one polyline from start to finish', () => {
    const { session, route } = setup();
    const line = session.routeLine;
    const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(near(line[0], route.start.position)).toBeLessThan(1);
    expect(near(line[line.length - 1], route.finish.position)).toBeLessThan(1);
  });
});

describe('subtitles', () => {
  it('passes direction lines on and keeps violation lines to the toast', async () => {
    const { session, frame } = setup([at(0.1, [{ id: 'harshBraking', position: [0, 0] }])]);
    const subs: string[] = [];
    session.onSubtitle = s => subs.push(s);
    session.start('uz', 'auto');
    for (let i = 0; i < 12; i++) session.step(frame(10, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(session.prompts.map(p => p.key)).toContain('exam.violation');
    expect(subs).toEqual([t('uz', 'exam.brief'), t('uz', 'exam.start')]);
  });
});
