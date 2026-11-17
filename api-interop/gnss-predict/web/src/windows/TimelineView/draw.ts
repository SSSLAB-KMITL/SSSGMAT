// วาด Timeline View ลง canvas (spec §10): Global Time Bar, Global Time Scale, Time Display
// - รูปทรงทั้งหมดมาจาก layout.ts (ตัวเดียวกับที่ใช้หาจุดที่คลิก) ที่นี่แค่ระบายสีตามธีม ไม่มีสถานะ: เรียกซ้ำด้วยข้อมูลเดิมได้ภาพเดิม
// - สีและตัวอักษรอ่านจากตัวแปร CSS (theme.css: --timeline-*) ครั้งเดียวแล้วจำไว้ (timelineTheme); ค่าสำรองในโค้ดมีไว้เฉพาะเมื่อยังไม่มี theme.css (jsdom)
// - ไม่ import Cesium

import { readCssVar } from "../../cesium/colors";
import { t } from "../../labels/labels";
import { parseOffset, type DateFormat } from "../../time/format";
import {
  BAR_H, DISPLAY_TOP, LABEL_W, ROW_H, intervalRects, needsScrollbar, plotOf, pointerX, viewPortFrame, type Plot, type TimelineScene,
} from "./layout";
import type { TimelineRow } from "./rows";
import { tickLabel, tickStepS, tickTimes, timeToX, zoneLabel } from "./scale";

export interface TimelineTheme {
  bg: string;
  rowAlt: string;
  barBg: string;
  viewportFill: string;
  viewportLine: string;
  grid: string;
  text: string;
  textMuted: string;
  /** ตัวชี้เวลาใน Global Time Bar (สีขาว) */
  pointer: string;
  /** เส้นเวลา animation ใน Time Display */
  now: string;
  /** เส้นทแยงของแถวที่ไม่มีช่วงเวลา */
  hatch: string;
  barOutline: string;
  fontUi: string;
  fontMono: string;
  fontSize: string;
}

const VARS: Record<Exclude<keyof TimelineTheme, "fontUi" | "fontMono" | "fontSize">, [name: string, fallback: string]> = {
  bg: ["--timeline-bg", "#1c222c"],
  rowAlt: ["--timeline-row-alt", "#232b37"],
  barBg: ["--timeline-bar-bg", "#38414f"],
  viewportFill: ["--timeline-viewport-fill", "#ffffff26"],
  viewportLine: ["--timeline-viewport-line", "#8fb8f0"],
  grid: ["--timeline-grid", "#ffffff2e"],
  text: ["--timeline-text", "#e6eaf0"],
  textMuted: ["--timeline-text-muted", "#aeb8c6"],
  pointer: ["--timeline-pointer", "#ffffff"],
  now: ["--timeline-now", "#ff8a5c"],
  hatch: ["--timeline-hatch", "#ffffff40"],
  barOutline: ["--timeline-bar-outline", "#000000"],
};

/** อ่านธีมผ่าน read (ชื่อตัวแปร -> ค่า) ตัวแปรที่ไม่มีใช้ค่าสำรอง */
export function timelineThemeFrom(read: (name: string) => string): TimelineTheme {
  const get = (name: string, fallback: string): string => read(name).trim() || fallback;
  const colours = Object.fromEntries(Object.entries(VARS).map(([key, [name, fallback]]) => [key, get(name, fallback)])) as unknown as Omit<TimelineTheme, "fontUi" | "fontMono" | "fontSize">;
  return { ...colours, fontUi: get("--font-ui", "sans-serif"), fontMono: get("--font-mono", "monospace"), fontSize: get("--font-size", "12px") };
}

let cached: TimelineTheme | null = null;

/** ธีมของหน้า (อ่านครั้งแรกที่ใช้แล้วจำไว้ ยังไม่มี theme.css = ไม่จำ) */
export function timelineTheme(): TimelineTheme {
  if (cached !== null) return cached;
  const theme = timelineThemeFrom(readCssVar);
  if (readCssVar("--timeline-bg") !== "") cached = theme;
  return theme;
}

