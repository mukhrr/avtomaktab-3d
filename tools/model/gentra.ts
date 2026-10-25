import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Document, NodeIO, PropertyType, type Material, type Primitive, type Texture, type mat4 } from '@gltf-transform/core';
import { dedup, joinPrimitives, prune, textureCompress, transformPrimitive, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { LAMP_GROUPS, type LampGroup } from '../../src/vehicle/lamps';

const RAW = 'assets-src/gentra/raw/scene.gltf';
const OUT = 'public/models/gentra.glb';
/** Half width of the player's physics box; the body shell is scaled across to fit it. */
export const HALF_WIDTH = 0.87;
const MIRRORS = ['obj96_Material6_0', 'obj97_Material6_0'];
const STEERING_WHEEL = 'obj180_Material   585_0';
// A boot-lid racing wing, not on any stock Lacetti or Gentra, and out of place on a driving school car.
const WING = 'obj85_Material6_0';
/** Badge geometry, found as small loose parts at the grille and boot centre: node, Y-up box (min, max), triangles. */
export const BADGE_PARTS: { node: string; what: string; box: [number[], number[]]; tris: number }[] = [
  { node: 'obj109_Material6_0', what: 'front bowtie, 13 x 4.5 cm on the grille bar', box: [[-0.07, 0.585, 2.115], [0.07, 0.64, 2.14]], tris: 44 },
  { node: 'obj165_Material6_0', what: 'boot lid centre emblem plate, 7 x 2 cm', box: [[-0.04, 0.8, -2.08], [0.04, 0.825, -2.06]], tris: 6 },
];

export type Group = 'paint' | 'chrome' | 'shell' | 'lamp' | 'interior' | 'glass' | 'wheel' | 'drop' | LampGroup;
export const BODY_GROUPS = ['paint', 'chrome', 'shell', 'interior', 'glass', ...LAMP_GROUPS] as const;

export const MATERIAL_GROUPS: Record<string, Group> = {
  'Material.006': 'paint', SideLights: 'paint', Suspension: 'paint',
  chrome: 'chrome',
  Material___593: 'shell', Material11: 'shell',
  HeadLights: 'lamp', Material___586: 'lamp',
  Material___585: 'interior',
  Material4: 'glass', Material8: 'glass', Material14: 'glass',
  Tread: 'wheel', Sidewall: 'wheel', Material5: 'wheel', Material7: 'wheel',
  // The roof aerial alone carries a 2048 px RGBA copy of the body atlas.
  Aerials: 'drop',
};

/** Wheel slot in the game's WHEEL_POSITIONS order: front right, front left, rear right, rear left (+x is the car's left). */
export function wheelIndex(x: number, z: number): number {
  return (z > 0 ? 0 : 2) + (x > 0 ? 1 : 0);
}

export type LensColour = 'amber' | 'red' | 'white' | 'grey' | 'green';

/** Colour class of a lamp texel, 0-255 sRGB; green is the atlas's unused background. */
export function lensColour([r, g, b]: number[]): LensColour {
  if (g > 120 && r < 90 && b < 90) return 'green';
  if (r > 180 && g > 80 && g < 190 && b < 110 && r - g > 40) return 'amber';
  if (r > 120 && g < 90 && b < 90) return 'red';
  if (r > 150 && g > 150 && b > 150) return 'white';
  return 'grey';
}

/**
 * Lamp function of one lamp triangle at height `y`. The headlamp units carry the front indicator as an amber and red
 * ring. In the tail lamps the clear and chrome cells above REVERSE_TOP are the indicators and those below it the
 * reverse lamps; the rest is tail and brake. No side repeaters and no third brake lamp in this model.
 */
export function lampGroup(material: string, colour: LensColour, x: number, y: number): LampGroup {
  const indicator = x > 0 ? 'indicatorLeft' : 'indicatorRight';
  if (material === 'HeadLights') return colour === 'amber' || colour === 'red' ? indicator : 'head';
  if (colour === 'red' || colour === 'green') return 'tail';
  return y > REVERSE_TOP ? indicator : 'reverse';
}

const REVERSE_TOP = 0.78;

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linear = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(c => srgbToLinear(c / 255));

interface Img { data: Buffer; w: number; h: number }

async function decode(t: Texture): Promise<Img> {
  const { data, info } = await sharp(t.getImage()!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

async function encode(t: Texture, img: Img): Promise<void> {
  t.setImage(new Uint8Array(await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).png().toBuffer()));
  t.setMimeType('image/png');
}

function median(img: Img, pixels: number[]): number[] {
  return [0, 1, 2, 3].map(c => {
    const v = pixels.map(p => img.data[p * 4 + c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
}

function fill(img: Img, pixels: number[], rgba: number[]): void {
  for (const p of pixels) img.data.set(rgba, p * 4);
}

/** Paints over the gold bowtie inside `box` (x0, y0, x1, y1) with the median colour of a ring just outside it. */
function eraseGold(img: Img, [x0, y0, x1, y1]: number[], grow = 5): number {
  const gold = (p: number) => {
    const [r, g, b] = img.data.subarray(p * 4, p * 4 + 3);
    return r > 150 && g > 120 && r - b > 50 && Math.abs(r - g) < 70;
  };
  const near = (x: number, y: number, d: number) => {
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= x0 - 2 && X <= x1 + 2 && Y >= y0 - 2 && Y <= y1 + 2 && gold(Y * img.w + X)) return true;
    }
    return false;
  };
  const mask: number[] = [], ring: number[] = [];
  for (let y = y0 - grow - 4; y <= y1 + grow + 4; y++) for (let x = x0 - grow - 4; x <= x1 + grow + 4; x++) {
    if (near(x, y, grow)) mask.push(y * img.w + x);
    else if (near(x, y, grow + 4)) ring.push(y * img.w + x);
  }
  fill(img, mask, median(img, ring));
  return mask.length;
}

/** Fills a rectangle with the median of its own border. */
function eraseRect(img: Img, [x0, y0, x1, y1]: number[]): void {
  const inside: number[] = [], border: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    (x === x0 || x === x1 || y === y0 || y === y1 ? border : inside).push(y * img.w + x);
  }
  fill(img, inside, median(img, border));
}

/** Fills part of a ring around the texture centre: radii r0..r1, columns x0..x1, one half (top or bottom). */
function eraseArc(img: Img, r0: number, r1: number, x0: number, x1: number, top: boolean, colour: number[]): void {
  const cx = img.w / 2, cy = img.h / 2, px: number[] = [];
  for (let y = 0; y < img.h; y++) for (let x = x0; x <= x1; x++) {
    const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (r >= r0 && r <= r1 && (y < cy) === top) px.push(y * img.w + x);
  }
  fill(img, px, colour);
}

function rawTexel(img: Img, u: number, v: number): number[] {
  const wrap = (t: number) => t - Math.floor(t);
  const p = (Math.min(img.h - 1, Math.floor(wrap(v) * img.h)) * img.w + Math.min(img.w - 1, Math.floor(wrap(u) * img.w))) * 4;
  return [img.data[p], img.data[p + 1], img.data[p + 2]];
}

/** New primitives sharing `prim`'s vertices, one per key, each with the triangles `key` assigns to it. */
function splitTriangles(doc: Document, prim: Primitive, key: (t: number) => string): Map<string, Primitive> {
  const idx = prim.getIndices()!, lists = new Map<string, number[]>();
  for (let t = 0; t < idx.getCount() / 3; t++) {
    const k = key(t);
    if (!lists.has(k)) lists.set(k, []);
    lists.get(k)!.push(idx.getScalar(t * 3), idx.getScalar(t * 3 + 1), idx.getScalar(t * 3 + 2));
  }
  const buffer = doc.getRoot().listBuffers()[0];
  return new Map([...lists].map(([k, list]) => [k, prim.clone().setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(buffer))]));
}

function texel(img: Img, x: number, y: number): number[] {
  const p = (y * img.w + x) * 4;
  return [0, 1, 2].map(c => srgbToLinear(img.data[p + c] / 255));
}

function sample(img: Img, u: number, v: number): number[] {
  const wrap = (t: number) => t - Math.floor(t);
  return texel(img, Math.min(img.w - 1, Math.floor(wrap(u) * img.w)), Math.min(img.h - 1, Math.floor(wrap(v) * img.h)));
}

function bounds(prims: Primitive[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], v = [0, 0, 0];
  for (const p of prims) {
    const pos = p.getAttribute('POSITION')!;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
    }
  }
  return { min, max };
}

const centroid = (prims: Primitive[]) => { const b = bounds(prims); return b.min.map((m, k) => (m + b.max[k]) / 2); };
const tris = (p: Primitive) => (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;

function setColours(doc: Document, prim: Primitive, colour: (i: number) => number[], size: 3 | 4): void {
  const n = prim.getAttribute('POSITION')!.getCount();
  const out = new Float32Array(n * size);
  for (let i = 0; i < n; i++) out.set(colour(i).slice(0, size), i * size);
  prim.setAttribute('COLOR_0', doc.createAccessor().setType(size === 4 ? 'VEC4' : 'VEC3').setArray(out).setBuffer(doc.getRoot().listBuffers()[0]));
}

function pointUvAt(doc: Document, prim: Primitive, uv: number[]): void {
  const n = prim.getAttribute('POSITION')!.getCount();
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) out.set(uv, i * 2);
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(out).setBuffer(doc.getRoot().listBuffers()[0]));
}

