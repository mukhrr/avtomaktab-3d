import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DistrictData } from './shared/district';
import { fixedSteps, STEP } from './physics/loop';
import { createPhysics } from './physics/world';
import { InputReader } from './vehicle/input';
import { Vehicle } from './vehicle/vehicle';
import { buildWorld } from './world/buildWorld';
import { createEnvironment } from './world/environment';
import { nearestLane } from './world/spawn';

const DISTRICT = 'tashkent-center';
const OUT_OF_BOUNDS = 20;
const FLIPPED_UP_Y = 0.2;
const FLIPPED_RESET_S = 2;
// On the ring road around Amir Temur square; the origin itself is inside the park.
const SPAWN_POINT: [number, number] = [-53, 105];

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

const { world } = await createPhysics(district);
const spawn = nearestLane(district, ...SPAWN_POINT)!;
const car = new Vehicle(world, spawn);
scene.add(car.object);

const held = new Set<string>(), pressed = new Set<string>();
addEventListener('keydown', e => {
  if (!e.repeat) pressed.add(e.code);
  held.add(e.code);
});
addEventListener('keyup', e => held.delete(e.code));
addEventListener('blur', () => held.clear());
const input = new InputReader();

// ?cam=x,y,z&look=x,z switches to a free orbit camera for inspecting the world.
const params = new URLSearchParams(location.search);
let orbit: OrbitControls | null = null;
if (params.has('cam')) {
  const [cx, cy, cz] = params.get('cam')!.split(',').map(Number);
  const [lx, lz] = (params.get('look') ?? '0,0').split(',').map(Number);
  camera.position.set(cx, cy, cz);
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(lx, 0, lz);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function resetToLane() {
  const p = car.object.position;
  car.reset(nearestLane(district, p.x, p.z) ?? spawn);
}

const clock = new THREE.Clock();
const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3();
let acc = 0, flippedFor = 0;

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const controls = input.read(held, pressed, navigator.getGamepads?.() ?? [], dt);
  if (pressed.has('KeyR')) resetToLane();
  pressed.clear();

  const r = fixedSteps(acc, dt);
  acc = r.accumulator;
  for (let i = 0; i < r.steps; i++) {
    car.update(controls, STEP);
    world.step();
  }
  car.sync();

  const p = car.object.position, b = district.bounds;
  if (p.x < b.minX - OUT_OF_BOUNDS || p.x > b.maxX + OUT_OF_BOUNDS || p.z < b.minZ - OUT_OF_BOUNDS || p.z > b.maxZ + OUT_OF_BOUNDS || p.y < -5) resetToLane();
  flippedFor = car.upright < FLIPPED_UP_Y ? flippedFor + dt : 0;
  if (flippedFor > FLIPPED_RESET_S) { resetToLane(); flippedFor = 0; }

  if (orbit) orbit.update();
  else {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.object.quaternion).setY(0).normalize();
    camPos.copy(p).addScaledVector(fwd, -7).setY(p.y + 2.8);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 5));
    camera.lookAt(camTarget.copy(p).addScaledVector(fwd, 4).setY(p.y + 1));
  }
  env.follow(p.x, p.z);
  renderer.render(scene, camera);
});

Object.assign(window, { __game: { car, held, pressed } });
