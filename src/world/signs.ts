import * as THREE from 'three';
import type { DistrictData, GraphEdge, Sign } from '../shared/district';
import { CODE } from '../shared/signCatalogue';
import { pointAlong } from './roadGeometry';

const CURB_GAP = 1;
const PLATE_BOTTOM = 2.2;
const PLATE_SIZE = 0.65;
const CELL_PX = 128;
const COLS = 4;

type Shape = 'circle' | 'triangle' | 'octagon' | 'square';

type SignType = Exclude<keyof typeof CODE, 'children'> | 'school';
const GLYPH_OF_CODE = new Map<string, SignType>(Object.entries(CODE).map(([k, v]) => [v, k === 'children' ? 'school' : k as SignType]));

const SHAPE_OF: Record<SignType, Shape> = {
  stop: 'octagon', giveWay: 'triangle', school: 'triangle',
  priorityRoad: 'square', pedestrianCrossing: 'square',
  noEntry: 'circle', noLeftTurn: 'circle', noRightTurn: 'circle', noUTurn: 'circle', speedLimit: 'circle',
};
const SHAPES: Shape[] = ['circle', 'triangle', 'octagon', 'square'];

/** Atlas cell identity: speed limits get one cell per value. */
export const plateKey = (s: Sign): string => (s.code === CODE.speedLimit ? `speedLimit:${s.value}` : GLYPH_OF_CODE.get(s.code) ?? s.code);

/** Where a sign's pole stands and which way its face points (toward oncoming traffic). */
export function signPose(edge: GraphEdge, s: Sign): { x: number; z: number; heading: number } {
  const pose = pointAlong(edge.points, s.at);
  const travel = s.dir === 1 ? pose.heading : pose.heading + Math.PI;
  const dx = Math.sin(travel), dz = Math.cos(travel), off = edge.width / 2 + CURB_GAP;
  return { x: pose.x - dz * off, z: pose.z + dx * off, heading: travel + Math.PI };
}

const RED = '#d6231e', BLUE = '#1b5fb5', WHITE = '#ffffff', BLACK = '#161616', YELLOW = '#f2c200';