export interface DrawInput {
  scene: TimelineScene;
  rows: readonly TimelineRow[];
  theme: TimelineTheme;
  fmt: DateFormat;
  ltz: string;
  /** แถบที่เมาส์ชี้อยู่ (เน้นขอบ) */
  hover: { row: number; interval: number | null } | null;
}

/** ตัดข้อความให้กว้างไม่เกิน maxWidth ด้วย "…" */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--;
  return `${text.slice(0, end)}…`;
}

function drawBar(ctx: CanvasRenderingContext2D, s: TimelineScene, p: Plot, theme: TimelineTheme): void {
  ctx.fillStyle = theme.barBg;
  ctx.fillRect(p.left, 3, p.width, BAR_H - 6);

  ctx.font = `${theme.fontSize} ${theme.fontUi}`;
  ctx.textAlign = "left";
  ctx.fillStyle = theme.textMuted;
  ctx.fillText(fit(ctx, t("timeline.globalTimeBar"), LABEL_W - 12), 8, BAR_H / 2);

  // View Port: กรอบที่ลากตัว (เลื่อน) หรือขอบ (ย่อ/ขยาย) ได้
  const { x0, x1 } = viewPortFrame(s);
  ctx.fillStyle = theme.viewportFill;
  ctx.fillRect(x0, 1, Math.max(1, x1 - x0), BAR_H - 2);
  ctx.strokeStyle = theme.viewportLine;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0 + 0.5, 1.5, Math.max(1, x1 - x0 - 1), BAR_H - 3);

  // ตัวชี้เวลา animation (สีขาว) เฉพาะเมื่อเวลาอยู่ในช่วงวิเคราะห์
  if (s.current >= s.bounds[0] && s.current <= s.bounds[1]) {
    const x = pointerX(s);
    ctx.fillStyle = theme.pointer;
    ctx.fillRect(x - 1, 0, 2, BAR_H);
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 6);
    ctx.closePath();
    ctx.fill();
  }
}

/** ขีดของ View Port: คืนเวลาของขีดทั้งหมดไว้ให้ Time Display ลากเส้นตาราง */
function drawScale(ctx: CanvasRenderingContext2D, s: TimelineScene, p: Plot, theme: TimelineTheme, fmt: DateFormat, ltz: string): number[] {
  const [v0, v1] = s.view;
  const step = tickStepS(v1 - v0, p.width);
  const offsetS = fmt === "LTZG" ? (parseOffset(ltz) ?? 0) * 60 : 0;
  const ticks = tickTimes(v0, v1, step, offsetS);

  ctx.font = `${theme.fontSize} ${theme.fontUi}`;
  ctx.textAlign = "left";
  ctx.fillStyle = theme.textMuted;
  ctx.fillText(fit(ctx, t("timeline.globalTimeScale"), LABEL_W - 12), 8, BAR_H + 11);
  ctx.font = `${theme.fontSize} ${theme.fontMono}`;
  ctx.fillText(zoneLabel(fmt, ltz), 8, BAR_H + 24);

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.left, DISPLAY_TOP - 0.5);
  ctx.lineTo(p.right, DISPLAY_TOP - 0.5);
  ctx.stroke();

  let prev: number | null = null;
  for (const time of ticks) {
    const x = Math.round(p.left + timeToX(time, v0, v1, p.width)) + 0.5;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(x, DISPLAY_TOP - 6);
    ctx.lineTo(x, DISPLAY_TOP);
    ctx.stroke();
    const label = tickLabel(time, step, fmt, ltz, prev);
    prev = time;
    ctx.textAlign = x < p.left + 22 ? "left" : x > p.right - 22 ? "right" : "center";
    ctx.font = `${theme.fontSize} ${theme.fontMono}`;
    ctx.fillStyle = theme.text;
    ctx.fillText(label.main, x, BAR_H + 11);
    if (label.sub !== undefined) {
      ctx.fillStyle = theme.textMuted;
      ctx.fillText(label.sub, x, BAR_H + 23);
    }
  }
  return ticks.map((time) => Math.round(p.left + timeToX(time, v0, v1, p.width)) + 0.5);
}

