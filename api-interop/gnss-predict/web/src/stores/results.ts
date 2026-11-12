// ผลลัพธ์ที่คำนวณแล้วของ scenario ที่เปิดอยู่ (spec server §6.5): สถานะ bundle, manifest ของ ephem, DOP ของ Facility แรกที่มีผล current
// refresh() ดึง /results แล้วโหลดไฟล์ที่ต้องใช้เมื่อ ephem เป็น current เท่านั้น (stale/missing = ไม่มีไฟล์ที่ใช้ได้ หน้าต่าง 3D/2D แสดงแค่ Facility พร้อมแถบแจ้ง)
// รอบใหม่ยกเลิกรอบเก่าด้วย AbortController และทิ้งคำตอบที่มาช้า

import { create } from "zustand";
import { apiGet, apiGetText, errorText, isAbortError, type ApiError } from "../api/client";
import { msg } from "../labels/messages.th";
import { parseAerCsv, parseDopCsv, prnByNoradOf, type AerRow, type DopRow, type EphemManifest } from "../data/files";
import { report } from "./messages";
import { useScenario } from "./scenario";

export type ResultsStatus = "unknown" | "current" | "stale" | "missing";

export interface BundleEntry {
  hash: string | null;
  status: "current" | "stale" | "missing";
  available: string[];
}

export interface ResultsInfo {
  ephem: BundleEntry;
  access: Record<string, BundleEntry>;
  error: { code: string; text: string } | null;
}

interface ResultsState {
  /** สถานะ ephem; unknown = ยังไม่ได้ดึงหรือดึงไม่สำเร็จ */
  status: ResultsStatus;
  info: ResultsInfo | null;
  manifest: EphemManifest | null;
  prnByNorad: Map<number, string>;
  /** แถว system == "ALL" ของ Facility แรกที่ผล analyze เป็น current */
  dop: DopRow[];
  dopFacility: string | null;
  refresh(): Promise<void>;
  /** ล้างทั้งหมดและยกเลิก refresh ที่ค้างอยู่ (ปิดหรือสลับ scenario) */
  reset(): void;
  /** URL ไฟล์ใน bundle ephem ที่ current (scene.czml, manifest.json, predicted.sp3) ไม่มี = null */
  ephemUrl(file: string): string | null;
  /** URL ไฟล์ใน bundle access ที่ current ของ Facility (access.czml, intervals.json, aer.csv, dop.csv, legacy_gps.csv) ไม่มี = null */
  accessUrl(facility: string, file: string): string | null;
  /** แถว DOP ล่าสุดที่เวลา ≤ t; ก่อนแถวแรก หรือเลยแถวสุดท้ายไปเกินหนึ่ง step = undefined */
  dopAt(t: Date): DopRow | undefined;
  /** aer.csv ของ Facility (จำไว้ต่อ hash); ไม่มีผล current = [] ผิดพลาดโยนต่อ */
  loadAer(facility: string): Promise<AerRow[]>;
}

const EMPTY = {
  status: "unknown" as ResultsStatus,
  info: null,
  manifest: null,
  prnByNorad: new Map<number, string>(),
  dop: [] as DopRow[],
  dopFacility: null,
};

let inflight: AbortController | null = null;
const enc = encodeURIComponent;

/**
 * aer.csv ที่โหลดแล้ว จำไว้ไม่เกิน AER_CACHE_MAX ไฟล์ (ไฟล์ใหญ่ ผลของ Facility หลายตัวไม่ควรค้างในหน่วยความจำ) ไล่ตัวที่ไม่ได้ใช้นานสุดออก
 * (Map เรียงตามลำดับที่ใส่ จึงใช้ delete แล้ว set ย้ายตัวที่เพิ่งใช้ไปท้าย)
 * aerLoading: การโหลดที่ยังไม่เสร็จต่อกุญแจ ผู้เรียกพร้อมกันรอคำขอเดียวกัน ล้างทั้งสองเมื่อ reset
 */
export const AER_CACHE_MAX = 4;
const aerCache = new Map<string, AerRow[]>();
const aerLoading = new Map<string, Promise<AerRow[]>>();

function clearAerCache(): void {
  aerCache.clear();
  aerLoading.clear();
}

function aerCacheGet(key: string): AerRow[] | undefined {
  const rows = aerCache.get(key);
  if (rows !== undefined) {
    aerCache.delete(key);
    aerCache.set(key, rows);
  }
  return rows;
}