const translate = (x: number, y: number, z: number): mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

export interface Stats {
  tris: number;
  bytes: number;
  scaleX: number;
  bodyHalfWidth: number;
  wheels: { index: number; centre: number[]; radius: number }[];
  materials: { material: string; group: Group; meshes: number; tris: number; area: number }[];
  badges: string[];
}

export async function buildGentra(raw = RAW, out = OUT): Promise<Stats> {
  const io = new NodeIO();
  const doc = await io.read(raw);
  const root = doc.getRoot();

  // Bake every node's world transform (the Sketchfab root turns Z-up into Y-up) into its primitives.
  const named: { name: string; prim: Primitive; material: string; group: Group }[] = [];
  const positions = new Set<unknown>();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')!;
      if (positions.has(pos)) throw new Error(`shared POSITION accessor on ${node.getName()}`);
      positions.add(pos);
      transformPrimitive(prim, world);
      const material = prim.getMaterial()?.getName() ?? '';
      named.push({ name: node.getName(), prim, material, group: MATERIAL_GROUPS[material] });
    }
  }
  const badges: string[] = [];
  for (const b of BADGE_PARTS) {
    const removed = removeParts(named.find(n => n.name === b.node)!.prim, b.box);
    if (removed !== b.tris) throw new Error(`${b.node}: removed ${removed} badge triangles, expected ${b.tris}`);
    badges.push(`${b.node}: ${b.what}, ${removed} triangles removed`);
  }
  for (const m of new Set(named.map(n => n.material))) if (!(m in MATERIAL_GROUPS)) throw new Error(`unmapped material ${m}`);

  const table = new Map<string, Stats['materials'][number]>();
  for (const n of named) {
    const row = table.get(n.material) ?? { material: n.material, group: MATERIAL_GROUPS[n.material], meshes: 0, tris: 0, area: 0 };
    row.meshes++;
    row.tris += tris(n.prim);
    row.area += area(n.prim);
    table.set(n.material, row);
  }

  let kept = named.filter(n => n.group !== 'drop' && n.name !== WING);
  const body = kept.filter(n => !MIRRORS.includes(n.name)).map(n => n.prim);
  const all = bounds(kept.map(n => n.prim)), shell = bounds(body);
  const cx = (shell.min[0] + shell.max[0]) / 2, cz = (all.min[2] + all.max[2]) / 2;
  const bodyHalfWidth = Math.max(shell.max[0] - cx, cx - shell.min[0]);
  const scaleX = Math.min(1, HALF_WIDTH / bodyHalfWidth);
  const fit: mat4 = [scaleX, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -cx * scaleX, -all.min[1], -cz, 1];
  for (const n of kept) transformPrimitive(n.prim, fit);

  const byName = (name: string) => kept.find(n => n.name === name)!.prim;
  if (centroid([byName(STEERING_WHEEL)])[0] <= 0) throw new Error('steering wheel is not on +x, the model is mirrored');
  if (centroid(kept.filter(n => n.material === 'HeadLights').map(n => n.prim))[2] <= 0) throw new Error('headlights are not at +z');

  // Badges: gold bowties and CHEVROLET lettering baked into the textures, found by colour and by eye.
  const textures = new Map(root.listTextures().map(t => [t.getURI(), t]));
  const tex = (name: string) => [...textures.entries()].find(([uri]) => uri.includes(name))![1];
  const atlas = await decode(tex('Material___593'));
  const lamps = await decode(tex('HeadLights'));
  const sidewall = await decode(tex('Sidewall'));

  kept = kept.flatMap(n => {
    if (n.group !== 'lamp') return [n];
    const uv = n.prim.getAttribute('TEXCOORD_0')!, pos = n.prim.getAttribute('POSITION')!, idx = n.prim.getIndices()!;
    const split = splitTriangles(doc, n.prim, t => {
      const ids = [0, 1, 2].map(k => idx.getScalar(t * 3 + k));
      const u = ids.map(i => uv.getElement(i, [0, 0]));
      const wild = Math.max(...u.map(p => p[0])) - Math.min(...u.map(p => p[0])) > 0.5;
      const colour = wild ? 'grey' : lensColour(rawTexel(lamps, (u[0][0] + u[1][0] + u[2][0]) / 3, (u[0][1] + u[1][1] + u[2][1]) / 3));
      const c = ids.map(i => pos.getElement(i, [0, 0, 0])).reduce((a, p) => a.map((v, k) => v + p[k] / 3), [0, 0, 0]);
      return lampGroup(n.material, colour, c[0], c[1]);
    });
    return [...split].map(([group, prim]) => ({ ...n, prim, group: group as Group }));
  });
  for (const g of LAMP_GROUPS) if (!kept.some(n => n.group === g)) throw new Error(`no triangles for lamp group ${g}`);
  const suspension = await decode(tex('Suspension'));
  badges.push(`Material___593 bowtie at px 887-1002 x 1284-1343: ${eraseGold(atlas, [887, 1284, 1002, 1343])} px repainted`);
  eraseRect(atlas, [760, 1840, 845, 1885]);
  badges.push('Material___593 under-bonnet CHEVROLET lettering and bowtie at px 760-845 x 1840-1885: repainted');
  badges.push(`HeadLights bowtie at px 744-791 x 232-253: ${eraseGold(lamps, [744, 232, 791, 253])} px repainted`);
  const lip = median(sidewall, ring(sidewall, 186));
  eraseArc(sidewall, 179, 196, 205, 308, true, lip);
  eraseArc(sidewall, 179, 196, 205, 308, false, lip);
  badges.push('Sidewall rim lip CHEVROLET lettering and bowtie, top and bottom, r 179-196 px: repainted');
  badges.push('Suspension brake caliper bowtie and CHEVROLET: texture dropped, baked to vertex colours');
  await encode(tex('Material___593'), atlas);
  await encode(tex('HeadLights'), lamps);
  await encode(tex('Sidewall'), sidewall);

  // Wheel parts share the sidewall texture: untextured parts point their UVs at a tyre or rim-lip texel and carry the rest as vertex colour.
  const TYRE = [16, 256], LIP = [69, 256];
  const tyreTexel = texel(sidewall, TYRE[0], TYRE[1]), lipTexel = texel(sidewall, LIP[0], LIP[1]);
  if (Math.max(...tyreTexel) > 0.05 || Math.min(...lipTexel) < 0.5) throw new Error(`wheel texels moved: tyre ${tyreTexel} lip ${lipTexel}`);
  const uvOf = (px: number[]) => [(px[0] + 0.5) / sidewall.w, (px[1] + 0.5) / sidewall.h];
  const over = (c: number[], t: number[]) => c.map((x, k) => Math.min(1, x / t[k]));
  const factor = (m: Material | null) => (m?.getBaseColorFactor() ?? [1, 1, 1, 1]);

  for (const n of kept) {
    const group = n.group, p = n.prim, mat = p.getMaterial();
    if (group === 'paint') {
      if (n.material === 'Suspension') {
        const uv = p.getAttribute('TEXCOORD_0')!;
        setColours(doc, p, i => sample(suspension, ...(uv.getElement(i, [0, 0]) as [number, number])), 3);
      } else {
        const c = factor(mat);
        setColours(doc, p, () => c, 3);
      }
    } else if (group === 'glass') {
      const rgba = n.material === 'Material4' ? [0.04, 0.05, 0.06, 0.7] : n.material === 'Material8' ? [0.55, 0.02, 0.02, 0.45] : [0.8, 0.8, 0.8, 0.25];
      setColours(doc, p, () => rgba, 4);
    } else if (group === 'wheel') {
      if (n.material === 'Sidewall') setColours(doc, p, () => [1, 1, 1], 3);
      else if (n.material === 'Tread') {
        pointUvAt(doc, p, uvOf(TYRE));
        setColours(doc, p, () => [1, 1, 1], 3);
      } else if (n.material === 'Material5') {
        pointUvAt(doc, p, uvOf(LIP));
        const c = over(factor(mat), lipTexel);
        setColours(doc, p, () => c, 3);
      } else {
        const uv = p.getAttribute('TEXCOORD_0')!;
        const baked = Array.from({ length: uv.getCount() }, (_, i) => over(sample(lamps, ...(uv.getElement(i, [0, 0]) as [number, number])), lipTexel));
        pointUvAt(doc, p, uvOf(LIP));
        setColours(doc, p, i => baked[i], 3);
      }
    }
    if (group === 'paint' || group === 'chrome' || group === 'glass') p.setAttribute('TEXCOORD_0', null);
    p.setAttribute('TEXCOORD_1', null);
  }

  const material = (name: string) => doc.createMaterial(name).setDoubleSided(true).setMetallicFactor(0);
  const mats = {
    paint: material('paint').setBaseColorFactor([...linear(0xf4f4f2), 1] as [number, number, number, number]).setRoughnessFactor(0.35).setMetallicFactor(0.3),
    chrome: material('chrome').setBaseColorFactor([0.8, 0.8, 0.8, 1]).setRoughnessFactor(0.2).setMetallicFactor(1),
    shell: material('shell').setBaseColorTexture(tex('Material___593')).setRoughnessFactor(0.6),
    ...Object.fromEntries(LAMP_GROUPS.map(g => [g, material(g).setBaseColorTexture(tex('HeadLights')).setEmissiveTexture(tex('HeadLights'))
      .setEmissiveFactor([1, 1, 1]).setRoughnessFactor(0.3)])) as Record<LampGroup, Material>,
    interior: material('interior').setBaseColorTexture(tex('Material___585')).setRoughnessFactor(0.8),
    glass: material('glass').setAlphaMode('BLEND').setRoughnessFactor(0.05),
    wheel: material('wheel').setBaseColorTexture(tex('Sidewall')).setRoughnessFactor(0.7),
  };

  const oldNodes = root.listNodes();
  const scene = root.listScenes()[0];
  for (const child of scene.listChildren()) scene.removeChild(child);
  const bodyNode = doc.createNode('body');
  scene.addChild(bodyNode);
  for (const g of BODY_GROUPS) {
    const prims = kept.filter(n => n.group === g).map(n => n.prim);
    for (const p of prims) p.setMaterial(mats[g]);
    const mesh = doc.createMesh(g).addPrimitive(joinPrimitives(prims));
    bodyNode.addChild(doc.createNode(g).setMesh(mesh));
  }

  const wheels: Stats['wheels'] = [];
  const wheelParts = kept.filter(n => n.group === 'wheel').map(n => {
    const c = centroid([n.prim]);
    return { ...n, index: wheelIndex(c[0], c[2]) };
  });
  for (let index = 0; index < 4; index++) {
    const parts = wheelParts.filter(n => n.index === index);
    if (parts.length !== 4) throw new Error(`wheel ${index} has ${parts.length} parts`);
    const tread = bounds(parts.filter(n => n.material === 'Tread').map(n => n.prim));
    const centre = tread.min.map((m, k) => (m + tread.max[k]) / 2);
    const radius = (tread.max[1] - tread.min[1]) / 2;
    for (const n of parts) {
      n.prim.setMaterial(mats.wheel);
      transformPrimitive(n.prim, translate(-centre[0], -centre[1], -centre[2]));
    }
    const node = doc.createNode(`wheel_${index}`).setTranslation(centre as [number, number, number])
      .setMesh(doc.createMesh(`wheel_${index}`).addPrimitive(joinPrimitives(parts.map(n => n.prim))));
    scene.addChild(node);
    wheels.push({ index, centre: centre.map(round), radius: round(radius) });
  }
  if (wheels.some(w => w.radius < 0.28 || w.radius > 0.33)) throw new Error(`wheel radius off: ${JSON.stringify(wheels)}`);

  for (const node of oldNodes) node.dispose();

  const stats: Omit<Stats, 'tris' | 'bytes'> = {
    scaleX: round(scaleX), bodyHalfWidth: round(bodyHalfWidth * scaleX), wheels,
    materials: [...table.values()].map(r => ({ ...r, area: round(r.area) })), badges,
  };
  scene.setExtras({ source: 'Lacetti by uzb_rx7, CC-BY-4.0', scaleX: stats.scaleX, bodyHalfWidth: stats.bodyHalfWidth, wheels });

  await doc.transform(
    prune(),
    // Lamp groups share one texture and factors but must keep a material each.
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 85 }),
    prune(),
  );

  const total = root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + tris(p), 0), 0);
  if (total > 25000) throw new Error(`${total} triangles`);
  mkdirSync(dirname(out), { recursive: true });
  await io.write(out, doc);
  return { ...stats, tris: total, bytes: statSync(out).size };
}

