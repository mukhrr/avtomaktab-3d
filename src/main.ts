import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DistrictData } from './shared/district';
import { CameraRig, CAR_LAYER } from './camera/cameras';
import { createMirrors } from './camera/mirrors';
import { fixedSteps, NO_EDGES, splitControls, STEP } from './physics/loop';
import { createHudStore, gearLabel } from './ui/hudStore';
import { createMinimap } from './ui/minimap';
import { mountHud } from './ui/mount';
import { createPhysics } from './physics/world';
import { PedSim } from './peds/pedSim';
import { pedView } from './peds/pedView';
import { EventBus } from './sim/events';
import { SignalSystem } from './sim/signals';
import { LaneNetwork } from './traffic/lanes';
import { closingSpeed, TrafficBodies } from './traffic/trafficBodies';
import { TrafficSim, type PlayerState } from './traffic/trafficSim';
import { trafficView } from './traffic/trafficView';
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
const HUD_INTERVAL = 0.1;
const STREET_RADIUS = 12;
const STOPPED = 0.5;
const SPAWN_POINT: [number, number] = [-53, 105];
const TRAFFIC_COUNT = 60;
const CROSSERS = 40;
const WALKERS = 80;
const PLAYER_LENGTH = 4.48;
const PLAYER_WIDTH = 1.74;

const district: DistrictData = await (await fetch(`/districts/${DISTRICT}/district.json`)).json();

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Mirrors render several times per frame; count draw calls for the whole frame.
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 3000);
const env = createEnvironment(scene);
const { signalLamps } = buildWorld(scene, district);

const credit = document.createElement('div');
credit.textContent = '© OpenStreetMap contributors';
credit.style.cssText = 'position:fixed;left:8px;bottom:4px;font:11px system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000;pointer-events:none';
document.body.append(credit);

const { world, ground } = await createPhysics(district);
const spawn = nearestLane(district, ...SPAWN_POINT)!;
const car = new Vehicle(world, spawn);
scene.add(car.object);
car.sync();
car.object.traverse(o => o.layers.set(CAR_LAYER));
const signals = new SignalSystem(district);
const traffic = new TrafficSim(district, new LaneNetwork(district), signals, { count: TRAFFIC_COUNT, seed: 1 });
const peds = new PedSim(district, { crossers: CROSSERS, walkers: WALKERS, seed: 2 });
const bodies = new TrafficBodies(world, TRAFFIC_COUNT);
const carsView = trafficView(scene, TRAFFIC_COUNT);
const pedsView = pedView(scene, CROSSERS + WALKERS);
const events = new EventBus();
const eventQueue = new RAPIER.EventQueue(true);
const rig = new CameraRig(camera, renderer.domElement);
const mirrors = createMirrors(renderer, scene, car.object);

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

function playerState(): PlayerState {
  const p = car.object.position;
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(car.object.quaternion);
  return { position: [p.x, p.z], heading: Math.atan2(f.x, f.z), speed: car.speed, length: PLAYER_LENGTH, width: PLAYER_WIDTH };
}

function resetToLane() {
  const p = car.object.position;
  car.reset(nearestLane(district, p.x, p.z) ?? spawn);
}

const clock = new THREE.Clock();
let acc = 0, pendingEdges = NO_EDGES, flippedFor = 0, frames = 0, hudT = 0;
let simMs = 0, simSteps = 0, simT = 0, simAvg = 0;
const hud = createHudStore();
if (params.has('debug')) events.on(e => console.log('[event]', e));
const minimap = createMinimap(district);
mountHud(hud, minimap.canvas, params.has('debug'));

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  renderer.info.reset();
  const controls = input.read(held, pressed, navigator.getGamepads?.() ?? [], dt);
  if (pressed.has('KeyR')) resetToLane();
  if (pressed.has('KeyC')) rig.cycle();
  if (pressed.has('KeyG') && Math.abs(car.speed) < STOPPED) car.gearbox = car.drivetrain.gearbox === 'auto' ? 'manual' : 'auto';
  pressed.clear();

  const r = fixedSteps(acc, dt);
  acc = r.accumulator;
  const split = splitControls(controls, pendingEdges, r.steps);
  pendingEdges = split.pending;
  for (const c of split.perStep) {
    const player = playerState();
    signals.update(STEP);
    const t0 = performance.now();
    traffic.step(STEP, player, peds);
    peds.step(STEP, player, traffic.agents, signals);
    simMs += performance.now() - t0;
    simSteps++;
    bodies.sync(traffic.agents);
    car.update(c, STEP);
    world.step(eventQueue);
    car.sync();
    eventQueue.drainCollisionEvents((a, b, started) => {
      if (!started) return;
      const other = a === car.collider.handle ? b : b === car.collider.handle ? a : null;
      if (other === null || other === ground.handle) return;
      const ai = bodies.agentFor(other);
      events.emit({ type: 'collision', with: ai ? 'car' : 'building', speed: ai ? closingSpeed(player, ai) : Math.abs(player.speed), time: signals.time });
    });
    for (const id of peds.hitTest(player)) {
      events.emit({ type: 'pedestrianHit', pedId: id, speed: Math.abs(player.speed), time: signals.time });
      peds.remove(id);
    }
  }
  signalLamps.update(signals);
  carsView.update(traffic.agents);
  pedsView.update(peds.peds);

  const p = car.object.position, b = district.bounds;
  if (p.x < b.minX - OUT_OF_BOUNDS || p.x > b.maxX + OUT_OF_BOUNDS || p.z < b.minZ - OUT_OF_BOUNDS || p.z > b.maxZ + OUT_OF_BOUNDS || p.y < -5) resetToLane();
  flippedFor = car.upright < FLIPPED_UP_Y ? flippedFor + dt : 0;
  if (flippedFor > FLIPPED_RESET_S) { resetToLane(); flippedFor = 0; }

  if (orbit) orbit.update();
  else rig.update(car.object, car.speed, dt);
  env.follow(p.x, p.z);
  mirrors.update(rig.mode);
  renderer.render(scene, camera);
  mirrors.overlay(rig.mode);

  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.object.quaternion);
  minimap.draw(p.x, p.z, Math.atan2(fwd.x, fwd.z));
  frames++;
  hudT += dt;
  simT += dt;
  if (simT >= 1) {
    simAvg = simSteps ? simMs / simSteps : 0;
    simMs = 0;
    simSteps = 0;
    simT = 0;
  }
  if (hudT >= HUD_INTERVAL) {
    const t = car.drivetrain;
    hud.set({
      speedKmh: Math.round(Math.abs(car.speed) * 3.6),
      gear: gearLabel(t.gearbox, t.gear),
      rpm: t.rpm,
      running: t.running,
      gearbox: t.gearbox,
      street: nearestLane(district, p.x, p.z, STREET_RADIUS)?.edge.name ?? '',
      fps: Math.round(frames / hudT),
      drawCalls: renderer.info.render.calls,
      activeCars: traffic.agents.filter(a => a.active).length,
      activePeds: peds.peds.filter(q => q.active).length,
      controllers: district.controllers.length,
      simMs: simAvg,
    });
    frames = 0;
    hudT = 0;
  }
});

Object.assign(window, { __game: { car, held, pressed, rig, renderer, scene, camera, mirrors, signals, traffic, peds, events } });
