import * as THREE from 'three';
import type { CameraMode } from './cameras';

const TARGET_W = 256;
const TARGET_H = 128;

interface MirrorSpec { name: string; eye: [number, number, number]; yaw: number; quad: [number, number, number]; quadSize: [number, number] }

// Positions relative to the chassis centre, car facing +z (driver on +x).
const SPECS: MirrorSpec[] = [
  { name: 'left', eye: [0.98, 0.32, 0.85], yaw: THREE.MathUtils.degToRad(-12), quad: [0.98, 0.32, 0.85], quadSize: [0.2, 0.12] },
  { name: 'right', eye: [-0.98, 0.32, 0.85], yaw: THREE.MathUtils.degToRad(12), quad: [-0.98, 0.32, 0.85], quadSize: [0.2, 0.12] },
  { name: 'rear', eye: [0, 0.6, 0.4], yaw: 0, quad: [0.05, 0.62, 0.55], quadSize: [0.26, 0.08] },
];

/** Live mirrors: three cameras into render targets, shown as glass in cockpit view or as a strip on top of the screen otherwise. */
export function createMirrors(renderer: THREE.WebGLRenderer, scene: THREE.Scene, car: THREE.Object3D) {
  const mirrors = SPECS.map(spec => {
    const target = new THREE.WebGLRenderTarget(TARGET_W, TARGET_H);
    const cam = new THREE.PerspectiveCamera(spec.name === 'rear' ? 45 : 35, TARGET_W / TARGET_H, 0.3, 600);
    cam.layers.enableAll();
    cam.position.set(...spec.eye);
    // Default camera looks along -z, which is backwards for a car facing +z; yaw toes the side mirrors outward.
    cam.rotation.set(0, spec.yaw, 0);
    car.add(cam);

    const texture = target.texture;
    texture.wrapS = THREE.RepeatWrapping;
    texture.repeat.x = -1; // mirror image

    const material = new THREE.MeshBasicMaterial({ map: texture });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(...spec.quadSize), material);
    glass.position.set(...spec.quad);
    // Faces the driver, who looks toward +z.
    glass.rotation.y = Math.PI;
    car.add(glass);
    return { spec, target, cam, glass, material };
  });

  const hudScene = new THREE.Scene();
  const hudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const hudQuads = mirrors.map(m => {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: m.target.texture }));
    hudScene.add(q);
    return q;
  });

  let frame = 0;
  return {
    update(mode: CameraMode): void {
      const cockpit = mode === 'cockpit';
      mirrors.forEach(m => (m.glass.visible = cockpit));
      if (frame++ % 2) return;
      const shadows = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false;
      for (const m of mirrors) {
        m.glass.visible = false;
        renderer.setRenderTarget(m.target);
        renderer.render(scene, m.cam);
        m.glass.visible = cockpit;
      }
      renderer.setRenderTarget(null);
      renderer.shadowMap.autoUpdate = shadows;
    },

    /** Draws the mirror strip over the frame in chase and top views. */
    overlay(mode: CameraMode): void {
      if (mode === 'cockpit') return;
      const aspect = renderer.domElement.width / renderer.domElement.height;
      const w = 0.22, h = (w * aspect * TARGET_H) / TARGET_W, y = 1 - h / 2 - 0.03;
      const order = ['left', 'rear', 'right'];
      hudQuads.forEach((q, i) => {
        q.scale.set(w, h, 1);
        q.position.set((order.indexOf(mirrors[i].spec.name) - 1) * (w + 0.02), y, 0);
      });
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(hudScene, hudCam);
      renderer.autoClear = autoClear;
    },

    dispose(): void {
      for (const m of mirrors) {
        m.target.dispose();
        m.material.dispose();
        car.remove(m.cam, m.glass);
      }
    },
  };
}
