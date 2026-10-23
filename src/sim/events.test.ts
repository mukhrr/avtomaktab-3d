import { EventBus, type GameEvent } from './events';

const hit: GameEvent = { type: 'pedestrianHit', pedId: 3, speed: 5, time: 12 };
const crash: GameEvent = { type: 'collision', with: 'car', speed: 8, time: 13 };

test('drain returns emitted events once, then nothing', () => {
  const bus = new EventBus();
  bus.emit(hit);
  bus.emit(crash);
  expect(bus.drain()).toEqual([hit, crash]);
  expect(bus.drain()).toEqual([]);
});

test('on listeners see events until unsubscribed', () => {
  const bus = new EventBus();
  const seen: GameEvent[] = [];
  const off = bus.on(e => seen.push(e));
  bus.emit(hit);
  off();
  bus.emit(crash);
  expect(seen).toEqual([hit]);
});

test('the undrained queue keeps only the last 256 events', () => {
  const bus = new EventBus();
  for (let i = 0; i < 300; i++) bus.emit({ ...hit, pedId: i });
  const out = bus.drain();
  expect(out).toHaveLength(256);
  expect(out[0]).toEqual({ ...hit, pedId: 44 });
  expect(out[255]).toEqual({ ...hit, pedId: 299 });
});
