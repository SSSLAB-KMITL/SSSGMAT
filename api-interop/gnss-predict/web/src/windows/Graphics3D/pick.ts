// เลือก object ด้วยการคลิกบนภาพของหน้าต่าง 3D (sensor spec §5.5) ไม่ import Cesium: Graphics3D.tsx (เมนูคลิกขวา) กับ scene3d.ts (คลิกซ้าย) ใช้ร่วมกัน
//
// - คลิกซ้ายบนดาวหรือ Facility = เลือก object นั้นเหมือนคลิกแถวใน Object Browser; คลิกที่ว่าง = ไม่เปลี่ยนการเลือก
// - คลิก = เมาส์เลื่อนไม่เกิน 4 px ระหว่างกดและปล่อย (ความเสี่ยง S4: ลากหมุนโลกแล้วปล่อยบนดาวต้องไม่เลือกดาว)

import { useSelection } from "../../stores/selection";
import { requestScroll, reveal } from "../ObjectBrowser/actions";

/** จุดบนภาพ (พิกเซลของ canvas) */
export interface Point {
  x: number;
  y: number;
}

/** เมาส์เลื่อนได้ไม่เกินเท่านี้ (พิกเซล) ระหว่างกดและปล่อยจึงนับเป็นคลิก */
export const CLICK_TOLERANCE_PX = 4;

/** จุดของดาวหรือ Facility ที่ห่างจากเมาส์ไม่เกินเท่านี้ (พิกเซล) นับว่าชี้อยู่ (จุดกว้าง 6–10 px) */
export const PICK_RADIUS_PX = 8;

/** กดที่ down แล้วปล่อยที่ up เป็นคลิกไหม (ระยะที่เลื่อนไม่เกิน tolPx) */
export function isClick(down: Point, up: Point, tolPx: number = CLICK_TOLERANCE_PX): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= tolPx;
}

/** จุดของ entity หนึ่งชิ้นบนภาพ (at = null: ไม่อยู่ในภาพ ซ่อน อยู่หลังโลก หรือนอกภาพ) */
export interface Marker {
  id: string;
  at: Point | null;
}

/** id ของจุดที่ห่างจาก target ไม่เกิน radius เรียงจากใกล้ไปไกล (จุดที่ไม่อยู่ในภาพข้ามไป) */
export function markersNear(markers: Iterable<Marker>, target: Point, radius: number = PICK_RADIUS_PX): string[] {
  const near: { id: string; distance: number }[] = [];
  for (const { id, at } of markers) {
    const distance = at === null ? Infinity : Math.hypot(at.x - target.x, at.y - target.y);
    if (distance <= radius) near.push({ id, distance });
  }
  return near.sort((a, b) => a.distance - b.distance).map((m) => m.id);
}

/**
 * เลือก object ที่ path เหมือนการเลือกจากที่อื่น: เป็น active object (state.ts ล้างการเลือกโฟลเดอร์ให้เอง) เปิดโฟลเดอร์ที่พับครอบแถวอยู่
 * และให้ Object Browser เลื่อนไปที่แถว (เลือกดาวเดิมซ้ำก็เปิดและเลื่อนอีก เผื่อผู้ใช้พับโฟลเดอร์ไปแล้ว)
 */
export function selectScenePath(path: string): void {
  useSelection.getState().select(path);
  reveal(path);
  requestScroll(path);
}

/**
 * ผู้ใช้กดที่ down แล้วปล่อยที่ up บนภาพ: ถ้าเป็นคลิกและมี object ใต้จุดที่ปล่อย (pathAt) เลือก object นั้น
 * ลากแล้วปล่อย หรือคลิกที่ว่าง = ไม่ทำอะไร (การเลือกเดิมอยู่)
 */
export function selectOnClick(down: Point, up: Point, pathAt: (x: number, y: number) => string | null): void {
  if (!isClick(down, up)) return;
  const path = pathAt(up.x, up.y);
  if (path !== null) selectScenePath(path);
}
