// ทะเบียนหน้าต่างกราฟิกที่เปิดอยู่ หนึ่งทะเบียนต่อชนิด (3D: Graphics3D/registry.ts, 2D: Graphics2D/registry2d.ts) ไม่ import Cesium:
// คำสั่ง แถบเครื่องมือ และ window.__gnssStudioTest อยู่ใน bundle หลัก ส่วน Cesium โหลดทีหลังกับหน้าต่าง
//
// - หน้าต่างลงทะเบียน handle ของตัวเองเมื่อ viewer พร้อม และถอนเมื่อปิด (ตัวถอนที่ค้างไม่ถอน handle ตัวใหม่กว่าที่ id เดียวกัน)
// - "หน้าต่างที่ active" (คำสั่งของแถบเครื่องมือทำกับมัน): panel ที่ dockview บอกว่า active ถ้าอยู่ในทะเบียนนี้,
//   ไม่งั้นหน้าต่างที่ผู้ใช้แตะล่าสุด (markActive), ไม่งั้นบานแรกที่เปิด
// - observable (subscribe/version) ให้คำสั่งและปุ่มวาดสถานะใหม่เมื่อหน้าต่างเปิด/ปิดหรือสถานะของหน้าต่าง (โหมดเมาส์ ฯลฯ) เปลี่ยน

import { useLayout } from "../../stores/layout";

/** โหมดของปุ่มซ้ายของเมาส์บนภาพ: ลากเลื่อนภาพ (Grab Globe ใน 3D) หรือลากกรอบเพื่อซูม (Zoom In) */
export type MouseMode = "grab" | "zoomIn";

export interface SceneRegistry<H extends { readonly panelId: string }> {
  /** ลงทะเบียน คืนตัวถอนที่ถอนเฉพาะเมื่อยังเป็น handle ตัวนี้ */
  register(handle: H): () => void;
  get(panelId: string): H | undefined;
  /** ทุกหน้าต่างที่ลงทะเบียนอยู่ ตามลำดับที่เปิด */
  all(): H[];
  /** ผู้ใช้แตะหน้าต่างนี้ (คลิก โฟกัส) */
  markActive(panelId: string): void;
  active(): H | undefined;
  /** หน้าต่าง id preferred ถ้าเปิดอยู่ ไม่งั้นบานที่เปิดก่อนสุด */
  first(preferred: string): H | undefined;
  /** แจ้งผู้ฟังว่าชุดหน้าต่างหรือสถานะของหน้าต่างเปลี่ยน */
  notify(): void;
  subscribe(listener: () => void): () => void;
  version(): number;
  /** ล้างทะเบียน (test) */
  reset(): void;
}

export function createSceneRegistry<H extends { readonly panelId: string }>(): SceneRegistry<H> {
  const scenes = new Map<string, H>();
  const listeners = new Set<() => void>();
  let lastActive: string | null = null;
  let version = 0;

  const notify = (): void => {
    version++;
    for (const l of [...listeners]) l();
  };

  return {
    register: (handle) => {
      scenes.set(handle.panelId, handle);
      notify();
      return () => {
        if (scenes.get(handle.panelId) !== handle) return;
        scenes.delete(handle.panelId);
        if (lastActive === handle.panelId) lastActive = null;
        notify();
      };
    },
    get: (panelId) => scenes.get(panelId),
    all: () => [...scenes.values()],
    markActive: (panelId) => {
      if (lastActive === panelId) return;
      lastActive = panelId;
      notify();
    },
    active: () => {
      const active = useLayout.getState().api?.activePanel?.id;
      if (active !== undefined && scenes.has(active)) return scenes.get(active);
      if (lastActive !== null && scenes.has(lastActive)) return scenes.get(lastActive);
      return scenes.values().next().value;
    },
    first: (preferred) => scenes.get(preferred) ?? scenes.values().next().value,
    notify,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
    reset: () => {
      scenes.clear();
      lastActive = null;
      notify();
    },
  };
}
