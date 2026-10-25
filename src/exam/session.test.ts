import type { Vec2 } from '../shared/district';
import { SignalSystem } from '../sim/signals';
import { SignSystem } from '../sim/signs';
import { LaneNetwork, pointAt, type LaneRef } from '../traffic/lanes';
import { testNetwork } from '../traffic/testNetwork';
import { TrafficSim } from '../traffic/trafficSim';
import { newCabin } from '../vehicle/cabin';
import type { AudioBackend } from '../audio/voice';
import { t } from '../i18n';
import { project as along } from '../traffic/turns';
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
    penalties: loadPenalties(), playerLength: 4.5,
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
  const frameOn = (ref: LaneRef, pathS: number, speed: number): SessionFrame => {
    const p = pointAt(net.path(ref).points, pathS);
    t += DT;
    return {
      t, dt: DT, position: p.position as Vec2, heading: p.heading, speed,
      drivetrain: { gearbox: 'auto', gear: 1, rpm: 800, running: true }, cabin: { ...newCabin(), belt: true }, steer: 0, events: [],
    };
  };
  return { session, route, net, placed, audio, frame, frameOn };
}

describe('ExamSession', () => {
  it('start puts the examiner in briefing and the car at the route start', () => {
    const { session, route, placed } = setup();
    expect(session.phase).toBeNull();
    session.start('uz', 'manual', route, true);
    expect(session.phase).toBe('briefing');
    expect(placed).toEqual([{ pose: route.start, gearbox: 'manual' }]);
  });

  it('speaks the brief, then starts the drive', () => {
    const { session, route, audio, frame } = setup([]);
    session.start('ru', 'auto', route, true);
    session.step(frame(10, 0));
    expect(session.phase).toBe('driving');
    session.step(frame(10, 0));
    expect(session.prompts.map(p => p.key)).toEqual(['exam.brief', 'exam.start']);
    expect(audio.urls[0]).toBe('/audio/ru/exam.brief.mp3');
  });

  it('a fail-tier violation ends the drive with a failed result, once', () => {
    const ends: unknown[] = [];
    const { session, route, frame } = setup([at(0.5, [{ id: 'redLight', position: [1, 2] }])]);
    session.onEnd = r => ends.push(r);
    session.start('uz', 'auto', route, true);
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
    const { session, route, frame } = setup([]);
    session.start('uz', 'auto', route, true);
    session.step(frame(10, 0));
    session.abandon();
    expect(session.phase).toBe('abandoned');
    expect(session.result!.passed).toBe(false);
  });

  it('a second start begins a fresh drive', () => {
    const { session, route, frame, placed } = setup([at(0.5, [{ id: 'redLight', position: [1, 2] }])]);
    session.start('uz', 'auto', route, true);
    for (let i = 0; i < 60; i++) session.step(frame(10, 0));
    expect(session.phase).toBe('failed');
    session.start('ru', 'auto', route, true);
    expect(session.phase).toBe('briefing');
    expect(session.prompts).toEqual([]);
    expect(placed).toHaveLength(2);
  });

  it('reports the route as one polyline from start to finish', () => {
    const { session, route } = setup();
    session.start('uz', 'auto', route, true);
    const line = session.routeLine;
    const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(near(line[0], route.start.position)).toBeLessThan(1);
    expect(near(line[line.length - 1], route.finish.position)).toBeLessThan(1);
  });
});

describe('unscored drive', () => {
  it('drops violations and ends without a result, firing onFreeEnd at the finish', () => {
    const { session, route, frame } = setup([at(0.5, [{ id: 'redLight', position: [1, 2] }])]);
    const ends: unknown[] = [], free: string[] = [], toasts: unknown[] = [];
    session.onEnd = r => ends.push(r);
    session.onFreeEnd = how => free.push(how);
    session.onPrompt = p => toasts.push(p);
    session.start('uz', 'auto', route, false);
    expect(session.scored).toBe(false);
    for (let i = 0; i < 60; i++) session.step(frame(10 + i * 0.1, 6));
    expect(session.phase).toBe('driving');
    expect(session.prompts.map(p => p.key)).not.toContain('exam.violation');
    expect(toasts.filter(p => (p as { key: string }).key === 'exam.violation')).toEqual([]);
    expect(session.result!.total).toBe(0);
    expect(ends).toEqual([]);
    expect(free).toEqual([]);
  });

  it('reaching the finish fires onFreeEnd, not onEnd, and says no verdict', () => {
    const { session, route, net, frameOn } = setup([]);
    const ends: unknown[] = [], free: string[] = [];
    session.onEnd = r => ends.push(r);
    session.onFreeEnd = how => free.push(how);
    session.start('uz', 'auto', route, false);
    route.steps.forEach((st, i) => {
      const len = net.path(st.ref).length;
      const last = i === route.steps.length - 1;
      for (let s = 0; s < len; s += 2) session.step(frameOn(st.ref, s, 6));
      if (last) for (let k = 0; k < 400; k++) session.step(frameOn(st.ref, along(net.path(st.ref).points, route.finish.position), 0));
    });
    expect(free).toEqual(['finished']);
    expect(ends).toEqual([]);
    expect(session.prompts.map(p => p.key)).not.toContain('exam.passed');
  });

  it('abandon returns to free driving without a debrief or a verdict line', () => {
    const { session, route, frame } = setup([]);
    const ends: unknown[] = [], free: string[] = [];
    session.onEnd = r => ends.push(r);
    session.onFreeEnd = how => free.push(how);
    session.start('uz', 'auto', route, false);
    session.step(frame(10, 0));
    session.abandon();
    expect(free).toEqual(['left']);
    expect(ends).toEqual([]);
    expect(session.prompts.map(p => p.key)).not.toContain('exam.failed');
  });

  it('a scored start after an unscored one scores again', () => {
    const { session, route } = setup([]);
    session.start('uz', 'auto', route, false);
    session.start('uz', 'auto', route, true);
    expect(session.scored).toBe(true);
  });

  it('routeLine follows the route given to start', () => {
    const { session, route } = setup([]);
    expect(session.routeLine).toEqual([]);
    session.start('uz', 'auto', route, false);
    expect(session.routeLine.length).toBeGreaterThan(1);
  });
});

describe('subtitles', () => {
  it('passes direction lines on and keeps violation lines to the toast', async () => {
    const { session, route, frame } = setup([at(0.1, [{ id: 'harshBraking', position: [0, 0] }])]);
    const subs: string[] = [];
    session.onSubtitle = s => subs.push(s);
    session.start('uz', 'auto', route, true);
    for (let i = 0; i < 12; i++) session.step(frame(10, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(session.prompts.map(p => p.key)).toContain('exam.violation');
    expect(subs).toEqual([t('uz', 'exam.brief'), t('uz', 'exam.start')]);
  });
});
