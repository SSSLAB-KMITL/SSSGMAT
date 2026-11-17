// ข้ามการ update ของ DataSourceDisplay เมื่อไม่มีอะไรเปลี่ยน (หน้าต่าง 3D ที่อยู่เฉย ๆ)
//
// Cesium เรียก dataSourceDisplay.update(time) ทุกเฟรมของ requestAnimationFrame แม้ไม่ได้วาดอะไร (requestRenderMode) และ PathVisualizer คำนวณเส้นทาง
// ของดาวทุกดวงใหม่ทุกครั้ง: หน้าต่างที่อยู่เฉย ๆ ใช้ CPU ราว 15% ของหนึ่ง core (วัดจริง: script 0.46 วินาทีต่อ 3 วินาที → 0.02 หลังใช้ตัวนี้)
// ตัวนี้แทน update ของ display ตัวนั้นตัวเดียว (ไม่แตะ prototype) ด้วยตัวที่ข้ามเมื่อ: เวลาเท่ารอบก่อน, ไม่มี EntityCollection ใดส่ง collectionChanged
// (เพิ่ม/ลบ/ค่าของ entity เปลี่ยน), ไม่มี data source เพิ่มหรือลบ, ไม่มี primitive เพิ่มเข้า scene.primitives หรือพร้อม (readyEvent) และรอบก่อน update
// คืน true (พร้อมแล้ว) ตัวถอนคืน update เดิม
//
// primitive ของ scene: ModelVisualizer สร้าง Model แบบ async (Model.fromGltfAsync) เพิ่มเข้า scene.primitives ทีหลัง และ update() คืน true ตลอด
// มันตั้ง modelMatrix, minimumPixelSize, สี, ขอบ ให้ Model ใน update() รอบหลังจากเพิ่มแล้วเท่านั้น และ node transformations หลัง Model ready เท่านั้น
// ข้ามรอบนั้น = โมเดลค้างที่ modelMatrix ตั้งต้น (ศูนย์กลางโลก) ขนาดขั้นต่ำ 0 ทั้งที่ ready และ show (ดาวที่ glb โหลดเสร็จหลัง entity เปลี่ยนครั้งสุดท้าย
// มองไม่เห็นเลย) primitive ที่เพิ่มหรือพร้อมจึงนับเป็นการเปลี่ยน และขอเฟรม (requestRenderMode: เฟรมถัดไป update ก่อน render)
//
// ข้อจำกัด: ใช้ได้เฉพาะ viewer ที่ภาพของ entity ขึ้นกับเวลาและค่าของ entity เท่านั้น viewer ที่ใช้ตัวนี้ต้องไม่ใช้
//   - CallbackProperty / CallbackPositionProperty (ค่าเปลี่ยนเองโดยไม่ส่ง event)
//   - path ที่ relativeTo เป็น "INERTIAL" หรือ entity อื่น (ขึ้นกับข้อมูล ICRF ที่โหลดทีหลัง)
//   - DataSourceDisplay ที่มี visualizer เพิ่มเอง (ExtraVisualizers / registerVisualizer)
// หรือถ้าใช้ ต้องเรียก touch() ที่คืนให้ทุกครั้งที่สิ่งนั้นอาจเปลี่ยน หน้าต่าง 3D (scene3d.ts) ไม่ใช้ทั้งสามอย่าง

import { JulianDate, type DataSourceCollection, type DataSourceDisplay, type EntityCollection, type Event, type PrimitiveCollection } from "cesium";

export interface IdleViewer {
  dataSourceDisplay: Pick<DataSourceDisplay, "update">;
  entities: EntityCollection;
  dataSources: DataSourceCollection;
  scene: { primitives: Pick<PrimitiveCollection, "primitiveAdded" | "primitiveRemoved">; requestRender(): void };
}

/** primitive ที่พร้อมทีหลัง (Model): ready = false จนกว่า readyEvent */
interface LateReady {
  ready?: unknown;
  readyEvent: Event;
}

const isLateReady = (p: unknown): p is LateReady =>
  typeof p === "object" && p !== null && (p as { ready?: unknown }).ready !== true && typeof (p as { readyEvent?: { addEventListener?: unknown } }).readyEvent?.addEventListener === "function";

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
  const primitives = viewer.scene.primitives;
  /** ตัวเลิกฟัง readyEvent ของ primitive ที่ยังไม่พร้อม */
  const pending = new Map<unknown, () => void>();
  const primitiveChanged = (): void => {
    touch();
    viewer.scene.requestRender();
  };
  const offPrimitiveAdded = primitives.primitiveAdded.addEventListener((p: unknown) => {
    primitiveChanged();
    if (!isLateReady(p) || pending.has(p)) return;
    const off = p.readyEvent.addEventListener(() => {
      pending.get(p)?.();
      pending.delete(p);
      primitiveChanged();
    });
    pending.set(p, off);
  });
  const offPrimitiveRemoved = primitives.primitiveRemoved.addEventListener((p: unknown) => {
    pending.get(p)?.();
    pending.delete(p);
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
      offPrimitiveAdded();
      offPrimitiveRemoved();
      for (const off of pending.values()) off();
      pending.clear();
      for (const off of watched.values()) off();
      watched.clear();
      if (hadOwn) display.update = previous;
      else delete (display as { update?: unknown }).update; // กลับไปใช้ของ prototype
    },
  };
}
