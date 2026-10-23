import type { Vec2 } from '../../src/shared/district';

const METRES_PER_DEG_LAT = 110540;
const METRES_PER_DEG_LON_AT_EQUATOR = 111320;

// Equirectangular is accurate to centimetres over a few km, which is all a district spans.
export function makeProjection(origin: { lat: number; lon: number }): (lat: number, lon: number) => Vec2 {
  const kx = METRES_PER_DEG_LON_AT_EQUATOR * Math.cos((origin.lat * Math.PI) / 180);
  const round = (v: number) => Math.round(v * 100) / 100 + 0;
  return (lat, lon) => [round((lon - origin.lon) * kx), round(-(lat - origin.lat) * METRES_PER_DEG_LAT)];
}
