import * as THREE from 'three';
import { applyModeLayers, CAR_LAYER, COCKPIT_LAYER, DRIVER_EYE } from '../camera/cameras';
import { MIRROR_SPECS } from '../camera/mirrors';
import { createCockpit } from './cockpit';
import { DIAL_END, DIAL_START, needleAngle } from './gauges';

const idle = { speedKmh: 0, rpm: 800, indicator: null, blinkOn: false, hazard: false, belt: true, steer: 0, running: true };

const meshes = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.updateMatrixWorld(true);
  o.traverse(c => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); });
  return out;
};

const corners = (spec: (typeof MIRROR_SPECS)[number]) => {
  const [x, y, z] = spec.quad, [w, h] = spec.quadSize;
  // Pulled 1 cm toward the eye side of the glass, so only geometry in front of the quad counts.
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => new THREE.Vector3(x + (sx * w) / 2, y + (sy * h) / 2, z - 0.01));
};

const headCamera = (yaw = 0, pitch = 0) => {
  const cam = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 3000);
  cam.position.copy(DRIVER_EYE);
  cam.quaternion.setFromEuler(new THREE.Euler(-pitch, Math.PI + yaw, 0, 'YXZ'));
  cam.updateMatrixWorld(true);
  return cam;
};

const firstHit = (from: THREE.Vector3, to: THREE.Vector3, targets: THREE.Object3D[]) => {
  const dir = to.clone().sub(from);
  const ray = new THREE.Raycaster(from, dir.clone().normalize(), 0, dir.length());
  ray.layers.enableAll();
  return ray.intersectObjects(targets, false)[0];
};

describe('cockpit', () => {
  it('leaves every mirror quad corner unobstructed from the eye', () => {
    const { root } = createCockpit();
    const parts = meshes(root);
    for (const spec of MIRROR_SPECS) {
      for (const c of corners(spec)) expect(firstHit(DRIVER_EYE, c, parts), `${spec.name} ${c.toArray()}`).toBeUndefined();
    }
  });

  it('hits the dashboard when aimed at it, so the mirror check can fail', () => {
    const { root } = createCockpit();
    expect(firstHit(DRIVER_EYE, new THREE.Vector3(0, 0.05, 0.9), meshes(root))).toBeDefined();
  });

  it('keeps the left and rear mirrors in frame at the default head pose, the right one at the right glance', () => {
    const inFrame = (cam: THREE.Camera, p: THREE.Vector3) => {
      const n = p.clone().project(cam);
      return Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && n.z < 1;
    };
    const ahead = headCamera();
    for (const spec of MIRROR_SPECS.filter(s => s.name !== 'right')) for (const c of corners(spec)) expect(inFrame(ahead, c)).toBe(true);
    const right = headCamera(THREE.MathUtils.degToRad(-60));
    for (const c of corners(MIRROR_SPECS.find(s => s.name === 'right')!)) expect(inFrame(right, c)).toBe(true);
  });

  it('keeps the dashboard top below the horizon from the eye', () => {
    const { root } = createCockpit();
    const cam = headCamera();
    const dash = root.getObjectByName('dashboard')!;
    const box = new THREE.Box3().setFromObject(dash);
    const pos = (dash as THREE.Mesh).geometry.getAttribute('position');
    const v = new THREE.Vector3();
    let top = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(dash.matrixWorld);
      if (v.z <= DRIVER_EYE.z + 0.2 || v.y < box.min.y + 0.01) continue;
      const n = v.clone().project(cam);
      if (Math.abs(n.x) <= 1) top = Math.max(top, n.y);
    }
    const horizon = DRIVER_EYE.clone().add(new THREE.Vector3(0, 0, 100)).project(cam).y;
    expect(top).toBeGreaterThan(-1);
    expect(top).toBeLessThan(horizon);
  });

  it('turns the steering wheel by steer x 450 degrees', () => {
    const cockpit = createCockpit();
    const wheel = cockpit.root.getObjectByName('steeringWheel')!;
    for (const steer of [-1, -0.3, 0, 0.5, 1]) {
      cockpit.update({ ...idle, steer });
      expect(wheel.rotation.z).toBeCloseTo(THREE.MathUtils.degToRad(steer * 450), 6);
    }
  });

  it('redraws the gauges at most 15 times in 60 updates over a second', () => {
    let t = 0;
    const cockpit = createCockpit(() => t);
    for (let i = 0; i < 60; i++, t += 1 / 60) cockpit.update({ ...idle, speedKmh: i, rpm: 800 + i * 50 });
    expect(cockpit.redraws).toBeLessThanOrEqual(15);
    expect(cockpit.redraws).toBeGreaterThanOrEqual(10);
  });
});

describe('gauges', () => {
  it('maps 0 and 200 km/h to the dial ends', () => {
    expect(needleAngle(0, 200)).toBeCloseTo(DIAL_START);
    expect(needleAngle(200, 200)).toBeCloseTo(DIAL_END);
    expect(needleAngle(100, 200)).toBeCloseTo((DIAL_START + DIAL_END) / 2);
    expect(needleAngle(260, 200)).toBeCloseTo(DIAL_END);
    expect(DIAL_END).toBeGreaterThan(DIAL_START);
  });
});

describe('camera layers', () => {
  it('shows the cockpit only in cockpit mode, the car body everywhere else', () => {
    const layers = new THREE.Layers();
    applyModeLayers(layers, 'chase');
    expect([layers.isEnabled(CAR_LAYER), layers.isEnabled(COCKPIT_LAYER)]).toEqual([true, false]);
    applyModeLayers(layers, 'cockpit');
    expect([layers.isEnabled(CAR_LAYER), layers.isEnabled(COCKPIT_LAYER)]).toEqual([false, true]);
    applyModeLayers(layers, 'top');
    expect([layers.isEnabled(CAR_LAYER), layers.isEnabled(COCKPIT_LAYER)]).toEqual([true, false]);
    expect(COCKPIT_LAYER).toBe(2);
  });
});
