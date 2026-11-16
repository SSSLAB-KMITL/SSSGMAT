export type GroundTarget = { lon: number; lat: number; height_m: number };

export function validGroundPoint(point: GroundTarget) {
  return (
    [point.lon, point.lat, point.height_m].every(Number.isFinite) &&
    Math.abs(point.lon) <= 180 &&
    Math.abs(point.lat) <= 90 &&
    point.height_m >= -500 &&
    point.height_m <= 9000
  );
}

export function groundEcef(point: GroundTarget): [number, number, number] {
  const a = 6378137,
    e2 = 6.6943799901413165e-3;
  const lon = (point.lon * Math.PI) / 180,
    lat = (point.lat * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [
    (n + point.height_m) * Math.cos(lat) * Math.cos(lon),
    (n + point.height_m) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - e2) + point.height_m) * Math.sin(lat),
  ];
}

export function targetLook(satellite: number[], target: GroundTarget) {
  const p = groundEcef(target),
    delta = satellite.map((v, i) => v - p[i]);
  const lon = (target.lon * Math.PI) / 180,
    lat = (target.lat * Math.PI) / 180;
  const east = -Math.sin(lon) * delta[0] + Math.cos(lon) * delta[1];
  const north =
    -Math.sin(lat) * Math.cos(lon) * delta[0] -
    Math.sin(lat) * Math.sin(lon) * delta[1] +
    Math.cos(lat) * delta[2];
  const up =
    Math.cos(lat) * Math.cos(lon) * delta[0] +
    Math.cos(lat) * Math.sin(lon) * delta[1] +
    Math.sin(lat) * delta[2];
  return {
    range_m: Math.hypot(...delta),
    azimuth_deg: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360,
    elevation_deg: (Math.atan2(up, Math.hypot(east, north)) * 180) / Math.PI,
  };
}

export function inFootprint(point: GroundTarget, ring: number[][]) {
  if (ring.length < 3) return false;
  // Unwrap the polygon consecutively, not each vertex around the target:
  // the latter incorrectly includes a point on the opposite side of Earth.
  const first = ring[0][0];
  const longitude = first + ((point.lon - first + 540) % 360) - 180;
  let previous = first;
  const polygon = ring.map(([lon, lat]) => {
    const unwrapped = previous + ((lon - previous + 540) % 360) - 180;
    previous = unwrapped;
    return [unwrapped - longitude, lat - point.lat];
  });
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x1, y1] = polygon[j],
      [x2, y2] = polygon[i];
    const cross = x1 * y2 - x2 * y1;
    if (
      Math.abs(cross) < 1e-10 &&
      Math.min(x1, x2) <= 0 &&
      Math.max(x1, x2) >= 0 &&
      Math.min(y1, y2) <= 0 &&
      Math.max(y1, y2) >= 0
    )
      return true;
    if (y1 > 0 !== y2 > 0 && 0 < x1 + ((x2 - x1) * -y1) / (y2 - y1))
      inside = !inside;
  }
  return inside;
}

export function selectedGround(s: {
  groundTarget: GroundTarget | null;
  selected: any;
  detail: any;
  site: any;
}): GroundTarget {
  if (s.groundTarget) return s.groundTarget;
  const d = s.detail?.id === s.selected?.id ? s.detail : null;
  const p = d?.preview?.roi || d?.geometry?.target || s.site;
  return { lon: p?.lon ?? 0, lat: p?.lat ?? 0, height_m: 0 };
}
