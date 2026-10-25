import { describe, expect, it, vi } from 'vitest';
import { AudioRig } from './audioRig';
import type { CarSound } from './carAudio';
import { stubContext, type Node } from './stubContext';

const level = (n: Node) => [...n.gain.events].reverse().find(e => e.kind === 'target')!.v;
const idle: CarSound = { rpm: 800, throttle: 0, running: true, speed: 0, slip: 0, gear: 1, belt: true, blinker: null };

function rig(settings = { sound: true, volume: 0.7 }, onVoice?: (audible: boolean) => void) {
  const stub = stubContext();
  const r = new AudioRig(stub.ctx, settings, onVoice);
  return { ...stub, r, master: r.sfx.master as unknown as Node };
}

describe('AudioRig', () => {
  it('routes the car through the Sfx master and sets the master gain from the volume', () => {
    const { r, master } = rig({ sound: true, volume: 0.4 });
    expect(r.car.master).toBe(r.sfx.master);
    expect(master.gain.value).toBeCloseTo(0.4, 5);
  });

  it('sound off is master gain 0 and mutes the voice, on restores the volume', () => {
    const onVoice = vi.fn();
    const { r, master } = rig({ sound: true, volume: 0.7 }, onVoice);
    r.apply({ sound: false, volume: 0.7 });
    expect(level(master)).toBe(0);
    expect(onVoice).toHaveBeenLastCalledWith(false);
    r.apply({ sound: true, volume: 0.5 });
    expect(level(master)).toBeCloseTo(0.5, 5);
    expect(onVoice).toHaveBeenLastCalledWith(true);
  });

  it('clamps a bad volume into 0 to 1', () => {
    const { r, master } = rig();
    r.apply({ sound: true, volume: 7 });
    expect(level(master)).toBe(1);
    r.apply({ sound: true, volume: NaN });
    expect(level(master)).toBe(0.7);
  });

  it('fires start on the running false-to-true edge and stall on true-to-false, not on the first frame', () => {
    const { r } = rig();
    const event = vi.spyOn(r.car, 'event');
    r.enter();
    r.frame(idle, 1 / 60, false);
    expect(event).not.toHaveBeenCalled();
    r.frame({ ...idle, running: false }, 1 / 60, false);
    expect(event).toHaveBeenLastCalledWith('stall');
    r.frame({ ...idle, running: false }, 1 / 60, false);
    r.frame(idle, 1 / 60, false);
    expect(event).toHaveBeenLastCalledWith('start');
    expect(event.mock.calls.filter(([e]) => e === 'start' || e === 'stall')).toHaveLength(2);
  });

  it('a reset that flips running back on after leaving does not play a starter', () => {
    const { r } = rig();
    const event = vi.spyOn(r.car, 'event');
    r.enter();
    r.frame({ ...idle, running: false }, 1 / 60, false);
    r.leave();
    r.enter();
    r.frame(idle, 1 / 60, false);
    expect(event.mock.calls.filter(([e]) => e === 'start')).toHaveLength(0);
  });

  it('fades out over 0.3 s on leave and back in on enter', () => {
    const { r } = rig();
    const fade = vi.spyOn(r.car, 'fade');
    r.leave();
    expect(fade).toHaveBeenLastCalledWith(0, 0.3);
    r.enter();
    expect(fade).toHaveBeenLastCalledWith(1, 0.3);
  });

  it('holds the horn while asked and releases it on leave', () => {
    const { r } = rig();
    const horn = vi.spyOn(r.car, 'horn');
    r.enter();
    r.frame(idle, 1 / 60, true);
    expect(horn).toHaveBeenLastCalledWith(true);
    r.leave();
    expect(horn).toHaveBeenLastCalledWith(false);
  });

  it('survives a non-finite dt and never feeds NaN to the car', () => {
    const { r } = rig();
    const update = vi.spyOn(r.car, 'update');
    r.enter();
    r.frame(idle, NaN, false);
    r.frame(idle, Infinity, false);
    expect(update).not.toHaveBeenCalled();
    r.frame(idle, 5, false);
    expect(update.mock.calls[0][1]).toBeLessThanOrEqual(0.1);
  });

  it('suspends the context when hidden and resumes when visible', () => {
    const { r, raw } = rig();
    const ctx = raw as unknown as { suspend: () => Promise<void>; resume: () => Promise<void>; state: string };
    ctx.suspend = vi.fn(async () => { ctx.state = 'suspended'; });
    ctx.resume = vi.fn(async () => { ctx.state = 'running'; });
    r.visibility(true);
    expect(ctx.suspend).toHaveBeenCalledTimes(1);
    r.visibility(false);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('ten start and abandon cycles leave the number of live nodes constant', () => {
    const { r, nodes } = rig();
    const live = () => nodes.filter(n => !n.disconnects).length;
    const settle = () => { for (const n of nodes) if (n.onended) { const f = n.onended; n.onended = null; f(); } };
    const counts: number[] = [];
    for (let i = 0; i < 10; i++) {
      r.enter();
      r.frame(idle, 1 / 60, true);
      r.frame({ ...idle, running: false, speed: 5, slip: 0.8, blinker: 'hazard', belt: false }, 1 / 60, false);
      r.frame(idle, 1 / 60, false);
      r.leave();
      settle();
      counts.push(live());
    }
    expect(new Set(counts).size).toBe(1);
  });
});