function polygon(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, start: number): void {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = start + (i * 2 * Math.PI) / n;
    const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

function ring(g: CanvasRenderingContext2D, c: number, fill: string): void {
  g.fillStyle = RED;
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fill;
  g.beginPath();
  g.arc(c, c, c * 0.72, 0, Math.PI * 2);
  g.fill();
}

function arrow(g: CanvasRenderingContext2D, kind: 'left' | 'right' | 'uturn', c: number): void {
  g.strokeStyle = BLACK;
  g.fillStyle = BLACK;
  g.lineWidth = c * 0.13;
  g.lineJoin = 'miter';
  const s = kind === 'right' ? -1 : 1;
  g.beginPath();
  if (kind === 'uturn') {
    g.moveTo(c * 0.8, c * 1.5);
    g.lineTo(c * 0.8, c * 0.8);
    g.arc(c, c * 0.8, c * 0.2, Math.PI, 0);
    g.lineTo(c * 1.2, c * 1.15);
    g.stroke();
    g.beginPath();
    g.moveTo(c * 1.2, c * 1.4);
    g.lineTo(c * 1.02, c * 1.12);
    g.lineTo(c * 1.38, c * 1.12);
  } else {
    g.moveTo(c, c * 1.5);
    g.lineTo(c, c * 0.95);
    g.lineTo(c - s * c * 0.28, c * 0.95);
    g.stroke();
    g.beginPath();
    g.moveTo(c - s * c * 0.5, c * 0.95);
    g.lineTo(c - s * c * 0.22, c * 0.72);
    g.lineTo(c - s * c * 0.22, c * 1.18);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = RED;
  g.lineWidth = c * 0.12;
  g.beginPath();
  g.moveTo(c * 0.4, c * 0.4);
  g.lineTo(c * 1.6, c * 1.6);
  g.stroke();
}

function person(g: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  g.fillStyle = BLACK;
  g.strokeStyle = BLACK;
  g.lineWidth = h * 0.12;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, y - h * 0.38, h * 0.1, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(x, y - h * 0.26);
  g.lineTo(x, y + h * 0.1);
  g.moveTo(x - h * 0.16, y - h * 0.12);
  g.lineTo(x + h * 0.16, y - h * 0.12);
  g.moveTo(x, y + h * 0.1);
  g.lineTo(x - h * 0.14, y + h * 0.42);
  g.moveTo(x, y + h * 0.1);
  g.lineTo(x + h * 0.14, y + h * 0.42);
  g.stroke();
}

function drawGlyph(g: CanvasRenderingContext2D, key: string): void {
  const size = CELL_PX, c = size / 2;
  const type = key.split(':')[0] as SignType;
  switch (type) {
    case 'stop':
      g.fillStyle = WHITE;
      polygon(g, c, c, c, 8, Math.PI / 8);
      g.fill();
      g.fillStyle = RED;
      polygon(g, c, c, c * 0.88, 8, Math.PI / 8);
      g.fill();
      g.fillStyle = WHITE;
      g.font = `bold ${size * 0.27}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('STOP', c, c);
      break;
    case 'giveWay':
    case 'school': {
      g.fillStyle = RED;
      polygon(g, c, c, c, 3, Math.PI / 2);
      g.fill();
      g.fillStyle = WHITE;
      polygon(g, c, c + c * 0.12, c * 0.58, 3, Math.PI / 2);
      g.fill();
      if (type === 'school') {
        person(g, c - c * 0.17, c + c * 0.18, c * 0.62);
        person(g, c + c * 0.17, c + c * 0.24, c * 0.46);
      }
      break;
    }
    case 'priorityRoad':
      g.fillStyle = WHITE;
      g.fillRect(0, 0, size, size);
      g.fillStyle = BLACK;
      polygon(g, c, c, c * 0.86, 4, Math.PI / 2);
      g.fill();
      g.fillStyle = WHITE;
      polygon(g, c, c, c * 0.72, 4, Math.PI / 2);
      g.fill();
      g.fillStyle = YELLOW;
      polygon(g, c, c, c * 0.6, 4, Math.PI / 2);
      g.fill();
      break;
    case 'pedestrianCrossing':
      g.fillStyle = WHITE;
      g.fillRect(0, 0, size, size);
      g.fillStyle = BLUE;
      g.fillRect(size * 0.04, size * 0.04, size * 0.92, size * 0.92);
      g.fillStyle = WHITE;
      polygon(g, c, c + c * 0.1, c * 0.7, 3, Math.PI / 2);
      g.fill();
      person(g, c, c + c * 0.12, c * 0.9);
      break;
    case 'noEntry':
      ring(g, c, RED);
      g.fillStyle = WHITE;
      g.fillRect(c * 0.38, c * 0.84, c * 1.24, c * 0.32);
      break;
    case 'noLeftTurn':
    case 'noRightTurn':
    case 'noUTurn':
      ring(g, c, WHITE);
      arrow(g, type === 'noLeftTurn' ? 'left' : type === 'noRightTurn' ? 'right' : 'uturn', c);
      break;
    case 'speedLimit': {
      ring(g, c, WHITE);
      g.fillStyle = BLACK;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold ${size * 0.42}px sans-serif`;
      g.fillText(key.split(':')[1], c, c + size * 0.02);
      break;
    }
  }
}

function plateGeometry(shape: Shape): THREE.BufferGeometry {
  const r = PLATE_SIZE / 2;
  switch (shape) {
    case 'circle': return new THREE.CircleGeometry(r, 32);
    case 'octagon': return new THREE.CircleGeometry(r * 1.04, 8, Math.PI / 8);
    case 'triangle': return new THREE.CircleGeometry(r * 1.2, 3, Math.PI / 2);
    case 'square': return new THREE.PlaneGeometry(PLATE_SIZE, PLATE_SIZE);
  }
}

/** One atlas cell per distinct plate, drawn with canvas vector glyphs; returns the cell column and row for each key. */
function drawAtlas(keys: string[]): { texture: THREE.CanvasTexture; rows: number } {
  const rows = Math.max(1, Math.ceil(keys.length / COLS));
  const canvas = document.createElement('canvas');
  canvas.width = COLS * CELL_PX;
  canvas.height = rows * CELL_PX;
  const g = canvas.getContext('2d')!;
  keys.forEach((key, i) => {
    g.save();
    g.translate((i % COLS) * CELL_PX, Math.floor(i / COLS) * CELL_PX);
    g.beginPath();
    g.rect(0, 0, CELL_PX, CELL_PX);
    g.clip();
    drawGlyph(g, key);
    g.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, rows };
}

function plateMaterial(texture: THREE.Texture, cellSize: THREE.Vector2): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
  mat.onBeforeCompile = shader => {
    shader.uniforms.uCell = { value: cellSize };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'attribute vec2 aCell;\nuniform vec2 uCell;\nvoid main() {')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = uv * uCell + aCell;\n#endif');
    // The back of a plate is plain metal, not a mirrored glyph.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      'vec4 sampledDiffuseColor = texture2D( map, vMapUv );\nif ( !gl_FrontFacing ) sampledDiffuseColor = vec4( 0.55, 0.57, 0.6, 1.0 );\ndiffuseColor *= sampledDiffuseColor;',
    );
  };
  return mat;
}

