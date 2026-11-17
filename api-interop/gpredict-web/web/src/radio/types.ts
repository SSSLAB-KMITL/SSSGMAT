// JSON shapes of the radio and rotator routes of the Gpredict Web server (sub-project 3, spec §6 to §8): the devices of
// Preferences → Interfaces (GET and PUT /api/hwconf), the transponders of a satellite, and the state of the controllers that
// the tick carries (`radio`, `rotator`) and that POST /api/modules/{name}/radio and /rotator answer. The web computes nothing of
// these: every number comes from the server. A measured number is `number | null`: the server sends null instead of NaN/Infinity.

import type { PassInfo } from "../passes/types";
import type { ApiMessage } from "../types";

// ---------------------------------------------------------------- Preferences → Interfaces

/**
 * A radio, with the keys of Gpredict's .rig file (ref-R §9.1) and its name. Frequencies are in Hz. `Type` 0 RX only, 1 TX only,
 * 2 Half-duplex, 3 Full-duplex, 4 FT817/857/897 (auto), 5 FT817/857/897 (manual); `PTT` 0 None, 1 Read PTT, 2 Read DCD;
 * `VFO_UP` and `VFO_DOWN` (1 A, 2 B, 3 Main, 4 Sub) only when `Type` is 3. PUT /api/hwconf ignores `Cycle`: the server keeps the
 * file's (a new radio gets 1000), the Radio Control window is where it is changed.
 */
export interface RadioConf {
  name: string;
  Host: string;
  Port: number;
  Cycle: number;
  LO: number;
  LO_UP: number;
  DefaultUplinkFreqHz: number;
  DefaultDownlinkFreqHz: number;
  Type: number;
  PTT: number;
  VFO_UP?: number;
  VFO_DOWN?: number;
  SIGNAL_AOS: boolean;
  SIGNAL_LOS: boolean;
  SIGNAL_AOIQ: boolean;
  SIGNAL_LOIQ: boolean;
}

/** A rotator, with the keys of Gpredict's .rot file (ref-R §9.2) and its name. `AzType` 0 is 0° → 180° → 360°, 1 is -180° → 0° → +180°. PUT ignores `Cycle` and `Threshold` like it does for a radio. */
export interface RotatorConf {
  name: string;
  Host: string;
  Port: number;
  Cycle: number;
  Threshold: number;
  AzType: number;
  MinAz: number;
  MaxAz: number;
  MinEl: number;
  MaxEl: number;
  AzStopPos: number;
}

/** GET and PUT /api/hwconf: every device, sorted by name. PUT takes both lists and replaces all the devices with them. */
export interface HwConf {
  radios: RadioConf[];
  rotators: RotatorConf[];
}

// ---------------------------------------------------------------- transponders

/** A transponder of a satellite (GET /api/trsp/{norad}); frequencies in Hz, 0 where there is none (a beacon has no uplink). */
export interface Transponder {
  name: string;
  up_low: number;
  up_high: number;
  down_low: number;
  down_high: number;
  invert: boolean;
  mode: string;
  baud: number;
}

/** POST /api/trsp/update: `status` is always "Finished" like Gpredict's; `messages` say, in Thai, why nothing was fetched. */
export interface TrspUpdateAnswer {
  status: "Finished";
  /** the data is not from this request (asked within two hours, or the fetch failed) */
  cached: boolean;
  /** when the data was fetched, ISO 8601 UTC; null if never */
  fetched_at: string | null;
  satellites: number;
  messages: ApiMessage[];
}

// ---------------------------------------------------------------- controllers

export type ControllerKind = "radio" | "rotator";

/** One open controller (GET /api/controllers): the Radio Control or Antenna Control window of a module. */
export interface ControllerRef {
  module: string;
  kind: ControllerKind;
}

export interface ControllerSat {
  norad: number;
  name: string;
}

/** One direction of the radio: the satellite's frequency, the radio's, the Doppler shift (null before the first tick) and the LO in MHz. */
export interface RadioLink {
  sat_hz: number;
  radio_hz: number;
  doppler_hz: number | null;
  lo_mhz: number;
}

/** The "radio" of a tick and the answer of POST /api/modules/{name}/radio (the snapshot of RigController). */
export interface RadioState {
  /** the radios to choose "1. Device" from (by name), and "2. Device" from: "None" and then the radios that are not RX only */
  devices: string[];
  devices2: string[];
  device1: string | null;
  device2: string;
  engaged: boolean;
  track: boolean;
  lock: boolean;
  cycle_ms: number;
  sats: ControllerSat[];
  norad: number | null;
  /** the names of the transponders of the satellite, and the index of the one chosen (null if there is none) */
  transponders: string[];
  transponder: number | null;
  down: RadioLink;
  up: RadioLink;
  az: number | null;
  el: number | null;
  range_km: number | null;
  rate_kms: number | null;
  countdown: string;
  /** FT817/857/897 (manual): the SPACE key switches to TX */
  space_ptt: boolean;
  /** a Thai line about the radio (cannot be read, disengaged after errors), null if there is none */
  status: string | null;
}

export interface AzEl {
  az: number;
  el: number;
}

/** The "rotator" of a tick and the answer of POST /api/modules/{name}/rotator (the snapshot of RotController). */
export interface RotatorState {
  devices: string[];
  device: string | null;
  engaged: boolean;
  track: boolean;
  monitor: boolean;
  monitor_enabled: boolean;
  knobs_enabled: boolean;
  cycle_ms: number;
  threshold_deg: number;
  sats: ControllerSat[];
  norad: number | null;
  knob: AzEl;
  limits: { min_az: number; max_az: number; min_el: number; max_el: number; az_type: number };
  target: AzEl | null;
  countdown: string;
  /** the "Read:" labels: the position as text, " --- " before Engage, "---" after Disengage, "ERROR" when it cannot be read */
  read: { az: string; el: string };
  setpoint: AzEl;
  /** the position read from the rotator (null while not engaged or after an error) */
  rotor: AzEl | null;
  pass: PassInfo | null;
  status: string | null;
}
