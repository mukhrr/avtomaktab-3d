import * as THREE from 'three';
import type { BuildingStyle } from '../shared/district';

export const ATLAS_COLS = 6;
export const ATLAS_ROWS = 4;
const CELL_PX = 256;
const BORDER_PX = 4;

export const FACADE_CELL: Record<BuildingStyle, { ground: number; upper: number; plain: number }> = {
  panel: { ground: 0, upper: 1, plain: 2 },
  brick: { ground: 3, upper: 4, plain: 5 },
  stucco: { ground: 6, upper: 7, plain: 8 },
  public: { ground: 9, upper: 10, plain: 11 },
  tower: { ground: 12, upper: 13, plain: 14 },
  shed: { ground: 15, upper: 16, plain: 17 },
};

/** Cells 18 to 23 are variants of the above, picked per bay so rows do not repeat. */
export const FACADE_VARIANT = { panelBalcony: 18, brickNarrow: 19, stuccoRail: 20, towerSpandrel: 21, parapet: 22, darkGlass: 23 };

export const BAY_WIDTH: Record<BuildingStyle, number> = { panel: 3.0, brick: 3.4, stucco: 3.6, public: 4.2, tower: 3.0, shed: 6.0 };

export function cellRect(index: number): { u0: number; v0: number; u1: number; v1: number } {
  const w = ATLAS_COLS * CELL_PX;
  const h = ATLAS_ROWS * CELL_PX;
  const col = index % ATLAS_COLS;
  const row = Math.floor(index / ATLAS_COLS);
  return {
    u0: (col * CELL_PX + 0.5) / w,
    u1: ((col + 1) * CELL_PX - 0.5) / w,
    v0: 1 - ((row + 1) * CELL_PX - 0.5) / h,
    v1: 1 - (row * CELL_PX + 0.5) / h,
  };
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function shade(color: number, f: number): number {
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((color >> s) & 255) * f)));
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

/** Draws in 256-unit cell coordinates, scaled to the real cell size and offset to the cell. */
class Cell {
  constructor(readonly g: CanvasRenderingContext2D, readonly ox: number, readonly oy: number, readonly k: number) {}

  fill(color: number, x: number, y: number, w: number, h: number): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(256, x + w);
    const y1 = Math.min(256, y + h);
    if (x1 <= x0 || y1 <= y0) return;
    this.g.fillStyle = hex(color);
    this.g.fillRect(this.ox + x0 * this.k, this.oy + y0 * this.k, (x1 - x0) * this.k, (y1 - y0) * this.k);
  }

  line(color: number, x0: number, y0: number, x1: number, y1: number, width = 2): void {
    const { g, k } = this;
    g.strokeStyle = hex(color);
    g.lineWidth = width * k;
    g.beginPath();
    g.moveTo(this.ox + x0 * k, this.oy + y0 * k);
    g.lineTo(this.ox + x1 * k, this.oy + y1 * k);
    g.stroke();
  }

  poly(color: number, pts: Array<[number, number]>, alpha = 1): void {
    const { g, k } = this;
    g.globalAlpha = alpha;
    g.fillStyle = hex(color);
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(this.ox + x * k, this.oy + y * k) : g.moveTo(this.ox + x * k, this.oy + y * k)));
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
  }

  /** Window with a frame, glass, a sky-reflection streak and an optional cross bar. */
  window(x: number, y: number, w: number, h: number, frame: number, glass: number, bars: 'none' | 'cross' | 'mid' = 'cross'): void {
    this.fill(frame, x - 6, y - 6, w + 12, h + 12);
    this.fill(glass, x, y, w, h);
    this.poly(0xffffff, [[x, y + h * 0.55], [x + w * 0.6, y], [x + w, y], [x, y + h]], 0.14);
    if (bars === 'cross' || bars === 'mid') this.line(frame, x + w / 2, y, x + w / 2, y + h, 4);
    if (bars === 'cross') this.line(frame, x, y + h * 0.4, x + w, y + h * 0.4, 4);
  }

  /** Keeps the outer texels the wall colour so mip levels blend into the wall, not the neighbouring cell. */
  border(color: number): void {
    const b = BORDER_PX;
    this.fill(color, 0, 0, 256, b);
    this.fill(color, 0, 256 - b, 256, b);
    this.fill(color, 0, 0, b, 256);
    this.fill(color, 256 - b, 0, b, 256);
  }
}