/** Drops the connected parts of `prim` whose bounds fit inside `box`; returns the triangles removed. */
function removeParts(prim: Primitive, [lo, hi]: [number[], number[]]): number {
  const pos = prim.getAttribute('POSITION')!, idx = prim.getIndices()!;
  const n = pos.getCount(), parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => { parent[find(a)] = find(b); };
  const seen = new Map<string, number>(), v = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const key = pos.getElement(i, v).map(x => Math.round(x * 1e4)).join();
    if (seen.has(key)) join(i, seen.get(key)!);
    else seen.set(key, i);
  }
  for (let t = 0; t < idx.getCount(); t += 3) { join(idx.getScalar(t), idx.getScalar(t + 1)); join(idx.getScalar(t), idx.getScalar(t + 2)); }
  const outside = new Set<number>();
  for (let i = 0; i < n; i++) {
    pos.getElement(i, v);
    if (v.some((x, k) => x < lo[k] || x > hi[k])) outside.add(find(i));
  }
  const kept: number[] = [];
  for (let t = 0; t < idx.getCount(); t += 3) {
    if (outside.has(find(idx.getScalar(t)))) kept.push(idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2));
  }
  const removed = idx.getCount() / 3 - kept.length / 3;
  idx.setArray(new Uint32Array(kept));
  return removed;
}

