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

/** Cells 18 to 23: alternates for a style's upper or plain bay, and a roof-edge strip. `bay` is the metres of wall one cell covers. */
export type VariantUse = 'upper' | 'plain' | 'parapet';
export interface FacadeVariant { cell: number; style: BuildingStyle | 'any'; bay: number; use: VariantUse }

export const FACADE_VARIANT: Record<'panelBalcony' | 'brickNarrow' | 'stuccoRail' | 'towerSpandrel' | 'parapet' | 'darkGlass', FacadeVariant> = {
  panelBalcony: { cell: 18, style: 'panel', bay: 3.0, use: 'upper' },
  brickNarrow: { cell: 19, style: 'brick', bay: 2.4, use: 'upper' },
  stuccoRail: { cell: 20, style: 'stucco', bay: 3.6, use: 'upper' },
  towerSpandrel: { cell: 21, style: 'tower', bay: 3.0, use: 'plain' },
  parapet: { cell: 22, style: 'any', bay: 3.0, use: 'parapet' },
  darkGlass: { cell: 23, style: 'tower', bay: 3.0, use: 'plain' },
};

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

/** Edge colour per side; a side left out already has its real content at the edge. */
interface Edges { top?: number; bottom?: number; left?: number; right?: number }

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

  /** Paints each side's border in the colour the draw function reports for that edge, so mips do not pull in a neighbour. */
  border(e: Edges): void {
    const b = BORDER_PX;
    if (e.top !== undefined) this.fill(e.top, 0, 0, 256, b);
    if (e.bottom !== undefined) this.fill(e.bottom, 0, 256 - b, 256, b);
    if (e.left !== undefined) this.fill(e.left, 0, 0, b, 256);
    if (e.right !== undefined) this.fill(e.right, 256 - b, 0, b, 256);
  }
}

const GLASS = 0x8fa6b8;
const DARK_FRAME = 0x55606b;

const PANEL_WALL = 0xd3cdc0;
const BRICK_RED = 0x9c4b37;
const BRICK_MORTAR = 0xb7a99a;
const BRICK_STONE = 0xd4cab6;
const STUCCO_WALL = 0xe8dcc0;
const STUCCO_TRIM = 0xf5eedb;
const PUBLIC_WALL = 0xe0d8c6;
const PUBLIC_PILASTER = 0xf0ebdd;
const SHED_WALL = 0xcec5b0;
const TOWER_GLASS = 0x6f8aa0;
const TOWER_GLASS_DARK = 0x4d6376;
const TOWER_SPANDREL = 0x56697a;
const TOWER_PLAIN = 0x58697a;
const TOWER_BAND = 0x2c3944;
const PARAPET_WALL = 0xbdb7aa;
const PARAPET_CAP = 0xa49e91;
const PLINTH = 0.85;

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
  c.fill(shade(wall, PLINTH), 0, 246, 256, 10);
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

function panel(c: Cell, kind: 'ground' | 'upper' | 'plain' | 'balcony', rand: () => number): Edges {
  const base = PANEL_WALL;
  concrete(c, base, rand);
  if (kind === 'ground') shopFront(c, base, 0xa9573c);
  panelSeams(c, base);
  if (kind === 'balcony') {
    c.fill(shade(base, 0.86), 0, 150, 256, 70);
    c.fill(shade(base, 0.6), 0, 216, 256, 6);
    for (let x = 16; x < 250; x += 20) c.line(shade(base, 0.55), x, 156, x, 214, 3);
    c.line(shade(base, 0.55), 0, 156, 256, 156, 4);
    c.window(78, 28, 100, 100, DARK_FRAME, GLASS, 'cross');
  } else if (kind === 'upper') {
    c.window(78, 62, 100, 100, DARK_FRAME, GLASS, 'cross');
    c.fill(shade(base, 0.7), 66, 172, 124, 8);
  }
  return { top: base, bottom: kind === 'ground' ? shade(base, PLINTH) : base, left: base, right: base };
}

