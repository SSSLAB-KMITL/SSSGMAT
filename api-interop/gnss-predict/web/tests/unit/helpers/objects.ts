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
const sat = (name: string, color = "#ffd23f", show = true): TreeObject => ({ path: satPath(name), class: "Satellite", name, color, show });

export function makeTree(over: { sats?: string[]; groups?: { group: string; children: string[] }[]; loose?: string[] } = {}): ObjectTree {
  const groups = over.groups ?? [{ group: "GPS sats", children: ["G01", "G02"] }, { group: "Mine", children: [] }];
  const loose = over.loose ?? ["G03", "G04", "G05"];
  return {
    path: "*",
    class: "Scenario",
    name: "S1",
    children: [
      { path: "*/Facility/THBK", class: "Facility", name: "THBK", color: "#ff79e6", show: true },
      { path: "*/Constellation/GPS", class: "Constellation", name: "GPS", color: "#ffd23f", show: true },
      ...groups.map((g) => ({ group: g.group, children: g.children.map((n) => sat(n)) })),
      ...loose.map((n) => sat(n)),
    ],
  };
}

export function makeScenarioDoc(extra: Partial<ScenarioDoc> = {}): ScenarioDoc {
  const sats = ["G01", "G02", "G03", "G04", "G05"];
  return makeDoc({
    name: "S1",
    objects: [
      { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
      { class: "Constellation", name: "GPS", system: "G", assigned_objects: [satPath("G01"), satPath("G02")] },
      ...sats.map((name, i) => ({ class: "Satellite", name, norad: 40101 + i })),
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
