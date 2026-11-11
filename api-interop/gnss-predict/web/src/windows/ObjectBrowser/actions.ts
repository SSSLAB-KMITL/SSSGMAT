// สิ่งที่ Object Browser ทำ (เลือก พับ เขียน คัดลอก/วาง ค้นหา) เป็นฟังก์ชันที่อ่านและเขียนผ่าน store ทั้งหมด ไม่รู้จัก React
// หน้าต่าง (ObjectBrowser.tsx) กับคำสั่งระดับแอป (objectCommands.ts) เรียกชุดเดียวกัน คำสั่งจึงทำงานได้แม้หน้าต่างไม่ได้เปิดอยู่
// การเขียนทุกอย่างผ่านเมธอดของ useScenario (เข้าคิวเขียนทีละอย่างในนั้น) ข้อผิดพลาดลง Message Viewer (writes.ts)

import { confirm } from "../../chrome/Dialogs";
import { msg } from "../../labels/messages.th";
import { useLayout } from "../../stores/layout";
import { useScenario, type ObjectPages } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";
import { copyName, useClipboard } from "./clipboard";
import { useObjectBrowser } from "./state";
import { expandableKeys, findMatches, flattenTree, isEditable, isSatellite, ROOT_KEY, type Row } from "./tree";
import { attempt } from "../../api/writes";

// ---------- แถวทั้งต้นไม้ ----------

export interface ObjectRows {
  /** key ของโหนดที่พับได้ทั้งหมด */
  allKeys: ReadonlySet<string>;
  /** ทุกโหนดเปิดหมด: ไว้หาแถวที่เลือกอยู่แม้โฟลเดอร์พับ ใช้ค้น และให้คำสั่งวางใช้สมาชิกครบของโฟลเดอร์ */
  allRows: readonly Row[];
  rowByKey: ReadonlyMap<string, Row>;
}

const NO_ROWS: ObjectRows = { allKeys: new Set(), allRows: [], rowByKey: new Map() };
let cached: { tree: unknown; doc: unknown; catalog: unknown; rows: ObjectRows } | null = null;

/** แถวของ scenario ที่เปิดอยู่ (คำนวณใหม่เมื่อ tree, doc หรือ catalog เปลี่ยนเท่านั้น) */
export function objectRows(): ObjectRows {
  const { tree, doc, catalog } = useScenario.getState();
  if (tree === null) return NO_ROWS;
  if (cached !== null && cached.tree === tree && cached.doc === doc && cached.catalog === catalog) return cached.rows;
  const allKeys = new Set(expandableKeys(tree));
  const allRows = flattenTree(tree, allKeys);
  const rows = { allKeys, allRows, rowByKey: new Map(allRows.map((row) => [row.key, row])) };
  cached = { tree, doc, catalog, rows };
  return rows;
}

export const hasTree = (): boolean => useScenario.getState().tree !== null;

// ---------- การเลือก การพับ ----------

export const selectedKey = (): string | null => useObjectBrowser.getState().groupSelected ?? useSelection.getState().activePath;

export function selectedRow(): Row | undefined {
  const key = selectedKey();
  return key === null ? undefined : objectRows().rowByKey.get(key);
}

/** เลือกแถว: object = active object ของแอป, โฟลเดอร์ = เก็บที่นี่ (ไม่ใช่ object) และไม่มี active object */
export function selectKey(key: string): void {
  const row = objectRows().rowByKey.get(key);
  if (row === undefined) return;
  if (row.kind === "group") {
    useObjectBrowser.setState({ groupSelected: row.key });
    useSelection.getState().select(null);
  } else {
    useObjectBrowser.setState({ groupSelected: null });
    useSelection.getState().select(row.path ?? null);
  }
}

export function setOpen(key: string, open: boolean): void {
  useObjectBrowser.setState((s) => {
    if (s.collapsed.has(key) === !open) return s;
    const next = new Set(s.collapsed);
    if (open) next.delete(key);
    else next.add(key);
    return { collapsed: next };
  });
}

/** เปิดโฟลเดอร์ที่พับครอบแถวนี้อยู่ */
export function reveal(key: string): void {
  const { rowByKey } = objectRows();
  const ancestors: string[] = [];
  for (let parent = rowByKey.get(key)?.parentKey ?? null; parent !== null; parent = rowByKey.get(parent)?.parentKey ?? null) ancestors.push(parent);
  useObjectBrowser.setState((s) => (ancestors.some((k) => s.collapsed.has(k)) ? { collapsed: new Set([...s.collapsed].filter((k) => !ancestors.includes(k))) } : s));
}