const GLASS = 0x8fa6b8;
const DARK_FRAME = 0x55606b;

function awning(c: Cell, color: number, y = 30, h = 36): void {
  c.fill(color, 14, y, 228, h);
  for (let x = 14; x < 242; x += 38) c.fill(shade(color, 0.82), x + 19, y, 19, h);
  c.fill(shade(color, 0.6), 14, y + h, 228, 4);
}

function shopFront(c: Cell, wall: number, awningColor: number): void {
  c.fill(wall, 0, 0, 256, 256);
  awning(c, awningColor);
  c.fill(shade(wall, 0.7), 14, 76, 228, 170);
  c.fill(0x9db6c6, 20, 82, 216, 158);
  c.poly(0xffffff, [[20, 200], [120, 82], [170, 82], [20, 240]], 0.14);
  c.line(DARK_FRAME, 128, 82, 128, 240, 4);
  c.fill(0x4b3a2e, 150, 120, 52, 120);
  c.fill(shade(wall, 0.85), 0, 246, 256, 10);
}

function concrete(c: Cell, base: number, rand: () => number): void {
  c.fill(base, 0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    c.fill(shade(base, 0.96 + rand() * 0.06), rand() * 240, rand() * 240, 6 + rand() * 20, 4 + rand() * 12);
  }
}

function panelSeams(c: Cell, base: number): void {
  const seam = shade(base, 0.8);
  c.line(seam, 8, 0, 8, 256, 3);
  c.line(seam, 248, 0, 248, 256, 3);
  c.line(seam, 0, 6, 256, 6, 3);
  c.line(seam, 0, 250, 256, 250, 3);
}

function panel(c: Cell, kind: 'ground' | 'upper' | 'plain' | 'balcony', rand: () => number): void {
  const base = 0xd3cdc0;
  if (kind === 'ground') {
    concrete(c, base, rand);
    shopFront(c, base, 0xa9573c);
    panelSeams(c, base);
    return;
  }
  concrete(c, base, rand);
  panelSeams(c, base);
  if (kind === 'plain') return;
  if (kind === 'balcony') {
    c.fill(shade(base, 0.86), 0, 150, 256, 70);
    c.fill(shade(base, 0.6), 0, 216, 256, 6);
    for (let x = 16; x < 250; x += 20) c.line(shade(base, 0.55), x, 156, x, 214, 3);
    c.line(shade(base, 0.55), 0, 156, 256, 156, 4);
    c.window(78, 28, 100, 100, DARK_FRAME, GLASS, 'cross');
    return;
  }
  c.window(78, 62, 100, 100, DARK_FRAME, GLASS, 'cross');
  c.fill(shade(base, 0.7), 66, 172, 124, 8);
}

function brick(c: Cell, kind: 'ground' | 'upper' | 'plain' | 'narrow', rand: () => number): void {
  const mortar = 0xb7a99a;
  c.fill(mortar, 0, 0, 256, 256);
  const bw = 32;
  const bh = 16;
  for (let row = 0; row < 256 / bh; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -off; x < 256; x += bw) {
      const x0 = Math.max(0, x);
      const x1 = Math.min(256, x + bw);
      c.fill(shade(0x9c4b37, 0.85 + rand() * 0.3), x0 + 1, row * bh + 1, x1 - x0 - 2, bh - 2);
    }
  }
  const stone = 0xd4cab6;
  if (kind === 'upper') {
    c.fill(stone, 72, 34, 112, 14);
    c.window(88, 56, 80, 150, 0x4a3b32, GLASS, 'mid');
    c.fill(stone, 74, 212, 108, 10);
  } else if (kind === 'narrow') {
    c.fill(stone, 90, 40, 76, 12);
    c.window(104, 60, 48, 130, 0x4a3b32, GLASS, 'none');
    c.fill(stone, 92, 196, 72, 10);
  } else if (kind === 'ground') {
    c.fill(stone, 56, 40, 144, 18);
    c.fill(0x2e2a28, 66, 58, 124, 198);
    c.fill(0x5d3f2b, 86, 80, 84, 176);
    c.line(0x2e2a28, 128, 80, 128, 256, 4);
    c.fill(stone, 56, 240, 144, 16);
  }
}

