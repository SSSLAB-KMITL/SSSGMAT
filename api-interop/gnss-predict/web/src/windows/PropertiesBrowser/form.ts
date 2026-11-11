// ตรรกะล้วนของ Properties Browser (spec §8): ค่าในฟอร์ม <-> หน้าของ server, ตรวจก่อน Apply และ diff ที่ส่งเฉพาะที่เปลี่ยน
// ไม่รู้จัก React และ store
//
// - "root" คือสิ่งที่ฟอร์มแก้: ของ object = { basic, graphics2d, graphics3d, constraints } ตามที่ GET /objects/{cls}/{name} ตอบ,
//   ของ Scenario = ส่วนของเอกสารที่หน้าแก้ (sectionsOf) ทั้งสองเป็นต้นไม้ JSON ธรรมดา ช่องหนึ่งช่องคือ path ในต้นไม้ (key = path คั่นด้วยจุด)
//   key ของช่องจึงเป็นชื่อ field ที่ server ใช้ใน 422 โดยตรง (fieldFromServer แค่ทำให้เป็นรูปเดียวกัน)
// - ค่าในฟอร์ม (Values) เป็นข้อความ/boolean/รายการ ตามที่ input เก็บ ไม่แปลงทิ้งไว้จนถึง Apply: แก้ข้อความไว้ครึ่งทางกลับมาหน้าเดิมแล้วยังเห็นข้อความที่พิมพ์
// - applyValues แปลงเฉพาะช่องที่ผู้ใช้แตะ (ต่างจากค่าตั้งต้นของมัน) และตรวจเฉพาะช่องเหล่านั้น: ค่าที่ server เก็บอยู่แล้วแต่ฟอร์มตรวจไม่ผ่าน
//   (เช่น ตัวเลขใหญ่มาก) ไม่ขวางการแก้ช่องอื่น; ผลคือสำเนาของ root ที่แก้แล้ว ให้ diffPages เทียบกับ root เดิม
// - diffPages ส่งเฉพาะกลุ่มหน้าที่เปลี่ยน และในกลุ่มนั้นเฉพาะใบที่เปลี่ยน (server ผสมแบบ deep-merge): ค่าที่อีกแท็บเพิ่งแก้ในช่องอื่นของกลุ่มเดียวกันไม่ถูกเขียนทับ

import { ENUMS } from "../../api/enums.gen";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import type { ObjectPages, ScenarioDoc } from "../../stores/scenario";
import { formatTime, parseOffset, type DateFormat } from "../../time/format";
import { parseIsoUtc, parseTime } from "../../time/parse";
import { fail, parseDecimal, pass, type Parsed as FieldParsed } from "../fieldRules";

export type ObjectClass = "Facility" | "Satellite" | "Constellation";
export type Tree = Record<string, unknown>;

// ---------- path ในต้นไม้ ----------

const isTree = (x: unknown): x is Tree => typeof x === "object" && x !== null && !Array.isArray(x);

export function getAt(root: Tree, key: string): unknown {
  let node: unknown = root;
  for (const part of key.split(".")) {
    if (!isTree(node)) return undefined;
    node = node[part];
  }
  return node;
}

/** ใส่ค่าที่ path (สร้างส่วนที่ขาดตามทาง) */
export function setAt(root: Tree, key: string, value: unknown): void {
  const parts = key.split(".");
  let node = root;
  for (const part of parts.slice(0, -1)) {
    if (!isTree(node[part])) node[part] = {};
    node = node[part] as Tree;
  }
  node[parts[parts.length - 1]] = value;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isTree(a) && isTree(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// ---------- diff ----------

/** ใบที่ต่างกันของต้นไม้ edited จาก original (object ซ้อนลงไป ส่วนรายการและค่าเดี่ยวเทียบทั้งก้อน) คีย์ที่หายจาก edited ไม่นับ: ฟอร์มไม่ลบช่อง */
export function diffTree(original: Tree, edited: Tree): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(edited)) {
    const before = original[key];
    if (isTree(value) && isTree(before)) {
      const inner = diffTree(before, value);
      if (Object.keys(inner).length > 0) out[key] = inner;
    } else if (!deepEqual(before, value)) {
      out[key] = structuredClone(value);
    }
  }
  return out;
}

