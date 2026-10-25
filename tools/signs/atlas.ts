import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp, { type OverlayOptions } from 'sharp';
import type { Sign } from '../../src/shared/district';
import { loadCatalogue, plateKey, type CatalogueEntry, type ValueKind } from '../../src/shared/signCatalogue';

/** uv rect in 0..1 with v measured up from the bottom of the image (the default three.js flipY orientation); size is the sign in metres. */
export interface AtlasCell { u: number; v: number; w: number; h: number; size: [number, number] }
export type Atlas = { width: number; height: number; cells: Record<string, AtlasCell> };

export const SPEEDS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const PX_PER_M = 160;
const PAD = 4;
const WIDTHS = [1024, 2048, 4096];

const EXAMPLE: Record<Exclude<ValueKind, 'speed' | 'text'>, number | string> = {
  mass: 3.5, height: 3.5, width: 2.5, length: 10, distance: 100, time: '8-19',
};
const TEXT_EXAMPLE: Record<string, string> = {
  '5.20.1': '500', '5.20.2': '39', '5.22': 'Chirchiq', '5.29.1': '39', '5.29.2': '39', '7.20': '3', '7.24': '1234',
};

type Variant = { key: string; value: number | string | undefined };

/** The values an entry is drawn with in the atlas, plus any value a district sign uses. */
export function variantsOf(e: CatalogueEntry, used: Variant[] = []): Variant[] {
  let base: (number | string | undefined)[];
  if (e.valueKind === null) base = [undefined];
  else if (e.valueKind === 'speed') base = SPEEDS;
  else if (e.valueKind === 'text') {
    if (!TEXT_EXAMPLE[e.number]) throw new Error(`atlas: ${e.number} is a text sign with no example string`);
    base = [TEXT_EXAMPLE[e.number]];
  } else base = [EXAMPLE[e.valueKind]];
  const out = new Map<string, Variant>();
  for (const value of base) out.set(plateKey(e.number, value), { key: plateKey(e.number, value), value });
  for (const u of used) if (u.key.split(':')[0] === e.number && u.value !== undefined) out.set(u.key, u);
  return [...out.values()];
}

export function valuesUsedBy(signs: Sign[]): Variant[] {
  const out: Variant[] = [];
  for (const s of signs) {
    for (const p of [{ code: s.code, value: s.value }, ...(s.plates ?? [])]) {
      if (p.value !== undefined) out.push({ key: plateKey(p.code, p.value), value: p.value });
    }
  }
  return out;
}

export function packAtlas(items: { key: string; px: [number, number] }[], width: number, pad: number): Record<string, { x: number; y: number }> {
  const sorted = [...items].sort((a, b) => b.px[1] - a.px[1]);
  const out: Record<string, { x: number; y: number }> = {};
  let x = 0, y = 0, shelf = 0;
  for (const { key, px: [w, h] } of sorted) {
    const fw = w + 2 * pad, fh = h + 2 * pad;
    if (fw > width) throw new Error(`atlas: ${key} is ${w} px wide, wider than the ${width} px sheet`);
    if (x + fw > width) { y += shelf; x = 0; shelf = 0; }
    out[key] = { x: x + pad, y: y + pad };
    x += fw;
    shelf = Math.max(shelf, fh);
  }
  return out;
}

export function checkAtlasCovers(signs: Sign[], atlas: Atlas): void {
  for (const s of signs) {
    for (const p of [{ code: s.code, value: s.value }, ...(s.plates ?? [])]) {
      const key = plateKey(p.code, p.value);
      if (!atlas.cells[key]) throw new Error(`sign ${s.id} needs atlas cell "${key}", which the atlas does not have`);
    }
  }
}

