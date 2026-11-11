// ต้นไม้ของ Object Browser (spec §7) เป็นแถวแบนสำหรับวาดแบบ virtual list
// - ต้นไม้จาก GET /objects: ราก (Scenario), Facility, Constellation, โฟลเดอร์กลุ่ม {group, children}, แล้วดาวที่ไม่อยู่ในกลุ่มใด
//   Constellation ไม่มีลูกในต้นไม้ (สมาชิกของมันแสดงในโฟลเดอร์/ดาวที่ไม่อยู่ในกลุ่ม)
// - ต้นไม้ไม่มี NORAD ของดาว: ธง (ซ่อน/⚠) และ tooltip มาจาก catalog ผ่าน NORAD ที่อยู่ใน doc.objects (W9) จึงจับคู่ได้แม้ดาวเปลี่ยนชื่อหรือถูกคัดลอก
// - key ของแถว: ราก "*", object = path ของมัน, โฟลเดอร์ = `group:<ชื่อ>` (ชื่อกลุ่มเป็นข้อความอิสระ จึงมีคำนำหน้ากันชนกับ path)

import { satelliteInfo, type SatelliteInfo } from "../../data/catalog";
import { t, type LabelKey } from "../../labels/labels";
import { MSG_KEYS, msg, type MsgKey } from "../../labels/messages.th";
import { useScenario, type ObjectTree, type TreeGroup, type TreeNode, type TreeObject } from "../../stores/scenario";

export type RowClass = "Scenario" | TreeObject["class"];

export interface Row {
  key: string;
  depth: number;
  kind: "object" | "group";
  /** object เท่านั้น ("*" = Scenario) */
  path?: string;
  cls?: RowClass;
  name: string;
  /** object ที่มีกล่องสีเท่านั้น (Facility, Constellation, Satellite) */
  color?: string;
  /** object ที่มีช่องติ๊กเท่านั้น; Constellation = ทุกดาวสมาชิกแสดงอยู่ */
  show?: boolean;
  /** ดาวที่ตัวกรองของ scenario ซ่อน (W9): แสดงตัวเอียงสีจาง ติ๊ก Show ไม่ได้ */
  hidden: boolean;
  /** ดาวที่มีธงอื่นนอกจาก name_mismatch (W9) */
  warn: boolean;
  tooltip: string;
  parentKey: string | null;
  expandable: boolean;
  expanded: boolean;
  /** ดาวที่อยู่ใน catalog */
  prn?: string;
  /** โฟลเดอร์ = path ของดาวที่อยู่ข้างใน (ตามที่ต้นไม้ส่งมา); Constellation = assigned_objects */
  members?: string[];
}

export type EditableRow = Row & { cls: Exclude<RowClass, "Scenario">; path: string };

/** แถวที่มีช่องติ๊ก Show และกล่องสี: Facility, Constellation, Satellite */
export const hasToggle = (row: Row): boolean => row.kind === "object" && row.cls !== undefined && row.cls !== "Scenario";
/** Facility, Constellation, Satellite: เปลี่ยนชื่อ ลบ และเลือกสีได้ */
export const isEditable = (row: Row | undefined): row is EditableRow => row !== undefined && hasToggle(row);
export const isSatellite = (row: Row | undefined): row is Row & { path: string } => row?.kind === "object" && row.cls === "Satellite";

export const ROOT_KEY = "*";
export const groupKey = (name: string): string => `group:${name}`;
const isGroup = (node: TreeNode): node is TreeGroup => "group" in node;

/** key ของโหนดที่พับ/ขยายได้: ราก (ถ้ามีลูก) และโฟลเดอร์ที่มีสมาชิก */
export function expandableKeys(tree: ObjectTree): string[] {
  const keys = tree.children.length > 0 ? [ROOT_KEY] : [];
  for (const child of tree.children) if (isGroup(child) && child.children.length > 0) keys.push(groupKey(child.group));
  return keys;
}

// ---------- ข้อมูลที่ต้นไม้ไม่มี ----------

export interface TreeContext {
  noradOf(path: string): number | undefined;
  info(norad: number): SatelliteInfo | undefined;
  /** assigned_objects ของ Constellation */
  membersOf(path: string): string[] | undefined;
}

/** อ่านจาก scenario ที่เปิดอยู่ (doc.objects สำหรับ NORAD และสมาชิก, catalog สำหรับธง) */
export function storeContext(): TreeContext {
  const norads = new Map<string, number>();
  const members = new Map<string, string[]>();
  for (const o of useScenario.getState().doc?.objects ?? []) {
    const path = `*/${o.class}/${o.name}`;
    if (o.class === "Satellite") norads.set(path, o.norad);
    else if (o.class === "Constellation") members.set(path, [...(o.assigned_objects ?? [])]);
  }
  return { noradOf: (p) => norads.get(p), info: satelliteInfo, membersOf: (p) => members.get(p) };
}

// ---------- tooltip ----------

const FLAG_LABELS: Record<string, LabelKey> = {
  stale: "option.flag.stale",
  too_old: "option.flag.tooOld",
  no_broadcast: "option.flag.noBroadcast",
  unhealthy: "option.flag.unhealthy",
  prn_changed: "option.flag.prnChanged",
  name_mismatch: "option.flag.nameMismatch",
};

/** ชื่อธงตามด้วยคำอธิบายไทย ("Too Old: ข้อมูลวงโคจรเก่ากว่า 7 วัน ...") ธงที่ไม่รู้จักแสดงรหัสตามที่ได้ */
export function flagLine(flag: string): string {
  const text = `flag.${flag}`;
  const explanation = (MSG_KEYS as string[]).includes(text) ? msg(text as MsgKey) : "";
  const name = Object.hasOwn(FLAG_LABELS, flag) ? t(FLAG_LABELS[flag]) : flag;
  return explanation === "" ? name : `${name}: ${explanation}`;
}