/** body ของ PATCH: เฉพาะกลุ่มหน้าที่เปลี่ยน ในกลุ่มนั้นเฉพาะช่องที่เปลี่ยน (ไม่ต่าง = {}) */
export function diffPages(original: ObjectPages, edited: ObjectPages): ObjectPages {
  return diffTree(original, edited) as ObjectPages;
}

/** ผสม patch ลงใน target ในที่เดิม (เหมือนที่ server ผสม PATCH): object ซ้อนผสมทีละชั้น ที่เหลือแทนที่ทั้งก้อน */
export function mergePatch(target: Tree, patch: Tree): void {
  for (const [key, value] of Object.entries(patch)) {
    const current = target[key];
    if (isTree(value) && isTree(current)) mergePatch(current, value);
    else target[key] = structuredClone(value);
  }
}

/** ชื่อ field ของ server (422) -> key ของช่องในฟอร์ม: ตัดดัชนีรายการ ("basic.assigned_objects[0]") และชี้ช่วงเวลาทั้งก้อนที่ Stop */
export function fieldFromServer(field: string): string {
  const key = field.replace(/\[\d+\]/g, "");
  return key === "analysis_period" ? "analysis_period.stop" : key;
}

// ---------- ชนิดของช่อง ----------

export type Value = string | boolean | string[];
export type Values = Record<string, Value>;
export type Errors = Record<string, string>;
/** รูปแบบเวลาที่ช่องเวลาใช้ (DateFormat และ offset ของ units ณ ตอนที่ฟอร์มโหลด) */
export interface TimeContext {
  format: DateFormat;
  offset: string;
}

export type Spec =
  | { kind: "text"; key: string; fallback: string }
  /**
   * gt = มากกว่า (ไม่รวมค่านั้น), min/max = รวมค่านั้น; fallback = ค่าที่ server ใช้เมื่อไม่มีช่องนี้ (null = ว่างได้);
   * notBelow = key ของช่องตัวเลขอีกช่องที่ช่องนี้ต้องไม่น้อยกว่า (Max ไม่ต่ำกว่า Min) ข้ามเมื่อช่องนี้ว่าง
   */
  | { kind: "number"; key: string; fallback: number | null; min?: number; max?: number; gt?: number; notBelow?: string }
  /** fallback null = ว่างได้ (null) และแสดงเป็นข้อความว่าง */
  | { kind: "choice"; key: string; options: readonly string[]; fallback: string | null }
  | { kind: "bool"; key: string; fallback: boolean }
  /** ข้อความว่าง = null */
  | { kind: "color"; key: string }
  | { kind: "list"; key: string }
  /** เวลา ISO ใน API <-> ข้อความตาม DateFormat; fallbackKey = ช่องที่ใช้แทนเมื่อไม่มีช่องนี้; after = ต้องอยู่หลังเวลาของช่องนั้น */
  | { kind: "time"; key: string; fallbackKey?: string; after?: string }
  | { kind: "offset"; key: string; fallback: string };

const text = (key: string, fallback = ""): Spec => ({ kind: "text", key, fallback });
const num = (key: string, fallback: number | null, bounds: { min?: number; max?: number; gt?: number; notBelow?: string } = {}): Spec => ({ kind: "number", key, fallback, ...bounds });
const choice = (key: string, options: readonly string[], fallback: string | null): Spec => ({ kind: "choice", key, options, fallback });
const bool = (key: string, fallback: boolean): Spec => ({ kind: "bool", key, fallback });
const color = (key: string): Spec => ({ kind: "color", key });

const DESCRIPTION: Spec[] = [text("basic.description"), text("basic.long_description")];

const ATTRIBUTES_2D = (sat: boolean): Spec[] => [
  color("graphics2d.color"),
  ...(sat ? [choice("graphics2d.line_style", ENUMS.LineStyle, null), num("graphics2d.line_width", null, { gt: 0 })] : []),
  choice("graphics2d.marker_style", ENUMS.MarkerStyle, null),
  bool("graphics2d.inherit", true),
];

