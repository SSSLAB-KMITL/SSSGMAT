// เมนูคลิกขวาบนภาพของหน้าต่าง 3D และ 2D (ใช้กับ CommandContextMenu ที่ห่อ element ของภาพ) ไม่ import Cesium
//
// - คลิกขวาบน object (objectAt ตอบ path และ objectMenu มีรายการ: หน้าต่าง 3D, sensor spec §5.5) = เลือก object แล้วเปิดเมนูของมันทันทีที่ browser
//   ส่ง contextmenu แบบเดิม
// - เมนูของหน้าต่าง (windowMenu, task 13c: Show Orbits / Show Ground Tracks) เปิดเมื่อคลิกขวาที่ไม่ชี้ object โดยไม่ลาก: กดและปล่อยปุ่มขวา
//   เลื่อนไม่เกิน 4 px (pick.ts isClick) ปุ่มขวาที่ลากคือการซูมของ Cesium จึงไม่เปิดเมนู ตัดสินตอนปล่อยปุ่ม ไม่ใช่ตอน contextmenu เพราะ macOS และ Linux
//   ส่ง contextmenu ตั้งแต่กดปุ่ม (ยังไม่รู้ว่าจะลาก) เปิดโดยส่ง contextmenu ของเราเองไปที่ element ของภาพ (Radix เปิดเมนูที่จุดนั้น)
//   contextmenu ของ browser ที่ไม่ชี้ object ถูกกันเสมอ (ไม่มีเมนูของ browser บนภาพ) Windows ส่ง contextmenu หลังปล่อยปุ่ม (หลังเมนูของเราเปิดแล้ว
//   และชี้ไปนอกภาพเพราะเมนูกันเมาส์ทั้งหน้า): กันเมนูของ browser ที่มานอกภาพภายใน 500 ms หลังเปิดเมนูของหน้าต่างหนึ่งครั้ง
// - คลิกขวาที่ว่างไม่เปลี่ยนการเลือก

import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { MenuEntry } from "../../chrome/menus";
import { isClick, selectScenePath, type Point } from "../Graphics3D/pick";

/** หลังเปิดเมนูของหน้าต่าง เมนูของ browser ที่ตามมานอกภาพภายในเวลานี้ (ms) ถูกกัน (Windows ส่ง contextmenu หลังปล่อยปุ่ม) */
export const NATIVE_MENU_GUARD_MS = 500;

export interface SceneMenuOptions {
  /** path ของ object ใต้จุด (x, y) ในภาพ (พิกเซลจากมุมซ้ายบนของ element ของภาพ) ไม่มี = null; หน้าต่างที่ไม่มีเมนูของ object (2D) ไม่ระบุ */
  objectAt?(x: number, y: number): string | null;
  /** เมนูของ object ที่ path (ว่าง = ไม่มีเมนู) */
  objectMenu?(path: string): readonly MenuEntry[];
  /** เมนูของหน้าต่าง */
  windowMenu: readonly MenuEntry[];
}

export interface SceneMenu {
  /** รายการของเมนูที่จะเปิด (ส่งให้ CommandContextMenu) */
  entries: readonly MenuEntry[];
  /** ตัวฟังที่ใส่ที่ element ของภาพ (ตัวเดียวกับ Trigger ของเมนู) */
  handlers: {
    onContextMenuCapture(e: ReactMouseEvent<HTMLElement>): void;
    onPointerDownCapture(e: ReactPointerEvent<HTMLElement>): void;
    onPointerUpCapture(e: ReactPointerEvent<HTMLElement>): void;
  };
}

const localPoint = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }): Point => {
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
};

/**
 * กันเมนูของ browser ที่มานอก el ครั้งเดียวภายใน NATIVE_MENU_GUARD_MS (ข้างใน el ตัวฟังของภาพจัดการเอง)
 * หน้าต่างถูกปิดไปแล้ว (el ไม่อยู่ในหน้า) = เลิกกัน
 */
function guardNativeMenu(el: HTMLElement): void {
  const prevent = (ev: Event): void => {
    if (!el.isConnected) {
      off();
      return;
    }
    if (ev.target instanceof Node && el.contains(ev.target)) return;
    ev.preventDefault();
    off();
  };
  const timer = setTimeout(() => off(), NATIVE_MENU_GUARD_MS);
  function off(): void {
    clearTimeout(timer);
    window.removeEventListener("contextmenu", prevent, true);
  }
  window.addEventListener("contextmenu", prevent, true);
}

export function useSceneMenu(opts: SceneMenuOptions): SceneMenu {
  const [entries, setEntries] = useState<readonly MenuEntry[]>([]);
  /** จุดที่กดปุ่มขวาค้างอยู่ (พิกัดของหน้าจอ) */
  const down = useRef<Point | null>(null);
  /** กำลังส่ง contextmenu ของเราเอง (เปิดเมนูของหน้าต่าง) */
  const opening = useRef(false);
  const latest = useRef(opts);
  latest.current = opts;

  const onContextMenuCapture = (e: ReactMouseEvent<HTMLElement>): void => {
    const { objectAt, objectMenu, windowMenu } = latest.current;
    if (opening.current) {
      setEntries(windowMenu);
      return; // ให้ Trigger ของเมนูเปิดเมนูที่จุดนี้
    }
    const at = localPoint(e);
    const path = objectAt?.(at.x, at.y) ?? null;
    const menu = path === null ? [] : (objectMenu?.(path) ?? []);
    setEntries(menu);
    if (path === null || menu.length === 0) {
      e.preventDefault(); // ไม่ให้ browser เปิดเมนูของมันเอง
      e.stopPropagation(); // และไม่ถึง Trigger ของเมนู (เมนูของหน้าต่างรอดูตอนปล่อยปุ่ม)
      return;
    }
    selectScenePath(path);
  };

  const onPointerDownCapture = (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button === 2) down.current = { x: e.clientX, y: e.clientY };
  };

  const onPointerUpCapture = (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button !== 2) return;
    const start = down.current;
    down.current = null;
    if (start === null || !isClick(start, { x: e.clientX, y: e.clientY })) return; // ลากปุ่มขวา = ซูม
    const at = localPoint(e);
    if ((latest.current.objectAt?.(at.x, at.y) ?? null) !== null) return; // บน object: เมนูของ object (contextmenu ของ browser)
    const el = e.currentTarget;
    opening.current = true;
    try {
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 2 }));
    } finally {
      opening.current = false;
    }
    guardNativeMenu(el);
  };

  return { entries, handlers: { onContextMenuCapture, onPointerDownCapture, onPointerUpCapture } };
}
