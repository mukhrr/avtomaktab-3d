import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCatalogue, type CatalogueEntry } from '../../src/shared/signCatalogue';
import { BEGIN, END, creditRows, renderSection, spliceSection } from './credits';

const credits = readFileSync('CREDITS.md', 'utf8');

describe('creditRows', () => {
  it('lists commons entries and drawn entries that are based on a page, in catalogue order', () => {
    const entries = [
      { number: '1.1', art: { source: 'commons', file: 'a', page: 'https://c/A', licence: 'Public domain' } },
      { number: '1.2', art: { source: 'drawn', file: 'b' } },
      { number: '1.3', art: { source: 'drawn', file: 'c', basedOn: 'https://c/C', licence: 'CC0' } },
      { number: '1.4', art: null },
    ] as unknown as CatalogueEntry[];
    expect(creditRows(entries)).toEqual([
      { number: '1.1', page: 'https://c/A', licence: 'Public domain', drawn: false },
      { number: '1.3', page: 'https://c/C', licence: 'CC0', drawn: true },
    ]);
  });

  it('refuses a based-on entry with no licence', () => {
    const entries = [{ number: '1.3', art: { source: 'drawn', file: 'c', basedOn: 'https://c/C' } }] as unknown as CatalogueEntry[];
    expect(() => creditRows(entries)).toThrow('1.3');
  });
});

describe('spliceSection', () => {
  it('replaces only what sits between the markers', () => {
    const doc = `top\n${BEGIN}\nold\n${END}\nbottom\n`;
    expect(spliceSection(doc, 'new\n')).toBe(`top\n${BEGIN}\nnew\n${END}\nbottom\n`);
  });

  it('appends the section when the markers are missing', () => {
    expect(spliceSection('top\n', 'new\n')).toBe(`top\n\n${BEGIN}\nnew\n${END}\n`);
  });
});

describe('CREDITS.md', () => {
  const entries = loadCatalogue();

  it('credits every commons entry with its number, page and licence', () => {
    for (const e of entries) {
      if (e.art?.source !== 'commons') continue;
      expect(credits, e.number).toContain(`| ${e.number} |`);
      expect(credits, e.number).toContain(e.art.page);
      expect(credits, e.number).toContain(e.art.licence);
    }
  });

  it('credits the page behind every drawn entry that is based on one', () => {
    for (const e of entries) {
      if (e.art?.source !== 'drawn' || !e.art.basedOn) continue;
      expect(credits, e.number).toContain(`| ${e.number} |`);
      expect(credits, e.number).toContain(e.art.basedOn);
    }
  });

  it('credits the Rules text to lex.uz', () => {
    expect(credits).toContain('https://lex.uz/uz/docs/-5953883');
  });

  it('matches what the script generates, so it cannot drift', () => {
    expect(credits).toBe(spliceSection(credits, renderSection(entries)));
  });
});
