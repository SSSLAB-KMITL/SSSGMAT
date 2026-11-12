// รูปทรงของ canvas ใน Timeline View (spec §10): พื้นที่ของสามส่วน สี่เหลี่ยมของแถบช่วงเวลา และตัวหาว่าจุด (x, y) บน canvas อยู่ที่ส่วนไหน
// ฟังก์ชันล้วน ใช้ทั้งตอนวาด (draw.ts) และตอนโต้ตอบ (TimelineView.tsx) จึงตรงกันเสมอ พิกัดทั้งหมดเป็นพิกเซล CSS จากมุมซ้ายบนของ canvas
//
//   ┌──────────┬────────────────────────────────────┐ ─ 0
//   │          │ Global Time Bar  (ช่วงวิเคราะห์ทั้งหมด: ตัวชี้เวลา + กรอบ View Port)         │
//   ├──────────┼────────────────────────────────────┤ ─ BAR_H
//   │ เขตเวลา   │ Global Time Scale (ขีดเวลาของ View Port)                                   │
//   ├──────────┼────────────────────────────────────┤ ─ DISPLAY_TOP
//   │ ชื่อแถว   │ Time Display (แถว + แถบช่วงเวลา + เส้นเวลาปัจจุบัน) เลื่อนขึ้นลงตาม scrollY │
//   └──────────┴────────────────────────────────────┘
//
// - สามส่วนใช้แกนเวลาแนวนอนเดียวกัน (plot) Global Time Bar แสดงทั้งช่วงวิเคราะห์ (bounds) ส่วน Scale และ Time Display แสดง View Port

import type { TimelineInterval } from "./rows";
import { timeToX, xToTime, type Range, type ViewPortDrag } from "./scale";

export const BAR_H = 28;
export const SCALE_H = 32;
export const DISPLAY_TOP = BAR_H + SCALE_H;
export const ROW_H = 22;
/** คอลัมน์ชื่อแถวด้านซ้าย */
export const LABEL_W = 132;
export const PAD_R = 10;
/** แถบเลื่อนแนวตั้งของแถว (ใช้เมื่อแถวสูงเกิน Time Display) */
export const SCROLL_W = 14;
/** ระยะ (พิกเซล) ที่ยังนับว่าจับตัวชี้เวลาหรือขอบ View Port ได้ */
export const GRAB_PX = 5;
/** ช่องว่างบนและล่างของแถบในแถว */
export const BAR_PAD = 4;
/** แถบช่วงเวลาที่สั้นมากยังกว้างอย่างน้อยเท่านี้ (พิกเซล) จะได้เห็นและคลิกได้ */
export const MIN_BAR_PX = 2;

export interface Size {
  width: number;
  height: number;
}

export interface Plot {
  left: number;
  right: number;
  width: number;
}

export interface TimelineScene {
  size: Size;
  rows: readonly { intervals: readonly TimelineInterval[] }[];
  /** View Port [v0, v1] */
  view: Range;
  /** ช่วงวิเคราะห์ [lo, hi] */
  bounds: Range;
  /** เวลา animation (วินาทีนับจาก epoch) */
  current: number;
  /** พิกเซลที่เลื่อนแถวขึ้นไปแล้ว */
  scrollY: number;
}

export function plotOf(size: Size, scrollbar: boolean): Plot {
  const left = LABEL_W;
  const right = Math.max(left + 1, size.width - PAD_R - (scrollbar ? SCROLL_W : 0));
  return { left, right, width: right - left };
}

export const displayHeight = (size: Size): number => Math.max(0, size.height - DISPLAY_TOP);
export const needsScrollbar = (size: Size, rowCount: number): boolean => rowCount * ROW_H > displayHeight(size);
export const maxScroll = (size: Size, rowCount: number): number => Math.max(0, rowCount * ROW_H - displayHeight(size));

const plotOfScene = (s: TimelineScene): Plot => plotOf(s.size, needsScrollbar(s.size, s.rows.length));

