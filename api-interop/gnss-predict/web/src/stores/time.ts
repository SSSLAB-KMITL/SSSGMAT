// store เวลากลางของแอป (spec §6.1): ทุกหน้าต่างอ่านเวลาจากที่นี่ที่เดียว
// ตรรกะ animation เป็นฟังก์ชันล้วน (advance, timeFromScenario) ส่วน useTime ห่อด้วย Zustand

import { create } from "zustand";
import type { components } from "../api/types.gen";
import { parseIsoUtc } from "../time/parse";
import { nextStep, prevStep } from "../time/steps";

export type TimeMode = "normal" | "realtime" | "xrealtime";
export type Cycle = "off" | "stop" | "loop";

export interface TimeState {
  current: Date;
  mode: TimeMode;
  direction: 1 | -1 | 0;
  step_s: number;
  multiplier: number;
  cycle: Cycle;
  periodStart: Date;
  periodStop: Date;
  animStart: Date;
  /**
   * เศษมิลลิวินาทีที่ Date เก็บไม่ได้ (−0.5…0.5) ถูกทบเข้าเฟรมถัดไป ไม่งั้นเฟรมที่เดินน้อยกว่า 1 ms
   * (Time Step 0.0001 s แบบ Normal = 0.05 ms ต่อเฟรม) ไม่ขยับเลย และ Real-Time เพี้ยนตามการปัดเศษของแต่ละเฟรม
   * ไม่มี = 0
   */
  residualMs?: number;
}

/** W2: Normal Animation Mode เดิน 1 step ต่อ refresh ที่ 30 ครั้งต่อวินาทีคงที่ */
export const NORMAL_REFRESH_HZ = 30;

type Moved = { current: Date; residualMs: number; stopped: boolean };

/**
 * เลื่อนเวลา `deltaMs` (≠ 0) แล้วใช้กฎ Animation Cycle ที่ปลายช่วงวิเคราะห์ (W1):
 * off = เดินเลยปลาย, stop = หยุดที่ปลาย (ถ้าอยู่ที่หรือเลยปลายนั้นอยู่แล้วก็หยุดอยู่กับที่ ไม่กระโดดกลับ),
 * loop = เดินหน้าเลยปลายกลับต้นช่วง ถอยหลังเลยต้นไปปลายช่วง
 */
function move(s: TimeState, deltaMs: number): Moved {
  const lo = +s.periodStart;
  const hi = +s.periodStop;
  const cur = +s.current;
  const total = (s.residualMs ?? 0) + deltaMs; // คิดเศษแยกจาก cur (≈1.8e12 ms) ไม่งั้นเศษสูญความละเอียดราว 0.2 µs ต่อเฟรม
  const exact = cur + total;
  const forward = deltaMs > 0;
  if (s.cycle === "stop") {
    if (forward ? cur >= hi : cur <= lo) return { current: s.current, residualMs: 0, stopped: true };
    if (forward ? exact >= hi : exact <= lo) return { current: new Date(forward ? hi : lo), residualMs: 0, stopped: true };
  } else if (s.cycle === "loop") {
    if (forward ? exact > hi : exact < lo) return { current: new Date(forward ? lo : hi), residualMs: 0, stopped: false };
  }
  const whole = Math.round(total);
  return { current: new Date(cur + whole), residualMs: total - whole, stopped: false };
}

/**
 * เดินเวลาตามเวลาจริงที่ผ่านไป `dtRealS` วินาที (W1, W2)
 * Normal: direction × step_s × 30 × dt; Real-Time: direction × dt; X Real-Time: direction × multiplier × dt
 * หยุดอยู่ (direction 0) หรือ dt ใช้ไม่ได้ → คืน state เดิมตัวเดิม
 */
export function advance(s: TimeState, dtRealS: number): TimeState {
  if (s.direction === 0 || !(dtRealS > 0)) return s;
  const rate = s.mode === "normal" ? s.step_s * NORMAL_REFRESH_HZ : s.mode === "realtime" ? 1 : s.multiplier;
  const deltaMs = s.direction * rate * dtRealS * 1000;
  if (!Number.isFinite(deltaMs) || deltaMs === 0) return s;
  const m = move(s, deltaMs);
  return { ...s, current: m.current, residualMs: m.residualMs, direction: m.stopped ? 0 : s.direction };
}

