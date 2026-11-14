// Static Highlight และ Animate Highlight ของ Access ในหน้าต่าง 2D (access spec §4, STK ref §F "Access graphics")
// ค่าตั้งอยู่ที่ `accesses[].graphics` (Access tool) ช่วงเวลามาจาก GET /access/intervals ตัวเดียวกับ Timeline View (windows/TimelineView/rows.ts)
//
// - วาดเมื่อ access `computed: true` (Clear = เลิกวาด), มี graphics ของตัวเอง (`inherit: false`: inherit true หรือไม่มี graphics = ค่าตั้งต้นของ scenario ไม่วาด),
//   Show เปิด และเปิดตัวเลือกนั้น (Static Highlight / Animate Highlight) ปิดตัวเลือกหรือเงื่อนไขใดหลุด = entity หายไปในรอบถัดไป (วาดใหม่ทุกครั้ง)
// - สี: Use Custom Color = custom_color ไม่งั้นสีของดาวในหน้าต่างนี้ (graphicsFor) ดาวที่อยู่ในหลาย access: ใช้ของ access แรกใน doc ที่เปิดตัวเลือกนั้น
//   ช่วงเวลาของดาวเดียวกันจากหลาย access (ต่าง Facility) รวมเป็นช่วงเดียว ไม่วาดทับกัน
// - ดาวต้อง "แสดงอยู่" ในหน้าต่างนี้: เปิด Show ของหน้า 2D, ไม่ถูกซ่อนตามธง (W9) และ entity ของมันอยู่ในภาพและแสดงอยู่ (sat/<PRN> ใน entities เดียวกับที่รับมา
//   ผู้เรียกวาดหลัง applyGraphics เสมอ: applyGraphics ซ่อน entity ที่ไม่ใช่ sat/fac/access)
// - Static Highlight (hl/static/<PRN>): polyline หนา 4 พิกเซลเป็น ground track ตามจุดใต้ดาว (ตำแหน่ง Earth-fixed ของดาวที่สุ่มทุก 60 วินาทีตลอดแต่ละช่วง access
//   รวมขอบ ฉายลงผิวโลกที่ความสูง 0 เหมือน overlay2d) เป็น ConstantProperty ไม่ขึ้นกับเวลาของภาพ ทุกช่วงเป็นเส้นแยก (id ที่สองเป็นต้นไปต่อท้าย /1, /2, …)
//   ไม่ต่อข้ามช่วงที่ไม่ได้อยู่ใน access
//   - ต้องฉายลงผิวโลก: polyline ของ entity เป็น geometry และที่ความสูงของดาว (ราว 20,000 กม.) โหมด 2D ไม่วาดเลย (ตรวจใน Chromium จริง
//     ต่างจาก path ของ Cesium ที่ความสูงเดิมซึ่งวาดได้)
//   - เส้นที่ข้ามเส้น 180° ไม่ต้องตัดเอง: Primitive ตัดที่เส้นนั้นให้ในโหมด 2D (PrimitivePipeline → GeometryPipeline.splitLongitude: scene3DOnly = false)
// - Animate Highlight (hl/box/<PRN>): billboard กรอบสี่เหลี่ยมที่ position = property ตำแหน่งของ entity ดาวตัวเดียวกัน (ไม่ใช่ CallbackProperty) และ availability =
//   ช่วง access ทั้งหมดของดาว กรอบจึงโผล่รอบดาวเฉพาะตอนอยู่ใน access ตามเวลาของ clock โดย Cesium เอง
// - ไม่มี CallbackProperty: หน้าต่าง 2D ข้าม update ของ dataSourceDisplay ตอนอยู่เฉย ๆ (idleUpdates.ts) การเพิ่ม/ลบ entity ส่ง collectionChanged รอบเดียว (suspendEvents)
// - HighlightIntervals ดึงช่วงเวลาที่ต้องใช้ (เฉพาะ access ที่ต้องวาด) ดึงใหม่เมื่อชุด access, ช่วงเวลาที่ตัดผล หรือผล (hash/สถานะ) ของ Facility ต้นทางเปลี่ยน
//   (กติกาเดียวกับ useAccessIntervals ของ Timeline) คำตอบของรอบเก่าถูกยกเลิกและทิ้ง

