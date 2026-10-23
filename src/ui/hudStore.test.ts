import { createHudStore, gearLabel } from './hudStore';

test('set notifies subscribers once and merges state', () => {
  const s = createHudStore();
  let calls = 0;
  s.subscribe(() => calls++);
  s.set({ speedKmh: 42, street: 'Amir Temur' });
  expect(calls).toBe(1);
  expect(s.get()).toMatchObject({ speedKmh: 42, street: 'Amir Temur', gear: 'N' });
});

test('unsubscribe stops notifications', () => {
  const s = createHudStore();
  let calls = 0;
  const off = s.subscribe(() => calls++);
  off();
  s.set({ fps: 60 });
  expect(calls).toBe(0);
});

test('gear labels', () => {
  expect(gearLabel('manual', -1)).toBe('R');
  expect(gearLabel('manual', 0)).toBe('N');
  expect(gearLabel('manual', 3)).toBe('3');
  expect(gearLabel('auto', 2)).toBe('D2');
  expect(gearLabel('auto', -1)).toBe('R');
});
