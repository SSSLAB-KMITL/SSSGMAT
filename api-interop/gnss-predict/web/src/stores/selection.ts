// object ที่เลือกอยู่ (Object Browser, Properties, 3D/2D ใช้ร่วมกัน) และตำแหน่งเมาส์บนแผนที่ 2D

import { create } from "zustand";

interface SelectionState {
  // path ของ object ที่เลือก เช่น "*/Satellite/G01" (null = ไม่ได้เลือก)
  activePath: string | null;
  /** [lat, lon] องศา ของเมาส์บนแผนที่ 2D (null = เมาส์อยู่นอกแผนที่) */
  cursorLatLon: [number, number] | null;
  select(path: string | null): void;
  setCursor(latLon: [number, number] | null): void;
}

export const useSelection = create<SelectionState>()((set) => ({
  activePath: null,
  cursorLatLon: null,
  select: (path) => set({ activePath: path }),
  setCursor: (latLon) => set({ cursorLatLon: latLon }),
}));
