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
