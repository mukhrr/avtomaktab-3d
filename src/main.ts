import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DistrictData } from './shared/district';
import { CameraRig, CAR_LAYER, lookGlance } from './camera/cameras';
import { createMirrors } from './camera/mirrors';
import { createGpuTimer, FrameStats } from './render/frameStats';
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
import { approachSpeeds, closingSpeed, TrafficBodies } from './traffic/trafficBodies';
import { TrafficSim, type PlayerState } from './traffic/trafficSim';
import { HornMonitor } from './traffic/horn';
import { AudioRig } from './audio/audioRig';
import { setVoiceMuted } from './audio/voice';
import { MapMatcher } from './exam/mapMatch';
import { trafficView } from './traffic/trafficView';
import { newCabin, stepCabin } from './vehicle/cabin';
import { InputReader } from './vehicle/input';
import { Vehicle } from './vehicle/vehicle';
import { useSkyAmbient } from './render/litMaterials';
import { afterProbe, createProbe } from './render/probe';
import { loadQuality, QUALITY, saveQuality, type Quality } from './render/quality';
import { createGroundMaterials } from './world/groundMaterials';
import { createFacadeTexture } from './world/facadeAtlas';
import { buildWorld } from './world/buildWorld';
import { createLandmarkTextures } from './world/landmarks';
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

// Antialiasing and ground textures are fixed for the page load, so the preset is read before anything is built.
const storedQuality = loadQuality();
const loadedQuality: Quality = storedQuality ?? 'medium';
const quality = QUALITY[loadedQuality];
let choice: StartChoice = loadChoice();

const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatioCap));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Mirrors render several times per frame; count draw calls for the whole frame.
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);
const gpuTimer = createGpuTimer(renderer.getContext() as WebGL2RenderingContext);
const frameStats = new FrameStats();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 3000);
const groundMats = createGroundMaterials(quality);
const env = createEnvironment(scene, camera, renderer, quality, choice.timeOfDay, groundMats.ground, quality.skyAmbient ? new THREE.PMREMGenerator(renderer) : null);
const { signalLamps } = buildWorld(scene, district, groundMats, createFacadeTexture(), createLandmarkTextures());

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
const mirrors = createMirrors(renderer, scene, car.object, quality);
if (quality.skyAmbient) useSkyAmbient(scene);
env.setupScene(scene);

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
/** Read by perf tooling through window.__game; cpu frame time alone mixes in catch-up sim steps. */
const lastFrame = { renderMs: 0, steps: 0, mainCalls: 0, mainTris: 0, frameMs: 0, gpuMs: null as number | null };
let acc = 0, pendingEdges = NO_EDGES, flippedFor = 0, frames = 0, hudT = 0;
let simMs = 0, simSteps = 0, simT = 0, simAvg = 0;
let cabin = newCabin(), simClock = 0;
const hud = createHudStore();
hud.set({ probing: storedQuality === null, quality: loadedQuality, loadedQuality });
if (params.has('debug')) events.on(e => console.log('[event]', e));
const minimap = createMinimap(district);

let screen: Screen = 'menu', seq = 0;
const show = (s: Screen) => {
  hud.set({ screen: (screen = s) });
  if (s === 'drive') audio?.enter();
  else audio?.leave();
};

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

function applyQuality(q: Quality) {
  const s = QUALITY[q];
  renderer.setPixelRatio(Math.min(devicePixelRatio, s.pixelRatioCap));
  renderer.setSize(innerWidth, innerHeight);
  env.setQuality(s);
  mirrors.setQuality(s);
}

// The probe samples the same loop that draws the start screen, so it never blocks it.
const probe = storedQuality === null ? createProbe() : null;
let probeDone = probe === null;
// True while the shown pick is only a fallback from a probe that measured nothing; Start must not store it.
let pickUnmeasured = false;

const horns = new HornMonitor({ matcher: new MapMatcher(district, net), signals, net });
let audio: AudioRig | null = null;
const camDir = new THREE.Vector3();

/** Called from click handlers only: browsers keep an AudioContext suspended until a user gesture. */
function unlockAudio() {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  setVoiceMuted(!choice.sound);
  try {
    if (audio) audio.apply(choice);
    else audio = new AudioRig(new Ctor(), choice, audible => setVoiceMuted(!audible));
    if (audio.ctx.state !== 'running') void audio.ctx.resume();
  } catch {
    audio = null;
  }
}

