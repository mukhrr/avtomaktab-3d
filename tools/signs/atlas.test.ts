import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Sign } from '../../src/shared/district';
import { loadCatalogue, plateKey } from '../../src/shared/signCatalogue';
import { assertTextRenders, checkAtlasCovers, exemptSvg, packAtlas, SPEEDS, type Atlas } from './atlas';

const readAtlasJson = (): Atlas => JSON.parse(readFileSync('public/signs/atlas.json', 'utf8'));

const sign = (over: Partial<Sign>): Sign => ({ id: 's', code: '2.5', edgeId: 'e', dir: 1, at: 0, origin: 'hand', ...over });

function randomItems(n: number): { key: string; px: [number, number] }[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, (_, i) => ({ key: `k${i}`, px: [20 + Math.floor(rnd() * 400), 20 + Math.floor(rnd() * 120)] as [number, number] }));
}

describe('packAtlas', () => {
  const items = randomItems(120);
  const width = 2048;
  const placed = packAtlas(items, width, 4);
  const rects = items.map(i => ({ key: i.key, x: placed[i.key].x, y: placed[i.key].y, w: i.px[0], h: i.px[1] }));

  it('packs cells without overlap and inside the width', () => {
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(width);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.key} and ${b.key}`).toBe(true);
      }
    }
  });

  it('leaves at least 4 px of padding round every cell', () => {
    const gap = (a: (typeof rects)[number], b: (typeof rects)[number]) =>
      Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
    let min = Infinity;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) min = Math.min(min, gap(rects[i], rects[j]));
    expect(min).toBeGreaterThanOrEqual(4);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(4);
      expect(r.y).toBeGreaterThanOrEqual(4);
      expect(r.x + r.w + 4).toBeLessThanOrEqual(width);
    }
  });

  it('refuses a cell wider than the sheet', () => {
    expect(() => packAtlas([{ key: 'wide', px: [300, 10] }], 256, 4)).toThrow('wide');
  });
});

describe('checkAtlasCovers', () => {
  const cell = { u: 0, v: 0, w: 0.1, h: 0.1, size: [0.7, 0.7] as [number, number] };
  const atlas: Atlas = { width: 100, height: 100, cells: { '3.24:60': cell, '7.5.4:8-19': cell } };

  it('fails naming the sign when a value has no cell', () => {
    expect(() => checkAtlasCovers([sign({ id: 'x', code: '3.24', value: 45 })], atlas)).toThrow('x');
  });

  it('fails naming the sign when a plate has no cell', () => {
    expect(() => checkAtlasCovers([sign({ id: 'p', code: '3.24', value: 60, plates: [{ code: '7.5.4', value: '9-18' }] })], atlas)).toThrow('p');
  });

  it('accepts signs whose cells exist', () => {
    expect(() => checkAtlasCovers([sign({ code: '3.24', value: 60, plates: [{ code: '7.5.4', value: '8-19' }] })], atlas)).not.toThrow();
  });
});

describe('sheet helpers', () => {
  it('can draw text through sharp', async () => {
    await expect(assertTextRenders()).resolves.toBeUndefined();
  });

  it('labels an exempt entry as a grey box', () => {
    const e = { ...loadCatalogue()[0], exempt: 'not on the exam' };
    const svg = exemptSvg(e, 320);
    expect(svg).toContain('#8a8f96');
    expect(svg).toContain('not on the exam');
  });
});

describe('the built atlas', () => {
  it('fits the budgets', () => {
    const a = readAtlasJson();
    expect(statSync('public/signs/atlas.png').size).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect((a.width * a.height * 4 * 4) / 3).toBeLessThanOrEqual(48 * 1024 * 1024);
  });

  it('has a cell for every entry with art', () => {
    const a = readAtlasJson();
    const examples: Record<string, number | string> = { mass: 3.5, height: 3.5, width: 2.5, length: 10, distance: 100, time: '8-19' };
    for (const e of loadCatalogue().filter(x => x.art)) {
      const keys = e.valueKind === 'speed' ? SPEEDS.map(v => plateKey(e.number, v))
        : e.valueKind === 'text' ? Object.keys(a.cells).filter(k => k.startsWith(`${e.number}:`))
        : [plateKey(e.number, e.valueKind ? examples[e.valueKind] : undefined)];
      expect(keys.length, e.number).toBeGreaterThan(0);
      for (const k of keys) {
        const c = a.cells[k];
        expect(c, k).toBeDefined();
        expect(c.size[0], k).toBeLessThanOrEqual(e.size[0] + 1e-9);
        expect(c.size[1], k).toBeLessThanOrEqual(e.size[1] + 1e-9);
        expect((c.w * a.width) / (c.h * a.height) / (c.size[0] / c.size[1]), k).toBeCloseTo(1, 1);
        expect(c.u >= 0 && c.v >= 0 && c.u + c.w <= 1 && c.v + c.h <= 1, k).toBe(true);
      }
    }
  });

  it('covers every sign in every district', () => {
    const a = readAtlasJson();
    const signs = JSON.parse(readFileSync('data/districts/tashkent-center/signs.json', 'utf8')) as Sign[];
    expect(() => checkAtlasCovers(signs, a)).not.toThrow();
  });
});
