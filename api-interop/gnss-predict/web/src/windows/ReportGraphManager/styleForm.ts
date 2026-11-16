// ฟอร์มของหน้าต่างแก้ style (spec §5.1): แปลง style (spec §3.3 + ช่อง P3) ไปเป็นฟอร์มและกลับ แบบที่ style ทุกตัวของ Installed Styles กลับมาเหมือนเดิมทุกช่อง
//
// - styleFromForm เขียนเฉพาะช่องที่ engine รู้จัก (check_style ปฏิเสธช่องที่ไม่รู้จัก) ตามลำดับเดียวกับ installed.json
//   time.start/stop เขียนเฉพาะ mode specify (engine ไม่รับใน object_period), graph.stack เขียนเฉพาะเมื่อ style เดิมมีหรือผู้ใช้ตั้ง,
//   style รายงานมี graph เป็น null เสมอ
// - รายการสถิติ (per_object / global_statistics) เก็บตามที่ได้มา ติ๊กใน Summary แล้วจึงเรียงใหม่ตามลำดับ Number of Accesses, Min, Max, Mean,
//   Total, Std Deviation (ลำดับของ Installed Styles) style ที่ไม่ได้แตะจึงกลับมาเหมือนเดิม
//   Summary Only ติ๊ก = สถิติอยู่ใน per_object (สรุปต่อ object แบบ AccessSummary) ไม่ติ๊ก = global_statistics (ท้ายรายงานแบบ Access)
// - หลาย Data Provider ใน content: engine รวมแถวตาม Time ทุกตัวจึงต้องมี Time (addColumn ใส่ให้เอง formProblem เตือนถ้าขาด)
// - Dynamic Display/Strip Chart ได้เฉพาะ style ที่ทุก provider ใช้กับ Dynamic Displays ไม่มี derive ไม่ใช่ Summary Only และกราฟเป็น time_xy (canDynamic)

import type { GraphDef, GraphType, ProviderInfo, StyleContent, StyleDef, StyleKind, StyleObjectType, StyleTime } from "../../data/reports";
import { msg } from "../../labels/messages.th";

export const TIME = "Time";
export const NUMBER_OF_ACCESSES = "Number of Accesses";
export const ACCESS_DATA = "Access Data";
/** ฟังก์ชันสถิติตามลำดับของ Summary (และลำดับใน Installed Styles) */
export const STAT_FUNCTIONS = ["Min", "Max", "Mean", "Total", "Std Deviation"] as const;
export type StatFunction = (typeof STAT_FUNCTIONS)[number];

export type Axis = "y1" | "y2";

export interface StyleForm {
  name: string;
  kind: StyleKind;
  objectType: StyleObjectType;
  content: StyleContent[];
  time: { mode: StyleTime["mode"]; stepS: number | null; start: string | null; stop: string | null };
  summary: { perObject: string[]; global: string[]; summaryOnly: boolean };
  /** style รายงาน = null; stack ไม่ระบุ = ไม่เขียนช่องนี้ */
  graph: { type: GraphType; y1: string[]; y2: string[]; stack?: boolean } | null;
  dynamic: boolean;
  derive: "gaps" | null;
  ours: boolean;
}

/** หนึ่งคอลัมน์ของ Report Contents / Graph Contents (entry = ตำแหน่งใน content) */
export interface FormColumn {
  entry: number;
  provider: string;
  group: string | null;
  element: string;
}

const copyContent = (content: readonly StyleContent[]): StyleContent[] => content.map((c) => ({ provider: c.provider, group: c.group, elements: [...c.elements] }));

export function formFromStyle(style: StyleDef): StyleForm {
  const g: GraphDef | null = style.kind === "graph" ? style.graph : null;
  return {
    name: style.name,
    kind: style.kind,
    objectType: style.object_type,
    content: copyContent(style.content),
    time: { mode: style.time.mode, stepS: style.time.step_s, start: style.time.start ?? null, stop: style.time.stop ?? null },
    summary: { perObject: [...style.summary.per_object], global: [...style.summary.global_statistics], summaryOnly: style.summary.summary_only },
    graph: g === null ? null : { type: g.type, y1: [...g.y1], y2: [...g.y2], ...(g.stack === undefined ? {} : { stack: g.stack }) },
    dynamic: style.dynamic,
    derive: style.derive,
    ours: style.ours,
  };
}

export function styleFromForm(form: StyleForm): StyleDef {
  const time: StyleTime = { mode: form.time.mode, step_s: form.time.stepS };
  if (form.time.mode === "specify") {
    if (form.time.start !== null) time.start = form.time.start;
    if (form.time.stop !== null) time.stop = form.time.stop;
  }
  const f = form.graph;
  const graph: GraphDef | null = form.kind === "report" || f === null
    ? null
    : { type: f.type, y1: [...f.y1], y2: [...f.y2], ...(f.stack === undefined ? {} : { stack: f.stack }) };
  return {
    name: form.name,
    kind: form.kind,
    object_type: form.objectType,
    content: copyContent(form.content),
    time,
    summary: { per_object: [...form.summary.perObject], global_statistics: [...form.summary.global], summary_only: form.summary.summaryOnly },
    graph,
    dynamic: form.dynamic,
    derive: form.derive,
    ours: form.ours,
  };
}

