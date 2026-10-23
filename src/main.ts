import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DistrictData } from './shared/district';
import { CameraRig, CAR_LAYER, lookGlance } from './camera/cameras';
import { createMirrors } from './camera/mirrors';
import { fixedSteps, NO_EDGES, splitControls, STEP } from './physics/loop';
import { ExamSession } from './exam/session';
import { loadPenalties } from './exam/penalties';
import type { ExamRoute } from './exam/route';
import { SignSystem } from './sim/signs';
import { loadChoice, type StartChoice } from './ui/choices';
import { createHudStore, gearLabel, type Screen } from './ui/hudStore';
import { createMinimap } from './ui/minimap';
import { mountHud } from './ui/mount';
import { createPhysics } from './physics/world';
import { canHitPedestrian, PedSim } from './peds/pedSim';
import { pedView } from './peds/pedView';
import { EventBus } from './sim/events';
import { SignalSystem } from './sim/signals';
import { LaneNetwork } from './traffic/lanes';
import { closingSpeed, TrafficBodies } from './traffic/trafficBodies';
import { TrafficSim, type PlayerState } from './traffic/trafficSim';
import { trafficView } from './traffic/trafficView';
import { newCabin, stepCabin } from './vehicle/cabin';
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
const ROUTE = 'route-1';
/** No AI car or pedestrian is left this close to the exam start; the sims respawn farther out. */
const START_CLEAR = 40;
const NO_KEYS = new Set<string>();

const district: DistrictData = await (await fetch(`/districts/${DISTRICT}/district.json`)).json();
const route: ExamRoute = await (await fetch(`/districts/${DISTRICT}/routes/${ROUTE}.json`)).json();

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
const net = new LaneNetwork(district);
const signs = new SignSystem(district);
const traffic = new TrafficSim(district, net, signals, { count: TRAFFIC_COUNT, seed: 1 }, signs);
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
let cabin = newCabin(), simClock = 0;
const hud = createHudStore();
if (params.has('debug')) events.on(e => console.log('[event]', e));
const minimap = createMinimap(district);

let screen: Screen = 'menu', choice: StartChoice = loadChoice(), seq = 0;
const show = (s: Screen) => hud.set({ screen: (screen = s) });

const session = new ExamSession({
  d: district, net, signals, signs, peds, traffic, route, penalties: loadPenalties(), playerLength: PLAYER_LENGTH,
  placeCar: (pose, gearbox) => {
    car.gearbox = gearbox;
    car.reset(pose);
    car.sync();
    cabin = newCabin();
    flippedFor = 0;
    traffic.clearNear(pose.position, START_CLEAR);
    peds.clearNear(pose.position, START_CLEAR);
    events.drain();
  },
});
session.onPrompt = p => {
  if (p.key !== 'exam.violation' || !p.vars) return;
  const id = String(p.vars.id);
  const e = session.penalties[id as keyof typeof session.penalties];
  hud.set({ toast: { seq: ++seq, id, vars: p.vars, points: e.points, tier: e.tier } });
};
session.onSubtitle = text => hud.set({ subtitle: { seq: ++seq, text } });
session.onEnd = result => {
  hud.set({ debrief: { lang: session.lang, result, startT: session.startT, routeLine: session.routeLine, penalties: session.penalties }, exam: null });
  show('debrief');
};

function examStep(steer: number) {
  const p = playerState();
  session.step({
    t: simClock, dt: STEP, position: p.position, heading: p.heading, speed: p.speed,
    drivetrain: car.drivetrain, cabin, steer, events: events.drain(),
  });
}

/** Runs inside the click handler, so the brief's audio starts within the user gesture. */
function startExam() {
  hud.set({ toast: null, subtitle: null, debrief: null, exam: { lang: choice.lang, maneuver: null, distance: 0, total: 0 } });
  show('drive');
  session.start(choice.lang, choice.gearbox);
  examStep(0);
}