/** PRN, SVN, NORAD, Block, ชื่อ CelesTrak, อายุข้อมูล (ทศนิยม 1 ตำแหน่ง) และธงทั้งหมดเป็นภาษาไทย บรรทัดละเรื่อง */
function satelliteTooltip(name: string, norad: number | undefined, info: SatelliteInfo | undefined): string {
  if (info === undefined) return norad === undefined ? name : [name, `${t("field.norad")}: ${norad}`].join("\n");
  const age = Number.isFinite(info.age_days) ? `${info.age_days.toFixed(1)} d` : "—";
  return [
    `${t("field.prn")}: ${info.prn}`,
    `${t("field.svn")}: ${info.svn}`,
    `${t("field.norad")}: ${info.norad}`,
    `${t("field.block")}: ${info.block}`,
    `${t("field.celestrakName")}: ${info.celestrak_name}`,
    `${t("field.dataAge")}: ${age}`,
    ...info.flags.map(flagLine),
  ].join("\n");
}

// ---------- แถว ----------

export interface FlattenOptions {
  /** ซ่อนทุกอย่างยกเว้นดาวที่ ⚠ กับโฟลเดอร์ที่ยังมีดาวนั้นอยู่ (ob.showFlagged) */
  flaggedOnly?: boolean;
  /** ไม่ระบุ = อ่านจาก store */
  context?: TreeContext;
}

/**
 * ต้นไม้เป็นแถวแบนตามลำดับที่เห็น `expanded` คือ key ของโหนดที่ขยายอยู่ (ไม่มีในชุด = พับ: ชุดว่างเหลือแถวรากแถวเดียว)
 */
export function flattenTree(tree: ObjectTree, expanded: ReadonlySet<string>, opts: FlattenOptions = {}): Row[] {
  const ctx = opts.context ?? storeContext();
  const shows = new Map<string, boolean>();
  for (const child of tree.children) {
    if (isGroup(child)) for (const member of child.children) shows.set(member.path, member.show);
    else shows.set(child.path, child.show);
  }

  const warns = (node: TreeObject): boolean => {
    const norad = node.class === "Satellite" ? ctx.noradOf(node.path) : undefined;
    return norad !== undefined && ctx.info(norad)?.warn === true;
  };
  let children = tree.children;
  if (opts.flaggedOnly === true) {
    children = children.flatMap<TreeNode>((child) => {
      if (!isGroup(child)) return warns(child) ? [child] : [];
      const kept = child.children.filter(warns);
      return kept.length > 0 ? [{ group: child.group, children: kept }] : [];
    });
  }

  const rows: Row[] = [];
  const objectRow = (node: TreeObject, depth: number, parentKey: string): Row => {
    const row: Row = {
      key: node.path, depth, kind: "object", path: node.path, cls: node.class, name: node.name, color: node.color, show: node.show,
      hidden: false, warn: false, tooltip: "", parentKey, expandable: false, expanded: false,
    };
    if (node.class === "Satellite") {
      const norad = ctx.noradOf(node.path);
      const info = norad === undefined ? undefined : ctx.info(norad);
      row.hidden = info?.hidden ?? false;
      row.warn = info?.warn ?? false;
      row.prn = info?.prn;
      row.tooltip = satelliteTooltip(node.name, norad, info);
    } else {
      if (node.class === "Constellation") {
        const members = ctx.membersOf(node.path) ?? [];
        // ดาวที่ถูกซ่อนติ๊ก Show ไม่ได้ จึงไม่นับ: ไม่งั้น Constellation ที่ติ๊กครบทุกดาวที่ติ๊กได้แล้วก็ยังไม่ติ๊กเพราะดาวที่ซ่อน
        const known = members.filter((path) => {
          const norad = ctx.noradOf(path);
          return shows.has(path) && !(norad !== undefined && ctx.info(norad)?.hidden === true);
        });
        row.members = members;
        if (known.length > 0) row.show = known.every((path) => shows.get(path) === true);
      }
      row.tooltip = `${t(node.class === "Facility" ? "ob.class.facility" : "ob.class.constellation")}: ${node.name}`;
    }
    return row;
  };

  rows.push({
    key: ROOT_KEY, depth: 0, kind: "object", path: ROOT_KEY, cls: "Scenario", name: tree.name, hidden: false, warn: false,
    tooltip: `${t("ob.class.scenario")}: ${tree.name}`, parentKey: null, expandable: children.length > 0, expanded: expanded.has(ROOT_KEY),
  });
  if (!expanded.has(ROOT_KEY)) return rows;

  for (const child of children) {
    if (!isGroup(child)) {
      rows.push(objectRow(child, 1, ROOT_KEY));
      continue;
    }
    const key = groupKey(child.group);
    const open = expanded.has(key) && child.children.length > 0;
    rows.push({
      key, depth: 1, kind: "group", name: child.group, hidden: false, warn: false, tooltip: `${t("ob.class.group")}: ${child.group}`,
      parentKey: ROOT_KEY, expandable: child.children.length > 0, expanded: expanded.has(key), members: child.children.map((m) => m.path),
    });
    if (open) for (const member of child.children) rows.push(objectRow(member, 2, key));
  }
  return rows;
}

/** แถวที่ชื่อหรือ PRN มีข้อความที่ค้น (ไม่สนตัวพิมพ์เล็กใหญ่ ตัดช่องว่างหัวท้ายของคำค้น) ตามลำดับที่เห็น คำค้นว่าง = ไม่ตรงอะไร */
export function findMatches(rows: readonly Row[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return rows.filter((row) => row.name.toLowerCase().includes(q) || (row.prn?.toLowerCase().includes(q) ?? false));
}
