// คลิปบอร์ดของ Object Browser (W15): อยู่ในหน่วยความจำของหน้าเว็บ ไม่ใช้คลิปบอร์ดของระบบ
// - Copy + Paste = สร้างดาว <ชื่อ>_1 (_2 ... ถ้าชื่อซ้ำ) ที่ NORAD เดียวกัน; Cut + Paste บนโฟลเดอร์ = ย้ายดาวเข้ากลุ่ม
// - ใช้ได้กับดาว (Satellite) เท่านั้นใน v1; เก็บเป็น path เพื่อให้ตัดแล้วดาวถูกลบ/เปลี่ยนชื่อไปก่อนวางตรวจได้จากต้นไม้ปัจจุบัน

import { create } from "zustand";
import { useScenario } from "../../stores/scenario";

export type ClipboardMode = "cut" | "copy";

export interface ClipboardContent {
  mode: ClipboardMode;
  paths: string[];
}

interface ClipboardState {
  content: ClipboardContent | null;
  set(mode: ClipboardMode, paths: string[]): void;
  clear(): void;
}

export const useClipboard = create<ClipboardState>()((set) => ({
  content: null,
  set: (mode, paths) => set({ content: { mode, paths: [...paths] } }),
  clear: () => set({ content: null }),
}));

// path ที่คัดลอก/ตัดไว้เป็นของ scenario ที่เปิดอยู่ตอนนั้น: เปิดหรือปิด scenario อื่นแล้ววางไม่ได้ (ไม่งั้นดาวชื่อเดียวกันของอีก scenario ถูกคัดลอกโดยไม่ตั้งใจ)
// (store นี้มีอายุเท่าหน้าเว็บ จึงไม่ต้องเลิกฟัง)
useScenario.subscribe((state, prev) => {
  if (state.name !== prev.name) useClipboard.getState().clear();
});

/** ความยาวชื่อ object สูงสุดที่ server รับ (NAME_PATTERN) */
const MAX_NAME = 32;

/**
 * ชื่อของสำเนา: `<base>_1` หรือเลขแรกที่ยังว่าง ชื่อที่ถูกใช้แล้วนับทุก class และไม่สนตัวพิมพ์เล็กใหญ่ (เหมือน server)
 * ชื่อเดิมยาวจนต่อท้ายแล้วเกิน 32 ตัว ตัดส่วนต้นให้พอดี
 */
export function copyName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = `_${n}`;
    const name = `${base.slice(0, MAX_NAME - suffix.length)}${suffix}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}
