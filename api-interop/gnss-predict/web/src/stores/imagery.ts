// ภาพพื้นโลกออนไลน์ของหน้าเว็บ (spec imagery §5, spec ภาพละเอียด §2, §4): สวิตช์ต่อแหล่ง (เจ้าของคือ settings.json ของ server) และรายการชั้นภาพ (catalog คงที่ของ server)
// - แหล่ง: gibs (NASA GIBS, ช่อง online_imagery.enabled เดิม) และ eox (Sentinel-2 cloudless) ผ่าน server ในเครื่อง;
//   osm (OpenStreetMap) และ ion (Cesium ion) browser ดึงตรง (server ไม่ส่งชั้นของสองแหล่งนี้ ชั้น OSM คือ OSM_LAYER ที่นี่ ชั้น ion มาจาก asset ที่เลือก)
// - load: GET /api/imagery/layers ครั้งเดียวตอนเริ่มแอป (App.tsx) ล้มเหลว = ทุกแหล่งปิดไว้ (ไม่มีชั้นออนไลน์) พร้อมคำเตือนไทย
//   สวิตช์ที่ไม่ใช่ true ตรง ๆ = ปิด ; ชั้นที่ไม่มี source = gibs (payload ก่อนมีช่องนี้) ; source ที่ไม่รู้จักทิ้ง
//   ion เปิดอยู่ = อ่าน /api/settings ด้วย (token อยู่ใน cesium_ion_token ของ store ค่าตั้ง) อ่านไม่ได้ = คำเตือนไทย ชั้น ion รอจนอ่านได้
// - updateSettings(patch): GET /api/settings แล้ว PUT ทั้งเอกสาร (server ไม่รับเอกสารไม่ครบ) ที่แก้ด้วย patch ผ่าน store ของค่าตั้ง แล้วตั้งสวิตช์ทุกแหล่งตามเอกสารที่ server ตอบ
//   (ตัวช่วยเดียวสำหรับการบันทึกจาก Globe Manager: สวิตช์และ token ของ Cesium ion) ล้มเหลว = โยนต่อ ไม่รายงาน (ผู้เรียกแสดงเอง)
// - setSource(id, on): updateSettings ที่แก้แค่สวิตช์ของแหล่งนั้น
//   store ของค่าตั้งจึงถือค่าล่าสุด (Daily Forecast Settings ส่งค่าที่ store ถือคืนตอน Apply ไม่ทับสวิตช์กลับ) token และสวิตช์อื่นกลับไปตามที่อ่านมา
//   สวิตช์ทุกแหล่งที่นี่ตามเอกสารที่ server ตอบ ล้มเหลว = สวิตช์คงค่าเดิม คำเตือนไทย (บอกชื่อแหล่ง) ใน Message Viewer แล้ว resolve (ผู้เรียกไม่ต้องแสดงซ้ำ)
// ชั้นไหนแสดงและโปร่งแสงเท่าไร (Show, Translucency) และ asset ของ ion อยู่ใน workbook ของ scenario (useLayout.globe) ไม่ใช่ที่นี่

import { create } from "zustand";
import { ApiError, apiGet, errorText } from "../api/client";
import type { ImageryPeriod } from "../cesium/imageryTime";
import { msg } from "../labels/messages.th";
import { report } from "./messages";
import { useSettings, type OnlineImagerySettings, type Settings } from "./settings";

export type { ImageryPeriod };

/** แหล่งภาพออนไลน์ แต่ละแหล่งมีสวิตช์ของตัวเอง (ปิดเป็นค่าตั้งต้น) */
export type ImagerySourceId = "gibs" | "eox" | "osm" | "ion";
export const IMAGERY_SOURCES: readonly ImagerySourceId[] = ["gibs", "eox", "osm", "ion"];
/** แหล่งที่มีชั้นใน catalog (gibs, eox ผ่าน server) หรือเป็นชั้นเดียวแบบ URL (osm) */
export type LayerSourceId = Exclude<ImagerySourceId, "ion">;

/** ชื่อแหล่งในข้อความไทย */
export const SOURCE_NAMES: Readonly<Record<ImagerySourceId, string>> = {
  gibs: "NASA GIBS", eox: "Sentinel-2 cloudless (EOX)", osm: "OpenStreetMap", ion: "Cesium ion",
};

/** ช่องของสวิตช์ใน settings.json (online_imagery) ของแต่ละแหล่ง (GIBS ใช้ชื่อเดิม enabled) */
const SETTING_FIELD: Readonly<Record<ImagerySourceId, keyof OnlineImagerySettings>> = { gibs: "enabled", eox: "eox", osm: "osm", ion: "ion" };

