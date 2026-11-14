// ภาพพื้นโลกออนไลน์ NASA GIBS ของหน้าเว็บ (spec imagery §5): สวิตช์ (เจ้าของคือ settings.json ของ server) และรายการชั้นภาพ (catalog คงที่ของ server)
// - load: GET /api/imagery/layers ครั้งเดียวตอนเริ่มแอป (App.tsx) ล้มเหลว = คงปิดไว้ (ไม่มีชั้น GIBS) พร้อมคำเตือนไทย
// - setEnabled: GET /api/settings แล้ว PUT ทั้งเอกสาร (server ไม่รับเอกสารไม่ครบ) ที่แก้แค่ online_imagery.enabled ผ่าน store ของค่าตั้ง
//   store ของค่าตั้งจึงถือค่าล่าสุด (Daily Forecast Settings ส่งค่าที่ store ถือคืนตอน Apply ไม่ทับสวิตช์กลับ)
//   ล้มเหลว = สวิตช์คงค่าเดิม คำเตือนไทยใน Message Viewer แล้ว resolve (ผู้เรียกไม่ต้องแสดงซ้ำ)
// ชั้นไหนแสดงและโปร่งแสงเท่าไร (Show, Translucency) อยู่ใน workbook ของ scenario (useLayout.globe) ไม่ใช่ที่นี่

import { create } from "zustand";
import { ApiError, apiGet, errorText } from "../api/client";
import type { ImageryPeriod } from "../cesium/imageryTime";
import { msg } from "../labels/messages.th";
import { report } from "./messages";
import { useSettings } from "./settings";

export type { ImageryPeriod };

export interface ImageryLayerInfo {
  id: string;
  title: string;
  period: ImageryPeriod;
  max_level: number;
  format: "jpg" | "png";
  credit: string;
}

interface ImageryState {
  /** สวิตช์ online_imagery.enabled ของ server (ปิด = ไม่มีชั้น GIBS บน viewer ใด) */
  enabled: boolean;
  /** catalog ตามลำดับการวาด (ชั้นหลังทับชั้นก่อน) */
  layers: ImageryLayerInfo[];
  /** อ่านรายการจาก server สำเร็จแล้ว */
  loaded: boolean;
  load(): Promise<void>;
  setEnabled(on: boolean): Promise<void>;
}

interface LayersOut {
  enabled: boolean;
  layers: ImageryLayerInfo[];
}

const codeOf = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.code : fallback);

export const useImagery = create<ImageryState>()((set) => ({
  enabled: false,
  layers: [],
  loaded: false,

  load: async () => {
    try {
      const { data } = await apiGet<LayersOut>("/imagery/layers");
      set({ enabled: data.enabled === true, layers: [...data.layers], loaded: true });
    } catch (e) {
      set({ enabled: false });
      report("warning", codeOf(e, "IMAGERY_LOAD"), msg("imagery.loadFailed", { message: errorText(e) }));
    }
  },

  setEnabled: async (on) => {
    try {
      const settings = useSettings.getState();
      await settings.loadSettings();
      const current = useSettings.getState().settings;
      if (current === null) throw new Error("no settings");
      await settings.saveSettings({ ...current, online_imagery: { ...current.online_imagery, enabled: on } });
      set({ enabled: useSettings.getState().settings?.online_imagery.enabled === true });
    } catch (e) {
      report("warning", codeOf(e, "IMAGERY_SAVE"), msg("imagery.saveFailed", { message: errorText(e) }));
    }
  },
}));
