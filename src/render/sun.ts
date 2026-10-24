const RAD = Math.PI / 180;

/** NOAA solar calculator approximation. Angles in radians, azimuth from north clockwise. */
export function sunPosition(
  latDeg: number,
  lonDeg: number,
  utcDate: Date,
): { elevation: number; azimuth: number } {
  const startOfYear = Date.UTC(utcDate.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((utcDate.getTime() - startOfYear) / 86400000) + 1;
  const utcHours =
    utcDate.getUTCHours() + utcDate.getUTCMinutes() / 60 + utcDate.getUTCSeconds() / 3600;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);

  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const trueSolarMin = utcHours * 60 + eqTimeMin + 4 * lonDeg;
  const hourAngle = (trueSolarMin / 4 - 180) * RAD;
  const lat = latDeg * RAD;

  const sinEl =
    Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)));

  // atan2 form gives azimuth from north clockwise directly
  const azimuth =
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat),
    ) +
    Math.PI;
  return { elevation, azimuth: ((azimuth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) };
}

/** World axes: +x east, +y up, +z south. */
export function sunDirection(elevation: number, azimuth: number): [number, number, number] {
  const c = Math.cos(elevation);
  return [Math.sin(azimuth) * c, Math.sin(elevation), -Math.cos(azimuth) * c];
}