document.addEventListener('visibilitychange', () => audio?.visibility(document.visibilityState === 'hidden'));

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
  onStart: (c, q) => {
    choice = c;
    unlockAudio();
    if (!(pickUnmeasured && q === hud.get().quality)) {
      saveQuality(q);
      pickUnmeasured = false;
    }
    hud.set({ quality: q });
    applyQuality(q);
    env.setTimeOfDay(c.timeOfDay);
    if (c.mode === 'exam') return startExam();
    if (Math.abs(car.speed) < STOPPED) car.gearbox = c.gearbox;
    hud.set({ exam: null, toast: null, subtitle: null });
    show('drive');
  },
  onRetry: () => {
    unlockAudio();
    startExam();
  },
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
  const cpuStart = performance.now();
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
      if (ai) events.emit({ type: 'collision', with: 'car', speed: closingSpeed(player, ai), time: signals.time, approach: approachSpeeds(player, ai) });
      else events.emit({ type: 'collision', with: 'building', speed: Math.abs(player.speed), time: signals.time });
    });
    if (canHitPedestrian(player.speed)) {
      for (const id of peds.hitTest(player)) {
        events.emit({ type: 'pedestrianHit', pedId: id, speed: Math.abs(player.speed), time: signals.time });
        peds.remove(id);
      }
    }
    if (session.active) examStep(c.steer);
  }
  if (audio && driving) {
    camera.getWorldDirection(camDir);
    const listener = { position: [camera.position.x, camera.position.z] as [number, number], heading: Math.atan2(camDir.x, camDir.z) };
    for (const h of horns.update(dt, playerState(), traffic.agents, signals, listener)) audio.sfx.horn(h.volume, h.pan);
    const d = car.drivetrain;
    audio.frame(
      { rpm: d.rpm, throttle: controls.throttle, running: d.running, speed: car.speed, slip: car.slip, gear: d.gear, belt: cabin.belt, blinker: cabin.hazard ? 'hazard' : cabin.indicator },
      dt,
      input.horn(held, navigator.getGamepads?.() ?? []),
    );
  }
  signalLamps.update(signals);
  carsView.update(traffic.agents, signals.time);
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
  const renderStart = performance.now();
  env.follow(p.x, p.z);
  env.update();
  gpuTimer?.begin();
  mirrors.update(rig.mode);
  const preCalls = renderer.info.render.calls;
  const preTris = renderer.info.render.triangles;
  renderer.render(scene, camera);
  const mainCalls = renderer.info.render.calls - preCalls;
  const mainTris = renderer.info.render.triangles - preTris;
  mirrors.overlay(rig.mode);
  gpuTimer?.end();
  const renderMs = performance.now() - renderStart;
  lastFrame.renderMs = renderMs;
  lastFrame.steps = r.steps;
  lastFrame.mainCalls = mainCalls;
  lastFrame.mainTris = mainTris;

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
    const ft = frameStats.summary();
    hud.set({
      speedKmh: Math.round(Math.abs(car.speed) * 3.6),
      gear: gearLabel(t.gearbox, t.gear),
      rpm: t.rpm,
      running: t.running,
      gearbox: t.gearbox,
      street: nearestLane(district, p.x, p.z, STREET_RADIUS)?.edge.name ?? '',
      fps: Math.round(frames / hudT),
      drawCalls: renderer.info.render.calls,
      mainCalls,
      mainTris,
      cpuP50: ft.cpuP50,
      cpuP95: ft.cpuP95,
      gpuP50: ft.gpuP50,
      gpuP95: ft.gpuP95,
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
  const gpuSample = gpuTimer?.poll() ?? null;
  lastFrame.frameMs = performance.now() - cpuStart;
  lastFrame.gpuMs = gpuSample;
  frameStats.add(lastFrame.frameMs, gpuSample);
  if (probe && !probeDone) {
    const result = probe.frame(performance.now(), renderMs, gpuSample, r.steps);
    if (result) {
      probeDone = true;
      if (result.measured) saveQuality(result.quality);
      if (afterProbe(loadedQuality, result) === 'reload') return location.reload();
      else pickUnmeasured = true;
      frameStats.reset();
      applyQuality(result.quality);
      hud.set({ probing: false, quality: result.quality });
    }
  }
});

Object.assign(window, { __game: { car, env, held, pressed, rig, renderer, scene, camera, mirrors, signals, traffic, peds, events, audio: () => audio, cabin: () => cabin, lastFrame, session, hud, route, start: (c: Partial<StartChoice>) => {
  choice = { ...choice, ...c };
  if (choice.mode === 'exam') startExam();
  else show('drive');
} } });
