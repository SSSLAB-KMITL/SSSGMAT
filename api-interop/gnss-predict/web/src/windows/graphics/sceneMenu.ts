// เมนูคลิกขวาบนภาพของหน้าต่าง 3D และ 2D (ใช้กับ CommandContextMenu ที่ห่อ element ของภาพ) ไม่ import Cesium
//
// - คลิกขวาบน object (objectAt ตอบ path และ objectMenu มีรายการ: หน้าต่าง 3D, sensor spec §5.5) = เลือก object แล้วเปิดเมนูของมันทันทีที่ browser
//   ส่ง contextmenu แบบเดิม
// - เมนูของหน้าต่าง (windowMenu, task 13c: Show Orbits / Show Ground Tracks) เปิดเมื่อคลิกขวาที่ไม่ชี้ object โดยไม่ลาก: กดและปล่อยปุ่มขวา
//   เลื่อนไม่เกิน 4 px (pick.ts isClick) ปุ่มขวาที่ลากคือการซูมของ Cesium จึงไม่เปิดเมนู ตัดสินตอนปล่อยปุ่ม ไม่ใช่ตอน contextmenu เพราะ macOS และ Linux
//   ส่ง contextmenu ตั้งแต่กดปุ่ม (ยังไม่รู้ว่าจะลาก) เปิดโดยส่ง contextmenu ของเราเองไปที่ element ของภาพ (Radix เปิดเมนูที่จุดนั้น)
//   contextmenu ของ browser ที่ไม่ชี้ object ถูกกันเสมอ (ไม่มีเมนูของ browser บนภาพ) Windows ส่ง contextmenu หลังปล่อยปุ่ม (หลังเมนูของเราเปิดแล้ว
//   ชี้ไปนอกภาพเพราะเมนูกันเมาส์ทั้งหน้า หรือยังชี้ในภาพ): ทุก contextmenu ของ browser ภายใน 500 ms หลังเปิดเมนูของหน้าต่าง ไม่ว่าชี้ที่ไหน
//   ถูกกันและหยุดที่ window (ไม่ขึ้นเมนูของ browser และไม่ถึงตัวฟังของภาพ ซึ่งจะเปลี่ยนรายการจนเมนูที่เปิดอยู่ว่าง) ยกเว้น contextmenu ของเราเอง
// - คลิกขวาที่ว่างไม่เปลี่ยนการเลือก
// - macOS: Ctrl+คลิกปุ่มซ้ายนับเป็นคลิกขวา (เริ่มที่ pointerdown ปุ่ม 0 + Ctrl จบที่ pointerup ปุ่มเดียวกัน) ระบบอื่น Ctrl+คลิกเป็นคลิกธรรมดา

import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { MenuEntry } from "../../chrome/menus";
import { isClick, selectScenePath, type Point } from "../Graphics3D/pick";

/** หลังเปิดเมนูของหน้าต่าง contextmenu ของ browser ที่ตามมาภายในเวลานี้ (ms) ถูกกัน (Windows ส่ง contextmenu หลังปล่อยปุ่ม) */
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

/** เครื่อง macOS (Ctrl+คลิก = คลิกขวา) */
export function isMacPlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac/i.test(nav.userAgentData?.platform ?? nav.platform ?? "");
}

/** ปุ่มที่เริ่มคลิกขวา: ปุ่มขวา หรือบน macOS ปุ่มซ้ายพร้อม Ctrl */
const isSecondaryDown = (e: { button: number; ctrlKey: boolean }): boolean => e.button === 2 || (e.button === 0 && e.ctrlKey && isMacPlatform());

const localPoint = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }): Point => {
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
};

/** contextmenu ที่เราส่งเองเพื่อเปิดเมนูของหน้าต่าง (ตัวกันไม่แตะ) */
const ours = new WeakSet<Event>();

/**
 * กันทุก contextmenu ของ browser ภายใน NATIVE_MENU_GUARD_MS ไม่ว่าชี้ที่ไหน: preventDefault และหยุดที่ window (capture) ไม่ถึงตัวฟังของภาพ
 * หน้าต่างถูกปิดไปแล้ว (el ไม่อยู่ในหน้า) = เลิกกัน
 */
function guardNativeMenu(el: HTMLElement): void {
  const prevent = (ev: Event): void => {
    if (!el.isConnected) {
      off();
      return;
    }
    if (ours.has(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
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
  /** จุดที่กดปุ่มขวา (หรือ Ctrl+ปุ่มซ้ายบน macOS) ค้างอยู่ (พิกัดของหน้าจอ) และปุ่มที่กด */
  const down = useRef<(Point & { button: number }) | null>(null);
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
    if (isSecondaryDown(e)) down.current = { x: e.clientX, y: e.clientY, button: e.button };
  };

  const onPointerUpCapture = (e: ReactPointerEvent<HTMLElement>): void => {
    const start = down.current;
    if (start === null || e.button !== start.button) return;
    down.current = null;
    if (!isClick(start, { x: e.clientX, y: e.clientY })) return; // ลากปุ่มขวา = ซูม (Ctrl+ลากปุ่มซ้าย = หมุนกล้อง)
    const at = localPoint(e);
    if ((latest.current.objectAt?.(at.x, at.y) ?? null) !== null) return; // บน object: เมนูของ object (contextmenu ของ browser)
    const el = e.currentTarget;
    opening.current = true;
    try {
      const open = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 2 });
      ours.add(open);
      el.dispatchEvent(open);
    } finally {
      opening.current = false;
    }
    guardNativeMenu(el);
  };

  return { entries, handlers: { onContextMenuCapture, onPointerDownCapture, onPointerUpCapture } };
}