export async function assertTextRenders(): Promise<void> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="70"><text x="6" y="58" font-family="Arial, Helvetica, 'Liberation Sans', sans-serif" font-weight="bold" font-size="60" fill="#000">88</text></svg>`;
  const { channels } = await sharp(Buffer.from(svg)).stats();
  if (!(channels[3].mean > 0)) {
    throw new Error('atlas: sharp drew no pixels for <text>; install Arial, Helvetica or Liberation Sans for fontconfig before rasterising signs');
  }
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Raster { data: Buffer; w: number; h: number }

const sizes = new Map<string, [number, number]>();

/** The catalogue size, or when the art's own proportions disagree with it by more than 5%, the largest size of the art's proportions that fits inside it. */
export async function sizeOf(e: CatalogueEntry): Promise<[number, number]> {
  const known = sizes.get(e.number);
  if (known) return known;
  const meta = await sharp(readFileSync(e.art!.file), { limitInputPixels: 1e8 }).metadata().catch((err: Error) => {
    throw new Error(`atlas: ${e.number} (${e.art!.file}): ${err.message}`);
  });
  if (!meta.width || !meta.height) throw new Error(`atlas: ${e.number} (${e.art!.file}): has no intrinsic size`);
  const [cw, ch] = e.size;
  let size = e.size;
  if (Math.abs(meta.width / meta.height / (cw / ch) - 1) > 0.05) {
    const k = Math.min(cw / meta.width, ch / meta.height);
    size = [Math.round(meta.width * k * 1000) / 1000, Math.round(meta.height * k * 1000) / 1000];
    console.warn(`atlas: ${e.number} art is ${meta.width}x${meta.height} but the catalogue size is ${cw}x${ch} m; using ${size.join('x')} m`);
  }
  sizes.set(e.number, size);
  return size;
}

async function rasterise(e: CatalogueEntry, value: number | string | undefined, pxPerM: number): Promise<Raster> {
  const file = e.art!.file;
  const size = await sizeOf(e);
  const w = Math.round(size[0] * pxPerM), h = Math.round(size[1] * pxPerM);
  try {
    let svg = readFileSync(file, 'utf8');
    if (value !== undefined) {
      if (!svg.includes('{value}')) throw new Error('has no {value} slot');
      svg = svg.split('{value}').join(xmlEscape(String(value)));
    }
    const input = Buffer.from(svg);
    const meta = await sharp(input, { limitInputPixels: 1e8 }).metadata();
    if (!meta.width || !meta.height) throw new Error('has no intrinsic size');
    const density = Math.min(2400, Math.max(72, 72 * 2 * Math.max(w / meta.width, h / meta.height)));
    const data = await sharp(input, { density, limitInputPixels: 1e8 }).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    return { data, w, h };
  } catch (err) {
    throw new Error(`atlas: ${e.number} (${file}): ${(err as Error).message}`);
  }
}

async function padded(r: Raster, pad: number): Promise<Raster> {
  const data = await sharp(r.data, { raw: { width: r.w, height: r.h, channels: 4 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: 'copy' })
    .raw().toBuffer();
  return { data, w: r.w + 2 * pad, h: r.h + 2 * pad };
}

const gpuBytes = (w: number, h: number) => (w * h * 4 * 4) / 3;

function chooseSheet(items: { key: string; px: [number, number] }[]) {
  let best: { width: number; height: number; at: Record<string, { x: number; y: number }> } | null = null;
  for (const width of WIDTHS) {
    if (items.some(i => i.px[0] + 2 * PAD > width)) continue;
    const at = packAtlas(items, width, PAD);
    const used = Math.max(...items.map(i => at[i.key].y + i.px[1] + PAD));
    const height = Math.ceil(used / 4) * 4;
    const better = !best || width * height < best.width * best.height ||
      (width * height === best.width * best.height && Math.max(width, height) < Math.max(best.width, best.height));
    if (better) best = { width, height, at };
  }
  if (!best) throw new Error('atlas: no sheet width fits the cells');
  return best;
}

export function exemptSvg(e: CatalogueEntry, pxPerM: number): string {
  const w = Math.round(e.size[0] * pxPerM), h = Math.round(e.size[1] * pxPerM);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#8a8f96"/>` +
    `<text x="${w / 2}" y="${h / 2 - 8}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="bold" fill="#fff">exempt</text>` +
    `<text x="${w / 2}" y="${h / 2 + 24}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" fill="#fff">${xmlEscape(e.exempt ?? 'no art')}</text></svg>`;
}

function wrap(text: string, perLine: number, lines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > perLine) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  out.push(line);
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].replace(/.{0,2}$/, '…'); }
  return out;
}

function labelSvg(e: CatalogueEntry, w: number): string {
  const rows = wrap(e.name.uz, Math.floor(w / 11), 3);
  const font = `font-family="Arial, Helvetica, 'Liberation Sans', sans-serif"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="104"><text x="${w / 2}" y="26" text-anchor="middle" ${font} font-weight="bold" font-size="26" fill="#111">${e.number}</text>` +
    rows.map((r, i) => `<text x="${w / 2}" y="${52 + i * 24}" text-anchor="middle" ${font} font-size="20" fill="#222">${xmlEscape(r)}</text>`).join('') + '</svg>';
}

