import { DEFAULT_CHOICE, loadChoice, saveChoice } from './choices';

afterEach(() => vi.unstubAllGlobals());

test('without localStorage the defaults are used and saving does not throw', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  expect(loadChoice()).toEqual(DEFAULT_CHOICE);
  expect(() => saveChoice({ mode: 'free', lang: 'ru', gearbox: 'manual', timeOfDay: 'evening', sound: true, volume: 0.7 })).not.toThrow();
});

test('a saved choice comes back, junk falls back field by field', () => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) });
  saveChoice({ mode: 'free', lang: 'ru', gearbox: 'manual', timeOfDay: 'evening', sound: true, volume: 0.7 });
  expect(loadChoice()).toEqual({ mode: 'free', lang: 'ru', gearbox: 'manual', timeOfDay: 'evening', sound: true, volume: 0.7 });
  mem.set('avtomaktab.start', '{"mode":"x","lang":"ru"}');
  expect(loadChoice()).toEqual({ ...DEFAULT_CHOICE, lang: 'ru' });
});

test('time of day defaults to noon and an invalid stored value falls back to it', () => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) });
  expect(DEFAULT_CHOICE.timeOfDay).toBe('noon');
  mem.set('avtomaktab.start', '{"timeOfDay":"midnight"}');
  expect(loadChoice().timeOfDay).toBe('noon');
  mem.set('avtomaktab.start', '{"timeOfDay":"morning"}');
  expect(loadChoice().timeOfDay).toBe('morning');
});

test('sound defaults to on at 0.7 and invalid stored values fall back to those', () => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) });
  expect(DEFAULT_CHOICE.sound).toBe(true);
  expect(DEFAULT_CHOICE.volume).toBe(0.7);
  for (const raw of ['{}', '{"sound":"no","volume":"loud"}', '{"volume":2}', '{"volume":-1}', '{"volume":null}']) {
    mem.set('avtomaktab.start', raw);
    expect(loadChoice().sound).toBe(true);
    expect(loadChoice().volume).toBe(0.7);
  }
  mem.set('avtomaktab.start', '{"sound":false,"volume":0.25}');
  expect(loadChoice()).toMatchObject({ sound: false, volume: 0.25 });
  mem.set('avtomaktab.start', '{"volume":0}');
  expect(loadChoice().volume).toBe(0);
});
