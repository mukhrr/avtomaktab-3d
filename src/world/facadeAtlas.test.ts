import { describe, expect, it } from 'vitest';
import type { BuildingStyle } from '../shared/district';
import { ATLAS_COLS, ATLAS_ROWS, BAY_WIDTH, cellRect, drawFacadeAtlas, FACADE_CELL } from './facadeAtlas';

const STYLES: BuildingStyle[] = ['panel', 'brick', 'stucco', 'public', 'tower', 'shed'];
const CELL_PX = 256;
const W = ATLAS_COLS * CELL_PX;
const H = ATLAS_ROWS * CELL_PX;

describe('facade atlas layout', () => {
  it('has a unique in-range cell for every style slot', () => {
    const all = STYLES.flatMap(s => [FACADE_CELL[s].ground, FACADE_CELL[s].upper, FACADE_CELL[s].plain]);
    expect(new Set(all).size).toBe(all.length);
    for (const i of all) {
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(ATLAS_COLS * ATLAS_ROWS);
    }
  });

  it('uses the agreed bay widths', () => {
    expect(BAY_WIDTH).toEqual({ panel: 3.0, brick: 3.4, stucco: 3.6, public: 4.2, tower: 3.0, shed: 6.0 });
  });

  it('cellRect insets half a texel and stays inside its own cell', () => {
    for (let i = 0; i < ATLAS_COLS * ATLAS_ROWS; i++) {
      const r = cellRect(i);
      const col = i % ATLAS_COLS;
      const row = Math.floor(i / ATLAS_COLS);
      expect(r.u0).toBeCloseTo((col * CELL_PX + 0.5) / W, 9);
      expect(r.u1).toBeCloseTo(((col + 1) * CELL_PX - 0.5) / W, 9);
      expect(r.v1).toBeCloseTo(1 - (row * CELL_PX + 0.5) / H, 9);
      expect(r.v0).toBeCloseTo(1 - ((row + 1) * CELL_PX - 0.5) / H, 9);
      expect(r.u0).toBeLessThan(r.u1);
      expect(r.v0).toBeLessThan(r.v1);
    }
  });

  it('cellRect cells tile the unit square without overlap', () => {
    let area = 0;
    for (let i = 0; i < ATLAS_COLS * ATLAS_ROWS; i++) {
      const r = cellRect(i);
      area += (r.u1 - r.u0) * (r.v1 - r.v0);
    }
    const full = 1 / (ATLAS_COLS * ATLAS_ROWS);
    expect(area).toBeLessThan(1);
    expect(area).toBeGreaterThan(0.99 * 1);
    expect((cellRect(1).u0 - cellRect(0).u1) * W).toBeCloseTo(1, 6);
    expect(full).toBeGreaterThan(0);
  });
});

function recordingContext() {
  const pts: Array<[number, number]> = [];
  const target: Record<string, unknown> = {};
  const g = new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      if (key === 'fillRect' || key === 'strokeRect' || key === 'rect' || key === 'clearRect') {
        return (x: number, y: number, w: number, h: number) => pts.push([x, y], [x + w, y + h]);
      }
      if (key === 'moveTo' || key === 'lineTo') return (x: number, y: number) => pts.push([x, y]);
      if (key === 'arc') return (x: number, y: number) => pts.push([x, y]);
      return () => {};
    },
    set(t, key: string, v) {
      t[key] = v;
      return true;
    },
  });
  return { g: g as unknown as CanvasRenderingContext2D, pts };
}

describe('drawFacadeAtlas', () => {
  it('draws into every cell and stays inside the atlas', () => {
    const { g, pts } = recordingContext();
    drawFacadeAtlas(g, CELL_PX, 7);
    for (let i = 0; i < ATLAS_COLS * ATLAS_ROWS; i++) {
      const x0 = (i % ATLAS_COLS) * CELL_PX;
      const y0 = Math.floor(i / ATLAS_COLS) * CELL_PX;
      const inside = pts.filter(([x, y]) => x >= x0 && x <= x0 + CELL_PX && y >= y0 && y <= y0 + CELL_PX);
      expect(inside.length, `cell ${i}`).toBeGreaterThan(4);
    }
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(H);
    }
  });

  it('is deterministic for a seed', () => {
    const a = recordingContext();
    const b = recordingContext();
    drawFacadeAtlas(a.g, CELL_PX, 3);
    drawFacadeAtlas(b.g, CELL_PX, 3);
    expect(a.pts).toEqual(b.pts);
  });
});
