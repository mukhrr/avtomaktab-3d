import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Building } from '../shared/district';
import { ATLAS_COLS, ATLAS_ROWS } from './facadeAtlas';
import { roofGeometry, wallGeometry } from './buildingGeometry';
import { batchChunks, centroid, groupByChunk } from './chunks';

const ROOF_SEED = 11;

/** u and v count bays and floors; fract picks the spot inside the vertex's atlas cell. */
export function facadePatch(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'attribute float facade;\nvarying float vFacade;\nvoid main() {')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvFacade = facade;');
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'varying float vFacade;\nvoid main() {')
    .replace('#include <map_fragment>', `#ifdef USE_MAP
	float facadeCell = floor( vFacade + 0.5 );
	vec2 cellSize = vec2( ${(1 / ATLAS_COLS).toFixed(8)}, ${(1 / ATLAS_ROWS).toFixed(8)} );
	vec2 halfTexel = 0.5 / vec2( textureSize( map, 0 ) );
	vec2 cellLo = vec2( mod( facadeCell, ${ATLAS_COLS}.0 ), ${ATLAS_ROWS - 1}.0 - floor( facadeCell / ${ATLAS_COLS}.0 ) ) * cellSize + halfTexel;
	vec2 cellSpan = cellSize - 2.0 * halfTexel;
	// Gradients of the unwrapped uv, so the mip level does not jump where fract wraps at a bay edge.
	vec4 sampledDiffuseColor = textureGrad( map, cellLo + fract( vMapUv ) * cellSpan, dFdx( vMapUv ) * cellSpan, dFdy( vMapUv ) * cellSpan );
	diffuseColor *= sampledDiffuseColor;
#endif`);
}

/** Walls and roofs merged per chunk, each kind batched into one mesh. */
export function addBuildings(scene: THREE.Scene, buildings: Building[], atlas: THREE.Texture, chunkSize: number): void {
  const facade = new THREE.MeshLambertMaterial({ map: atlas });
  facade.userData.patchShader = facadePatch;
  const roof = new THREE.MeshLambertMaterial({ vertexColors: true });
  const groups = [...groupByChunk(buildings, b => centroid(b.footprint), chunkSize).values()];
  scene.add(
    batchChunks(groups.map(g => merge(g.map(wallGeometry))), facade),
    batchChunks(groups.map(g => merge(g.map(b => roofGeometry(b, ROOF_SEED)))), roof),
  );
}

function merge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(geoms, false);
  geoms.forEach(g => g.dispose());
  return merged;
}