/** ช่องของแต่ละ class ตามสคีมาของ server (schema.py): ขอบเขตของตัวเลขตรงกับ Field(ge/le/gt) ที่นั่น */
export const OBJECT_SPECS: Record<ObjectClass, readonly Spec[]> = {
  Facility: [
    num("basic.position.lat_deg", 0, { min: -90, max: 90 }),
    num("basic.position.lon_deg", 0, { min: -180, max: 180 }),
    num("basic.position.alt_m", 0),
    ...DESCRIPTION,
    num("constraints.elevation_angle_min_deg", 0, { min: -90, max: 90 }),
    num("constraints.elevation_angle_max_deg", null, { min: -90, max: 90, notBelow: "constraints.elevation_angle_min_deg" }),
    ...ATTRIBUTES_2D(false),
  ],
  Satellite: [
    ...DESCRIPTION,
    ...ATTRIBUTES_2D(true),
    choice("graphics2d.pass.lead_type", ENUMS.LeadType, "Time"),
    num("graphics2d.pass.lead_time_s", null, { min: 0 }),
    num("graphics2d.pass.lead_percent", null, { min: 0, max: 100 }),
    choice("graphics2d.pass.trail_type", ENUMS.TrailType, "Time"),
    num("graphics2d.pass.trail_time_s", null, { min: 0 }),
    num("graphics2d.pass.trail_percent", null, { min: 0, max: 100 }),
    choice("graphics2d.pass.visible_sides", ENUMS.VisibleSides, "Both"),
    bool("graphics2d.pass.show_pass_labels", false),
    bool("graphics2d.pass.show_path_labels", false),
    choice("graphics2d.swath.type", ["Ground Elevation"], "Ground Elevation"),
    num("graphics2d.swath.elevation_deg", 10, { min: 0, max: 90 }),
    choice("graphics2d.swath.options", ENUMS.SwathOptions, "No Graphics"),
    choice("graphics3d.orbit_system", ENUMS.OrbitSystem, "Fixed by Window"),
  ],
  Constellation: [...DESCRIPTION, color("basic.color"), { kind: "list", key: "basic.assigned_objects" }],
};

/** ช่องของ Scenario: key = path ในเอกสาร scenario.json ค่าตั้งต้นตรงกับของ server (schema.py) */
export const SCENARIO_SPECS: readonly Spec[] = [
  { kind: "time", key: "analysis_period.start" },
  { kind: "time", key: "analysis_period.stop", after: "analysis_period.start" },
  { kind: "time", key: "animation.start", fallbackKey: "analysis_period.start" },
  choice("animation.update_mode", ENUMS.UpdateMode, "time_step"),
  num("animation.time_step_s", 60, { gt: 0 }),
  num("animation.x_real_time_multiplier", 60, { gt: 0 }),
  choice("animation.cycle", ENUMS.Cycle, "loop"),
  choice("units.date_format", ENUMS.DateFormat, "UTCG"),
  { kind: "offset", key: "units.ltz_offset", fallback: "+07:00" },
  text("description"),
  text("long_description"),
  num("ionosphere.shell_km", 400, { gt: 0 }),
  bool("graphics2d_global.show_labels", true),
];

const SECTION_KEYS = ["analysis_period", "animation", "units", "description", "long_description", "ionosphere", "graphics2d_global"] as const;

/** ส่วนของเอกสาร Scenario ที่หน้า Properties แก้ (สำเนา; ส่วนที่เอกสารไม่มีไม่ใส่) */
export function sectionsOf(doc: ScenarioDoc): Tree {
  const source = doc as unknown as Tree;
  const out: Tree = {};
  for (const key of SECTION_KEYS) if (source[key] !== undefined) out[key] = structuredClone(source[key]);
  return out;
}

/** รูปแบบเวลาของ Scenario ตาม units (ไม่มี = UTCG +07:00 ตามค่าตั้งต้นของ server) */
export function timeContextOf(root: Tree): TimeContext {
  const format = getAt(root, "units.date_format");
  const offset = getAt(root, "units.ltz_offset");
  return { format: format === "LTZG" ? "LTZG" : "UTCG", offset: typeof offset === "string" ? offset : "+07:00" };
}

const DEFAULT_CONTEXT: TimeContext = { format: "UTCG", offset: "+07:00" };