import {
  ArcType, BillboardGraphics, Cartesian3, Cartographic, ColorMaterialProperty, ConstantProperty, Entity, JulianDate, Math as CesiumMath, PolylineGraphics,
  TimeInterval, TimeIntervalCollection, type EntityCollection,
} from "cesium";
import { isAbortError } from "../api/client";
import type { components } from "../api/types.gen";
import type { ResultsInfo } from "../stores/results";
import type { ScenarioDoc } from "../stores/scenario";
import { parseIsoUtc } from "../time/parse";
import { accessKey, fetchAccessResult, type AccessDef, type IntervalsByAccess } from "../windows/TimelineView/rows";
import { cssColor, entityIdFor, fixedPositionAt, graphicsFor, type ApplyCtx } from "./graphics";
import { lonLatPositions } from "./overlay2d";

type SatelliteObj = components["schemas"]["SatelliteObj"];

/** ช่วง access: วินาทีนับจาก epoch (หน่วยเดียวกับ TimelineInterval) */
export interface Interval {
  start: number;
  stop: number;
}

/** ความหนาเส้นของ Static Highlight (พิกเซล) */
export const STATIC_HIGHLIGHT_WIDTH = 4;
/** ระยะห่างของจุดตัวอย่างบนเส้น Static Highlight (มิลลิวินาที): MEO เคลื่อนราว 230 กม. ต่อจุด */
const STEP_MS = 60_000;
/** ขนาดกรอบของ Animate Highlight (พิกเซล) */
const BOX_SIZE = 28;
const BOX_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX_SIZE}" height="${BOX_SIZE}" viewBox="0 0 ${BOX_SIZE} ${BOX_SIZE}">` +
  `<rect x="2" y="2" width="${BOX_SIZE - 4}" height="${BOX_SIZE - 4}" fill="none" stroke="#ffffff" stroke-width="3"/></svg>`;
