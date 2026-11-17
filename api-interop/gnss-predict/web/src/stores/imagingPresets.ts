// preset ของดาวถ่ายภาพ (ข2 Ruling p): GET /api/imaging/presets (ตารางคงที่ของ engine ไม่ต่อเน็ต ไม่ผูก scenario) อ่านครั้งเดียวตอนเริ่มแอป (App.tsx)
// - หน้าเว็บรู้ว่าดาวใดเป็นดาวถ่ายภาพจาก NORAD (presetOfNorad) ไม่ใช่จากชื่อ: ดาวที่เปลี่ยนชื่อหรือคัดลอกยังจับคู่ได้
// - อ่านไม่ได้ (หรือคำตอบไม่ใช่รายการ preset) = ไม่มี preset, loaded = false และคำเตือนไทยหนึ่งข้อความ Show Imagery จึงปิดใช้

import { create } from "zustand";
import { ApiError, apiGet, errorText } from "../api/client";
import type { components } from "../api/types.gen";
import { msg } from "../labels/messages.th";
import { report } from "./messages";

export type ImagingPresetOut = components["schemas"]["ImagingPresetOut"];

interface ImagingPresetsState {
  /** preset X01…X08 ตามลำดับที่ server ส่ง */
  presets: ImagingPresetOut[];
  /** อ่านจาก server สำเร็จแล้ว */
  loaded: boolean;
  load(): Promise<void>;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** รูปร่างที่ Show Imagery ใช้: prn, NORAD (จำนวนเต็ม) และชื่อชั้น GIBS */
const isPreset = (x: unknown): x is ImagingPresetOut =>
  isRecord(x) && typeof x.prn === "string" && Number.isInteger(x.norad) && typeof x.gibs_layer === "string";

export const useImagingPresets = create<ImagingPresetsState>()((set) => ({
  presets: [],
  loaded: false,

  load: async () => {
    try {
      const { data } = await apiGet<unknown>("/imaging/presets");
      if (!Array.isArray(data)) throw new RangeError("the imaging presets are not a list");
      set({ presets: data.filter(isPreset), loaded: true });
    } catch (e) {
      set({ presets: [], loaded: false });
      report("warning", e instanceof ApiError ? e.code : "IMAGING_PRESETS", msg("imaging.presetsFailed", { message: errorText(e) }));
    }
  },
}));

/** preset ของดาว NORAD นี้ ไม่ใช่ดาวถ่ายภาพหรือยังไม่ได้อ่าน = undefined */
export function presetOfNorad(norad: number): ImagingPresetOut | undefined {
  return useImagingPresets.getState().presets.find((p) => p.norad === norad);
}