const roads = district.graph.edges.map(e => e.points);
mountHud(hud, minimap.canvas, params.has('debug'), {
  roads,
  routeKm: route.lengthM / 1000,
  choice: () => choice,
  onStart: c => {
    choice = c;
    if (c.mode === 'exam') return startExam();
    if (Math.abs(car.speed) < STOPPED) car.gearbox = c.gearbox;
    hud.set({ exam: null, toast: null, subtitle: null });
    show('drive');
  },
  onRetry: startExam,
  onMenu: () => {
    session.silence();
    show('menu');
  },
});

/** During an exam R or a flip ends it; outside one they put the car back on a lane. */
function resetOrAbandon() {
  if (session.active) session.abandon();
  else resetToLane();
}

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  renderer.info.reset();
  const driving = screen === 'drive';
  const read = input.read(driving ? held : NO_KEYS, driving ? pressed : NO_KEYS, driving ? navigator.getGamepads?.() ?? [] : [], dt);
  rig.glance = read.glance;
  const controls = { ...read, glance: read.glance ?? (rig.mode === 'cockpit' ? lookGlance(rig.headYaw, rig.headPitch) : null) };
  if (driving && pressed.has('KeyR')) resetOrAbandon();
  if (driving && pressed.has('Escape')) {
    if (session.active) session.abandon();
    else show('menu');
  }
  if (pressed.has('KeyC')) rig.cycle();
  if (driving && !session.active && pressed.has('KeyG') && Math.abs(car.speed) < STOPPED) car.gearbox = car.drivetrain.gearbox === 'auto' ? 'manual' : 'auto';
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
    simClock += STEP;
    cabin = stepCabin(cabin, c, simClock, playerState().heading);
    eventQueue.drainCollisionEvents((a, b, started) => {
      if (!started) return;
      const other = a === car.collider.handle ? b : b === car.collider.handle ? a : null;
      if (other === null || other === ground.handle) return;
      const ai = bodies.agentFor(other);
      events.emit({ type: 'collision', with: ai ? 'car' : 'building', speed: ai ? closingSpeed(player, ai) : Math.abs(player.speed), time: signals.time });
    });
    if (canHitPedestrian(player.speed)) {
      for (const id of peds.hitTest(player)) {
        events.emit({ type: 'pedestrianHit', pedId: id, speed: Math.abs(player.speed), time: signals.time });
        peds.remove(id);
      }
    }
    if (session.active) examStep(c.steer);
  }
  signalLamps.update(signals);
  carsView.update(traffic.agents);
  pedsView.update(peds.peds);

  const p = car.object.position, b = district.bounds;
  if (p.x < b.minX - OUT_OF_BOUNDS || p.x > b.maxX + OUT_OF_BOUNDS || p.z < b.minZ - OUT_OF_BOUNDS || p.z > b.maxZ + OUT_OF_BOUNDS || p.y < -5) {
    if (session.active) session.abandon();
    resetToLane();
  }
  flippedFor = car.upright < FLIPPED_UP_Y ? flippedFor + dt : 0;
  if (flippedFor > FLIPPED_RESET_S) {
    resetOrAbandon();
    flippedFor = 0;
  }

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
      indicator: cabin.indicator,
      hazard: cabin.hazard,
      belt: cabin.belt,
      glance: cabin.glance,
    });
    if (session.active) {
      const next = session.nextManeuver;
      hud.set({ exam: { lang: session.lang, maneuver: next?.maneuver ?? null, distance: next?.distance ?? 0, total: session.result?.total ?? 0 } });
    }
    frames = 0;
    hudT = 0;
  }
});

Object.assign(window, { __game: { car, held, pressed, rig, renderer, scene, camera, mirrors, signals, traffic, peds, events, cabin: () => cabin, session, hud, route, start: (c: Partial<StartChoice>) => {
  choice = { ...choice, ...c };
  if (choice.mode === 'exam') startExam();
  else show('drive');
} } });
