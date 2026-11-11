// ข้ามการ update ของ DataSourceDisplay เมื่อไม่มีอะไรเปลี่ยน (หน้าต่าง 3D ที่อยู่เฉย ๆ)
//
// Cesium เรียก dataSourceDisplay.update(time) ทุกเฟรมของ requestAnimationFrame แม้ไม่ได้วาดอะไร (requestRenderMode) และ PathVisualizer คำนวณเส้นทาง
// ของดาวทุกดวงใหม่ทุกครั้ง: หน้าต่างที่อยู่เฉย ๆ ใช้ CPU ราว 15% ของหนึ่ง core (วัดจริง: script 0.46 วินาทีต่อ 3 วินาที → 0.02 หลังใช้ตัวนี้)
// ตัวนี้แทน update ของ display ตัวนั้นตัวเดียว (ไม่แตะ prototype) ด้วยตัวที่ข้ามเมื่อ: เวลาเท่ารอบก่อน, ไม่มี EntityCollection ใดส่ง collectionChanged
// (เพิ่ม/ลบ/ค่าของ entity เปลี่ยน), ไม่มี data source เพิ่มหรือลบ และรอบก่อน update คืน true (พร้อมแล้ว) ตัวถอนคืน update เดิม
//
// ข้อจำกัด: ใช้ได้เฉพาะ viewer ที่ภาพของ entity ขึ้นกับเวลาและค่าของ entity เท่านั้น viewer ที่ใช้ตัวนี้ต้องไม่ใช้
//   - CallbackProperty / CallbackPositionProperty (ค่าเปลี่ยนเองโดยไม่ส่ง event)
//   - path ที่ relativeTo เป็น "INERTIAL" หรือ entity อื่น (ขึ้นกับข้อมูล ICRF ที่โหลดทีหลัง)
//   - DataSourceDisplay ที่มี visualizer เพิ่มเอง (ExtraVisualizers / registerVisualizer)
// หรือถ้าใช้ ต้องเรียก touch() ที่คืนให้ทุกครั้งที่สิ่งนั้นอาจเปลี่ยน หน้าต่าง 3D (scene3d.ts) ไม่ใช้ทั้งสามอย่าง

import { JulianDate, type DataSourceCollection, type DataSourceDisplay, type EntityCollection } from "cesium";

export interface IdleViewer {
  dataSourceDisplay: Pick<DataSourceDisplay, "update">;
  entities: EntityCollection;
  dataSources: DataSourceCollection;
}

export interface IdleUpdates {
  /** บังคับให้รอบถัดไป update จริง (ใช้เมื่อมีสิ่งที่เปลี่ยนโดยไม่ผ่าน event ของ EntityCollection) */
  touch(): void;
  /** เลิกฟังและคืน update เดิมของ display */
  dispose(): void;
}

export function skipIdleDisplayUpdates(viewer: IdleViewer): IdleUpdates {
  const display = viewer.dataSourceDisplay;
  const hadOwn = Object.hasOwn(display, "update");
  const previous = display.update;
  const update = previous.bind(display);
  let last: JulianDate | undefined;
  let dirty = true;
  let ready = false;
  const touch = (): void => {
    dirty = true;
  };
  const watched = new Map<EntityCollection, () => void>();
  const watch = (c: EntityCollection): void => {
    if (!watched.has(c)) watched.set(c, c.collectionChanged.addEventListener(touch));
  };
  watch(viewer.entities);
  for (let i = 0; i < viewer.dataSources.length; i++) watch(viewer.dataSources.get(i).entities);
  const offAdded = viewer.dataSources.dataSourceAdded.addEventListener((_c: unknown, ds: { entities: EntityCollection }) => {
    watch(ds.entities);
    touch();
  });
  const offRemoved = viewer.dataSources.dataSourceRemoved.addEventListener((_c: unknown, ds: { entities: EntityCollection }) => {
    watched.get(ds.entities)?.();
    watched.delete(ds.entities);
    touch();
  });
  display.update = (time: JulianDate): boolean => {
    if (!dirty && ready && last !== undefined && JulianDate.equals(time, last)) return true;
    dirty = false;
    last = JulianDate.clone(time, last);
    ready = update(time);
    return ready;
  };
  let disposed = false;
  return {
    touch,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      offAdded();
      offRemoved();
      for (const off of watched.values()) off();
      watched.clear();
      if (hadOwn) display.update = previous;
      else delete (display as { update?: unknown }).update; // กลับไปใช้ของ prototype
    },
  };
}
