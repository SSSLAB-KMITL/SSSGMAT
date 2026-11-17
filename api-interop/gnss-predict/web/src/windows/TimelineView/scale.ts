// คณิตศาสตร์ของ Timeline View (spec §10): แปลงเวลา <-> พิกเซล ขั้นของขีดเวลา ซูม/เลื่อน View Port และป้ายขีดเวลาตาม DateFormat
// ไม่รู้จัก React, canvas หรือ store: เวลาทุกค่าเป็นวินาทีนับจาก epoch (จำนวนจริง) ช่วง [v0, v1] / [lo, hi] เป็นคู่ตัวเลข
//
// - View Port = ช่วงเวลา [v0, v1] ที่ Time Display และ Global Time Scale แสดง อยู่ในช่วงวิเคราะห์ (bounds) เสมอ กว้างไม่น้อยกว่า MIN_VIEW_S
//   (ช่วงวิเคราะห์ที่สั้นกว่านั้นแสดงได้แค่ทั้งช่วง)
// - ฟังก์ชันที่คืน View Port คืนคู่ใหม่เสมอ ไม่แก้ค่าที่รับมา

import { formatTime, type DateFormat } from "../../time/format";

export type Range = readonly [number, number];
export type ViewPort = [number, number];

/** View Port แคบสุด (วินาที) */
export const MIN_VIEW_S = 60;
/** ระยะห่างน้อยสุดระหว่างขีดเวลา (พิกเซล) */
export const MIN_TICK_SPACING_PX = 80;
/** ขั้นของขีดเวลา (วินาที) 1 5 10 30 วินาที, 1 5 10 30 นาที, 1 2 6 12 ชั่วโมง, 1 2 วัน, 1 สัปดาห์ */
export const TICK_STEPS_S = [1, 5, 10, 30, 60, 300, 600, 1800, 3600, 7200, 21_600, 43_200, 86_400, 172_800, 604_800] as const;
/** จำนวนขีดสูงสุดที่ tickTimes ยอมคืน (ผู้เรียกที่เลือกขั้นด้วย tickStepS ได้ไม่ถึงหลักร้อย) */
export const MAX_TICKS = 2000;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const SECONDS_PER_DAY = 86_400;

/** เวลา t -> พิกเซลจากขอบซ้ายของแกนกว้าง width ที่แสดง [v0, v1] (ไม่ตัดขอบ; ช่วงว่าง = 0) */
export function timeToX(t: number, v0: number, v1: number, width: number): number {
  return v1 > v0 ? ((t - v0) / (v1 - v0)) * width : 0;
}

/** พิกเซลจากขอบซ้ายของแกนกว้าง width ที่แสดง [v0, v1] -> เวลา (ความกว้างว่าง = v0) */
export function xToTime(x: number, v0: number, v1: number, width: number): number {
  return width > 0 ? v0 + (x / width) * (v1 - v0) : v0;
}

/** ขั้นเล็กสุดในตารางที่ทำให้ขีดห่างกันอย่างน้อย 80 พิกเซลเมื่อแสดงช่วง spanS วินาทีบนความกว้าง widthPx (เกินตาราง = ขั้นใหญ่สุด) */
export function tickStepS(spanS: number, widthPx: number): number {
  const last = TICK_STEPS_S[TICK_STEPS_S.length - 1];
  if (!(spanS > 0)) return TICK_STEPS_S[0];
  if (!(widthPx > 0)) return last;
  const minStep = (spanS * MIN_TICK_SPACING_PX) / widthPx;
  return TICK_STEPS_S.find((step) => step >= minStep - 1e-9) ?? last;
}

const minWidth = ([lo, hi]: Range): number => Math.min(MIN_VIEW_S, hi - lo);

/** ย้ายช่วงกว้าง w ที่เริ่ม start เข้าในช่วง [lo, hi] (ชิดขอบ ไม่เปลี่ยนความกว้าง) */
function place(start: number, w: number, [lo, hi]: Range): ViewPort {
  if (w >= hi - lo) return [lo, hi];
  const n0 = clamp(start, lo, hi - w);
  return [n0, n0 === hi - w ? hi : n0 + w];
}

/**
 * ซูมรอบเวลา centerT: ความกว้างใหม่ = ความกว้างเดิม x factor (factor < 1 = ซูมเข้า, > 1 = ซูมออก) จำกัดไว้ที่ 60 วินาที ถึงทั้งช่วงวิเคราะห์
 * เวลา centerT อยู่ตำแหน่งสัดส่วนเดิมของ View Port (เมาส์อยู่ที่เดิม) ถ้า centerT อยู่นอก View Port ใช้ขอบที่ใกล้สุด
 */
export function zoomViewPort(v0: number, v1: number, centerT: number, factor: number, bounds: Range): ViewPort {
  const [lo, hi] = bounds;
  const width = v1 - v0;
  const next = clamp(width * factor, minWidth(bounds), hi - lo);
  if (next >= hi - lo) return [lo, hi];
  const about = clamp(centerT, v0, v1);
  const fraction = width > 0 ? (about - v0) / width : 0.5;
  return place(about - fraction * next, next, bounds);
}