/** Signs as one pole mesh plus one plate mesh per shape, all plates sharing a single glyph atlas. */
export function addSigns(scene: THREE.Scene, d: DistrictData): void {
  if (!d.signs.length) return;
  const keys = [...new Set(d.signs.map(plateKey))];
  const { texture, rows } = drawAtlas(keys);
  const cellSize = new THREE.Vector2(1 / COLS, 1 / rows);
  const cellOf = (key: string) => {
    const i = keys.indexOf(key);
    return [(i % COLS) / COLS, 1 - (Math.floor(i / COLS) + 1) / rows] as const;
  };

  const edges = new Map(d.graph.edges.map(e => [e.id, e]));
  const placed = d.signs.filter(s => edges.has(s.edgeId));
  const dark = new THREE.MeshLambertMaterial({ color: 0x8a8d91 });
  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.04, 0.04, PLATE_BOTTOM + PLATE_SIZE / 2).translate(0, (PLATE_BOTTOM + PLATE_SIZE / 2) / 2, 0), dark, placed.length,
  );
  const material = plateMaterial(texture, cellSize);
  const plates = SHAPES.map(shape => {
    const own = placed.filter(s => SHAPE_OF[GLYPH_OF_CODE.get(s.code)!] === shape);
    const geo = plateGeometry(shape);
    const cells = new Float32Array(own.length * 2);
    own.forEach((s, i) => cells.set(cellOf(plateKey(s)), i * 2));
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    return { own, mesh: new THREE.InstancedMesh(geo, material, own.length) };
  });

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0), face = new THREE.Vector3(0, 0, 1);
  const flip = new THREE.Quaternion().setFromAxisAngle(face, Math.PI);
  placed.forEach((s, i) => {
    const pose = signPose(edges.get(s.edgeId)!, s);
    q.setFromAxisAngle(up, pose.heading);
    poles.setMatrixAt(i, m.compose(p.set(pose.x, 0, pose.z), q, one));
  });
  for (const { own, mesh } of plates) {
    own.forEach((s, i) => {
      const pose = signPose(edges.get(s.edgeId)!, s);
      q.setFromAxisAngle(up, pose.heading);
      // Give way is the plain triangle turned point-down; its glyph has no orientation.
      if (s.code === CODE.giveWay) q.multiply(flip);
      // Offset along the facing direction so the plate sits in front of the pole.
      p.set(pose.x + Math.sin(pose.heading) * 0.06, PLATE_BOTTOM + PLATE_SIZE / 2, pose.z + Math.cos(pose.heading) * 0.06);
      mesh.setMatrixAt(i, m.compose(p, q, one));
    });
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  poles.frustumCulled = false;
  scene.add(poles);
}