/** กรอบสีขาวไม่ทึบ (ย้อมสีด้วย billboard.color) เป็น data URI: ไม่ต้องใช้ canvas */
const BOX_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(BOX_SVG)}`;

const STATIC_PREFIX = "hl/static/";
const BOX_PREFIX = "hl/box/";
const HEX = /^#[0-9a-fA-F]{6}$/;

// ---------- เวลาตัวอย่าง ----------

/**
 * เวลาตัวอย่าง (มิลลิวินาทีนับจาก epoch) ต่อช่วง: เริ่มที่ขอบแรก ทุก stepMs และขอบสุดท้ายเสมอ (ไม่ซ้ำเมื่อขอบสุดท้ายตรงตัวอย่าง)
 * ช่วงยาวศูนย์ = หนึ่งตัวอย่าง ช่วงที่ stop ก่อน start หรือไม่ใช่ตัวเลข = [] (ผลเรียงตรงกับช่วงที่ส่งมา) stepMs ที่ไม่เป็นบวก = ขอบสองด้านเท่านั้น
 */
export function highlightTimes(intervals: readonly Interval[], stepMs: number): number[][] {
  return intervals.map(({ start, stop }) => {
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < start) return [];
    const a = start * 1000;
    const b = stop * 1000;
    if (b === a) return [a];
    const step = Number.isFinite(stepMs) && stepMs > 0 ? stepMs : b - a;
    const out: number[] = [];
    for (let i = 0; a + i * step < b; i++) out.push(a + i * step);
    out.push(b);
    return out;
  });
}

// ---------- กราฟิกของ access ----------

export interface HighlightOptions {
  static: boolean;
  animate: boolean;
  /** สีที่ผู้ใช้เลือก (#rrggbb ตัวเล็ก) null = สีของดาว */
  color: string | null;
}

/** ตัวเลือก highlight ของ access ที่ต้องวาด ไม่ต้องวาด (ไม่ computed, inherit, ไม่มี graphics, Show ปิด, ปิดทั้งสองตัวเลือก) = null */
export function highlightOptions(access: AccessDef): HighlightOptions | null {
  const g = access.graphics;
  if (access.computed !== true || g === null || g === undefined || g.inherit !== false || g.show === false) return null;
  const isStatic = g.static_highlight === true;
  const animate = g.animate_highlight === true;
  if (!isStatic && !animate) return null;
  const custom = g.color_mode === "custom" && typeof g.custom_color === "string" && HEX.test(g.custom_color) ? g.custom_color.toLowerCase() : null;
  return { static: isStatic, animate, color: custom };
}

// ---------- ช่วงเวลาจากคำตอบของ server ----------

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** ช่วงที่อ่านได้ของคำตอบ (start/stop เป็น ISO) เรียงตามเวลาเริ่ม ที่อ่านไม่ได้ข้าม */
function parseIntervals(list: readonly unknown[]): Interval[] {
  const out: Interval[] = [];
  for (const raw of list) {
    if (!isRecord(raw) || typeof raw.start !== "string" || typeof raw.stop !== "string") continue;
    const start = parseIsoUtc(raw.start);
    const stop = parseIsoUtc(raw.stop);
    if (start !== null && stop !== null) out.push({ start: start.getTime() / 1000, stop: stop.getTime() / 1000 });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** รวมช่วงที่ซ้อนหรือติดกัน (เรียงตามเวลาเริ่มก่อน) */
function mergeIntervals(list: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const iv of [...list].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last !== undefined && iv.start <= last.stop) last.stop = Math.max(last.stop, iv.stop);
    else out.push({ ...iv });
  }
  return out;
}

interface Part {
  intervals: Interval[];
  /** สีที่ผู้ใช้เลือกของ access แรกที่เปิดตัวเลือกนี้ (null = สีของดาว) */
  color: string | null;
}

interface SatPlan {
  /** id ของ entity ดาว: sat/<PRN> */
  id: string;
  obj: SatelliteObj;
  static?: Part;
  animate?: Part;
}

function addPart(part: Part | undefined, intervals: Interval[], color: string | null): Part {
  return part === undefined ? { intervals: [...intervals], color } : { intervals: [...part.intervals, ...intervals], color: part.color };
}

/** แผนวาดต่อ entity ดาว จาก access ที่ต้องวาดและคำตอบที่ได้ (access ที่ยังไม่มีคำตอบ หรือคำตอบไม่ ok ไม่มีส่วน) */
function planOf(doc: ScenarioDoc, replies: IntervalsByAccess, prnByNorad: ReadonlyMap<number, string>): Map<string, SatPlan> {
  const satellites = new Map<string, SatelliteObj>();
  for (const obj of doc.objects) if (obj.class === "Satellite" && !satellites.has(obj.name)) satellites.set(obj.name, obj as SatelliteObj);
  const plans = new Map<string, SatPlan>();
  for (const access of doc.accesses ?? []) {
    const options = highlightOptions(access);
    const reply = replies[accessKey(access)];
    if (options === null || reply === undefined || reply.status !== "ok") continue;
    for (const [name, list] of Object.entries(reply.bySat)) {
      const obj = satellites.get(name);
      const id = obj === undefined ? undefined : entityIdFor(obj, prnByNorad);
      if (obj === undefined || id === undefined) continue;
      const intervals = parseIntervals(list);
      const plan = plans.get(id) ?? { id, obj };
      if (options.static) plan.static = addPart(plan.static, intervals, options.color);
      if (options.animate) plan.animate = addPart(plan.animate, intervals, options.color);
      plans.set(id, plan);
    }
  }
  return plans;
}

// ---------- รูปทรง ----------

/** จุดใต้ดาวที่เวลาตัวอย่าง (มิลลิวินาที) บนผิวทรงรี (ความสูง 0, ละติจูดถูกบีบไว้ใน ±MAX_LAT) ที่ดาวไม่มีตำแหน่ง (นอกช่วงตัวอย่าง) ข้าม */
function groundPoints(sat: Entity, times: readonly number[]): Cartesian3[] {
  const lonLat: [number, number][] = [];
  for (const ms of times) {
    const p = fixedPositionAt(sat, JulianDate.fromDate(new Date(ms)));
    const c = p === null ? undefined : Cartographic.fromCartesian(new Cartesian3(p.x, p.y, p.z));
    if (c !== undefined) lonLat.push([CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)]);
  }
  return lonLatPositions(lonLat);
}

/** เส้น Static Highlight ของดาวหนึ่งดวง: หนึ่งเส้นต่อหนึ่งช่วง access (ช่วงที่มีตำแหน่งไม่ถึงสองจุดวาดเป็นเส้นไม่ได้ ข้าม) */
function staticEntities(prn: string, sat: Entity, part: Part, color: string): Entity[] {
  const material = cssColor(color);
  const out: Entity[] = [];
  for (const times of highlightTimes(mergeIntervals(part.intervals), STEP_MS)) {
    const points = groundPoints(sat, times);
    if (points.length < 2) continue;
    out.push(
      new Entity({
        id: out.length === 0 ? `${STATIC_PREFIX}${prn}` : `${STATIC_PREFIX}${prn}/${out.length}`,
        polyline: new PolylineGraphics({
          positions: new ConstantProperty(points),
          width: STATIC_HIGHLIGHT_WIDTH,
          material: new ColorMaterialProperty(material),
          arcType: ArcType.NONE,
        }),
      }),
    );
  }
  return out;
}

/** กรอบ Animate Highlight ของดาวหนึ่งดวง: availability = ช่วง access (รวมขอบ) ตำแหน่ง = property ของ entity ดาว */
function boxEntity(prn: string, sat: Entity, part: Part, color: string): Entity | null {
  if (sat.position === undefined) return null;
  const availability = new TimeIntervalCollection();
  for (const { start, stop } of mergeIntervals(part.intervals)) {
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < start) continue;
    availability.addInterval(
      new TimeInterval({
        start: JulianDate.fromDate(new Date(start * 1000)),
        stop: JulianDate.fromDate(new Date(stop * 1000)),
        isStartIncluded: true,
        isStopIncluded: true,
      }),
    );
  }
  if (availability.length === 0) return null;
  return new Entity({
    id: `${BOX_PREFIX}${prn}`,
    availability,
    position: sat.position,
    billboard: new BillboardGraphics({ image: BOX_IMAGE, color: cssColor(color), width: BOX_SIZE, height: BOX_SIZE }),
  });
}

// ---------- วาดลง entities ----------

const isHighlight = (id: string): boolean => id.startsWith("hl/");

/**
 * วาด highlight ของทุก access ใน doc ลง entities (entity ของดาว `sat/<PRN>` อยู่ใน entities ชุดเดียวกัน) แทนชุดเดิมทั้งหมด (id ขึ้นต้น `hl/`)
 * replies = คำตอบของ /access/intervals ต่อ access (กุญแจ accessKey) ดู HighlightIntervals ผู้เรียกวาดหลัง applyGraphics (ที่ซ่อน entity ที่ไม่รู้จัก)
 * ไม่มี doc หรือไม่มี access ที่ต้องวาด = ลบของเดิมอย่างเดียว
 */
export function applyAccessHighlights(entities: EntityCollection, doc: ScenarioDoc | null, replies: IntervalsByAccess, ctx: ApplyCtx): void {
  const built: Entity[] = [];
  for (const plan of doc === null ? [] : planOf(doc, replies, ctx.prnByNorad).values()) {
    const sat = entities.getById(plan.id);
    const g = graphicsFor(plan.obj, doc as ScenarioDoc, { hidden: ctx.isHidden(plan.obj.norad), mode: ctx.mode, prnByNorad: ctx.prnByNorad, tokens: ctx.tokens });
    if (sat === undefined || !g.show || !sat.show) continue;
    const prn = plan.id.slice("sat/".length);
    if (plan.static !== undefined) built.push(...staticEntities(prn, sat, plan.static, plan.static.color ?? g.color));
    if (plan.animate !== undefined) {
      const box = boxEntity(prn, sat, plan.animate, plan.animate.color ?? g.color);
      if (box !== null) built.push(box);
    }
  }
  const old = entities.values.filter((e) => isHighlight(e.id));
  if (old.length === 0 && built.length === 0) return;
  entities.suspendEvents();
  try {
    for (const e of old) entities.remove(e);
    for (const e of built) entities.add(e);
  } finally {
    entities.resumeEvents();
  }
}

/** จำนวน highlight ที่มีอยู่ตอนนี้: เส้น Static (ทุกท่อน) และกรอบ Animate ที่อยู่ใน access ณ time (window.__gnssStudioTest.overlays2d) */
export function highlightCounts(entities: EntityCollection, time: JulianDate): { tracks: number; boxes: number } {
  let tracks = 0;
  let boxes = 0;
  for (const e of entities.values) {
    if (e.id.startsWith(STATIC_PREFIX)) tracks++;
    else if (e.id.startsWith(BOX_PREFIX) && e.isAvailable(time)) boxes++;
  }
  return { tracks, boxes };
}

// ---------- ดึงช่วงเวลา ----------

const NO_REPLIES: IntervalsByAccess = {};
const facilityOf = (from: string): string => from.split("/").at(-1) ?? from;

/**
 * ตัวดึงช่วงเวลาของ access ที่ต้องวาด highlight (หน้าต่าง 2D หนึ่งบานต่อหนึ่งตัว) sync เรียกเมื่อ doc หรือผลลัพธ์เปลี่ยน: ดึงเมื่อกุญแจเปลี่ยนเท่านั้น
 * (ชุด access ที่ต้องวาด + from/to/ช่วงที่ตัดผล + สถานะ ephem + สถานะ/hash ของ Facility ต้นทาง) ค่าที่ไม่กระทบช่วงเวลา เช่น สี ไม่ดึงใหม่
 * onChange เรียกเมื่อคำตอบใหม่มาถึง (ไม่เรียกเมื่อไม่มี access ที่ต้องวาดแล้ว: ผู้เรียกวาดใหม่ตามหลัง sync อยู่แล้ว)
 */
export class HighlightIntervals {
  private key: string | null = null;
  private ctl: AbortController | null = null;
  private disposed = false;
  private current: IntervalsByAccess = NO_REPLIES;
  private running: Promise<void> = Promise.resolve();

  constructor(private readonly onChange: () => void) {}

  /** คำตอบล่าสุดต่อ access (กุญแจ accessKey) */
  get replies(): IntervalsByAccess {
    return this.current;
  }

  sync(scenario: string | null, doc: ScenarioDoc | null, info: ResultsInfo | null): void {
    if (this.disposed) return;
    const wanted = scenario === null || doc === null ? [] : (doc.accesses ?? []).filter((a) => highlightOptions(a) !== null);
    if (scenario === null || wanted.length === 0) {
      this.key = null;
      this.ctl?.abort();
      this.ctl = null;
      this.current = NO_REPLIES;
      return;
    }
    const key = JSON.stringify([
      scenario,
      wanted.map((a) => [a.from, a.to, a.time_period ?? null]),
      info?.ephem.status ?? null,
      wanted.map((a) => {
        const entry = info?.access[facilityOf(a.from)];
        return [entry?.status ?? null, entry?.hash ?? null];
      }),
    ]);
    if (key === this.key) return;
    this.key = key;
    this.ctl?.abort();
    const ctl = new AbortController();
    this.ctl = ctl;
    this.running = this.load(scenario, wanted, ctl);
  }

  private async load(scenario: string, wanted: readonly AccessDef[], ctl: AbortController): Promise<void> {
    try {
      const entries = await Promise.all(wanted.map(async (a) => [a, await fetchAccessResult(scenario, a, ctl.signal)] as const));
      if (ctl.signal.aborted || this.disposed) return;
      this.current = Object.fromEntries(entries.map(([a, result]) => [accessKey(a), result]));
      this.onChange();
    } catch (e) {
      if (!isAbortError(e)) throw e;
    }
  }

  /** รอการดึงล่าสุดจบ (test) */
  async idle(): Promise<void> {
    let seen: Promise<void> | null = null;
    while (seen !== this.running) {
      seen = this.running;
      await seen;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.ctl?.abort();
  }
}