/**
 * ตัวคูณความกว้าง View Port ของการหมุนล้อ deltaY (deltaMode ตาม WheelEvent: 0 พิกเซล, 1 บรรทัด, 2 หน้า): หมุนขึ้น (ติดลบ) < 1 = ซูมเข้า
 * ต่อเนื่องตามระยะ (แตะ trackpad เล็กน้อยขยับน้อย ล้อเมาส์หนึ่งคลิกราว 1.3 เท่า) หนึ่งเหตุการณ์ไม่เกิน 4 เท่าไม่ว่าทิศไหน
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  return clamp(Math.exp(pixels * 0.0025), 0.25, 4);
}

/** เลื่อน View Port ไป delta วินาที ความกว้างเท่าเดิม ชิดขอบช่วงวิเคราะห์ */
export function panViewPort(view: Range, delta: number, bounds: Range): ViewPort {
  return place(view[0] + delta, view[1] - view[0], bounds);
}

/** เลื่อน View Port ให้เวลา centerT อยู่กลาง (Center ของแถบช่วงเวลา) ความกว้างเท่าเดิม ชิดขอบช่วงวิเคราะห์ */
export function centerViewPort(view: Range, centerT: number, bounds: Range): ViewPort {
  const w = view[1] - view[0];
  return place(centerT - w / 2, w, bounds);
}

export type ViewPortDrag = "viewport" | "edgeLeft" | "edgeRight";

/**
 * ลาก View Port ใน Global Time Bar: start = View Port ตอนเริ่มลาก, grabT = เวลาที่จับ, nowT = เวลาที่เมาส์อยู่ตอนนี้
 * ลากตัว = เลื่อน, ลากขอบซ้าย/ขวา = เปลี่ยนขอบนั้นอย่างเดียว (ระยะที่จับห่างจากขอบคงเดิม) ไม่แคบกว่า 60 วินาที ไม่พ้นช่วงวิเคราะห์
 */
export function dragViewPort(kind: ViewPortDrag, start: Range, grabT: number, nowT: number, bounds: Range): ViewPort {
  const [lo, hi] = bounds;
  const delta = nowT - grabT;
  if (kind === "viewport") return panViewPort(start, delta, bounds);
  const minW = minWidth(bounds);
  if (kind === "edgeLeft") return [clamp(start[0] + delta, lo, start[1] - minW), start[1]];
  return [start[0], clamp(start[1] + delta, start[0] + minW, hi)];
}

/**
 * เวลาของขีดทั้งหมดใน [v0, v1] (รวมปลายทั้งสอง) ที่เป็นพหุคูณของ stepS ในเวลาท้องถิ่น (offsetS = วินาทีที่เวลาท้องถิ่นนำ UTC; UTCG = 0)
 * เกิน MAX_TICKS ขีด (ผู้เรียกเลือกขั้นผิด) คืนว่าง
 */
export function tickTimes(v0: number, v1: number, stepS: number, offsetS = 0): number[] {
  if (!(stepS > 0) || !(v1 >= v0) || (v1 - v0) / stepS > MAX_TICKS) return [];
  const out: number[] = [];
  const first = Math.ceil((v0 + offsetS) / stepS) * stepS - offsetS;
  for (let i = 0, t = first; t <= v1 + 1e-9; i++, t = first + i * stepS) out.push(t);
  return out;
}

export interface TickLabel {
  /** ข้อความหลักของขีด: วันที่ (ขั้นตั้งแต่ 1 วัน) หรือเวลา HH:MM (HH:MM:SS เมื่อขั้นน้อยกว่า 1 นาที) */
  main: string;
  /** วันที่ ใต้เวลา: ใส่เฉพาะขีดแรกและขีดที่ข้ามเที่ยงคืน (ตามเวลาท้องถิ่นของ DateFormat) */
  sub?: string;
}

const PARTS_RE = /^(\d{1,2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2})\./;

interface Parts {
  date: string;
  hm: string;
  hms: string;
}

function partsOf(t: number, fmt: DateFormat, ltz: string): Parts | null {
  const m = PARTS_RE.exec(formatTime(new Date(t * 1000), fmt, ltz));
  return m === null ? null : { date: `${m[1]} ${m[2]} ${m[3]}`, hm: `${m[4]}:${m[5]}`, hms: `${m[4]}:${m[5]}:${m[6]}` };
}

/**
 * ป้ายของขีดเวลา t ตาม DateFormat ของ scenario ในรูปที่สั้นที่สุดที่ยังอ่านได้ไม่กำกวมที่ขั้น stepS
 * ขั้น >= 1 วัน = วันที่ ขั้นเล็กกว่า = เวลา และวันที่ใต้เวลาที่ขีดแรก (prev = null) หรือเมื่อวันที่ต่างจากขีดก่อนหน้า (prev)
 */
export function tickLabel(t: number, stepS: number, fmt: DateFormat, ltz: string, prev: number | null): TickLabel {
  const now = partsOf(t, fmt, ltz);
  if (now === null) return { main: "" };
  if (stepS >= SECONDS_PER_DAY) return { main: now.date };
  const main = stepS < 60 ? now.hms : now.hm;
  const before = prev === null ? null : partsOf(prev, fmt, ltz);
  return before !== null && before.date === now.date ? { main } : { main, sub: now.date };
}

/** ป้ายเขตเวลาของ DateFormat ("UTCG" หรือ "LTZG+07:00") ตรงกับท้ายของ formatTime */
export function zoneLabel(fmt: DateFormat, ltz: string): string {
  return formatTime(new Date(0), fmt, ltz).split(" ").at(-1) ?? "";
}
