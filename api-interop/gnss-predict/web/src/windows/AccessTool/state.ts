// สถานะของ Access tool (spec §4, STK ref §F) แบบฟังก์ชันล้วน: ต้นไม้ Associated Objects, ชุดปลายทางที่ส่งให้ server, รายการที่เป็นตัวหนา,
// body ของ Compute / Clear / Remove และ object ของรายงาน ไม่แตะ store และ React
//
// - Access For เป็น Facility: ต้นไม้ Constellation → Satellite (ดาวที่ไม่อยู่ใน Constellation ใดต่อท้ายเป็นรายการเดี่ยว)
//   Access For เป็น Satellite: รายการ Facility ติ๊กได้เฉพาะใบ (ดาวหรือ Facility) ช่องของ Constellation ติ๊ก/เอาออกทั้งกลุ่ม
// - ชุดปลายทาง (P8): Constellation ที่ติ๊กสมาชิกครบใช้ path ของ Constellation (server จับคู่ access ด้วยชุด `to` ที่เท่ากัน)
//   ที่เหลือเป็น path ของดาวรายดวง เรียงตามลำดับใน doc
// - ตัวหนา = access ที่ `computed: true` และผล analyze ของ Facility ต้นทาง current (คู่ P1 `*/Facility/THBK *\/Satellite/G01`)
// - Access For เป็นดาว: server รับ (ดาว, [Facility เดียว]) แล้วสลับเอง ที่นี่ส่งเป็น Facility → [ดาว] ทีละ Facility ตรง ๆ
//   (Clear All / Remove All แบบ "all" ใช้ได้เฉพาะ Facility จึงไล่ access ของแต่ละ Facility ที่ปลายทางเป็นดาวนี้ดวงเดียว)

import type { components } from "../../api/types.gen";
import type { ScenarioDoc } from "../../stores/scenario";

export type AccessGraphics = Required<components["schemas"]["AccessGraphics"]>;
export type AccessTimePeriod = components["schemas"]["AccessTimePeriod"];

const FACILITY = "*/Facility/";
const SATELLITE = "*/Satellite/";
const CONSTELLATION = "*/Constellation/";

export type AccessForClass = "Facility" | "Satellite";

export interface AssocNode {
  path: string;
  name: string;
  cls: "Constellation" | "Satellite" | "Facility";
  /** สมาชิกของ Constellation (เฉพาะดาวที่มีอยู่ใน doc) */
  children?: AssocNode[];
}

/** กราฟิกตั้งต้นของ access ใหม่ (ตรงกับค่าตั้งต้นของ AccessGraphics ใน server) */
export const DEFAULT_GRAPHICS: Readonly<AccessGraphics> = Object.freeze({
  show: true, static_highlight: false, animate_highlight: false, animate_line: true, color_mode: "object", custom_color: null, inherit: true,
});

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** ชนิดของ Access For: Facility หรือ Satellite ที่มีอยู่ใน doc ไม่งั้น null */
export function accessForClass(doc: ScenarioDoc | null, from: string | null): AccessForClass | null {
  if (doc === null || from === null) return null;
  const obj = doc.objects.find((o) => `*/${o.class}/${o.name}` === from);
  return obj?.class === "Facility" || obj?.class === "Satellite" ? obj.class : null;
}

const pathsOf = (doc: ScenarioDoc, cls: "Facility" | "Satellite"): string[] =>
  doc.objects.filter((o) => o.class === cls).map((o) => `*/${cls}/${o.name}`);

/** สมาชิกของแต่ละ Constellation (เฉพาะดาวที่มีอยู่ใน doc ไม่ซ้ำ ตามลำดับใน assigned_objects) เรียงตามลำดับ Constellation ใน doc */
function constellations(doc: ScenarioDoc): [path: string, members: string[]][] {
  const satellites = new Set(pathsOf(doc, "Satellite"));
  return doc.objects
    .filter((o) => o.class === "Constellation")
    .map((o) => {
      const assigned = (o as { assigned_objects?: unknown }).assigned_objects;
      const members = Array.isArray(assigned) ? assigned.filter((p): p is string => typeof p === "string" && satellites.has(p)) : [];
      return [`${CONSTELLATION}${o.name}`, [...new Set(members)]];
    });
}

/** ต้นไม้ Associated Objects ของ Access For (ไม่ใช่ Facility/Satellite ที่มีอยู่ = []) */
export function associatedTree(doc: ScenarioDoc | null, from: string | null): AssocNode[] {
  const cls = accessForClass(doc, from);
  if (doc === null || cls === null) return [];
  const leaf = (path: string, kind: "Satellite" | "Facility"): AssocNode => ({ path, name: nameOf(path), cls: kind });
  if (cls === "Satellite") return pathsOf(doc, "Facility").map((p) => leaf(p, "Facility"));
  const groups = constellations(doc);
  const grouped = new Set(groups.flatMap(([, members]) => members));
  return [
    ...groups.map(([path, members]): AssocNode => ({ path, name: nameOf(path), cls: "Constellation", children: members.map((m) => leaf(m, "Satellite")) })),
    ...pathsOf(doc, "Satellite").filter((p) => !grouped.has(p)).map((p) => leaf(p, "Satellite")),
  ];
}

