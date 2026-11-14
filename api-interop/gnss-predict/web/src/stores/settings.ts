// สถานะ server (/api/health), ค่าตั้ง (/api/settings, spec server §9.1) และสถานะการเชื่อมต่อ SSE

import { create } from "zustand";
import { apiGet, apiSend } from "../api/client";
import type { DailyStatus } from "./jobs";

export interface HealthInfo {
  engine_version: string;
  gmat_found: boolean;
  data_dir: string;
  free_bytes: number | null;
  writable: boolean;
  daily: DailyStatus;
}

export interface DailySettings {
  enabled: boolean;
  run_at_utc: string;
  facility: string;
  retention_days: number;
  validation_retry_hours: number;
  validation_give_up_days: number;
}

/**
 * สวิตช์ภาพออนไลน์ แยกต่อแหล่ง (spec imagery §4.1, spec ภาพละเอียด §2): ค่าตั้งต้นปิดทุกช่อง ไม่ต่อเน็ตเองจนกว่าผู้ใช้เปิดแหล่งนั้น
 * `enabled` = NASA GIBS (ชื่อเดิม), `eox` = Sentinel-2 cloudless ผ่าน server, `osm` / `ion` = OpenStreetMap / Cesium ion ที่ browser ดึงตรง
 * PUT ต้องส่งครบทั้งสี่ช่อง (server ไม่เติมค่าให้): ผู้เรียกที่แก้ช่องเดียวต้องกระจายค่าที่ถืออยู่คืนไปทั้งก้อน
 */
export interface OnlineImagerySettings {
  enabled: boolean;
  eox: boolean;
  osm: boolean;
  ion: boolean;
}

export interface Settings {
  daily: DailySettings;
  cesium_ion_token: string;
  online_imagery: OnlineImagerySettings;
}

interface SettingsState {
  health: HealthInfo | null;
  settings: Settings | null;
  /** SSE ต่ออยู่หรือไม่ (แถบสถานะเป็นสีแดงเมื่อ false) */
  connected: boolean;
  /** ผิดพลาดเงียบ (แถบสถานะดึงซ้ำเป็นระยะ; สถานะการเชื่อมต่อแจ้งอยู่แล้ว) คงค่าเดิมไว้ */
  loadHealth(): Promise<void>;
  /** ผิดพลาดโยน ApiError ต่อ ให้หน้าตั้งค่าแสดงเอง */
  loadSettings(): Promise<void>;
  /** ค่าที่ server ไม่รับโยน ApiError (field บอกช่อง) ค่าเดิมไม่เปลี่ยน */
  saveSettings(s: Settings): Promise<void>;
}

export const useSettings = create<SettingsState>()((set) => ({
  health: null,
  settings: null,
  connected: false,

  loadHealth: async () => {
    try {
      const { data } = await apiGet<HealthInfo>("/health");
      set({ health: data });
    } catch {
      // ดึงไม่ได้: คงค่าเดิม (การเชื่อมต่อที่หลุดแสดงที่แถบสถานะอยู่แล้ว)
    }
  },

  loadSettings: async () => {
    const { data } = await apiGet<Settings>("/settings");
    set({ settings: data });
  },

  saveSettings: async (s) => {
    const { data } = await apiSend<Settings>("PUT", "/settings", s);
    set({ settings: data });
  },
}));
