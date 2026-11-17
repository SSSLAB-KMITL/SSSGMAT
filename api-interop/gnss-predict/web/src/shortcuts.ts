// คีย์ลัดของแอป (spec §5.1): keydown ตัวเดียวบน window เรียกคำสั่งผ่านทะเบียน (commands.ts)
//
// - Ctrl/Cmd+S = file.save และ preventDefault เสมอ (ไม่ให้ browser เปิดกล่อง Save Page) แม้พิมพ์อยู่ในช่องข้อความ และแม้คำสั่งยังไม่ลงทะเบียน
// - Delete = object.delete และ Ctrl/Cmd+F = edit.find เฉพาะเมื่อโฟกัสอยู่ใน element ที่มี data-focus-scope="objectBrowser" (Object Browser ใส่ให้)
//   และไม่ได้พิมพ์อยู่ในช่องข้อความ; Ctrl+F จับ (preventDefault) เมื่อคำสั่งใช้ได้เท่านั้น ไม่งั้นปล่อยให้ browser ค้นหาตามปกติ
// - Ctrl+N, Ctrl+O, Ctrl+Q ไม่แตะ: browser จองไว้
// - ตัวอักษรดูจาก event.key ถ้าเป็นตัวละติน ไม่งั้น (แป้นพิมพ์ไทยให้อักษรไทย) ดูจากตำแหน่งปุ่ม event.code; ข้ามเหตุการณ์ที่กำลังประกอบคำ (isComposing)

import { isEnabled, runCommand } from "./commands";

export const OBJECT_BROWSER_SCOPE = "objectBrowser";

/** ช่องที่พิมพ์ข้อความได้ (ไม่รวม checkbox, radio, ปุ่ม) */
const TEXT_INPUT_TYPES = new Set(["text", "search", "number", "email", "url", "tel", "password", "date", "datetime-local", "month", "time", "week"]);

function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return el.isContentEditable;
}

const inObjectBrowser = (el: Element | null): boolean => el?.closest(`[data-focus-scope="${OBJECT_BROWSER_SCOPE}"]`) != null;

/**
 * ปุ่มตัวอักษรของคีย์ลัด: ดูตัวอักษรที่แป้นพิมพ์ให้ (event.key) ก่อนถ้าเป็นตัวละติน เพราะผังแป้นอย่าง Dvorak หรือ Colemak วางตัวอักษรต่างจากตำแหน่งจริง
 * (Ctrl+S ที่ตำแหน่ง KeyS ของ Colemak คือ Ctrl+R และของ Dvorak คือ Ctrl+O ต้องไม่ถูกแย่งไป)
 * ใช้ตำแหน่งจริง (event.code) เฉพาะเมื่อ event.key ไม่ใช่ตัวละติน เช่นผังแป้นไทยที่ให้อักษรไทย
 */
function isKey(e: KeyboardEvent, letter: string): boolean {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase() === letter;
  return e.code === `Key${letter.toUpperCase()}`;
}

export interface ShortcutTarget {
  addEventListener(type: "keydown", listener: (e: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", listener: (e: KeyboardEvent) => void): void;
}

/** ติดตั้งคีย์ลัด คืนฟังก์ชันถอน */
export function installShortcuts(target: ShortcutTarget = window): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing) return;
    const primary = e.ctrlKey || e.metaKey;
    const source = e.target instanceof Element ? e.target : document.activeElement;

    if (primary && !e.altKey && !e.shiftKey && isKey(e, "s")) {
      e.preventDefault();
      if (!e.repeat) runCommand("file.save");
      return;
    }

    if (isTextEntry(source) || !inObjectBrowser(source)) return;

    if (primary && !e.altKey && !e.shiftKey && isKey(e, "f")) {
      if (!isEnabled("edit.find")) return;
      e.preventDefault();
      if (!e.repeat) runCommand("edit.find");
      return;
    }

    if (e.key === "Delete" && !primary && !e.altKey && !e.shiftKey) {
      if (!e.repeat) runCommand("object.delete");
    }
  };

  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