export const requestScroll = (key: string | null): void => useObjectBrowser.setState({ scrollTarget: key });

export const expandAll = (): void => useObjectBrowser.setState({ collapsed: new Set() });
/** พับทุกโฟลเดอร์ แต่ราก (Scenario) ยังเปิดอยู่ เห็น Facility, Constellation และโฟลเดอร์ */
export const collapseAll = (): void => useObjectBrowser.setState({ collapsed: new Set([...objectRows().allKeys].filter((key) => key !== ROOT_KEY)) });

/** เปิดหรือโฟกัสหน้าต่าง Object Browser (คำสั่งที่ต้องมีหน้าจอ: Find, New Group, Rename, ตัวกรองธง) ไม่มีพื้นที่ทำงานให้เปิด = ไม่ทำอะไร */
export function showObjectBrowser(): void {
  const layout = useLayout.getState();
  if (layout.api === null) return;
  try {
    layout.openPanel("objectBrowser");
  } catch {
    // พื้นที่ทำงานเปิดหน้าต่างตอนนี้ไม่ได้: สถานะที่ตั้งไว้แล้วจะแสดงเมื่อหน้าต่างเปิด
  }
}

// ---------- งานที่กำลังเขียน ----------

const busyCount = new Map<string, number>();

function markBusy(keys: readonly string[], on: boolean): void {
  for (const key of keys) {
    const n = (busyCount.get(key) ?? 0) + (on ? 1 : -1);
    if (n > 0) busyCount.set(key, n);
    else busyCount.delete(key);
  }
  useObjectBrowser.setState({ busy: new Set(busyCount.keys()) });
}

async function whileBusy<T>(keys: readonly string[], work: () => Promise<T>): Promise<T> {
  markBusy(keys, true);
  try {
    return await work();
  } finally {
    markBusy(keys, false);
  }
}

// ---------- การกระทำกับ object ----------

export function openProperties(row: Row): void {
  if (row.kind === "object") useLayout.getState().openPanel("propertiesBrowser", { path: row.path, name: row.name });
}

const showPages = (show: boolean): ObjectPages => ({ graphics2d: { show }, graphics3d: { show } });

/**
 * ติ๊ก Show: Satellite และ Facility ตั้ง show ของหน้า 2D และ 3D; Constellation ไม่มีหน้ากราฟิก จึงตั้งของสมาชิกทีละดวงตามลำดับ
 * (ดวงที่ซ่อนติ๊กไม่ได้ ดวงที่เป็นค่านั้นอยู่แล้วไม่ต้องเขียน สมาชิกที่เป็น Constellation ซ้อนไม่มีหน้ากราฟิกจึงข้าม) หยุดที่ดวงแรกที่ล้มเหลว
 * แถวที่กำลังเขียนอยู่ (และสมาชิกที่ Constellation กำลังไล่เขียน) ปิดช่องติ๊กไว้จนเสร็จ การสั่งซ้ำระหว่างนั้นไม่ทำอะไร
 */
export async function setShow(row: Row, show: boolean): Promise<void> {
  if (!isEditable(row) || useObjectBrowser.getState().busy.has(row.key)) return;
  const patch = (target: { cls: string; name: string; path: string }) =>
    attempt(() => useScenario.getState().patchObject(target.cls, target.name, showPages(show)), target.path);
  if (row.cls !== "Constellation") {
    await whileBusy([row.key], () => patch(row));
    return;
  }
  const { rowByKey } = objectRows();
  const busy = useObjectBrowser.getState().busy;
  const members = (row.members ?? [])
    .map((path) => rowByKey.get(path))
    .filter((m): m is Row & { cls: "Satellite" | "Facility"; path: string } => m !== undefined && (m.cls === "Satellite" || m.cls === "Facility"))
    .filter((m) => !m.hidden && m.show !== show && !busy.has(m.key));
  await whileBusy([row.key, ...members.map((m) => m.key)], async () => {
    for (const member of members) if (!(await patch(member)).ok) return;
  });
}

export async function setColor(row: Row, color: string): Promise<void> {
  if (!isEditable(row)) return;
  // Constellation มีสีของตัวเอง (สมาชิกที่ inherit ตาม) ส่วน Facility และ Satellite ตั้งสีที่หน้า 2D Graphics และเลิก inherit
  const pages: ObjectPages = row.cls === "Constellation" ? { basic: { color } } : { graphics2d: { color, inherit: false } };
  await attempt(() => useScenario.getState().patchObject(row.cls, row.name, pages), row.path);
}

