import * as THREE from 'three';

export const WHEEL_POSITIONS: [number, number, number][] = [
  [-0.74, -0.25, 1.31], [0.74, -0.25, 1.31], [-0.74, -0.25, -1.31], [0.74, -0.25, -1.31],
];

/** White Cobalt-like sedan from primitives, facing +z; replaced by a CC-BY model in M4. */
export function createCarModel(): { root: THREE.Group; wheels: THREE.Object3D[] } {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.35, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1c2630, roughness: 0.1, metalness: 0.6 });
  const parts: [THREE.BufferGeometry, THREE.Material, number, number][] = [
    [new THREE.BoxGeometry(1.74, 0.62, 4.48), paint, 0.05, 0],
    [new THREE.BoxGeometry(1.56, 0.5, 2.3), glass, 0.6, -0.15],
    [new THREE.BoxGeometry(1.5, 0.08, 1.8), paint, 0.88, -0.2],
  ];
  for (const [g, m, y, z] of parts) {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(0, y, z);
    mesh.castShadow = true;
    root.add(mesh);
  }
  for (const x of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
    head.position.set(x, 0.12, 2.25);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xb01818 }));
    tail.position.set(x, 0.17, -2.25);
    root.add(head, tail);
  }

  const tyre = new THREE.CylinderGeometry(0.31, 0.31, 0.21, 18).rotateZ(Math.PI / 2);
  const rubber = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const rim = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
  const hub = new THREE.BoxGeometry(0.22, 0.4, 0.06);
  const wheels = WHEEL_POSITIONS.map(([x, y, z]) => {
    const steer = new THREE.Group();
    steer.position.set(x, y, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(tyre, rubber), new THREE.Mesh(hub, rim));
    steer.add(spin);
    root.add(steer);
    return steer;
  });
  return { root, wheels };
}