type ScenarioDoc = components["schemas"]["ScenarioDoc"];
/** ส่วนของ scenario ที่ใช้ตั้งเวลา (ฟิลด์ animation ที่ server มีค่าเริ่มต้นอาจไม่มา) */
export type TimeSource = Pick<ScenarioDoc, "analysis_period" | "animation">;

const MODE_OF_UPDATE_MODE: Record<NonNullable<NonNullable<ScenarioDoc["animation"]>["update_mode"]>, TimeMode> = {
  time_step: "normal",
  real_time: "realtime",
  x_real_time: "xrealtime",
};

function readTime(field: string, text: string): Date {
  const d = parseIsoUtc(text);
  if (!d) throw new RangeError(`${field} is not an ISO 8601 UTC time ending in Z: ${JSON.stringify(text)}`);
  return d;
}

/**
 * ค่าตั้งต้นของ store จาก scenario: ฟิลด์ animation ที่หายใช้ค่าเริ่มต้นของ server
 * (time_step_s 60, update_mode time_step, x_real_time_multiplier 60, cycle loop, start = ต้นช่วงวิเคราะห์)
 * เวลาที่อ่านไม่ได้ throw RangeError
 */
export function timeFromScenario(doc: TimeSource): TimeState {
  const a: NonNullable<TimeSource["animation"]> = doc.animation ?? {};
  const periodStart = readTime("analysis_period.start", doc.analysis_period.start);
  const periodStop = readTime("analysis_period.stop", doc.analysis_period.stop);
  const animStart = a.start ? readTime("animation.start", a.start) : periodStart;
  return {
    current: animStart,
    mode: MODE_OF_UPDATE_MODE[a.update_mode ?? "time_step"],
    direction: 0,
    step_s: a.time_step_s ?? 60,
    multiplier: a.x_real_time_multiplier ?? 60,
    cycle: a.cycle ?? "loop",
    periodStart,
    periodStop,
    animStart,
    residualMs: 0,
  };
}

interface TimeActions {
  init(doc: TimeSource): void;
  reset(): void;
  stepForward(): void;
  stepBackward(): void;
  start(): void;
  reverse(): void;
  pause(): void;
  increaseStep(): void;
  decreaseStep(): void;
  setMode(mode: TimeMode): void;
  setMultiplier(x: number): void;
  setCurrent(d: Date): void;
  tick(dtRealS: number): void;
}

export type TimeStore = TimeState & TimeActions;

const EPOCH = new Date(0);

export const useTime = create<TimeStore>()((set, get) => {
  const timeOf = (st: TimeStore): TimeState => ({
    current: st.current, mode: st.mode, direction: st.direction, step_s: st.step_s, multiplier: st.multiplier, cycle: st.cycle,
    periodStart: st.periodStart, periodStop: st.periodStop, animStart: st.animStart, residualMs: st.residualMs,
  });
  const oneStep = (sign: 1 | -1) => {
    const s = timeOf(get());
    const m = move(s, sign * s.step_s * 1000);
    set({ current: m.current, residualMs: m.residualMs, direction: 0 });
  };
  return {
    // ค่าก่อนเปิด scenario ใดๆ (init เขียนทับ)
    current: EPOCH, mode: "normal", direction: 0, step_s: 60, multiplier: 60, cycle: "loop",
    periodStart: EPOCH, periodStop: new Date(86_400_000), animStart: EPOCH, residualMs: 0,

    init: (doc) => set(timeFromScenario(doc)),
    reset: () => set((st) => ({ current: st.animStart, direction: 0, residualMs: 0 })),
    stepForward: () => oneStep(1),
    stepBackward: () => oneStep(-1),
    start: () => set({ direction: 1 }),
    reverse: () => set({ direction: -1 }),
    pause: () => set({ direction: 0 }),
    increaseStep: () => set((st) => ({ step_s: nextStep(st.step_s) })),
    decreaseStep: () => set((st) => ({ step_s: prevStep(st.step_s) })),
    setMode: (mode) => set({ mode }),
    setMultiplier: (x) => {
      if (Number.isFinite(x) && x > 0) set({ multiplier: x });
    },
    setCurrent: (d) => {
      if (Number.isFinite(d.getTime())) set({ current: new Date(d.getTime()), residualMs: 0 });
    },
    tick: (dtRealS) => {
      const s = timeOf(get());
      const n = advance(s, dtRealS);
      if (n !== s) set({ current: n.current, direction: n.direction, residualMs: n.residualMs });
    },
  };
});