/** ใบทุกใบของต้นไม้ (ดาวหรือ Facility ไม่ซ้ำ ตามลำดับที่เห็น) ใช้กับ Select All */
export function leavesOf(tree: readonly AssocNode[]): string[] {
  const out = new Set<string>();
  for (const node of tree) for (const leaf of node.children ?? (node.cls === "Constellation" ? [] : [node])) out.add(leaf.path);
  return [...out];
}

/**
 * ชุดปลายทาง (`to`) ของรายการที่ติ๊ก (path ของใบ): Constellation ที่สมาชิกถูกติ๊กครบ (มีสมาชิกอย่างน้อยหนึ่ง) = path ของ Constellation
 * แทนสมาชิกของมัน ใบที่เหลือเรียงตามลำดับใน doc
 */
export function targetsOf(checked: ReadonlySet<string>, doc: ScenarioDoc | null): string[] {
  if (doc === null) return [];
  const out: string[] = [];
  const covered = new Set<string>();
  for (const [path, members] of constellations(doc)) {
    if (members.length > 0 && members.every((m) => checked.has(m))) {
      out.push(path);
      for (const m of members) covered.add(m);
    }
  }
  const leaves = [...pathsOf(doc, "Satellite"), ...pathsOf(doc, "Facility")];
  for (const path of leaves) if (checked.has(path) && !covered.has(path)) out.push(path);
  return out;
}

/** สถานะผล analyze ต่อชื่อ Facility (จาก useResults().info.access) */
export type StatusByFacility = Readonly<Record<string, "current" | "stale" | "missing" | undefined>>;

/**
 * คู่ P1 (`*\/Facility/THBK *\/Satellite/G01`) ที่แสดงเป็นตัวหนา: access ที่ `computed: true` และผลของ Facility ต้นทาง current
 * Constellation ใน `to` ขยายเป็นสมาชิกที่มีอยู่ใน doc ณ ตอนนี้
 */
export function computedSatellites(doc: ScenarioDoc | null, statusByFacility: StatusByFacility): Set<string> {
  const out = new Set<string>();
  if (doc === null) return out;
  const members = new Map(constellations(doc));
  for (const access of doc.accesses ?? []) {
    if (access.computed !== true || !access.from.startsWith(FACILITY)) continue;
    if (statusByFacility[nameOf(access.from)] !== "current") continue;
    for (const to of access.to) {
      for (const sat of to.startsWith(CONSTELLATION) ? (members.get(to) ?? []) : to.startsWith(SATELLITE) ? [to] : []) out.add(`${access.from} ${sat}`);
    }
  }
  return out;
}

/** คู่ P1 ของ Access For กับใบหนึ่งใบ (Facility มาก่อนเสมอ) */
export const pairOf = (from: string, leaf: string): string => (from.startsWith(FACILITY) ? `${from} ${leaf}` : `${leaf} ${from}`);

/** object ของรายงาน/กราฟ: คู่ P1 ของทุกใบที่ติ๊ก ตามลำดับใน doc */
export function reportObjects(doc: ScenarioDoc | null, from: string | null, checked: ReadonlySet<string>): string[] {
  if (doc === null || from === null || accessForClass(doc, from) === null) return [];
  const leaves = [...pathsOf(doc, "Satellite"), ...pathsOf(doc, "Facility")];
  return leaves.filter((p) => checked.has(p)).map((p) => pairOf(from, p));
}

/** (from, to) หนึ่งชุดที่ส่งให้ /access/compute, /clear หรือ /remove */
export interface AccessSelection {
  from: string;
  to: string[] | "all";
}

/**
 * ชุดที่จะส่งของรายการที่ติ๊ก: Facility = หนึ่งชุด (Facility, ปลายทางทั้งหมด), Satellite = หนึ่งชุดต่อ Facility ที่ติ๊ก (Facility, [ดาว])
 * ไม่มีอะไรติ๊ก หรือ Access For ใช้ไม่ได้ = []
 */
export function selections(doc: ScenarioDoc | null, from: string | null, checked: ReadonlySet<string>): AccessSelection[] {
  const cls = accessForClass(doc, from);
  if (cls === null || from === null) return [];
  const to = targetsOf(checked, doc);
  if (to.length === 0) return [];
  return cls === "Facility" ? [{ from, to }] : to.filter((p) => p.startsWith(FACILITY)).map((facility) => ({ from: facility, to: [from] }));
}

/**
 * ชุดของ Clear All / Remove All: Facility = (Facility, "all"); Satellite = access ทุกตัวที่ปลายทางเป็นดาวนี้ดวงเดียว (ตัวที่รวมดาวนี้ใน
 * Constellation หรือกับดาวอื่นไม่ใช่ของดาวนี้คนเดียว จึงไม่แตะ) ไม่มี = []
 */
export function allSelections(doc: ScenarioDoc | null, from: string | null): AccessSelection[] {
  const cls = accessForClass(doc, from);
  if (doc === null || cls === null || from === null) return [];
  if (cls === "Facility") return [{ from, to: "all" }];
  const facilities = new Set<string>();
  for (const a of doc.accesses ?? []) if (a.to.length === 1 && a.to[0] === from && a.from.startsWith(FACILITY)) facilities.add(a.from);
  return [...facilities].map((facility) => ({ from: facility, to: [from] }));
}
