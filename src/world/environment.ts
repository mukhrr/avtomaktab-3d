import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { Sky } from 'three/addons/objects/Sky.js';
import type { QualitySettings } from '../render/quality';
import { sunDirection, sunPosition } from '../render/sun';
import { TIMES_OF_DAY, type TimeOfDay } from '../render/timeOfDay';
import { GROUND_TILE } from './groundMaterials';
import { worldUVs } from './meshes';

const LAT = 41.3111;
const LON = 69.2797;
const SHADOW_HALF_SIZE = 120;
const SUN_DISTANCE = 300;
const SKY_SIZE = 2500;
// three's bias is in [0, 1] of the shadow camera depth, so it is set as metres divided by that camera's far.
const SHADOW_BIAS_M = 0.05;
const CSM_LIGHT_FAR = 1000;
const SHADOW_NORMAL_BIAS = 0.03;
const ENV_SKY_SIZE = 50;

export interface EnvMapSource {
  fromScene(scene: THREE.Scene, sigma?: number, near?: number, far?: number): THREE.WebGLRenderTarget;
  dispose(): void;
}

export interface Environment {
  follow(x: number, z: number): void;
  update(): void;
  setTimeOfDay(tod: TimeOfDay): void;
  setQuality(q: QualitySettings): void;
  setupMaterial(m: THREE.Material): void;
  setupScene(root: THREE.Object3D): void;
  dispose(): void;
}

const isLit = (m: THREE.Material) =>
  (m as THREE.MeshLambertMaterial).isMeshLambertMaterial ||
  (m as THREE.MeshStandardMaterial).isMeshStandardMaterial ||
  (m as THREE.MeshPhongMaterial).isMeshPhongMaterial;

