import * as THREE from 'three';
import type { CockpitState } from './cockpit';

/** Needle angles in radians, clockwise from 12 o'clock. */
export const DIAL_START = THREE.MathUtils.degToRad(-135);
export const DIAL_END = THREE.MathUtils.degToRad(135);

export const SPEED_MAX = 200;
export const RPM_MAX = 7000;
const RPM_RED = 6200;

export const needleAngle = (value: number, max: number) =>
  DIAL_START + THREE.MathUtils.clamp(value / max, 0, 1) * (DIAL_END - DIAL_START);

const W = 512;
const H = 256;
const R = 104;
const TACHO: [number, number] = [116, 128];
const SPEEDO: [number, number] = [W - 116, 128];
const LAMP_OFF = '#2a2c30';

const at = (cx: number, cy: number, a: number, r: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

function dial(g: CanvasRenderingContext2D, [cx, cy]: [number, number], max: number, major: number, minor: number, label: (v: number) => string, red?: number) {
  g.fillStyle = '#0b0c0e';
  g.beginPath();
  g.arc(cx, cy, R + 6, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#5a5e66';
  g.lineWidth = 3;
  g.stroke();
  // Canvas arcs start at 3 o'clock, our angles at 12.
  if (red !== undefined) {
    g.strokeStyle = '#d0302a';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(cx, cy, R - 6, needleAngle(red, max) - Math.PI / 2, DIAL_END - Math.PI / 2);
    g.stroke();
  }
  g.fillStyle = g.strokeStyle = '#e8ecef';
  g.font = 'bold 17px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let v = 0; v <= max + 1e-6; v += minor) {
    const a = needleAngle(v, max), big = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    const [x0, y0] = at(cx, cy, a, R - (big ? 16 : 9)), [x1, y1] = at(cx, cy, a, R - 2);
    g.lineWidth = big ? 3 : 1.5;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    if (big) g.fillText(label(v), ...at(cx, cy, a, R - 32));
  }
}

function needle(g: CanvasRenderingContext2D, [cx, cy]: [number, number], a: number) {
  const [x, y] = at(cx, cy, a, R - 10), [bx, by] = at(cx, cy, a + Math.PI, 14);
  g.strokeStyle = '#ff6a2a';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(bx, by);
  g.lineTo(x, y);
  g.stroke();
  g.fillStyle = '#30333a';
  g.beginPath();
  g.arc(cx, cy, 9, 0, Math.PI * 2);
  g.fill();
}

function arrow(g: CanvasRenderingContext2D, x: number, y: number, dir: number, lit: boolean) {
  g.fillStyle = lit ? '#3ddc5a' : LAMP_OFF;
  g.beginPath();
  g.moveTo(x + dir * 16, y);
  g.lineTo(x - dir * 2, y - 14);
  g.lineTo(x - dir * 2, y - 6);
  g.lineTo(x - dir * 14, y - 6);
  g.lineTo(x - dir * 14, y + 6);
  g.lineTo(x - dir * 2, y + 6);
  g.lineTo(x - dir * 2, y + 14);
  g.closePath();
  g.fill();
}

function hazard(g: CanvasRenderingContext2D, x: number, y: number, lit: boolean) {
  g.strokeStyle = lit ? '#ff4d3a' : LAMP_OFF;
  g.lineWidth = 4;
  for (const r of [16, 8]) {
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r * 0.95, y + r * 0.6);
    g.lineTo(x - r * 0.95, y + r * 0.6);
    g.closePath();
    g.stroke();
  }
}

function belt(g: CanvasRenderingContext2D, x: number, y: number, lit: boolean) {
  g.fillStyle = g.strokeStyle = lit ? '#ff4d3a' : LAMP_OFF;
  g.beginPath();
  g.arc(x, y - 11, 5, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(x - 7, y + 14);
  g.lineTo(x - 5, y - 3);
  g.lineTo(x + 6, y - 3);
  g.lineTo(x + 8, y + 14);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x - 9, y - 6);
  g.lineTo(x + 9, y + 10);
  g.stroke();
}

function engine(g: CanvasRenderingContext2D, x: number, y: number, lit: boolean) {
  g.fillStyle = lit ? '#ffb020' : LAMP_OFF;
  g.fillRect(x - 13, y - 7, 22, 14);
  g.fillRect(x - 8, y - 12, 10, 5);
  g.fillRect(x + 9, y - 3, 6, 6);
  g.fillRect(x - 18, y - 3, 5, 6);
}

/** Dial faces, ticks and captions: everything that never changes, drawn once and copied in on each redraw. */
function drawFace(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#121316';
  g.fillRect(0, 0, W, H);
  dial(g, TACHO, RPM_MAX, 1000, 500, v => String(v / 1000), RPM_RED);
  dial(g, SPEEDO, SPEED_MAX, 20, 10, v => String(v));
  g.fillStyle = '#9aa0a8';
  g.font = '12px system-ui, sans-serif';
  g.fillText('x1000 rpm', TACHO[0], TACHO[1] + 44);
  g.fillText('km/h', SPEEDO[0], SPEEDO[1] + 44);
}

function drawLive(g: CanvasRenderingContext2D, s: CockpitState): void {
  g.fillStyle = '#e8ecef';
  g.font = 'bold 20px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(Math.round(s.speedKmh)), SPEEDO[0], SPEEDO[1] + 66);
  needle(g, TACHO, needleAngle(s.running ? s.rpm : 0, RPM_MAX));
  needle(g, SPEEDO, needleAngle(s.speedKmh, SPEED_MAX));

  // Lamps sit in the top half of the centre strip; the steering wheel rim covers the bottom half.
  const mid = W / 2;
  arrow(g, mid - 18, 26, -1, s.blinkOn && (s.indicator === 'left' || s.hazard));
  arrow(g, mid + 18, 26, 1, s.blinkOn && (s.indicator === 'right' || s.hazard));
  hazard(g, mid, 66, s.hazard && s.blinkOn);
  belt(g, mid, 104, !s.belt);
  engine(g, mid, 138, !s.running);
}

export function createGaugeCanvas(): { texture: THREE.DataTexture; draw(s: CockpitState): void } | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  // Software canvas: uploading a GPU-backed canvas cost about 6 ms of gpu time per redraw on the reference Mac.
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const face = document.createElement('canvas');
  face.width = W;
  face.height = H;
  const fg = face.getContext('2d');
  if (!g || !fg) return null;
  drawFace(fg);
  const texture = new THREE.DataTexture(new Uint8Array(W * H * 4), W, H, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  return {
    texture,
    draw(s) {
      g.drawImage(face, 0, 0);
      drawLive(g, s);
      // The readback is allocated by the canvas anyway, so the texture takes it instead of copying it.
      texture.image.data = g.getImageData(0, 0, W, H).data as unknown as Uint8Array;
      texture.needsUpdate = true;
    },
  };
}

export const GAUGE_ASPECT = W / H;
