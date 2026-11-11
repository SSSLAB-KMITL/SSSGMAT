// รายชื่อดาวใน snapshot (GET /api/catalog) และกติกาธง W9
// ซ่อน = (too_old และ show_too_old ปิด) หรือ (no_broadcast และ show_no_broadcast ปิด); ⚠ = มีธงอื่นนอกจาก name_mismatch
// โหลดครั้งเดียวต่อการเปิด scenario (stores/scenario.ts) กรองฝั่งหน้าเว็บ จึงเปลี่ยนตัวกรองแล้วไม่ต้องเรียก server อีก

import { useScenario } from "../stores/scenario";

export interface CatalogEntry {
  prn: string;
  system: string;
  svn: string;
  norad: number;
  block: string;
  celestrak_name: string;
  omm_epoch: string;
  age_days: number;
  flags: string[];
}

/** ตัวกรองดาวของ scenario (satellite_filter) ที่ไม่มีหรือขาดช่อง = ปิด */
export interface SatelliteFilterLike {
  show_too_old?: boolean;
  show_no_broadcast?: boolean;
}

export type SatelliteInfo = CatalogEntry & { hidden: boolean; warn: boolean };

export function describeSatellite(entry: CatalogEntry, filter: SatelliteFilterLike | null | undefined): SatelliteInfo {
  const flags = entry.flags ?? [];
  const hidden = (flags.includes("too_old") && !(filter?.show_too_old ?? false))
    || (flags.includes("no_broadcast") && !(filter?.show_no_broadcast ?? false));
  const warn = flags.some((f) => f !== "name_mismatch");
  return { ...entry, hidden, warn };
}

/** ข้อมูลดาวของ scenario ที่เปิดอยู่ตาม NORAD (ไม่ผ่านชื่อ: ดาวที่เปลี่ยนชื่อหรือคัดลอกยังจับคู่ได้) ไม่พบ = undefined */
export function satelliteInfo(norad: number): SatelliteInfo | undefined {
  const { catalog, doc } = useScenario.getState();
  const entry = catalog.get(norad);
  return entry === undefined ? undefined : describeSatellite(entry, doc?.satellite_filter);
}