type ShaderPatch = (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void;

const patchIds = new WeakMap<ShaderPatch, number>();
let nextPatchId = 1;
const patchId = (f: ShaderPatch): number => {
  let id = patchIds.get(f);
  if (id === undefined) patchIds.set(f, (id = nextPatchId++));
  return id;
};

/** Sky, sun, fog and shadows. One shadowed light follows the car on one cascade; CSM fits 2 or 3 to the camera. */
export function createEnvironment(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  q: QualitySettings,
  tod: TimeOfDay,
  groundMaterial: THREE.Material,
  envMaps: EnvMapSource | null = null,
): Environment {
  const fog = new THREE.Fog(0xffffff, 1, 2);
  const background = new THREE.Color();
  scene.fog = fog;
  scene.background = background;

  const hemi = new THREE.HemisphereLight();
  scene.add(hemi);

  const sky = new Sky();
  sky.scale.setScalar(SKY_SIZE);
  sky.frustumCulled = false;
  scene.add(sky);
  const skyMaterial = sky.material as THREE.ShaderMaterial;
  // three's Sky goes grey-white under a high sun and tracks exposure; these restore a clear blue at any exposure.
  skyMaterial.fragmentShader = skyMaterial.fragmentShader
    .replace('uniform float mieDirectionalG;', 'uniform float mieDirectionalG;\nuniform float saturation;\nuniform float gain;')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', 'retColor = max( mix( vec3( dot( retColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ), retColor, saturation ), 0.0 ) * gain;\n\t\t\tgl_FragColor = vec4( retColor, 1.0 );');
  const skyU = skyMaterial.uniforms;
  skyU.saturation = { value: 1 };
  skyU.gain = { value: 1 };
  skyU.mieDirectionalG.value = 0.8;

  const envSky = new THREE.Mesh(sky.geometry, sky.material);
  envSky.scale.setScalar(ENV_SKY_SIZE);
  const envScene = new THREE.Scene();
  envScene.add(envSky);
  let envTarget: THREE.WebGLRenderTarget | null = null;

  const ground = new THREE.Mesh(worldUVs(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), GROUND_TILE.ground), groundMaterial);
  ground.receiveShadow = true;
  scene.add(ground);

  const toSun = new THREE.Vector3(0, 1, 0);
  const sunColor = new THREE.Color();
  let sunIntensity = 1;
  const focus = new THREE.Vector2();
  const materials = new Set<THREE.Material>();
  let single: THREE.DirectionalLight | null = null;
  let csm: CSM | null = null;
  let quality = q;
  const lastProjection = new THREE.Matrix4();

  const lights = (): THREE.DirectionalLight[] => (csm ? csm.lights : single ? [single] : []);

  function applyLight(): void {
    for (const l of lights()) {
      l.color.copy(sunColor);
      l.intensity = sunIntensity;
    }
    if (csm) csm.lightDirection.copy(toSun).negate();
  }

  function placeSingle(): void {
    if (!single) return;
    single.target.position.set(focus.x, 0, focus.y);
    single.position.copy(single.target.position).addScaledVector(toSun, SUN_DISTANCE);
  }

  function teardown(): void {
    if (single) {
      scene.remove(single, single.target);
      single.shadow.dispose();
      single = null;
    }
    if (csm) {
      csm.remove();
      for (const l of csm.lights) l.shadow.dispose();
      csm.dispose();
      csm = null;
    }
  }

  function build(next: QualitySettings): void {
    teardown();
    quality = next;
    if (next.cascades === 1) {
      single = new THREE.DirectionalLight();
      single.castShadow = true;
      single.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize);
      single.shadow.bias = -SHADOW_BIAS_M / (2 * SUN_DISTANCE);
      single.shadow.normalBias = SHADOW_NORMAL_BIAS;
      Object.assign(single.shadow.camera, {
        left: -SHADOW_HALF_SIZE, right: SHADOW_HALF_SIZE, top: SHADOW_HALF_SIZE, bottom: -SHADOW_HALF_SIZE, near: 1, far: 2 * SUN_DISTANCE,
      });
      scene.add(single, single.target);
      placeSingle();
    } else {
      csm = new CSM({
        camera,
        parent: scene,
        cascades: next.cascades,
        maxFar: next.shadowFar,
        mode: 'practical',
        shadowMapSize: next.shadowMapSize,
        lightDirection: toSun.clone().negate(),
        lightIntensity: sunIntensity,
        lightNear: 1,
        lightFar: CSM_LIGHT_FAR,
        lightMargin: 200,
      });
      // Fading hides the jump in shadow resolution where one cascade hands over to the next.
      csm.fade = true;
      for (const l of csm.lights) {
        l.shadow.bias = -SHADOW_BIAS_M / CSM_LIGHT_FAR;
        l.shadow.normalBias = SHADOW_NORMAL_BIAS;
      }
      csm.updateFrustums();
      lastProjection.copy(camera.projectionMatrix);
    }
    applyLight();
    for (const m of materials) patch(m);
  }

  function patch(m: THREE.Material): void {
    if (csm) csm.setupMaterial(m);
    const user = m.userData.patchShader as ShaderPatch | undefined;
    if (user) {
      // CSM assigns onBeforeCompile outright, so its function is captured and called first, then the material's own patch.
      const csmPatch = csm ? m.onBeforeCompile : null;
      m.onBeforeCompile = (shader, r) => {
        csmPatch?.call(m, shader, r);
        user(shader, r);
      };
      const key = `${csm ? `csm${csm.cascades}${csm.fade ? 'f' : ''}` : 'plain'}:${patchId(user)}`;
      m.customProgramCacheKey = () => key;
    }
    m.needsUpdate = true;
  }

  function setTimeOfDay(next: TimeOfDay): void {
    const p = TIMES_OF_DAY[next];
    const { elevation, azimuth } = sunPosition(LAT, LON, new Date(p.utc));
    toSun.set(...sunDirection(elevation, azimuth));
    sunColor.setHex(p.sunColor);
    sunIntensity = p.sunIntensity;
    hemi.color.setHex(p.skyColor);
    hemi.groundColor.setHex(p.groundColor);
    hemi.intensity = envMaps ? p.hemiIntensity : p.hemiWithoutSky;
    fog.color.setHex(p.fogColor);
    fog.near = p.fogNear;
    fog.far = p.fogFar;
    background.setHex(p.fogColor);
    renderer.toneMappingExposure = p.exposure;
    skyU.turbidity.value = p.turbidity;
    skyU.rayleigh.value = p.rayleigh;
    skyU.mieCoefficient.value = p.mie;
    (skyU.sunPosition.value as THREE.Vector3).copy(toSun);
    scene.environmentIntensity = p.envIntensity;
    if (envMaps) {
      // Ambient light comes from the unsaturated sky, so a bluer visible sky does not tint the city.
      skyU.saturation.value = 1;
      skyU.gain.value = 1;
      const next = envMaps.fromScene(envScene, 0, 0.1, 2 * ENV_SKY_SIZE);
      envTarget?.dispose();
      envTarget = next;
      scene.environment = next.texture;
    }
    skyU.saturation.value = p.skySaturation;
    skyU.gain.value = p.skyGain;
    applyLight();
    placeSingle();
  }

  function setupMaterial(m: THREE.Material): void {
    if (!isLit(m) || materials.has(m)) return;
    materials.add(m);
    patch(m);
  }

  setTimeOfDay(tod);
  build(q);

  return {
    follow(x, z) {
      focus.set(x, z);
      placeSingle();
    },

    update() {
      camera.updateMatrixWorld();
      sky.position.copy(camera.position);
      if (!csm) return;
      if (!lastProjection.equals(camera.projectionMatrix)) {
        csm.updateFrustums();
        lastProjection.copy(camera.projectionMatrix);
      }
      csm.update();
    },

    setTimeOfDay,

    setQuality(next) {
      if (next.cascades === quality.cascades && next.shadowMapSize === quality.shadowMapSize && next.shadowFar === quality.shadowFar) return;
      build(next);
    },

    setupMaterial,

    setupScene(root) {
      root.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) setupMaterial(m);
      });
    },

    dispose() {
      teardown();
      for (const m of materials) m.needsUpdate = true;
      materials.clear();
      scene.remove(hemi, sky, ground);
      envTarget?.dispose();
      envTarget = null;
      envMaps?.dispose();
      scene.environment = null;
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      ground.geometry.dispose();
    },
  };
}