async function contactSheet(entries: CatalogueEntry[], used: Variant[], out: string): Promise<void> {
  const scale = PX_PER_M * 2, sheetW = 4000, gap = 28, labelH = 104;
  const boxes: { e: CatalogueEntry; w: number; h: number }[] = [];
  for (const e of entries) {
    const size = e.art ? await sizeOf(e) : e.size;
    boxes.push({ e, w: Math.round(size[0] * scale), h: Math.round(size[1] * scale) });
  }
  const places: { e: CatalogueEntry; x: number; y: number; bw: number; w: number; h: number }[] = [];
  let x = gap, y = gap, rowH = 0;
  for (const b of boxes) {
    const bw = Math.max(b.w, 230);
    if (x + bw + gap > sheetW) { x = gap; y += rowH + gap; rowH = 0; }
    places.push({ ...b, x, y, bw });
    x += bw + gap;
    rowH = Math.max(rowH, b.h + 10 + labelH);
  }
  const sheetH = y + rowH + gap;
  const layers: OverlayOptions[] = [];
  for (const p of places) {
    const left = p.x + Math.round((p.bw - p.w) / 2);
    if (p.e.art) {
      const v = variantsOf(p.e, used);
      const shown = p.e.valueKind === 'speed' ? v.find(c => c.value === 60)! : v[0];
      const r = await rasterise(p.e, shown.value, scale);
      layers.push({ input: r.data, raw: { width: r.w, height: r.h, channels: 4 }, left, top: p.y });
    } else {
      layers.push({ input: Buffer.from(exemptSvg(p.e, scale)), left, top: p.y });
    }
    layers.push({ input: Buffer.from(labelSvg(p.e, p.bw)), left: p.x, top: p.y + p.h + 10 });
  }
  mkdirSync(out.slice(0, out.lastIndexOf('/')), { recursive: true });
  await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#d9dde2' } })
    .composite(layers).png({ compressionLevel: 9 }).toFile(out);
}

function districtSigns(): Sign[] {
  const root = 'data/districts';
  return readdirSync(root).flatMap(d => (existsSync(`${root}/${d}/signs.json`) ? (JSON.parse(readFileSync(`${root}/${d}/signs.json`, 'utf8')) as Sign[]) : []));
}

export async function buildAtlas(): Promise<void> {
  await assertTextRenders();
  const catalogue = loadCatalogue();
  const used = valuesUsedBy(districtSigns());
  const cells: { key: string; e: CatalogueEntry; value: number | string | undefined }[] = [];
  const sizeOfCell = new Map<string, [number, number]>();
  for (const e of catalogue.filter(x => x.art)) for (const v of variantsOf(e, used)) cells.push({ key: v.key, e, value: v.value });

  const rasters = new Map<string, Raster>();
  for (const c of cells) {
    rasters.set(c.key, await rasterise(c.e, c.value, PX_PER_M));
    sizeOfCell.set(c.key, await sizeOf(c.e));
  }
  const items = cells.map(c => ({ key: c.key, px: [rasters.get(c.key)!.w, rasters.get(c.key)!.h] as [number, number] }));
  const { width, height, at } = chooseSheet(items);

  const sheet = Buffer.alloc(width * height * 4);
  const atlas: Atlas = { width, height, cells: {} };
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  for (const c of cells) {
    const r = rasters.get(c.key)!;
    const p = await padded(r, PAD);
    const { x, y } = at[c.key];
    for (let row = 0; row < p.h; row++) {
      p.data.copy(sheet, ((y - PAD + row) * width + (x - PAD)) * 4, row * p.w * 4, (row + 1) * p.w * 4);
    }
    atlas.cells[c.key] = { u: round(x / width), v: round(1 - (y + r.h) / height), w: round(r.w / width), h: round(r.h / height), size: sizeOfCell.get(c.key)! };
  }
  mkdirSync('public/signs', { recursive: true });
  await sharp(sheet, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, palette: false }).toFile('public/signs/atlas.png');
  writeFileSync('public/signs/atlas.json', JSON.stringify(atlas));
  const png = statSync('public/signs/atlas.png').size;
  console.info(`atlas ${width}x${height}, ${cells.length} cells, PNG ${(png / 1048576).toFixed(2)} MB, GPU ~${(gpuBytes(width, height) / 1048576).toFixed(1)} MB with mips`);

  await contactSheet(catalogue, used, 'docs/visuals/m5a/contact-sheet.png');
  console.info(`contact sheet ${(statSync('docs/visuals/m5a/contact-sheet.png').size / 1048576).toFixed(2)} MB`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await buildAtlas();
