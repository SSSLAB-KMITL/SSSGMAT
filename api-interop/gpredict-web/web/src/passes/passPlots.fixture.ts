// Passes for the tests of the Polar and Az/El plots: only the columns the plots read are filled in.

import type { PassInfo, PassRow } from "./types";

/** AOS of every pass built here: 2026-11-12 10:00:00 UTC. */
export const AOS_MS = Date.parse("2026-11-12T10:00:00.000Z");

/** A sample of the Data tab with only the time, azimuth and elevation. */
export function sample(ms: number, az: number | null, el: number | null): PassRow {
  return {
    t: new Date(ms).toISOString(),
    az,
    el,
    ra: null,
    dec: null,
    range_km: null,
    rate_kms: null,
    lat_deg: null,
    lon_deg: null,
    ssp: "",
    footprint_km: null,
    alt_km: null,
    vel_kms: null,
    doppler_hz: null,
    loss_db: null,
    delay_ms: null,
    ma: null,
    phase_deg: null,
    vis: "-",
  };
}

/**
 * A pass of `n` samples `stepS` seconds apart, from AOS at `AOS_MS` to LOS at the last sample; the azimuth moves from `az0`
 * to `az1` and the elevation is a half sine of height `maxEl`. The AOS and LOS azimuths differ by half a degree from the
 * azimuth of the first and of the last sample, so that a test can tell which of the two is used.
 */
export function makePass(az0: number, az1: number, n = 21, stepS = 30, maxEl = 60): PassInfo {
  const rows = Array.from({ length: n }, (_, i) => {
    const f = n > 1 ? i / (n - 1) : 0;
    return sample(AOS_MS + i * stepS * 1000, az0 + (az1 - az0) * f, maxEl * Math.sin(Math.PI * f));
  });
  return {
    orbit: 1234,
    aos: rows[0]!.t,
    tca: rows[Math.floor(n / 2)]!.t,
    los: rows[n - 1]!.t,
    max_el: maxEl,
    aos_az: az0 - 0.5,
    max_el_az: (az0 + az1) / 2,
    los_az: az1 + 0.5,
    vis: "V--",
    rows,
  };
}