export interface BarRect {
  /** ลำดับของช่วงเวลาในแถว */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** สี่เหลี่ยมของแถบช่วงเวลาของแถวที่ rowIndex ที่อยู่ใน View Port (ตัดให้อยู่ในพื้นที่แกนเวลา) */
export function intervalRects(s: TimelineScene, rowIndex: number): BarRect[] {
  const row = s.rows[rowIndex];
  if (row === undefined) return [];
  const p = plotOfScene(s);
  const [v0, v1] = s.view;
  const y = DISPLAY_TOP + rowIndex * ROW_H - s.scrollY + BAR_PAD;
  const out: BarRect[] = [];
  row.intervals.forEach((iv, index) => {
    if (iv.stop <= v0 || iv.start >= v1) return;
    const x0 = Math.max(p.left, p.left + timeToX(iv.start, v0, v1, p.width));
    const x1 = Math.min(p.right, p.left + timeToX(iv.stop, v0, v1, p.width));
    out.push({ index, x: x0, y, w: Math.max(x1 - x0, MIN_BAR_PX), h: ROW_H - 2 * BAR_PAD });
  });
  return out;
}

/** ตำแหน่งแนวนอนของตัวชี้เวลาใน Global Time Bar */
export function pointerX(s: TimelineScene): number {
  const p = plotOfScene(s);
  return p.left + timeToX(s.current, s.bounds[0], s.bounds[1], p.width);
}

/** ขอบซ้ายและขวาของกรอบ View Port ใน Global Time Bar */
export function viewPortFrame(s: TimelineScene): { x0: number; x1: number } {
  const p = plotOfScene(s);
  return {
    x0: p.left + timeToX(s.view[0], s.bounds[0], s.bounds[1], p.width),
    x1: p.left + timeToX(s.view[1], s.bounds[0], s.bounds[1], p.width),
  };
}

export type BarZone = "pointer" | ViewPortDrag | "track";

export type Hit =
  /** Global Time Bar: time = เวลาที่ตำแหน่งนี้ในช่วงวิเคราะห์ทั้งหมด (ตัดให้อยู่ในช่วง) */
  | { part: "bar"; zone: BarZone; time: number }
  /** Global Time Scale: time ตาม View Port */
  | { part: "scale"; time: number }
  /** Time Display: row / interval = ลำดับแถวและช่วงเวลาใต้เมาส์ (null = ไม่มี) */
  | { part: "display"; time: number; row: number | null; interval: number | null }
  /** คอลัมน์ชื่อแถว */
  | { part: "label"; row: number | null }
  | { part: "none" };

const NONE: Hit = { part: "none" };
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

function barHit(s: TimelineScene, x: number): Hit {
  const p = plotOfScene(s);
  if (x < p.left - GRAB_PX || x > p.right + GRAB_PX) return NONE;
  const [lo, hi] = s.bounds;
  const time = clamp(xToTime(x - p.left, lo, hi, p.width), lo, hi);
  if (s.current >= lo && s.current <= hi && Math.abs(x - pointerX(s)) <= GRAB_PX) return { part: "bar", zone: "pointer", time };
  const { x0, x1 } = viewPortFrame(s);
  const dl = Math.abs(x - x0);
  const dr = Math.abs(x - x1);
  if (Math.min(dl, dr) <= GRAB_PX) return { part: "bar", zone: dl <= dr ? "edgeLeft" : "edgeRight", time };
  // View Port ที่เต็มช่วงวิเคราะห์ไม่มีตัวให้เลื่อน: คลิกบนแถบ = ตั้งเวลา
  const whole = s.view[0] <= lo && s.view[1] >= hi;
  return { part: "bar", zone: !whole && x > x0 && x < x1 ? "viewport" : "track", time };
}

/** จุด (x, y) บน canvas อยู่ที่ส่วนไหน และใต้เมาส์มีอะไร */
export function hitTest(s: TimelineScene, x: number, y: number): Hit {
  const { width, height } = s.size;
  if (x < 0 || y < 0 || x > width || y >= height) return NONE;
  if (y < BAR_H) return barHit(s, x);
  const p = plotOfScene(s);
  if (y < DISPLAY_TOP) return x < p.left || x > p.right ? NONE : { part: "scale", time: xToTime(x - p.left, s.view[0], s.view[1], p.width) };

  const index = Math.floor((y - DISPLAY_TOP + s.scrollY) / ROW_H);
  const row = index >= 0 && index < s.rows.length ? index : null;
  if (x < p.left) return { part: "label", row };
  if (x > p.right) return NONE;
  const time = xToTime(x - p.left, s.view[0], s.view[1], p.width);
  let interval: number | null = null;
  if (row !== null) {
    // ช่วงเวลาที่ซ้อนกัน: ตัวหลัง (วาดทีหลัง อยู่บนสุด) ชนะ
    for (const r of intervalRects(s, row).reverse()) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        interval = r.index;
        break;
      }
    }
  }
  return { part: "display", time, row, interval };
}
