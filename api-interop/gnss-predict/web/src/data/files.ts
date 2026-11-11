// ตัวอ่านไฟล์ผลลัพธ์ใน bundle (spec server §6.5, spec engine §8): dop.csv, aer.csv และ manifest.json ของ ephem
// เวลาทุกช่องอ่านด้วย parseIsoUtc ตัวเดียวกับเวลาอื่นของ API ไฟล์ CSV ของ engine ไม่มีเครื่องหมายคำพูดในช่องใด

import { parseIsoUtc } from "../time/parse";

// ---------- manifest ของ ephem ----------

export interface ManifestSatellite {
  prn: string;
  system: string;
  svn: string;
  norad: number | null;
  block: string;
  celestrak_name: string;
  omm_epoch: string;
  age_days: number | null;
  flags: string[];
  propagated: boolean;
}

export interface EphemManifest {
  satellites: ManifestSatellite[];
  gmat_version?: string;
  [key: string]: unknown;
}

/** NORAD -> PRN ของดาวใน manifest (ดาวที่ไม่มี NORAD ข้าม) ใช้จับคู่ดาวใน scenario กับ entity ใน CZML (W8) */
export function prnByNoradOf(manifest: EphemManifest | null): Map<number, string> {
  const out = new Map<number, string>();
  const satellites: unknown = manifest?.satellites;
  for (const s of Array.isArray(satellites) ? (satellites as ManifestSatellite[]) : []) {
    if (typeof s?.norad === "number" && typeof s.prn === "string") out.set(s.norad, s.prn);
  }
  return out;
}

// ---------- CSV ----------

interface Table {
  /** ตำแหน่งช่องตามชื่อหัวคอลัมน์ */
  col: Record<string, number>;
  rows: string[][];
}

function readTable(text: string, required: readonly string[], what: string): Table {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { col: {}, rows: [] };
  const names = lines[0].split(",").map((c) => c.trim());
  const col: Record<string, number> = {};
  for (const name of required) {
    const i = names.indexOf(name);
    if (i < 0) throw new RangeError(`${what}: header has no column "${name}"`);
    col[name] = i;
  }
  return { col, rows: lines.slice(1).map((l) => l.split(",")) };
}

/** ช่องที่ต้องเป็นจำนวน (นับดาว มุม ระยะ) อ่านไม่ได้ = RangeError */
function need(cell: string | undefined, what: string, line: number, name: string): number {
  const n = cell === undefined || cell.trim() === "" ? Number.NaN : Number(cell);
  if (!Number.isFinite(n)) throw new RangeError(`${what}: line ${line}: "${name}" is not a number: ${JSON.stringify(cell)}`);
  return n;
}

/** ช่องที่ว่างได้ (DOP คำนวณไม่ได้เมื่อมีดาวไม่ถึงสี่ดวง) ว่างหรืออ่านไม่ได้ = null */
function maybe(cell: string | undefined): number | null {
  if (cell === undefined || cell.trim() === "") return null;
  const n = Number(cell);
  return Number.isFinite(n) ? n : null;
}

function timeOf(cell: string | undefined, what: string, line: number): number {
  const d = cell === undefined ? null : parseIsoUtc(cell.trim());
  if (d === null) throw new RangeError(`${what}: line ${line}: "time_utc" is not an ISO 8601 UTC time: ${JSON.stringify(cell)}`);
  return d.getTime();
}

const sortedByTime = <T extends { t: number }>(rows: T[]): T[] =>
  rows.every((r, i) => i === 0 || rows[i - 1].t <= r.t) ? rows : rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.t - b.r.t || a.i - b.i).map((x) => x.r);

// ---------- dop.csv ----------

export interface DopRow {
  time_utc: string;
  /** เวลาเป็น ms จาก epoch (UTC) */
  t: number;
  n_visible: number;
  gdop: number | null;
  pdop: number | null;
  hdop: number | null;
  vdop: number | null;
  edop: number | null;
  ndop: number | null;
  tdop: number | null;
}

const DOP_COLUMNS = ["time_utc", "system", "n_visible", "gdop", "pdop", "hdop", "vdop", "edop", "ndop", "tdop"] as const;

/** dop.csv -> แถวของ system == "ALL" เท่านั้น เรียงตามเวลา (หนึ่งแถวต่อ step) หัวคอลัมน์ขาดหรือช่องเวลา/จำนวนดาวอ่านไม่ได้ = RangeError */
export function parseDopCsv(text: string): DopRow[] {
  const { col, rows } = readTable(text, DOP_COLUMNS, "dop.csv");
  const out: DopRow[] = [];
  rows.forEach((r, i) => {
    if (r[col.system]?.trim() !== "ALL") return;
    const line = i + 2;
    const time_utc = (r[col.time_utc] ?? "").trim();
    out.push({
      time_utc,
      t: timeOf(time_utc, "dop.csv", line),
      n_visible: need(r[col.n_visible], "dop.csv", line, "n_visible"),
      gdop: maybe(r[col.gdop]), pdop: maybe(r[col.pdop]), hdop: maybe(r[col.hdop]), vdop: maybe(r[col.vdop]),
      edop: maybe(r[col.edop]), ndop: maybe(r[col.ndop]), tdop: maybe(r[col.tdop]),
    });
  });
  return sortedByTime(out);
}

// ---------- aer.csv ----------

export interface AerRow {
  time_utc: string;
  t: number;
  prn: string;
  az_deg: number;
  el_deg: number;
  range_km: number;
  ipp_lat_deg: number | null;
  ipp_lon_deg: number | null;
  mf: number | null;
}

const AER_COLUMNS = ["time_utc", "prn", "az_deg", "el_deg", "range_km", "ipp_lat_deg", "ipp_lon_deg", "mf"] as const;

/** aer.csv -> แถวตามลำดับในไฟล์ (เรียงเวลา แล้วตาม PRN) หัวคอลัมน์ขาดหรือช่องเวลา/มุม/ระยะอ่านไม่ได้ = RangeError */
export function parseAerCsv(text: string): AerRow[] {
  const { col, rows } = readTable(text, AER_COLUMNS, "aer.csv");
  return rows.map((r, i) => {
    const line = i + 2;
    const time_utc = (r[col.time_utc] ?? "").trim();
    return {
      time_utc,
      t: timeOf(time_utc, "aer.csv", line),
      prn: (r[col.prn] ?? "").trim(),
      az_deg: need(r[col.az_deg], "aer.csv", line, "az_deg"),
      el_deg: need(r[col.el_deg], "aer.csv", line, "el_deg"),
      range_km: need(r[col.range_km], "aer.csv", line, "range_km"),
      ipp_lat_deg: maybe(r[col.ipp_lat_deg]), ipp_lon_deg: maybe(r[col.ipp_lon_deg]), mf: maybe(r[col.mf]),
    };
  });
}