function stucco(c: Cell, kind: 'ground' | 'upper' | 'plain' | 'rail', rand: () => number): void {
  const cream = 0xe8dcc0;
  c.fill(cream, 0, 0, 256, 256);
  for (let i = 0; i < 24; i++) c.fill(shade(cream, 0.97 + rand() * 0.04), rand() * 230, rand() * 230, 14 + rand() * 24, 10 + rand() * 18);
  const trim = 0xf5eedb;
  c.fill(trim, 0, 0, 256, 20);
  c.fill(shade(cream, 0.8), 0, 20, 256, 5);
  if (kind === 'ground') {
    shopFront(c, cream, 0x7c4a3a);
    c.fill(trim, 0, 0, 256, 20);
    c.fill(shade(cream, 0.8), 0, 20, 256, 5);
    c.fill(trim, 0, 0, 14, 256);
    c.fill(trim, 242, 0, 14, 256);
    return;
  }
  if (kind === 'upper' || kind === 'rail') {
    c.fill(trim, 76, 56, 104, 148);
    c.window(88, 68, 80, 120, 0x6b6257, GLASS, 'mid');
    c.fill(shade(cream, 0.78), 70, 208, 116, 8);
    if (kind === 'rail') {
      for (let x = 78; x < 180; x += 14) c.line(0x4d4a46, x, 190, x, 206, 3);
      c.line(0x4d4a46, 76, 190, 180, 190, 3);
    }
  }
}

function pilasters(c: Cell, wall: number): void {
  const light = 0xf0ebdd;
  for (const x of [0, 228]) {
    c.fill(light, x, 0, 28, 256);
    c.fill(shade(wall, 0.8), x === 0 ? 28 : 228 - 4, 0, 4, 256);
    c.fill(shade(light, 0.85), x, 0, 28, 8);
  }
}

function publicBay(c: Cell, kind: 'ground' | 'upper' | 'plain', rand: () => number): void {
  const wall = 0xe0d8c6;
  concrete(c, wall, rand);
  if (kind === 'ground') {
    shopFront(c, wall, 0x4f6b73);
  } else if (kind === 'upper') {
    c.window(78, 40, 100, 176, 0x5b5a56, GLASS, 'cross');
    c.fill(0xf0ebdd, 64, 26, 128, 8);
    c.fill(shade(wall, 0.75), 66, 222, 124, 8);
  }
  pilasters(c, wall);
}

function tower(c: Cell, kind: 'ground' | 'upper' | 'plain' | 'spandrel' | 'dark'): void {
  const glass = kind === 'dark' || kind === 'ground' ? 0x4d6376 : 0x6f8aa0;
  c.fill(glass, 0, 0, 256, 256);
  c.poly(0xffffff, [[0, 190], [150, 0], [210, 0], [0, 256]], 0.1);
  c.poly(0xffffff, [[120, 256], [256, 90], [256, 140], [160, 256]], 0.07);
  if (kind === 'plain' || kind === 'spandrel') c.fill(0x58697a, 0, 0, 256, 256);
  else c.fill(0x56697a, 0, 218, 256, 38);
  if (kind !== 'plain') c.poly(0xffffff, [[0, 210], [100, 150], [140, 150], [30, 256]], 0.05);
  for (const x of [0, 64, 128, 192, 252]) c.fill(0x3e4c59, x, 0, 4, 256);
  c.fill(0x3e4c59, 0, 214, 256, 5);
  if (kind === 'ground') {
    c.fill(0x2c3944, 0, 0, 256, 30);
    c.fill(0x2c3944, 0, 244, 256, 12);
  }
}

