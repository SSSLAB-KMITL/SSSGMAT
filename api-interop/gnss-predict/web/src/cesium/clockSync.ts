// เวลาของ viewer ตามนาฬิกาของแอป (spec §9.1): useTime เป็นเจ้าของเวลาที่เดียว viewer ไม่เดินเอง (shouldAnimate = false)
// ทุกครั้งที่ useTime.current เปลี่ยน ตั้ง clock.currentTime แล้วขอเฟรม (requestRenderMode: ไม่ขอ = ภาพไม่ขยับ)

import { JulianDate, type Viewer } from "cesium";
import { useTime } from "../stores/time";

type ClockViewer = Pick<Viewer, "clock" | "scene">;

/** ตั้งเวลาของ viewer เป็น d แล้วขอวาดเฟรมใหม่ */
export function syncClock(viewer: ClockViewer, d: Date): void {
  viewer.clock.currentTime = JulianDate.fromDate(d, new JulianDate()); // Clock เก็บตัวที่ส่งมาเลย จึงต้องเป็นตัวใหม่ทุกครั้ง
  viewer.scene.requestRender();
}

/** ตั้งเวลาตอนนี้ แล้วตามทุกการเปลี่ยนของ useTime (onChange เรียกหลังตั้งเวลาแล้ว) คืนฟังก์ชันเลิกตาม */
export function bindClock(viewer: ClockViewer, onChange?: (d: Date) => void): () => void {
  syncClock(viewer, useTime.getState().current);
  return useTime.subscribe((s, prev) => {
    if (s.current === prev.current) return;
    syncClock(viewer, s.current);
    onChange?.(s.current);
  });
}
