import { DEFAULT_CHOICE, loadChoice, saveChoice } from './choices';

afterEach(() => vi.unstubAllGlobals());

test('without localStorage the defaults are used and saving does not throw', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  expect(loadChoice()).toEqual(DEFAULT_CHOICE);
  expect(() => saveChoice({ mode: 'free', lang: 'ru', gearbox: 'manual' })).not.toThrow();
});

test('a saved choice comes back, junk falls back field by field', () => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) });
  saveChoice({ mode: 'free', lang: 'ru', gearbox: 'manual' });
  expect(loadChoice()).toEqual({ mode: 'free', lang: 'ru', gearbox: 'manual' });
  mem.set('avtomaktab.start', '{"mode":"x","lang":"ru"}');
  expect(loadChoice()).toEqual({ ...DEFAULT_CHOICE, lang: 'ru' });
});
