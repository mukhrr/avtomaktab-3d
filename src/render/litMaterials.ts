import * as THREE from 'three';

/** Lambert ignores scene.environment, so presets with sky ambient swap every Lambert material for a matte Standard one. */
export function useSkyAmbient(root: THREE.Object3D): void {
  const swapped = new Map<THREE.Material, THREE.Material>();
  const swap = (m: THREE.Material): THREE.Material => {
    const l = m as THREE.MeshLambertMaterial;
    if (!l.isMeshLambertMaterial) return m;
    let s = swapped.get(m);
    if (!s) {
      s = new THREE.MeshStandardMaterial({
        color: l.color, map: l.map, flatShading: l.flatShading, vertexColors: l.vertexColors,
        side: l.side, transparent: l.transparent, opacity: l.opacity, roughness: 1, metalness: 0,
      });
      swapped.set(m, s);
      m.dispose();
    }
    return s;
  };
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}
