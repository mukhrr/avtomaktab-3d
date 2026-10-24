import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { QUALITY } from '../render/quality';
import { sunDirection, sunPosition } from '../render/sun';
import { TIMES_OF_DAY } from '../render/timeOfDay';
import { createEnvironment } from './environment';

const LAT = 41.3111;
const LON = 69.2797;

function setup(q = QUALITY.high) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 3000);
  const renderer = { toneMappingExposure: 1 } as unknown as THREE.WebGLRenderer;
  const env = createEnvironment(scene, camera, renderer, q, 'noon', new THREE.MeshLambertMaterial());
  return { scene, camera, renderer, env };
}

const shadowLights = (scene: THREE.Scene) => {
  const out: THREE.DirectionalLight[] = [];
  scene.traverse(o => {
    if ((o as THREE.DirectionalLight).isDirectionalLight && (o as THREE.DirectionalLight).castShadow) out.push(o as THREE.DirectionalLight);
  });
  return out;
};

describe('createEnvironment', () => {
  it('scales the sky to fit inside the camera far plane', () => {
    const { scene, camera } = setup();
    let sky: THREE.Mesh | undefined;
    scene.traverse(o => {
      if ((o as THREE.Mesh & { isSky?: boolean }).isSky) sky = o as THREE.Mesh;
    });
    expect(sky).toBeDefined();
    sky!.geometry.computeBoundingSphere();
    const r = sky!.geometry.boundingSphere!.radius * Math.max(sky!.scale.x, sky!.scale.y, sky!.scale.z);
    expect(r).toBeLessThan(camera.far);
    expect((sky!.material as THREE.Material).depthWrite).toBe(false);
  });

  it.each([QUALITY.low, QUALITY.high])('setTimeOfDay points the sun along the preset direction (cascades %#)', q => {
    const { scene, renderer, env } = setup(q);
    const fog = scene.fog as THREE.Fog;
    const noonFog = fog.color.getHex();
    const noonExposure = renderer.toneMappingExposure;
    env.setTimeOfDay('evening');
    env.update();
    const p = TIMES_OF_DAY.evening;
    const { elevation, azimuth } = sunPosition(LAT, LON, new Date(p.utc));
    const want = new THREE.Vector3(...sunDirection(elevation, azimuth));
    for (const light of shadowLights(scene)) {
      const got = light.position.clone().sub(light.target.position).normalize();
      expect(got.distanceTo(want)).toBeLessThan(1e-6);
    }
    expect(fog.color.getHex()).toBe(p.fogColor);
    expect(fog.color.getHex()).not.toBe(noonFog);
    expect(renderer.toneMappingExposure).toBe(p.exposure);
    expect(renderer.toneMappingExposure).not.toBe(noonExposure);
  });

  it('low quality has one shadow-casting light, high has three 2048 cascades', () => {
    const { scene, env } = setup();
    env.setQuality(QUALITY.low);
    expect(shadowLights(scene)).toHaveLength(1);
    env.setQuality(QUALITY.high);
    const lights = shadowLights(scene);
    expect(lights).toHaveLength(3);
    for (const l of lights) expect(l.shadow.mapSize.width).toBe(2048);
  });

  it('disposes the old shadow maps when quality changes', () => {
    const { scene, env } = setup();
    const old = shadowLights(scene);
    const spies = old.map(l => vi.spyOn(l.shadow, 'dispose'));
    env.setQuality(QUALITY.low);
    for (const s of spies) expect(s).toHaveBeenCalled();
    const single = shadowLights(scene)[0];
    const spy = vi.spyOn(single.shadow, 'dispose');
    env.setQuality(QUALITY.medium);
    expect(spy).toHaveBeenCalled();
    expect(shadowLights(scene)).toHaveLength(2);
  });

  it('patches lit materials for cascades and re-patches them when the cascade count changes', () => {
    const { scene, env } = setup();
    const lambert = new THREE.MeshLambertMaterial();
    const basic = new THREE.MeshBasicMaterial();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), lambert), new THREE.InstancedMesh(new THREE.BoxGeometry(), basic, 2));
    env.setupScene(scene);
    expect(lambert.defines?.CSM_CASCADES).toBe(3);
    expect(basic.defines?.USE_CSM).toBeUndefined();
    env.setQuality(QUALITY.medium);
    expect(lambert.defines?.CSM_CASCADES).toBe(2);
    env.setQuality(QUALITY.low);
    expect(lambert.defines?.USE_CSM).toBeUndefined();
  });

  it.each([QUALITY.low, QUALITY.medium, QUALITY.high])('keeps shadow bias under 0.1 m in world units (cascades %#)', q => {
    const { scene } = setup(q);
    for (const l of shadowLights(scene)) {
      expect(Math.abs(l.shadow.bias) * l.shadow.camera.far).toBeLessThan(0.1);
      expect(l.shadow.camera.far).toBeLessThanOrEqual(1000);
    }
  });
});