export interface ImageryLayerInfo {
  id: string;
  title: string;
  period: ImageryPeriod;
  max_level: number;
  format: "jpg" | "png";
  credit: string;
  source: LayerSourceId;
}

/** แม่แบบ URL ของ OpenStreetMap (browser ดึงตรง ไม่ผ่าน server: นโยบายของ OSM ไม่แนะนำ proxy ที่ cache เอง) */
export const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** ชั้น OpenStreetMap (แถว "osm" ใน useLayout.globe) ระดับซูมสูงสุด 19 เครดิตต้องอยู่บนจอ */
export const OSM_LAYER: Readonly<ImageryLayerInfo> = Object.freeze({
  id: "osm", title: "OpenStreetMap", period: "static", max_level: 19, format: "png", credit: "© OpenStreetMap contributors", source: "osm",
});

export type ImagerySources = Record<ImagerySourceId, boolean>;

const SOURCES_OFF: Readonly<ImagerySources> = Object.freeze({ gibs: false, eox: false, osm: false, ion: false });

interface ImageryState {
  /** สวิตช์ของแต่ละแหล่งตาม settings.json ของ server (ปิด = ไม่มีชั้นของแหล่งนั้นบน viewer ใด ไม่มีคำขอไปโฮสต์นั้น) */
  sources: ImagerySources;
  /** catalog ของ server (gibs, eox) ตามลำดับที่ส่งมา */
  layers: ImageryLayerInfo[];
  /** อ่านรายการจาก server สำเร็จแล้ว */
  loaded: boolean;
  load(): Promise<void>;
  /** GET แล้ว PUT ทั้งเอกสารที่แก้ด้วย patch แล้วตั้งสวิตช์ตามเอกสารที่ server ตอบ ล้มเหลวโยนต่อ (สวิตช์และค่าเดิมไม่เปลี่ยน ไม่รายงาน) */
  updateSettings(patch: (current: Settings) => Settings): Promise<void>;
  setSource(id: ImagerySourceId, on: boolean): Promise<void>;
}

interface LayersOut {
  enabled?: unknown;
  sources?: Partial<Record<ImagerySourceId, unknown>>;
  layers: (Omit<ImageryLayerInfo, "source"> & { source?: unknown })[];
}

const codeOf = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.code : fallback);

/** สวิตช์จาก payload: true ตรง ๆ เท่านั้น (ไม่มี sources = payload เก่า: gibs จาก enabled) */
function sourcesOf(data: LayersOut): ImagerySources {
  const s = data.sources ?? { gibs: data.enabled };
  return { gibs: s.gibs === true, eox: s.eox === true, osm: s.osm === true, ion: s.ion === true };
}

function layersOf(data: LayersOut): ImageryLayerInfo[] {
  const out: ImageryLayerInfo[] = [];
  for (const l of data.layers) {
    const source = l.source ?? "gibs";
    if (source === "gibs" || source === "eox") out.push({ ...l, source });
  }
  return out;
}

const fromSettings = (o: OnlineImagerySettings): ImagerySources => ({
  gibs: o.enabled === true, eox: o.eox === true, osm: o.osm === true, ion: o.ion === true,
});

export const useImagery = create<ImageryState>()((set) => ({
  sources: SOURCES_OFF,
  layers: [],
  loaded: false,

  load: async () => {
    let sources: ImagerySources;
    try {
      const { data } = await apiGet<LayersOut>("/imagery/layers");
      sources = sourcesOf(data);
      set({ sources, layers: layersOf(data), loaded: true });
    } catch (e) {
      set({ sources: SOURCES_OFF });
      report("warning", codeOf(e, "IMAGERY_LOAD"), msg("imagery.loadFailed", { message: errorText(e) }));
      return;
    }
    if (!sources.ion || useSettings.getState().settings !== null) return;
    try {
      await useSettings.getState().loadSettings();
    } catch (e) {
      report("warning", codeOf(e, "IMAGERY_ION_SETTINGS"), msg("imagery.ionSettingsFailed", { message: errorText(e) }));
    }
  },

  updateSettings: async (patch) => {
    const settings = useSettings.getState();
    await settings.loadSettings();
    const current = useSettings.getState().settings;
    if (current === null) throw new Error("no settings");
    await settings.saveSettings(patch(current));
    const saved = useSettings.getState().settings;
    if (saved !== null) set({ sources: fromSettings(saved.online_imagery) });
  },

  setSource: async (id, on) => {
    try {
      await useImagery.getState().updateSettings((current) => ({ ...current, online_imagery: { ...current.online_imagery, [SETTING_FIELD[id]]: on } }));
    } catch (e) {
      report("warning", codeOf(e, "IMAGERY_SAVE"), msg("imagery.saveFailed", { source: SOURCE_NAMES[id], message: errorText(e) }));
    }
  },
}));