function shed(c: Cell, kind: 'ground' | 'upper' | 'plain', rand: () => number): void {
  const wall = 0xcec5b0;
  concrete(c, wall, rand);
  c.fill(shade(wall, 0.85), 0, 240, 256, 16);
  if (kind === 'upper') {
    c.fill(0x4f5a62, 30, 70, 196, 40);
    c.fill(GLASS, 34, 74, 188, 32);
    for (const x of [97, 160]) c.line(0x4f5a62, x, 74, x, 106, 3);
  } else if (kind === 'ground') {
    c.fill(0x4a4a48, 36, 56, 184, 200);
    c.fill(0x8e9296, 42, 62, 172, 194);
    for (let y = 78; y < 256; y += 24) c.line(0x6f7377, 42, y, 214, y, 3);
    c.fill(0x6f7377, 120, 236, 16, 8);
  }
}

function parapet(c: Cell, rand: () => number): void {
  concrete(c, 0xbdb7aa, rand);
  c.fill(0xa49e91, 0, 0, 256, 30);
  c.fill(0xd9d4c8, 0, 30, 256, 10);
  c.fill(0x8f897d, 0, 40, 256, 6);
}

/** Draws every atlas cell (6 by 4); no text or logos anywhere. */
export function drawFacadeAtlas(g: CanvasRenderingContext2D, cellPx: number, seed: number): void {
  const rand = rng(seed);
  const k = cellPx / CELL_PX;
  const draws: Array<[number, number, (c: Cell) => void]> = [
    [FACADE_CELL.panel.ground, 0xd3cdc0, c => panel(c, 'ground', rand)],
    [FACADE_CELL.panel.upper, 0xd3cdc0, c => panel(c, 'upper', rand)],
    [FACADE_CELL.panel.plain, 0xd3cdc0, c => panel(c, 'plain', rand)],
    [FACADE_CELL.brick.ground, 0x9c4b37, c => brick(c, 'ground', rand)],
    [FACADE_CELL.brick.upper, 0x9c4b37, c => brick(c, 'upper', rand)],
    [FACADE_CELL.brick.plain, 0x9c4b37, c => brick(c, 'plain', rand)],
    [FACADE_CELL.stucco.ground, 0xe8dcc0, c => stucco(c, 'ground', rand)],
    [FACADE_CELL.stucco.upper, 0xe8dcc0, c => stucco(c, 'upper', rand)],
    [FACADE_CELL.stucco.plain, 0xe8dcc0, c => stucco(c, 'plain', rand)],
    [FACADE_CELL.public.ground, 0xe0d8c6, c => publicBay(c, 'ground', rand)],
    [FACADE_CELL.public.upper, 0xe0d8c6, c => publicBay(c, 'upper', rand)],
    [FACADE_CELL.public.plain, 0xe0d8c6, c => publicBay(c, 'plain', rand)],
    [FACADE_CELL.tower.ground, 0x4d6376, c => tower(c, 'ground')],
    [FACADE_CELL.tower.upper, 0x6f8aa0, c => tower(c, 'upper')],
    [FACADE_CELL.tower.plain, 0x58697a, c => tower(c, 'plain')],
    [FACADE_CELL.shed.ground, 0xcec5b0, c => shed(c, 'ground', rand)],
    [FACADE_CELL.shed.upper, 0xcec5b0, c => shed(c, 'upper', rand)],
    [FACADE_CELL.shed.plain, 0xcec5b0, c => shed(c, 'plain', rand)],
    [FACADE_VARIANT.panelBalcony, 0xd3cdc0, c => panel(c, 'balcony', rand)],
    [FACADE_VARIANT.brickNarrow, 0x9c4b37, c => brick(c, 'narrow', rand)],
    [FACADE_VARIANT.stuccoRail, 0xe8dcc0, c => stucco(c, 'rail', rand)],
    [FACADE_VARIANT.towerSpandrel, 0x58697a, c => tower(c, 'spandrel')],
    [FACADE_VARIANT.parapet, 0xbdb7aa, c => parapet(c, rand)],
    [FACADE_VARIANT.darkGlass, 0x4d6376, c => tower(c, 'dark')],
  ];
  for (const [index, edge, draw] of draws) {
    const cell = new Cell(g, (index % ATLAS_COLS) * cellPx, Math.floor(index / ATLAS_COLS) * cellPx, k);
    draw(cell);
    cell.border(edge);
  }
}

export function createFacadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL_PX;
  canvas.height = ATLAS_ROWS * CELL_PX;
  drawFacadeAtlas(canvas.getContext('2d')!, CELL_PX, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
