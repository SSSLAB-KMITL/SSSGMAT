// คืนโฟกัสหลังกล่องโต้ตอบของ Radix ปิด: กล่องของแอปไม่มี Dialog.Trigger (เปิดจากคำสั่ง คีย์ลัด หรือ store) Radix จึงโฟกัส trigger ที่เป็น null
// แล้วโฟกัสตกไปที่ <body> คีย์ลูกศรและคีย์ลัดของ Object Browser (ต้องมีโฟกัสใน data-focus-scope ของมัน) จึงหายหลังกด Cancel หรือ Rename
//
// ใช้: const returnFocus = useReturnFocus(open); แล้วใส่ <Dialog.Content onCloseAutoFocus={returnFocus.onCloseAutoFocus}>
// - จำ element ที่มีโฟกัสตอน open เปลี่ยนเป็น true (useLayoutEffect: ก่อน FocusScope ของ Radix ย้ายโฟกัสเข้ากล่องใน effect ของมัน)
// - ตอนปิด: กันค่าตั้งต้นของ Radix แล้วโฟกัส element นั้นถ้ายังอยู่ในหน้า (หายไปแล้ว = ไม่บังคับโฟกัสไปไหน)
// - element ที่จำไว้อยู่ในกล่องอื่นที่ปิดไปก่อน (เช่น 412 ที่กล่องของทั้งแอปเปิดแวบหนึ่งก่อนกล่องของ Properties Browser รับไป):
//   ใช้ที่ที่กล่องนั้นคืนโฟกัสให้แทน (กล่องที่ปิดแล้วจดไว้ใน returnedBy ตาม element ของกล่อง)
// - forget(): ไม่คืนโฟกัสครั้งนี้ (Windows... หลัง Activate: คืนไปที่เดิมจะทำให้หน้าต่างเดิม active อีก)

import { useLayoutEffect, useMemo, useRef } from "react";

export interface ReturnFocus {
  onCloseAutoFocus(event: Event): void;
  forget(): void;
}

/** กล่องที่ปิดแล้ว (element ของ Dialog.Content) → element ที่กล่องนั้นคืนโฟกัสให้ */
const returnedBy = new WeakMap<Element, HTMLElement | null>();

export function useReturnFocus(open: boolean): ReturnFocus {
  const saved = useRef<{ element: HTMLElement; box: Element | null } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    saved.current = active instanceof HTMLElement && active !== document.body ? { element: active, box: active.closest('[role="dialog"]') } : null;
  }, [open]);
  return useMemo(
    () => ({
      onCloseAutoFocus: (event: Event) => {
        event.preventDefault();
        const s = saved.current;
        saved.current = null;
        let target = s?.element ?? null;
        if (target !== null && !target.isConnected && s?.box != null) target = returnedBy.get(s.box) ?? null;
        if (event.target instanceof Element) returnedBy.set(event.target, target);
        if (target?.isConnected === true) target.focus({ preventScroll: true });
      },
      forget: () => {
        saved.current = null;
      },
    }),
    [],
  );
}