function brick(c: Cell, kind: 'ground' | 'upper' | 'plain' | 'narrow', rand: () => number): Edges {
  c.fill(BRICK_MORTAR, 0, 0, 256, 256);
  const bw = 32;
  const bh = 16;
  for (let row = 0; row < 256 / bh; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -off; x < 256; x += bw) {
      const x0 = Math.max(0, x);
      const x1 = Math.min(256, x + bw);
      c.fill(shade(BRICK_RED, 0.85 + rand() * 0.3), x0 + 1, row * bh + 1, x1 - x0 - 2, bh - 2);
    }
  }
  const stone = BRICK_STONE;
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
  // The brick courses run to the cell edge and tile as they are.
  return {};
}

function stucco(c: Cell, kind: 'ground' | 'upper' | 'plain' | 'rail', rand: () => number): Edges {
  const cream = STUCCO_WALL;
  c.fill(cream, 0, 0, 256, 256);
  for (let i = 0; i < 24; i++) c.fill(shade(cream, 0.97 + rand() * 0.04), rand() * 230, rand() * 230, 14 + rand() * 24, 10 + rand() * 18);
  const trim = STUCCO_TRIM;
  if (kind === 'ground') {
    shopFront(c, cream, 0x7c4a3a);
    c.fill(trim, 0, 0, 14, 256);
    c.fill(trim, 242, 0, 14, 256);
  }
  c.fill(trim, 0, 0, 256, 20);
  c.fill(shade(cream, 0.8), 0, 20, 256, 5);
  if (kind === 'upper' || kind === 'rail') {
    c.fill(trim, 76, 56, 104, 148);
    c.window(88, 68, 80, 120, 0x6b6257, GLASS, 'mid');
    c.fill(shade(cream, 0.78), 70, 208, 116, 8);
    if (kind === 'rail') {
      for (let x = 78; x < 180; x += 14) c.line(0x4d4a46, x, 190, x, 206, 3);
      c.line(0x4d4a46, 76, 190, 180, 190, 3);
    }
  }
  const ground = kind === 'ground';
  return { top: trim, bottom: ground ? shade(cream, PLINTH) : cream, left: ground ? trim : cream, right: ground ? trim : cream };
}

function pilasters(c: Cell, wall: number): void {
  const light = PUBLIC_PILASTER;
  for (const x of [0, 228]) {
    c.fill(light, x, 0, 28, 256);
    c.fill(shade(wall, 0.8), x === 0 ? 28 : 228 - 4, 0, 4, 256);
    c.fill(shade(light, 0.85), x, 0, 28, 8);
  }
}

function publicBay(c: Cell, kind: 'ground' | 'upper' | 'plain', rand: () => number): Edges {
  const wall = PUBLIC_WALL;
  concrete(c, wall, rand);
  if (kind === 'ground') {
    shopFront(c, wall, 0x4f6b73);
  } else if (kind === 'upper') {
    c.window(78, 40, 100, 176, 0x5b5a56, GLASS, 'cross');
    c.fill(PUBLIC_PILASTER, 64, 26, 128, 8);
    c.fill(shade(wall, 0.75), 66, 222, 124, 8);
  }
  pilasters(c, wall);
  // Pilasters fill both side edges and the cell is the same left to right at top and bottom, so nothing needs a border.
  return {};
}

function tower(c: Cell, kind: 'ground' | 'upper' | 'plain' | 'spandrel' | 'dark'): Edges {
  const glass = kind === 'dark' || kind === 'ground' ? TOWER_GLASS_DARK : TOWER_GLASS;
  const solid = kind === 'plain' || kind === 'spandrel';
  c.fill(glass, 0, 0, 256, 256);
  c.poly(0xffffff, [[0, 190], [150, 0], [210, 0], [0, 256]], 0.1);
  c.poly(0xffffff, [[120, 256], [256, 90], [256, 140], [160, 256]], 0.07);
  if (solid) c.fill(TOWER_PLAIN, 0, 0, 256, 256);
  else c.fill(TOWER_SPANDREL, 0, 218, 256, 38);
  if (kind !== 'plain') c.poly(0xffffff, [[0, 210], [100, 150], [140, 150], [30, 256]], 0.05);
  for (const x of [0, 64, 128, 192, 252]) c.fill(0x3e4c59, x, 0, 4, 256);
  c.fill(0x3e4c59, 0, 214, 256, 5);
  if (kind === 'ground') {
    c.fill(TOWER_BAND, 0, 0, 256, 30);
    c.fill(TOWER_BAND, 0, 244, 256, 12);
  }
  // Mullions stand on both side edges, so only the top and bottom get a border.
  if (kind === 'ground') return { top: TOWER_BAND, bottom: TOWER_BAND };
  return { top: solid ? TOWER_PLAIN : glass, bottom: solid ? TOWER_PLAIN : TOWER_SPANDREL };
}

