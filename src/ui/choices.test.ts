import { DEFAULT_CHOICE, loadChoice, saveChoice } from './choices';

afterEach(() => vi.unstubAllGlobals());

test('without localStorage the defaults are used and saving does not throw', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  expect(loadChoice()).toEqual(DEFAULT_CHOICE);
  expect(() => saveChoice({ mode: 'free', lang: 'ru', gearbox: 'manual', timeOfDay: 'evening' })).not.toThrow();
});

test('a saved choice comes back, junk falls back field by field', () => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) });
  saveChoice({ mode: 'free', lang: 'ru', gearbox: 'manual', timeOfDay: 'evening' });
  expect(loadChoice()).toEqual({ mode: 'free', lang: 'ru', gearbox: 'manual', timeOfDay: 'evening' });
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
