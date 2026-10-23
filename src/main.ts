import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DistrictData } from './shared/district';
import { buildWorld } from './world/buildWorld';
import { createEnvironment } from './world/environment';

const DISTRICT = 'tashkent-center';

const district: DistrictData = await (await fetch(`/districts/${DISTRICT}/district.json`)).json();

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 3000);
const env = createEnvironment(scene);
buildWorld(scene, district);

const credit = document.createElement('div');
credit.textContent = '© OpenStreetMap contributors';
credit.style.cssText = 'position:fixed;left:8px;bottom:4px;font:11px system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none';
document.body.append(credit);

const orbit = new OrbitControls(camera, renderer.domElement);
// ?cam=x,y,z&look=x,z positions the debug camera, handy for checking a junction.
const params = new URLSearchParams(location.search);
const [cx, cy, cz] = (params.get('cam') ?? '0,80,120').split(',').map(Number);
const [lx, lz] = (params.get('look') ?? '0,0').split(',').map(Number);
camera.position.set(cx, cy, cz);
orbit.target.set(lx, 0, lz);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  orbit.update();
  env.follow(orbit.target.x, orbit.target.z);
  renderer.render(scene, camera);
});
