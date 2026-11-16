import { createContext, useContext } from "react";
import type { GroundTarget } from "./viewingGeometry";
export type Site = {
  id: string;
  name: string;
  subtitle: string;
  timezone: string;
  lon: number;
  lat: number;
  color: string;
};
export type Scene = {
  id: string;
  site_id: string;
  platform: string;
  center_utc: string;
  start_utc: string;
  end_utc: string;
  polarization: string;
  incidence_deg: number;
  view_azimuth_deg_raw: number;
  duration_s: number;
  range_resolution_m: number;
  slant_range_m: number;
  products: string[];
  ready: boolean;
  footprint: { coordinates: number[][][] };
  stac_url: string;
  gec_public_url: string;
  sicd_public_url: string;
  cphd_public_url: string;
  [key: string]: any;
};
export type Job = {
  id: string;
  scene_id: string;
  site_id: string;
  kind: string;
  state: string;
  progress: number;
  message: string;
  error?: string;
};
export type StudioState = {
  groundTarget: GroundTarget | null;
  setGroundTarget: (value: GroundTarget | null) => void;
  imageMode: string;
  setImageMode: (value: string) => void;
  sites: Site[];
  scenes: Scene[];
  site: Site;
  selected: Scene | null;
  detail: any;
  jobs: Job[];
  loading: boolean;
  error: string;
  filter: string;
  setFilter: (v: string) => void;
  setSite: (v: string) => void;
  select: (id: string) => void;
  run: (kind: string, params?: any) => Promise<void>;
  refresh: () => Promise<void>;
  message: (v: string) => void;
  view: string;
  setView: (v: string) => void;
  reference: string;
  setReference: (v: string) => void;
  sample: number;
  setSample: (v: number) => void;
  overlay: boolean;
  setOverlay: (v: boolean) => void;
  candidate: number | null;
  setCandidate: (v: number | null) => void;
  review: (status: string, kind: string) => Promise<void>;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  api: any;
  setApi: (v: any) => void;
};
export const Studio = createContext<StudioState>(null!);
export const useStudio = () => useContext(Studio);
export async function request(path: string, options?: RequestInit) {
  const r = await fetch("/api/eo" + path, options);
  if (!r.ok) {
    let text = await r.text();
    try {
      text = JSON.parse(text).detail;
    } catch {}
    throw new Error(typeof text === "string" ? text : JSON.stringify(text));
  }
  return r.json();
}
export function localTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
