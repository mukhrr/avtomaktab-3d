import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Indicator } from './cabin';
import { createGaugeCanvas, GAUGE_ASPECT } from './gauges';

export interface CockpitState { speedKmh: number; rpm: number; indicator: Indicator | null; blinkOn: boolean; hazard: boolean; belt: boolean; steer: number; running: boolean }

const WHEEL_LOCK = THREE.MathUtils.degToRad(450);
const REDRAW_S = 1 / 15;
const WHEEL_CENTRE = new THREE.Vector3(0.35, -0.01, 0.3);
const WHEEL_TILT = THREE.MathUtils.degToRad(22);
const WHEEL_RADIUS = 0.18;
const GAUGE_WIDTH = 0.38;

const DASH = 0x1c1d20;
const TRIM = 0x3a3c40;
const BLACK = 0x141416;
const TRIM_LIGHT = 0x7a7e86;

function painted(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  flat.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const colours = new Float32Array(flat.getAttribute('position').count * 3);
  for (let k = 0; k < colours.length; k += 3) colours.set([c.r, c.g, c.b], k);
  flat.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return flat;
}

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number) =>
  painted(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), color);

function bar(a: THREE.Vector3, b: THREE.Vector3, thick: number, color: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(thick, thick, len);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return painted(g, color);
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return g;
}

function dashGeometry(): THREE.BufferGeometry {
  const column = painted(new THREE.CylinderGeometry(0.03, 0.04, 0.32, 10).rotateX(Math.PI / 2).translate(0, 0, 0.16), BLACK)
    .applyMatrix4(new THREE.Matrix4().compose(WHEEL_CENTRE, new THREE.Quaternion().setFromEuler(new THREE.Euler(WHEEL_TILT, 0, 0)), new THREE.Vector3(1, 1, 1)));
  return merged([
    box(-0.84, 0.84, -0.12, 0.12, 0.58, 1.12, DASH),
    // Binnacle hood over the gauges, high enough to clear the eye's line to their top edge.
    box(0.13, 0.57, 0.225, 0.26, 0.48, 0.66, DASH),
    box(0.13, 0.15, 0.0, 0.225, 0.52, 0.66, DASH),
    box(0.55, 0.57, 0.0, 0.225, 0.52, 0.66, DASH),
    box(-0.12, 0.12, -0.45, -0.12, 0.45, 0.8, DASH),
    column,
  ]);
}

/** A-pillars, the header above the windscreen and the roof rails back to the B-pillars. */
function edgeGeometry(): THREE.BufferGeometry {
  return merged([
    bar(new THREE.Vector3(0.77, 0.12, 1.08), new THREE.Vector3(0.66, 0.72, 0.48), 0.06, TRIM),
    bar(new THREE.Vector3(-0.77, 0.12, 1.08), new THREE.Vector3(-0.66, 0.72, 0.48), 0.06, TRIM),
    box(-0.7, 0.7, 0.7, 0.76, 0.38, 0.54, TRIM),
    box(0.62, 0.7, 0.7, 0.76, -0.7, 0.5, TRIM),
    box(-0.7, -0.62, 0.7, 0.76, -0.7, 0.5, TRIM),
    // Rear-view mirror stem, behind the glass so it never covers it.
    box(0.03, 0.07, 0.66, 0.7, 0.56, 0.58, BLACK),
  ]);
}

function wheelGeometry(): THREE.BufferGeometry {
  return merged([
    painted(new THREE.TorusGeometry(WHEEL_RADIUS, 0.016, 8, 32), BLACK),
    // Top-centre stripe: only the upper rim is in frame, so this is what shows the wheel turning.
    painted(new THREE.BoxGeometry(0.012, 0.036, 0.036).translate(0, WHEEL_RADIUS, 0), TRIM_LIGHT),
    painted(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16).rotateX(Math.PI / 2), BLACK),
    ...[Math.PI / 2, -Math.PI / 2, Math.PI].map(a =>
      painted(new THREE.BoxGeometry(0.02, WHEEL_RADIUS, 0.02).translate(0, WHEEL_RADIUS / 2, 0).rotateZ(a), BLACK)),
  ]);
}

/**
 * Driver's view of the interior, in the car's frame (car faces +z, driver at +x). Hangs on the car root rather than
 * the lean pivot, because the eye and mirror glass do too: a leaning dashboard would slide against a fixed eye.
 */
export function createCockpit(now = () => performance.now() / 1000) {
  const root = new THREE.Group();
  root.name = 'cockpit';
  const shellMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const dash = new THREE.Mesh(dashGeometry(), shellMaterial);
  dash.name = 'dashboard';
  const edges = new THREE.Mesh(edgeGeometry(), shellMaterial);
  edges.name = 'bodyEdges';

  const column = new THREE.Group();
  column.position.copy(WHEEL_CENTRE);
  column.rotation.x = WHEEL_TILT;
  const wheel = new THREE.Mesh(wheelGeometry(), shellMaterial);
  wheel.name = 'steeringWheel';
  column.add(wheel);

  const gauges = createGaugeCanvas();
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(GAUGE_WIDTH, GAUGE_WIDTH / GAUGE_ASPECT),
    new THREE.MeshBasicMaterial(gauges ? { map: gauges.texture } : { color: 0x121316 }),
  );
  panel.name = 'gauges';
  panel.position.set(0.35, 0.1, 0.545);
  // Faces the driver, tipped back toward the eye.
  panel.rotation.set(-0.35, Math.PI, 0, 'YXZ');

  root.add(dash, edges, column, panel);
  root.traverse(o => (o.castShadow = o.receiveShadow = false));

  let redraws = 0, lastDraw = -Infinity;
  return {
    root,
    get redraws() {
      return redraws;
    },
    update(s: CockpitState): void {
      wheel.rotation.z = s.steer * WHEEL_LOCK;
      const t = now();
      if (t - lastDraw < REDRAW_S) return;
      lastDraw = t;
      redraws++;
      gauges?.draw(s);
    },
  };
}
