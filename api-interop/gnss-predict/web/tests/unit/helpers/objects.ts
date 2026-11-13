// scenario ปลอมสำหรับ test ของ Object Browser: ต้นไม้ตามรูปของ GET /objects (Facility, Constellation, โฟลเดอร์กลุ่ม, ดาวที่ไม่อยู่ในกลุ่ม) + doc + catalog

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CatalogEntry } from "../../../src/data/catalog";
import { useScenario, type ObjectTree, type ScenarioDoc, type TreeObject } from "../../../src/stores/scenario";
import { makeDoc } from "./chrome";

type Flags = string[];

export const entry = (n: number, flags: Flags = [], over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  prn: `G${String(n).padStart(2, "0")}`,
  system: "GPS",
  svn: `G${60 + n}`,
  norad: 40100 + n,
  block: "IIF",
  celestrak_name: `GPS BIIF-${n}  (PRN ${n})`,
  omm_epoch: "2026-11-11T00:00:00Z",
  age_days: 1.26,
  flags,
  ...over,
});

/** G01 G02 ปกติ, G03 no_broadcast (ซ่อน), G04 stale (⚠), G05 name_mismatch อย่างเดียว (ไม่มี ⚠) */
export const CATALOG: CatalogEntry[] = [
  entry(1),
  entry(2),
  entry(3, ["no_broadcast"]),
  entry(4, ["stale"], { age_days: 3.04 }),
  entry(5, ["name_mismatch"]),
];

export const satPath = (name: string) => `*/Satellite/${name}`;
export const sensorPath = (name: string) => `*/Sensor/${name}`;
export const SENSOR_COLOR = "#e8c547";
/** ดาวหนึ่งโหนดในต้นไม้: ดาวที่มี Sensor มี children ตามที่ server ส่ง (ไม่มี Sensor = ไม่มีคีย์ children) */
const sat = (name: string, color = "#ffd23f", show = true, sensors: string[] = []): TreeObject => ({
  path: satPath(name), class: "Satellite", name, color, show,
  ...(sensors.length > 0 ? { children: sensors.map((s): TreeObject => ({ path: sensorPath(s), class: "Sensor", name: s, color: SENSOR_COLOR, show: true })) } : {}),
});

/** Sensor ตามชื่อดาวแม่: { G01: ["Sensor1", "Sensor2"] } (ชื่อ Sensor ห้ามซ้ำกับชื่อ scenario "S1" เพราะ test หาแถวด้วยชื่อ) */
export type SensorsOf = Record<string, string[]>;

export function makeTree(over: { sats?: string[]; groups?: { group: string; children: string[] }[]; loose?: string[]; sensors?: SensorsOf } = {}): ObjectTree {
  const groups = over.groups ?? [{ group: "GPS sats", children: ["G01", "G02"] }, { group: "Mine", children: [] }];
  const loose = over.loose ?? ["G03", "G04", "G05"];
  const node = (name: string): TreeObject => sat(name, "#ffd23f", true, over.sensors?.[name]);
  return {
    path: "*",
    class: "Scenario",
    name: "S1",
    children: [
      { path: "*/Facility/THBK", class: "Facility", name: "THBK", color: "#ff79e6", show: true },
      { path: "*/Constellation/GPS", class: "Constellation", name: "GPS", color: "#ffd23f", show: true },
      ...groups.map((g) => ({ group: g.group, children: g.children.map(node) })),
      ...loose.map(node),
    ],
  };
}

/** Sensor ใน doc ตามสคีมา (ค่าตั้งต้นของ STK: Simple Conic 45°, ชี้ Az 0 El 90, สี #e8c547) */
export const sensorObj = (name: string, parent: string, graphics2d: Record<string, unknown> = {}) => ({
  class: "Sensor", name, parent: satPath(parent), description: "", long_description: "",
  definition: { type: "Simple Conic", cone_half_angle: 45 },
  pointing: { type: "Fixed", orientation: "Az-El", azimuth: 0, elevation: 90, about_boresight: "Rotate" },
  graphics2d: { show: true, color: SENSOR_COLOR, fill: false, fill_translucency: 50, ...graphics2d },
  graphics3d: { show: true, color: SENSOR_COLOR, show_radial_lines: true, show_boresight_marker: false },
});

export function makeScenarioDoc(extra: Partial<ScenarioDoc> = {}, sensors: SensorsOf = {}): ScenarioDoc {
  const sats = ["G01", "G02", "G03", "G04", "G05"];
  return makeDoc({
    name: "S1",
    objects: [
      { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
      { class: "Constellation", name: "GPS", system: "G", assigned_objects: [satPath("G01"), satPath("G02")] },
      ...sats.map((name, i) => ({ class: "Satellite", name, norad: 40101 + i })),
      ...Object.entries(sensors).flatMap(([parent, names]) => names.map((name) => sensorObj(name, parent))),
    ] as never,
    groups: [{ name: "GPS sats", members: [satPath("G01"), satPath("G02")] }, { name: "Mine", members: [] }],
    satellite_filter: { show_too_old: false, show_no_broadcast: false },
    ...extra,
  });
}

/**
 * ตัวแปรสี --color-* จาก theme.css ใส่ที่ <html> (jsdom ไม่โหลด CSS ของแอป) กล่องสีของ Object Browser จึงได้สีของระบบแบบเดียวกับหน้าจริง
 * (themeTokens ใน cesium/colors.ts อ่านตัวแปรเหล่านี้; ไม่มีค่า = ขาวทุกระบบ)
 */
export function applyThemeColors(): void {
  const css = readFileSync(resolve(import.meta.dirname, "../../../src/theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const seen = new Set<string>();
  for (const m of css.matchAll(/(--color-[\w-]+)\s*:\s*([^;]+);/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    document.documentElement.style.setProperty(m[1], m[2].trim());
  }
}

/** เปิด scenario ปลอม S1 พร้อมต้นไม้และ catalog (ไม่ผ่านเครือข่าย) และสีของธีม (applyThemeColors) */
export function loadObjects(opts: { tree?: ObjectTree; doc?: ScenarioDoc; catalog?: CatalogEntry[] } = {}): { tree: ObjectTree; doc: ScenarioDoc } {
  applyThemeColors();
  const tree = opts.tree ?? makeTree();
  const doc = opts.doc ?? makeScenarioDoc();
  useScenario.setState({ name: "S1", doc, etag: '"e1"', tree, catalog: new Map((opts.catalog ?? CATALOG).map((e) => [e.norad, e])) });
  return { tree, doc };
}

/** เปิด scenario ปลอมที่ดาวบางดวงมี Sensor (ต้นไม้และ doc ตรงกัน) */
export function loadSensors(sensors: SensorsOf, opts: { catalog?: CatalogEntry[] } = {}): { tree: ObjectTree; doc: ScenarioDoc } {
  return loadObjects({ tree: makeTree({ sensors }), doc: makeScenarioDoc({}, sensors), catalog: opts.catalog });
}
