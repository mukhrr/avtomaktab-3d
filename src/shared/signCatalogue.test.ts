import { CODE, entry, loadCatalogue, validateCatalogue } from './signCatalogue';

function countBy<T>(items: T[], key: (item: T) => number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const it of items) out[key(it)] = (out[key(it)] ?? 0) + 1;
  return out;
}

const clone = () => structuredClone(loadCatalogue()) as unknown as Record<string, unknown>[];

test('holds all 297 official entries with unique numbers', () => {
  const c = loadCatalogue();
  expect(c).toHaveLength(297);
  expect(new Set(c.map((e) => e.number)).size).toBe(297);
});

test('counts entries per group as in Appendix 1', () => {
  expect(countBy(loadCatalogue(), (e) => e.group)).toEqual({ 1: 50, 2: 9, 3: 39, 4: 24, 5: 84, 6: 30, 7: 61 });
});

test('names every code the game acts on', () => {
  for (const code of Object.values(CODE)) expect(entry(code).name.uz).not.toBe('');
});

test('rejects an entry with a non-positive size', () => {
  const rows = clone();
  rows[0].size = [0, 0.7];
  expect(() => validateCatalogue(rows)).toThrow(String(rows[0].number));
});

test('rejects art from a licence other than public domain or CC0', () => {
  const rows = clone();
  rows[0].art = { source: 'commons', file: 'x.svg', page: 'https://commons.wikimedia.org/wiki/File:x.svg', licence: 'CC BY-SA 4.0' };
  expect(() => validateCatalogue(rows)).toThrow('licence');
  rows[0].art = { source: 'commons', file: 'x.svg', page: 'https://commons.wikimedia.org/wiki/File:x.svg', licence: ' cc0 1.0 ' };
  expect(() => validateCatalogue(rows)).not.toThrow();
});

test('rejects checked: true without a reference', () => {
  const rows = clone();
  rows[0].checked = true;
  rows[0].reference = null;
  expect(() => validateCatalogue(rows)).toThrow('reference');
});

test('throws on an unknown code', () => {
  expect(() => entry('9.99')).toThrow('9.99');
});

test('accepts drawn art based on public-domain Commons art and rejects other licences', () => {
  const rows = clone();
  const basedOn = 'https://commons.wikimedia.org/wiki/File:x.svg';
  rows[0].art = { source: 'drawn', file: 'data/signs/drawn/x.svg', basedOn, licence: 'Public domain' };
  expect(() => validateCatalogue(rows)).not.toThrow();
  rows[0].art = { source: 'drawn', file: 'data/signs/drawn/x.svg', basedOn, licence: 'CC BY-SA 3.0' };
  expect(() => validateCatalogue(rows)).toThrow('licence');
  rows[0].art = { source: 'drawn', file: 'data/signs/drawn/x.svg', basedOn };
  expect(() => validateCatalogue(rows)).toThrow('licence');
  rows[0].art = { source: 'drawn', file: 'assets-src/signs/x.svg' };
  expect(() => validateCatalogue(rows)).toThrow('data/signs/drawn');
});
