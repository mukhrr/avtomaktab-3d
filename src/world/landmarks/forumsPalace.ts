import * as THREE from 'three';
import type { Landmark, Vec2 } from '../../shared/district';
import { type LandmarkParts, cap, localFootprint, merge, paint, toLocal, underside, walls } from './common';

export const WALL_HEIGHT = 30;
export const DOME_TOP = 40.2;
const COLUMN_R = 0.75;
const COLUMN_GAP = 1.5;
/** Columns stand 1.5 m in front of the wall and their outer edge stays this far inside the footprint. */
const COLUMN_MARGIN = 0.4;
const INSET = COLUMN_GAP + COLUMN_R + COLUMN_MARGIN;
const COLUMN_SPACING = 5.2;
const ENTABLATURE = 2.2;
const DRUM_R = 18, DRUM_TOP = 32;
const COLLINEAR = 0.02;
const WHITE = 0xf2efe8, GLASS = 0x34465a, ROOF = 0xa9a59c, BLUE = 0x2f6cb3, GOLD = 0xc9a23f;

export interface Side { from: number; to: number; length: number; out: Vec2 }

/** Runs of nearly collinear edges, as vertex index ranges of the CCW polygon. */
export function straightSides(p: Vec2[]): Side[] {
  const n = p.length;
  const dir = (i: number): Vec2 => {
    const a = p[i], b = p[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  };
  const bend = (i: number) => { const a = dir((i + n - 1) % n), b = dir(i); return Math.abs(a[0] * b[1] - a[1] * b[0]); };
  const start = [...Array(n).keys()].find(i => bend(i) > COLLINEAR) ?? 0;
  const sides: Side[] = [];
  let from = start;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (k < n && bend(i) <= COLLINEAR) continue;
    const a = p[from], b = p[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    sides.push({ from, to: i, length: len, out: [(b[1] - a[1]) / len, -(b[0] - a[0]) / len] });
    from = i;
  }
  return sides;
}

/** The longest straight side among those whose outward normal points within 60 degrees of the square. */
export function frontSide(sides: Side[], toSquare: Vec2): Side {
  const facing = sides.filter(s => s.out[0] * toSquare[0] + s.out[1] * toSquare[1] > 0.5);
  return (facing.length ? facing : sides).reduce((a, b) => (b.length > a.length ? b : a));
}

/** Moves the side inward by `inset`; its end vertices slide along the neighbouring edges so the outline stays inside. */
function insetSide(p: Vec2[], s: Side, inset: number): Vec2[] {
  const n = p.length, out = p.map(q => [...q] as Vec2);
  const inward: Vec2 = [-s.out[0], -s.out[1]];
  for (let i = s.from; ; i = (i + 1) % n) {
    if (i === s.from || i === s.to) {
      const other = p[i === s.from ? (i + n - 1) % n : (i + 1) % n];
      const ux = other[0] - p[i][0], uz = other[1] - p[i][1], len = Math.hypot(ux, uz);
      const along = (ux * inward[0] + uz * inward[1]) / len;
      const t = inset / Math.max(along, 0.2);
      out[i] = [p[i][0] + (ux / len) * t, p[i][1] + (uz / len) * t];
    } else {
      out[i] = [p[i][0] + inward[0] * inset, p[i][1] + inward[1] * inset];
    }
    if (i === s.to) break;
  }
  return out;
}

export function forumsPalaceParts(l: Landmark): LandmarkParts {
  const fp = localFootprint(l);
  const square = toLocal(l, [0, 0]);
  const toSquare: Vec2 = [square[0] / Math.hypot(...square), square[1] / Math.hypot(...square)];
  const front = frontSide(straightSides(fp), toSquare);
  const body = insetSide(fp, front, INSET);

  const glassLine = [body[front.from], body[front.to]].map(q => [q[0] + front.out[0] * 0.05, q[1] + front.out[1] * 0.05] as Vec2);
  const glassWall = paint(walls(glassLine, 0, WALL_HEIGHT - ENTABLATURE, undefined, false), GLASS);
  const shell = walls(body, 0, WALL_HEIGHT);
  const parts = [paint(shell, WHITE), paint(cap(body, WALL_HEIGHT), ROOF), glassWall];

  const a = fp[front.from], b = fp[front.to];
  const ux = (b[0] - a[0]) / front.length, uz = (b[1] - a[1]) / front.length;
  const off = INSET - COLUMN_GAP;
  const count = Math.floor((front.length - 2 * INSET) / COLUMN_SPACING) + 1;
  const span = (count - 1) * COLUMN_SPACING;
  const startT = (front.length - span) / 2;
  const colH = WALL_HEIGHT - ENTABLATURE;
  for (let i = 0; i < count; i++) {
    const t = startT + i * COLUMN_SPACING;
    const x = a[0] + ux * t - front.out[0] * off, z = a[1] + uz * t - front.out[1] * off;
    parts.push(paint(new THREE.CylinderGeometry(COLUMN_R, COLUMN_R * 1.08, colH, 12, 1, true).translate(x, colH / 2, z), WHITE));
  }
  const ent = [body[front.from], body[front.to]].map(q => [q[0] + front.out[0] * (off + COLUMN_R), q[1] + front.out[1] * (off + COLUMN_R)] as Vec2);
  const beam: Vec2[] = [ent[0], ent[1], body[front.to], body[front.from]];
  parts.push(paint(walls(beam, colH, WALL_HEIGHT), WHITE), paint(cap(beam, WALL_HEIGHT), WHITE));
  parts.push(paint(underside(beam, colH), WHITE));

  const drum = paint(new THREE.CylinderGeometry(DRUM_R, DRUM_R, DRUM_TOP - WALL_HEIGHT, 48, 1, true).translate(0, (WALL_HEIGHT + DRUM_TOP) / 2, 0), WHITE);
  const domeH = DOME_TOP - DRUM_TOP - 0.6;
  const profile = Array.from({ length: 13 }, (_, i) => {
    const t = (i / 12) * (Math.PI / 2);
    return new THREE.Vector2(Math.max(0.001, DRUM_R * Math.cos(t)), DRUM_TOP + domeH * Math.sin(t));
  });
  const dome = paint(new THREE.LatheGeometry(profile, 48), BLUE);
  const finial = paint(new THREE.ConeGeometry(0.25, 0.6, 8).translate(0, DOME_TOP - 0.3, 0), GOLD);
  parts.push(drum, dome, finial);
  return { solid: merge(parts) };
}