function ring(img: Img, r: number): number[] {
  const out: number[] = [];
  for (let a = 0; a < 360; a += 2) {
    const t = (a * Math.PI) / 180;
    out.push(Math.round(img.h / 2 + r * Math.sin(t)) * img.w + Math.round(img.w / 2 + r * Math.cos(t)));
  }
  return out;
}

function area(p: Primitive): number {
  const pos = p.getAttribute('POSITION')!, idx = p.getIndices();
  const n = idx ? idx.getCount() : pos.getCount();
  const at = (i: number) => pos.getElement(idx ? idx.getScalar(i) : i, [0, 0, 0]);
  let s = 0;
  for (let i = 0; i < n; i += 3) {
    const a = at(i), b = at(i + 1), c = at(i + 2);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    s += 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
  }
  return s;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await buildGentra();
  console.log(`${OUT}: ${(s.bytes / 1024 / 1024).toFixed(2)} MB, ${s.tris} triangles, x scale ${s.scaleX}, body half width ${s.bodyHalfWidth} m`);
  console.table(s.materials);
  console.table(s.wheels.map(w => ({ index: w.index, x: w.centre[0], y: w.centre[1], z: w.centre[2], radius: w.radius })));
  for (const b of s.badges) console.log(`badge: ${b}`);
}