function shed(c: Cell, kind: 'ground' | 'upper' | 'plain', rand: () => number): Edges {
  const wall = SHED_WALL;
  concrete(c, wall, rand);
  c.fill(shade(wall, PLINTH), 0, 240, 256, 16);
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
  return { top: wall, bottom: shade(wall, PLINTH), left: wall, right: wall };
}

function parapet(c: Cell, rand: () => number): Edges {
  concrete(c, PARAPET_WALL, rand);
  c.fill(PARAPET_CAP, 0, 0, 256, 30);
  c.fill(0xd9d4c8, 0, 30, 256, 10);
  c.fill(0x8f897d, 0, 40, 256, 6);
  // Every row is a single colour across the cell, so the side edges already match.
  return { top: PARAPET_CAP, bottom: PARAPET_WALL };
}

/** Draws every atlas cell (6 by 4); no text or logos anywhere. */
export function drawFacadeAtlas(g: CanvasRenderingContext2D, cellPx: number, seed: number): void {
  const rand = rng(seed);
  const k = cellPx / CELL_PX;
  const V = FACADE_VARIANT;
  const draws: Array<[number, (c: Cell) => Edges]> = [
    [FACADE_CELL.panel.ground, c => panel(c, 'ground', rand)],
    [FACADE_CELL.panel.upper, c => panel(c, 'upper', rand)],
    [FACADE_CELL.panel.plain, c => panel(c, 'plain', rand)],
    [FACADE_CELL.brick.ground, c => brick(c, 'ground', rand)],
    [FACADE_CELL.brick.upper, c => brick(c, 'upper', rand)],
    [FACADE_CELL.brick.plain, c => brick(c, 'plain', rand)],
    [FACADE_CELL.stucco.ground, c => stucco(c, 'ground', rand)],
    [FACADE_CELL.stucco.upper, c => stucco(c, 'upper', rand)],
    [FACADE_CELL.stucco.plain, c => stucco(c, 'plain', rand)],
    [FACADE_CELL.public.ground, c => publicBay(c, 'ground', rand)],
    [FACADE_CELL.public.upper, c => publicBay(c, 'upper', rand)],
    [FACADE_CELL.public.plain, c => publicBay(c, 'plain', rand)],
    [FACADE_CELL.tower.ground, c => tower(c, 'ground')],
    [FACADE_CELL.tower.upper, c => tower(c, 'upper')],
    [FACADE_CELL.tower.plain, c => tower(c, 'plain')],
    [FACADE_CELL.shed.ground, c => shed(c, 'ground', rand)],
    [FACADE_CELL.shed.upper, c => shed(c, 'upper', rand)],
    [FACADE_CELL.shed.plain, c => shed(c, 'plain', rand)],
    [V.panelBalcony.cell, c => ({ ...panel(c, 'balcony', rand), left: undefined, right: undefined })],
    [V.brickNarrow.cell, c => brick(c, 'narrow', rand)],
    [V.stuccoRail.cell, c => stucco(c, 'rail', rand)],
    [V.towerSpandrel.cell, c => tower(c, 'spandrel')],
    [V.parapet.cell, c => parapet(c, rand)],
    [V.darkGlass.cell, c => tower(c, 'dark')],
  ];
  for (const [index, draw] of draws) {
    const cell = new Cell(g, (index % ATLAS_COLS) * cellPx, Math.floor(index / ATLAS_COLS) * cellPx, k);
    cell.border(draw(cell));
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