// ---------- root -> ค่าในฟอร์ม ----------

const numberText = (n: number | null): string => (n === null ? "" : String(n));

function timeText(iso: unknown, ctx: TimeContext): string {
  if (typeof iso !== "string") return "";
  const d = parseIsoUtc(iso);
  return d === null ? iso : formatTime(d, ctx.format, ctx.offset);
}

function valueOf(root: Tree, spec: Spec, ctx: TimeContext): Value {
  const raw = getAt(root, spec.key);
  switch (spec.kind) {
    case "text":
      return typeof raw === "string" ? raw : spec.fallback;
    case "number":
      return numberText(typeof raw === "number" ? raw : raw === undefined || raw === null ? spec.fallback : null);
    case "choice":
      return typeof raw === "string" ? raw : (spec.fallback ?? "");
    case "bool":
      return typeof raw === "boolean" ? raw : spec.fallback;
    case "color":
      return typeof raw === "string" ? raw : "";
    case "list":
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    case "time":
      return timeText(raw ?? (spec.fallbackKey === undefined ? undefined : getAt(root, spec.fallbackKey)), ctx);
    case "offset":
      return typeof raw === "string" ? raw : spec.fallback;
  }
}

export function valuesFrom(root: Tree, specs: readonly Spec[], ctx: TimeContext = DEFAULT_CONTEXT): Values {
  return Object.fromEntries(specs.map((spec) => [spec.key, valueOf(root, spec, ctx)]));
}

const sameValue = (a: Value | undefined, b: Value | undefined): boolean => deepEqual(a, b);

/** ผู้ใช้แก้ค่าอะไรไปบ้างจากค่าตั้งต้น (ฟอร์มที่ไม่ได้แตะ = false) */
export function isDirty(values: Values, initial: Values): boolean {
  return Object.keys({ ...initial, ...values }).some((key) => !sameValue(values[key], initial[key]));
}

/** ข้อความของ Duration (วินาที) จากข้อความเวลาสองช่อง; อ่านไม่ได้หรือ Stop ไม่อยู่หลัง Start = "—" */
export function durationText(start: string, stop: string, ctx: TimeContext): string {
  const a = parseTime(start, ctx.format, ctx.offset);
  const b = parseTime(stop, ctx.format, ctx.offset);
  if (a === null || b === null || b.getTime() <= a.getTime()) return "—";
  return `${((b.getTime() - a.getTime()) / 1000).toFixed(3)} ${t("field.unit.sec")}`;
}

// ---------- ค่าในฟอร์ม -> root ----------

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

type Parsed = FieldParsed<unknown>;

function parseNumber(spec: Extract<Spec, { kind: "number" }>, input: string): Parsed {
  const trimmed = input.trim();
  if (trimmed === "") return spec.fallback === null ? pass(null) : fail(msg("props.notNumber"));
  return parseDecimal(trimmed, { gt: spec.gt, min: spec.min, max: spec.max });
}

/** เวลา ISO ที่ API ใช้: ลงท้าย Z วินาทีเต็ม (มีมิลลิวินาทีเมื่อไม่ใช่ศูนย์) */
export const isoOf = (d: Date): string => d.toISOString().replace(/\.000Z$/, "Z");

function parseSpec(spec: Spec, input: Value, ctx: TimeContext, example: string): Parsed {
  switch (spec.kind) {
    case "text":
      return pass(input);
    case "number":
      return parseNumber(spec, String(input));
    case "choice": {
      const code = String(input);
      if (code === "" && spec.fallback === null) return pass(null);
      return spec.options.includes(code) ? pass(code) : fail(msg("props.notOption"));
    }
    case "bool":
      return pass(input === true);
    case "color": {
      const c = String(input);
      if (c === "") return pass(null);
      return COLOR_RE.test(c) ? pass(c) : fail(msg("props.notOption"));
    }
    case "list":
      return pass(Array.isArray(input) ? [...input] : []);
    case "time": {
      const d = parseTime(String(input), ctx.format, ctx.offset);
      return d === null ? fail(msg("time.invalid", { example })) : pass(isoOf(d));
    }
    case "offset": {
      const offset = String(input);
      return parseOffset(offset) === null ? fail(msg("props.offsetInvalid")) : pass(offset);
    }
  }
}

