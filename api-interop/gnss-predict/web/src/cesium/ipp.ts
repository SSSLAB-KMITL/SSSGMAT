// จุดและเส้นทาง IPP (ionospheric pierce point) ของดาวที่ Facility เห็น (ของเราเอง spec §9.3) จาก aer.csv ของ Facility
//
// - จุด: แถวของ epoch ล่าสุดที่ ≤ เวลาปัจจุบัน (เลยแถวสุดท้ายได้ไม่เกินหนึ่ง step ของไฟล์) ที่มุมเงย ≥ มุมเงยต่ำสุดของ Facility และมี IPP
// - เส้นทาง: เฉพาะดาวที่มีจุดตอนนี้ แถวของดาวนั้นในช่วง ±10 นาทีจากเวลาปัจจุบันที่ผ่านเกณฑ์เดียวกัน ตัดเป็นท่อนเมื่อมีแถวที่ไม่ผ่านเกณฑ์
//   หรือ epoch ขาด (ห่างเกิน 1.5 step) ท่อนที่มีจุดเดียวไม่วาด
// - indexAer ทำครั้งเดียวต่อไฟล์ (ไฟล์หนึ่งวันมีราว 150,000 แถว) ippAt ค้นแบบทวิภาค

import type { components } from "../api/types.gen";
import type { AerRow } from "../data/files";
import type { ResultsInfo, ResultsStatus } from "../stores/results";

type ScenarioDoc = components["schemas"]["ScenarioDoc"];
type FacilityObj = components["schemas"]["FacilityObj"];

export const IPP_TRACK_HALF_MS = 600_000;

/** aer.csv ที่ใช้: Facility, มุมเงยต่ำสุดของมัน และกุญแจ scenario/Facility/hash (เปลี่ยน = โหลดใหม่) */
export interface IppSource {
  facility: string;
  minEl: number;
  key: string;
}

/**
 * Facility ที่ใช้ทำ IPP: ตัวแรกตามลำดับใน doc ที่ผล access เป็น current และมี hash (ephem ต้อง current ด้วย) มุมเงยต่ำสุดจาก
 * constraints.elevation_angle_min_deg (ไม่มี = 0) ผลไม่ current หรือไม่มี scenario = null (ไม่แสดง IPP)
 */
export function ippSource(doc: ScenarioDoc | null, name: string | null, results: { status: ResultsStatus; info: ResultsInfo | null }): IppSource | null {
  if (name === null || doc === null || results.status !== "current") return null;
  for (const o of doc.objects) {
    if (o.class !== "Facility") continue;
    const e = results.info?.access[o.name];
    if (e?.status !== "current" || !e.hash) continue;
    const minEl = (o as FacilityObj).constraints?.elevation_angle_min_deg ?? 0;
    return { facility: o.name, minEl, key: `${name}/${o.name}/${e.hash}` };
  }
  return null;
}

export interface IppIndex {
  /** epoch ที่มีในไฟล์ (ms, เรียง) */
  epochs: number[];
  byEpoch: Map<number, AerRow[]>;
  /** แถวของแต่ละดาวเรียงตามเวลา */
  byPrn: Map<string, AerRow[]>;
  /** ระยะห่างของ epoch (ms) ที่น้อยที่สุด ไฟล์ที่มี epoch เดียว = 0 */
  step: number;
}

export interface IppPoint {
  prn: string;
  lat: number;
  lon: number;
  el: number;
}

export interface IppTrack {
  prn: string;
  /** ท่อนของเส้นทาง แต่ละจุดเป็น [lon, lat] */
  segments: [number, number][][];
}

export function indexAer(rows: readonly AerRow[]): IppIndex {
  const byEpoch = new Map<number, AerRow[]>();
  const byPrn = new Map<string, AerRow[]>();
  for (const r of rows) {
    const e = byEpoch.get(r.t);
    if (e === undefined) byEpoch.set(r.t, [r]);
    else e.push(r);
    const p = byPrn.get(r.prn);
    if (p === undefined) byPrn.set(r.prn, [r]);
    else p.push(r);
  }
  const epochs = [...byEpoch.keys()].sort((a, b) => a - b);
  for (const list of byPrn.values()) list.sort((a, b) => a.t - b.t);
  let step = Number.POSITIVE_INFINITY;
  for (let i = 1; i < epochs.length; i++) step = Math.min(step, epochs[i] - epochs[i - 1]);
  return { epochs, byEpoch, byPrn, step: Number.isFinite(step) ? step : 0 };
}

/** ตำแหน่งแรกใน list (เรียง) ที่ค่า ≥ x */
function lowerBound<T>(list: readonly T[], x: number, key: (v: T) => number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (key(list[mid]) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const usable = (r: AerRow, minElDeg: number): r is AerRow & { ipp_lat_deg: number; ipp_lon_deg: number } =>
  r.el_deg >= minElDeg && r.ipp_lat_deg !== null && r.ipp_lon_deg !== null;

/** จุด IPP ณ เวลา tMs และเส้นทาง ±halfMs ของดาวเหล่านั้น (ลำดับตามไฟล์) */
export function ippAt(index: IppIndex, tMs: number, minElDeg: number, halfMs = IPP_TRACK_HALF_MS): { points: IppPoint[]; tracks: IppTrack[] } {
  const { epochs } = index;
  const i = lowerBound(epochs, tMs, (e) => e);
  const at = i < epochs.length && epochs[i] === tMs ? i : i - 1;
  if (at < 0 || tMs - epochs[at] > index.step) return { points: [], tracks: [] };
  const points: IppPoint[] = [];
  for (const r of index.byEpoch.get(epochs[at]) ?? []) {
    if (usable(r, minElDeg)) points.push({ prn: r.prn, lat: r.ipp_lat_deg, lon: r.ipp_lon_deg, el: r.el_deg });
  }
  const gap = index.step * 1.5;
  const tracks = points.map(({ prn }): IppTrack => {
    const list = index.byPrn.get(prn) ?? [];
    const segments: [number, number][][] = [];
    let current: [number, number][] = [];
    let last = Number.NaN;
    const close = (): void => {
      if (current.length >= 2) segments.push(current);
      current = [];
    };
    for (let k = lowerBound(list, tMs - halfMs, (r) => r.t); k < list.length && list[k].t <= tMs + halfMs; k++) {
      const r = list[k];
      if (!usable(r, minElDeg)) {
        close();
        continue;
      }
      if (current.length > 0 && r.t - last > gap) close();
      current.push([r.ipp_lon_deg, r.ipp_lat_deg]);
      last = r.t;
    }
    close();
    return { prn, segments };
  });
  return { points, tracks };
}