/** ฟอร์มของ New... (กราฟใหม่เริ่มเป็น Time XY ไม่มีแกน) */
export function newForm(kind: StyleKind, objectType: StyleObjectType, name = ""): StyleForm {
  return {
    name, kind, objectType, content: [],
    time: { mode: "object_period", stepS: null, start: null, stop: null },
    summary: { perObject: [], global: [], summaryOnly: false },
    graph: kind === "graph" ? { type: "time_xy", y1: [], y2: [] } : null,
    dynamic: false, derive: null, ours: false,
  };
}

/** คอลัมน์ทั้งหมดตามลำดับในรายงาน */
export function columnsOf(form: StyleForm): FormColumn[] {
  return form.content.flatMap((c, entry) => c.elements.map((element) => ({ entry, provider: c.provider, group: c.group, element })));
}

/** ชื่อ element ทั้งหมดใน content (ไม่ซ้ำ) */
export const elementsOf = (form: StyleForm): string[] => [...new Set(form.content.flatMap((c) => c.elements))];

const hasTime = (providers: readonly ProviderInfo[], provider: string): boolean =>
  providers.find((p) => p.name === provider)?.elements.some((e) => e.name === TIME) ?? false;

/**
 * Add: element ไปท้ายกลุ่มของ provider/group เดียวกัน (ไม่มี = กลุ่มใหม่ท้าย content) มีอยู่แล้ว = ไม่เปลี่ยน
 * กลุ่มใหม่ตัวที่สองขึ้นไป (หลาย provider รวมตาม Time) ได้ Time ให้เองทั้งกลุ่มใหม่และกลุ่มเดิมที่ยังไม่มี ถ้า provider นั้นมี Time
 */
export function addColumn(form: StyleForm, col: { provider: string; group: string | null; element: string }, providers: readonly ProviderInfo[] = []): StyleForm {
  const content = copyContent(form.content);
  const at = content.findIndex((c) => c.provider === col.provider && c.group === col.group);
  if (at >= 0) {
    if (!content[at].elements.includes(col.element)) content[at].elements.push(col.element);
    return { ...form, content };
  }
  content.push({ provider: col.provider, group: col.group, elements: [col.element] });
  if (content.length > 1) {
    for (const c of content) if (!c.elements.includes(TIME) && hasTime(providers, c.provider)) c.elements.unshift(TIME);
  }
  return { ...form, content };
}

/** สถิติ "<ฟังก์ชัน> <element>" ของ element นั้นไหม */
const statOf = (stat: string, element: string): boolean => STAT_FUNCTIONS.some((f) => stat === `${f} ${element}`);

/** ตัดแกนและสถิติที่อ้าง element ซึ่งไม่อยู่ใน content แล้ว */
function prune(form: StyleForm): StyleForm {
  const have = new Set(elementsOf(form));
  const keepStat = (s: string): boolean => s === NUMBER_OF_ACCESSES ? form.content.some((c) => c.provider === ACCESS_DATA) : !STAT_FUNCTIONS.some((f) => s.startsWith(`${f} `)) || [...have].some((e) => statOf(s, e));
  const graph = form.graph === null ? null : { ...form.graph, y1: form.graph.y1.filter((e) => have.has(e)), y2: form.graph.y2.filter((e) => have.has(e)) };
  return { ...form, graph, summary: { ...form.summary, perObject: form.summary.perObject.filter(keepStat), global: form.summary.global.filter(keepStat) } };
}

/** Remove: คอลัมน์ที่ i (กลุ่มที่ว่างแล้วหายไป) แกนและสถิติของ element ที่ไม่เหลือในรายงานหายตาม */
export function removeColumn(form: StyleForm, i: number): StyleForm {
  const col = columnsOf(form)[i];
  if (col === undefined) return form;
  const content = copyContent(form.content);
  content[col.entry].elements = content[col.entry].elements.filter((e) => e !== col.element);
  return prune({ ...form, content: content.filter((c) => c.elements.length > 0) });
}

/** Up (-1) / Down (+1): สลับคอลัมน์ที่ i กับตัวข้างเคียงในกลุ่มเดียวกัน (ข้ามกลุ่มไม่ได้ เพราะ content เรียงเป็นกลุ่มของ provider) */
export function moveColumn(form: StyleForm, i: number, dir: -1 | 1): StyleForm {
  const cols = columnsOf(form);
  const a = cols[i];
  const b = cols[i + dir];
  if (a === undefined || b === undefined || a.entry !== b.entry) return form;
  const content = copyContent(form.content);
  const els = content[a.entry].elements;
  const ia = els.indexOf(a.element);
  const ib = els.indexOf(b.element);
  [els[ia], els[ib]] = [els[ib], els[ia]];
  return { ...form, content };
}