function drawHatch(ctx: CanvasRenderingContext2D, p: Plot, y: number, theme: TimelineTheme): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.left, y + 2, p.width, ROW_H - 4);
  ctx.clip();
  ctx.strokeStyle = theme.hatch;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = p.left - ROW_H; x < p.right; x += 8) {
    ctx.moveTo(x, y + ROW_H);
    ctx.lineTo(x + ROW_H, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawDisplay(ctx: CanvasRenderingContext2D, input: DrawInput, p: Plot, gridX: readonly number[]): void {
  const { scene: s, rows, theme, hover } = input;
  const height = s.size.height - DISPLAY_TOP;
  if (height <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, DISPLAY_TOP, s.size.width, height);
  ctx.clip();

  const first = Math.max(0, Math.floor(s.scrollY / ROW_H));
  const last = Math.min(rows.length - 1, Math.floor((s.scrollY + height) / ROW_H));
  for (let i = first; i <= last; i++) {
    const y = DISPLAY_TOP + i * ROW_H - s.scrollY;
    if (i % 2 === 1) {
      ctx.fillStyle = theme.rowAlt;
      ctx.fillRect(0, y, s.size.width, ROW_H);
    }
  }

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of gridX) {
    ctx.moveTo(x, DISPLAY_TOP);
    ctx.lineTo(x, s.size.height);
  }
  ctx.stroke();

  ctx.font = `${theme.fontSize} ${theme.fontUi}`;
  for (let i = first; i <= last; i++) {
    const row = rows[i];
    const y = DISPLAY_TOP + i * ROW_H - s.scrollY;
    ctx.textAlign = "left";
    ctx.fillStyle = theme.text;
    ctx.fillText(fit(ctx, row.name, LABEL_W - 12), 8, y + ROW_H / 2);
    if (row.unavailable !== undefined) drawHatch(ctx, p, y, theme);
    for (const r of intervalRects(s, i)) {
      ctx.fillStyle = row.color;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const hot = hover !== null && hover.row === i && hover.interval === r.index;
      ctx.strokeStyle = hot ? theme.text : theme.barOutline;
      ctx.lineWidth = hot ? 2 : 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
    }
  }

  // เวลา animation ปัจจุบัน
  const [v0, v1] = s.view;
  if (s.current >= v0 && s.current <= v1) {
    const x = Math.round(p.left + timeToX(s.current, v0, v1, p.width)) + 0.5;
    ctx.strokeStyle = theme.now;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, DISPLAY_TOP);
    ctx.lineTo(x, s.size.height);
    ctx.stroke();
  }

  // เส้นแบ่งคอลัมน์ชื่อแถว
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.left - 0.5, DISPLAY_TOP);
  ctx.lineTo(p.left - 0.5, s.size.height);
  ctx.stroke();
  ctx.restore();
}

/** วาดทั้ง canvas (ผู้เรียกตั้ง transform ของ pixel ratio ไว้แล้ว: พิกัดเป็นพิกเซล CSS) */
export function drawTimeline(ctx: CanvasRenderingContext2D, input: DrawInput): void {
  const { scene: s, theme, fmt, ltz } = input;
  const p = plotOf(s.size, needsScrollbar(s.size, input.rows.length));
  ctx.clearRect(0, 0, s.size.width, s.size.height);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, s.size.width, s.size.height);
  ctx.textBaseline = "middle";
  drawBar(ctx, s, p, theme);
  const gridX = drawScale(ctx, s, p, theme, fmt, ltz);
  drawDisplay(ctx, input, p, gridX);
}
