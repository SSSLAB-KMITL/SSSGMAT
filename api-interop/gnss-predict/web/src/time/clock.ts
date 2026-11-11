// นาฬิกาตัวเดียวของแอป: requestAnimationFrame ลูปเดียว เรียก useTime.tick ด้วยเวลาจริงที่ผ่านไปตั้งแต่เฟรมก่อน

import { useTime } from "../stores/time";

export interface ClockDeps {
  raf: (cb: (t: number) => void) => number;
  caf: (id: number) => void;
  now: () => number;
}

/** เฟรมที่ห่างกว่านี้ (แท็บถูกซ่อนแล้วกลับมา) นับเป็น 1 วินาที เวลาจะได้ไม่กระโดด */
export const MAX_FRAME_DT_S = 1;

function runLoop({ raf, caf, now }: ClockDeps): () => void {
  let last = now();
  let id = 0;
  let running = true;
  const frame = () => {
    if (!running) return;
    id = raf(frame); // ขอเฟรมถัดไปก่อน tick: ถ้า tick (หรือผู้ติดตาม) ล้ม ลูปไม่หยุด และ stop() ยกเลิกได้ถูกตัวเสมอ
    const t = now();
    const dt = Math.min((t - last) / 1000, MAX_FRAME_DT_S);
    last = t;
    if (dt > 0) useTime.getState().tick(dt);
  };
  id = raf(frame);
  return () => {
    running = false;
    caf(id);
  };
}

let shared: { holders: number; stopLoop: () => void } | null = null;

/**
 * เริ่มนาฬิกา คืนฟังก์ชันหยุด (เรียกซ้ำได้ไม่เป็นไร)
 * ทั้งแอปมีลูป rAF เดียว: เรียกซ้ำขณะที่ลูปทำงานอยู่ใช้ลูปเดิมร่วมกัน (deps ของการเรียกหลังไม่มีผล)
 * และลูปหยุดเมื่อทุกผู้เรียกหยุดแล้ว กันเวลาเดินเป็นสองเท่าเวลา component mount ซ้อน
 * `deps` ไว้ฉีดตอน test (ค่าเริ่มต้น requestAnimationFrame, cancelAnimationFrame, performance.now)
 */
export function startClock(deps: Partial<ClockDeps> = {}): () => void {
  if (!shared) {
    shared = {
      holders: 0,
      stopLoop: runLoop({
        raf: deps.raf ?? ((cb) => requestAnimationFrame(cb)),
        caf: deps.caf ?? ((id) => cancelAnimationFrame(id)),
        now: deps.now ?? (() => performance.now()),
      }),
    };
  }
  const mine = shared;
  mine.holders++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--mine.holders === 0) {
      mine.stopLoop();
      if (shared === mine) shared = null;
    }
  };
}