/** แกนของ element ในกราฟ (null = ไม่แสดง) */
export const axisOf = (form: StyleForm, element: string): Axis | null =>
  form.graph?.y1.includes(element) ? "y1" : form.graph?.y2.includes(element) ? "y2" : null;

export function setAxis(form: StyleForm, element: string, axis: Axis | null): StyleForm {
  if (form.graph === null) return form;
  const y1 = form.graph.y1.filter((e) => e !== element);
  const y2 = form.graph.y2.filter((e) => e !== element);
  if (axis === "y1") y1.push(element);
  if (axis === "y2") y2.push(element);
  return { ...form, graph: { ...form.graph, y1, y2 } };
}

export function setGraphType(form: StyleForm, type: GraphType): StyleForm {
  return form.graph === null ? form : { ...form, graph: { ...form.graph, type } };
}

/** ตำแหน่งในลำดับมาตรฐาน: Number of Accesses ก่อน แล้วตาม STAT_FUNCTIONS (ที่ไม่รู้จักไว้ท้าย ลำดับเดิม) */
function rank(stat: string): number {
  if (stat === NUMBER_OF_ACCESSES) return 0;
  const i = STAT_FUNCTIONS.findIndex((f) => stat.startsWith(`${f} `));
  return i < 0 ? STAT_FUNCTIONS.length + 1 : i + 1;
}
const ordered = (list: readonly string[]): string[] => [...list].map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);

/** รายการสถิติที่ Summary แก้อยู่ตอนนี้ */
export const activeStats = (form: StyleForm): string[] => (form.summary.summaryOnly ? form.summary.perObject : form.summary.global);

/** ติ๊ก/เลิกติ๊กสถิติ (ชื่อเต็ม เช่น "Min Duration" หรือ "Number of Accesses") ในรายการที่ Summary แก้อยู่ */
export function toggleStat(form: StyleForm, stat: string, on: boolean): StyleForm {
  const list = activeStats(form).filter((s) => s !== stat);
  const next = ordered(on ? [...list, stat] : list);
  return { ...form, summary: form.summary.summaryOnly ? { ...form.summary, perObject: next } : { ...form.summary, global: next } };
}

/** Summary Only: ย้ายสถิติที่ติ๊กไว้ไปอีกรายการ (สรุปต่อ object ↔ Global Statistics) */
export function setSummaryOnly(form: StyleForm, on: boolean): StyleForm {
  if (form.summary.summaryOnly === on) return form;
  const { perObject, global } = form.summary;
  return on
    ? { ...form, summary: { perObject: ordered([...new Set([...perObject, ...global])]), global: [], summaryOnly: true } }
    : { ...form, summary: { perObject: [], global: ordered([...new Set([...global, ...perObject])]), summaryOnly: false } };
}

/** provider ที่ไม่ใช้กับ Dynamic Display (ค่าเดียวกับ engine dataproviders: Access Data ใช้กับ Reports เท่านั้น) ไว้ใช้เมื่อไม่มีรายการ provider */
const REPORT_ONLY = new Set([ACCESS_DATA]);

/**
 * style นี้สร้างเป็น Dynamic Display/Strip Chart ได้ไหม (ตามกฎ dynamic ของ engine check_style): ติ๊ก dynamic ไว้ ทุก provider ใช้กับ Dynamic Displays
 * ไม่มี derive ไม่ใช่ Summary Only และกราฟ (ถ้ามี) เป็น time_xy; providers = รายการจาก /dataproviders (ไม่ส่ง = ใช้ REPORT_ONLY)
 */
export function canDynamic(style: StyleDef, providers?: readonly ProviderInfo[]): boolean {
  if (!style.dynamic || style.derive !== null || style.summary.summary_only) return false;
  if (style.graph !== null && style.graph.type !== "time_xy") return false;
  return style.content.every((c) => {
    const info = providers?.find((p) => p.name === c.provider);
    return info === undefined ? !REPORT_ONLY.has(c.provider) : info.uses.includes("Dynamic Displays");
  });
}

/** ข้อผิดพลาดของฟอร์มที่บอกได้ก่อนส่ง (ข้อความไทย) ไม่มี = null; ที่เหลือ server ตรวจ (422 STYLE_INVALID) */
export function formProblem(form: StyleForm): string | null {
  if (form.content.length === 0) return msg("styleEditor.noColumns");
  if (form.content.length > 1) {
    const missing = form.content.filter((c) => !c.elements.includes(TIME)).map((c) => c.provider);
    if (missing.length > 0) return msg("styleEditor.joinNeedsTime", { providers: missing.join(", ") });
  }
  if (form.kind === "graph" && form.graph?.type === "time_xy" && form.graph.y1.length === 0 && form.graph.y2.length === 0) return msg("styleEditor.noAxis");
  return null;
}