/**
 * ค่าในฟอร์มกลับเป็น root: คืนสำเนาของ base ที่ใส่เฉพาะช่องที่ผู้ใช้แก้ และข้อผิดพลาดต่อช่อง (key -> ข้อความไทย)
 * ctx = รูปแบบเวลา ณ ตอนที่ฟอร์มแสดงข้อความ (ข้อความเวลาที่พิมพ์แปลความด้วยรูปแบบนี้ ไม่ใช่รูปแบบที่ยังไม่ Apply ในหน้า Units)
 */
export function applyValues(
  base: Tree, values: Values, specs: readonly Spec[], ctx: TimeContext = DEFAULT_CONTEXT,
): { edited: Tree; errors: Errors } {
  const initial = valuesFrom(base, specs, ctx);
  const edited = structuredClone(base);
  const errors: Errors = {};
  const changed = (key: string): boolean => !sameValue(values[key], initial[key]);
  for (const spec of specs) {
    if (!changed(spec.key)) continue;
    const shown = initial[spec.key];
    const example = typeof shown === "string" && shown !== "" ? shown : timeText("2026-01-01T00:00:00Z", ctx);
    const parsed = parseSpec(spec, values[spec.key], ctx, example);
    if (parsed.ok) setAt(edited, spec.key, parsed.value);
    else errors[spec.key] = parsed.error;
  }
  // ตัวเลขที่ต้องไม่น้อยกว่าอีกช่อง (Max ไม่ต่ำกว่า Min): เทียบเมื่อช่องใดช่องหนึ่งเปลี่ยน ทั้งสองอ่านได้ และช่องนี้ไม่ว่าง; ผิดที่ช่องนี้ (Max)
  for (const spec of specs) {
    if (spec.kind !== "number" || spec.notBelow === undefined) continue;
    if (!changed(spec.key) && !changed(spec.notBelow)) continue;
    if (errors[spec.key] !== undefined || errors[spec.notBelow] !== undefined) continue;
    const high = getAt(edited, spec.key);
    const low = getAt(edited, spec.notBelow);
    if (typeof high === "number" && typeof low === "number" && high < low) errors[spec.key] = msg("props.maxBelowMin");
  }
  // เวลาที่ต้องอยู่หลังอีกช่อง: เทียบเมื่อช่องใดช่องหนึ่งเปลี่ยน และทั้งสองอ่านได้
  for (const spec of specs) {
    if (spec.kind !== "time" || spec.after === undefined) continue;
    if (!changed(spec.key) && !changed(spec.after)) continue;
    if (errors[spec.key] !== undefined || errors[spec.after] !== undefined) continue;
    const end = parseIsoUtc(String(getAt(edited, spec.key) ?? ""));
    const start = parseIsoUtc(String(getAt(edited, spec.after) ?? ""));
    if (end !== null && start !== null && end.getTime() <= start.getTime()) errors[spec.key] = msg("wizard.stopBeforeStart");
  }
  return { edited, errors };
}

// ---------- หน้า ----------

export interface PageFields {
  id: string;
  fields: readonly string[];
}

/**
 * ช่องของฟอร์มที่ field ของ server ชี้ถึง และหน้าที่แสดงมัน: ตรงตัวก่อน แล้วช่องที่อยู่ในส่วนที่ field ชี้ ("graphics2d.pass") แล้วช่องที่ field อยู่ลึกกว่า
 * ไม่มีหน้าแสดง = null
 */
export function locateField(pages: readonly PageFields[], key: string): { page: string; field: string } | null {
  if (key === "") return null;
  const tests = [(f: string) => f === key, (f: string) => f.startsWith(`${key}.`), (f: string) => key.startsWith(`${f}.`)];
  for (const test of tests) {
    for (const page of pages) {
      const field = page.fields.find(test);
      if (field !== undefined) return { page: page.id, field };
    }
  }
  return null;
}

/** ข้อความของรายการค่าที่เลือกได้เดียว (Swath Type) */
export const swathTypeLabel = (code: string): string => (code === "Ground Elevation" ? t("option.swathType.groundElevation") : code);
