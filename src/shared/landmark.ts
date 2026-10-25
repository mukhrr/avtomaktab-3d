import type { DistrictData, Landmark } from './district';
import { pointInPolygon, segmentDistance } from '../world/spatial';

export const MONUMENT_PEDESTAL_HEIGHT = 6.5;
export const MONUMENT_RADIUS = 6;
export const FOUNTAIN_HEIGHT = 0.6;

export interface LandmarkCollider { id: string; x: number; z: number; radius: number; height: number }

export function landmarkBuildingIds(d: DistrictData): Set<string> {
  return new Set(d.landmarks.flatMap(l => (l.buildingId ? [l.buildingId] : [])));
}

/** Inside the footprint or radius grown by `margin`. */
export function inLandmark(l: Landmark, x: number, z: number, margin: number): boolean {
  const poly = l.footprint;
  if (poly) return pointInPolygon(x, z, poly) || poly.some((a, i) => segmentDistance(x, z, a, poly[(i + 1) % poly.length]).d <= margin);
  return l.radius !== undefined && Math.hypot(x - l.x, z - l.z) <= l.radius + margin;
}

/** Solids the car can hit that have no building prism: the monument pedestal and the fountain basins. */
export function landmarkColliders(d: DistrictData): LandmarkCollider[] {
  return d.landmarks.flatMap(l => {
    if (l.kind === 'amirTemur') return [{ id: l.id, x: l.x, z: l.z, radius: MONUMENT_RADIUS, height: MONUMENT_PEDESTAL_HEIGHT }];
    if (l.kind === 'fountain' && l.radius) return [{ id: l.id, x: l.x, z: l.z, radius: l.radius, height: FOUNTAIN_HEIGHT }];
    return [];
  });
}