export async function deleteRow(row: Row): Promise<void> {
  if (!isEditable(row)) return;
  if (!(await confirm(msg("confirm.delete", { name: row.name })))) return;
  const done = await attempt(() => useScenario.getState().remove(row.cls, row.name), row.path);
  if (done.ok && useSelection.getState().activePath === row.path) useSelection.getState().select(null);
}

// ---------- Cut / Copy / Paste (W15) ----------

export function copyRow(mode: "cut" | "copy", row: Row): void {
  if (isSatellite(row)) useClipboard.getState().set(mode, [row.path]);
}

export async function paste(): Promise<void> {
  const content = useClipboard.getState().content;
  const store = useScenario.getState();
  if (content === null || content.paths.length === 0) return;
  if (content.mode === "copy") {
    const objects = store.doc?.objects ?? [];
    const taken = new Set(objects.map((o) => o.name));
    let created: string | undefined;
    for (const path of content.paths) {
      const source = objects.find((o) => o.class === "Satellite" && `*/Satellite/${o.name}` === path);
      if (source === undefined || source.class !== "Satellite") continue; // ดาวที่คัดลอกไว้ถูกลบไปแล้ว
      const name = copyName(source.name, taken);
      taken.add(name);
      const done = await attempt(() => store.insert({ class: "Satellite", method: "Define Properties", name, norad: source.norad }), `*/Satellite/${name}`);
      if (!done.ok) return;
      created = done.value[0] ?? created;
    }
    if (created !== undefined) {
      useObjectBrowser.setState({ groupSelected: null });
      useSelection.getState().select(created);
      requestScroll(created);
    }
    return;
  }
  const target = selectedRow();
  if (target?.kind !== "group") return;
  const present = new Set(objectRows().allRows.filter((row) => row.cls === "Satellite").map((row) => row.path));
  const moving = content.paths.filter((path) => present.has(path)); // ดาวที่ตัดไว้แล้วถูกลบหรือเปลี่ยนชื่อไปแล้วไม่ย้าย
  if (moving.length === 0) {
    useClipboard.getState().clear();
    return;
  }
  // ย้ายดาวเข้ากลุ่ม = ตั้งสมาชิกของกลุ่มใหม่ทั้งหมด (server ตั้งสมาชิกตรงตัว และดึงดาวออกจากกลุ่มอื่นเอง)
  const members = [...new Set([...(target.members ?? []), ...moving])];
  const done = await attempt(() => store.setGroup(target.name, members));
  if (done.ok) useClipboard.getState().clear();
}

// ---------- Find ----------

/**
 * เลือกแถวที่ตรงถัดไป (direction 1) หรือก่อนหน้า (-1) วนรอบ; คืนว่าพบไหม
 * คำค้นเดิม = ต่อจากแถวที่เลือกอยู่ตอนนี้ (ผู้ใช้ย้ายไปเลือกที่อื่นหลังจากพบครั้งก่อน ก็ค้นต่อจากตรงนั้น ไม่ใช่จากแถวที่พบครั้งก่อน);
 * คำค้นใหม่ = เริ่มที่แถวแรก (หรือสุดท้ายถ้าย้อนกลับ) ค้นเฉพาะแถวที่เห็นภายใต้ตัวกรองธง และเปิดโฟลเดอร์ที่พับครอบแถวที่พบ
 */
export function find(query: string, direction: 1 | -1): boolean {
  const { tree } = useScenario.getState();
  if (tree === null) return false;
  const { flaggedOnly, findAnchor } = useObjectBrowser.getState();
  const rows = flattenTree(tree, objectRows().allKeys, { flaggedOnly });
  const matches = findMatches(rows, query);
  if (matches.length === 0) return false;
  const position = new Map(rows.map((row, i) => [row.key, i]));
  const current = selectedKey();
  const from = findAnchor?.query === query ? (current !== null && position.has(current) ? current : findAnchor.key) : null;
  const at = from === null ? undefined : position.get(from);
  let next: Row;
  if (at === undefined) next = direction === 1 ? matches[0] : matches[matches.length - 1];
  else if (direction === 1) next = matches.find((row) => (position.get(row.key) ?? -1) > at) ?? matches[0];
  else next = [...matches].reverse().find((row) => (position.get(row.key) ?? -1) < at) ?? matches[matches.length - 1];
  useObjectBrowser.setState({ findAnchor: { query, key: next.key } });
  selectKey(next.key);
  reveal(next.key);
  requestScroll(next.key);
  return true;
}