function aerCachePut(key: string, rows: AerRow[]): void {
  aerCache.delete(key);
  aerCache.set(key, rows);
  while (aerCache.size > AER_CACHE_MAX) aerCache.delete(aerCache.keys().next().value as string);
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * manifest.json ที่ใช้ได้: object ที่มี satellites เป็นรายการของ object (แถบสถานะ ภาพ 3D/2D และ About อ่านช่องของดาวแต่ละดวงโดยตรง)
 * ไม่งั้น RangeError: optional() เตือนแล้วถือว่าไม่มี manifest แทนที่จะให้ส่วนที่อ่านมันพังตอนวาด
 */
function assertManifest(x: unknown): EphemManifest {
  if (!isRecord(x) || !Array.isArray(x.satellites) || !x.satellites.every(isRecord)) {
    throw new RangeError('manifest.json: "satellites" is not a list of satellites');
  }
  return x as EphemManifest;
}

/** ไฟล์เสริมโหลดไม่ได้: แจ้งเตือนใน Message Viewer (ยกเว้นยกเลิกหรือสายหลุด ซึ่งแถบสถานะแจ้งอยู่แล้ว) แล้วคืน null */
async function optional<T>(file: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (e) {
    if (isAbortError(e) || (e as ApiError).code === "NETWORK") return null;
    report("warning", "RESULT_FILE", msg("results.fileFailed", { file, message: errorText(e) }));
    return null;
  }
}

export const useResults = create<ResultsState>()((set, get) => ({
  ...EMPTY,

  refresh: async () => {
    inflight?.abort();
    const name = useScenario.getState().name;
    if (name === null) {
      inflight = null;
      clearAerCache();
      set({ ...EMPTY });
      return;
    }
    const ctl = new AbortController();
    inflight = ctl;
    const { signal } = ctl;
    const base = `/scenarios/${enc(name)}`;
    try {
      const { data: info } = await apiGet<ResultsInfo>(`${base}/results`, { signal });
      if (signal.aborted) return;
      const status: ResultsStatus = info.ephem.status;
      const hash = status === "current" ? info.ephem.hash : null;
      const sameBundle = hash !== null && get().info?.ephem.hash === hash;
      // สถานะขึ้นก่อน (แถบเตือนไม่ต้องรอไฟล์) ไฟล์ของ bundle เดิมคงไว้ ไม่กะพริบ
      set({ status, info, ...(sameBundle ? {} : { manifest: null, prnByNorad: new Map(), dop: [], dopFacility: null }) });
      if (hash === null) return;
      const dopFacility = Object.entries(info.access).find(([, e]) => e.status === "current" && e.hash !== null)?.[0] ?? null;
      const [manifest, dop] = await Promise.all([
        optional("manifest.json", () => apiGet<unknown>(`${base}/ephem/${hash}/manifest.json`, { signal }).then((r) => assertManifest(r.data))),
        dopFacility === null
          ? Promise.resolve<DopRow[] | null>([])
          : optional("dop.csv", async () => parseDopCsv(await apiGetText(`${base}/access/${enc(dopFacility)}/${info.access[dopFacility].hash}/dop.csv`, { signal }))),
      ]);
      if (signal.aborted) return;
      set({ manifest, prnByNorad: prnByNoradOf(manifest), dop: dop ?? [], dopFacility: dop === null ? null : dopFacility });
    } catch (e) {
      if (signal.aborted || isAbortError(e)) return;
      if ((e as ApiError).code === "NETWORK") return; // สายหลุด: คงสถานะเดิม แถบสถานะแจ้งอยู่แล้ว
      set({ ...EMPTY });
      report("error", (e as ApiError).code ?? "RESULTS", msg("results.failed", { message: errorText(e) }));
    }
  },

  reset: () => {
    inflight?.abort();
    inflight = null;
    clearAerCache();
    set({ ...EMPTY });
  },

  ephemUrl: (file) => {
    const name = useScenario.getState().name;
    const e = get().info?.ephem;
    return name === null || e === undefined || e.status !== "current" || e.hash === null ? null : `/api/scenarios/${enc(name)}/ephem/${e.hash}/${file}`;
  },

  accessUrl: (facility, file) => {
    const name = useScenario.getState().name;
    const e = get().info?.access[facility];
    return name === null || e === undefined || e.status !== "current" || e.hash === null ? null : `/api/scenarios/${enc(name)}/access/${enc(facility)}/${e.hash}/${file}`;
  },

  dopAt: (t) => {
    const rows = get().dop;
    const ms = t.getTime();
    if (rows.length === 0 || !(ms >= rows[0].t)) return undefined;
    // แถวสุดท้ายที่ t ≤ ms (ค้นแบบทวิภาค)
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rows[mid].t <= ms) lo = mid;
      else hi = mid - 1;
    }
    const step = rows.length >= 2 ? rows[rows.length - 1].t - rows[rows.length - 2].t : 0;
    return lo === rows.length - 1 && ms > rows[lo].t + step ? undefined : rows[lo];
  },

  loadAer: async (facility) => {
    const name = useScenario.getState().name;
    const url = get().accessUrl(facility, "aer.csv");
    const hash = get().info?.access[facility]?.hash;
    if (name === null || url === null || !hash) return [];
    const key = `${name}/${facility}/${hash}`;
    const cached = aerCacheGet(key);
    if (cached !== undefined) return cached;
    const loading = aerLoading.get(key);
    if (loading !== undefined) return loading;
    let load: Promise<AerRow[]> | undefined;
    load = (async () => {
      try {
        const rows = parseAerCsv(await apiGetText(url));
        if (aerLoading.get(key) === load) aerCachePut(key, rows); // reset ระหว่างโหลด = ผลของ scenario ที่ปิดไปแล้ว ไม่เก็บ
        return rows;
      } finally {
        if (aerLoading.get(key) === load) aerLoading.delete(key);
      }
    })();
    aerLoading.set(key, load);
    return load;
  },
}));
