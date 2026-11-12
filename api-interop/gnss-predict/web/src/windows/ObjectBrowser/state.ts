// สถานะหน้าจอของ Object Browser ที่คำสั่ง (ลงทะเบียนระดับแอป ดู objectCommands.ts) กับหน้าต่างใช้ร่วมกัน
// คำสั่งต้องทำงานได้แม้หน้าต่างถูกปิดหรือ dockview ถอดแท็บที่ซ่อนอยู่ จึงเก็บที่นี่ ไม่ใช่ใน component
// (คลิปบอร์ดอยู่ที่ clipboard.ts)
//
// - collapsed: key ของโหนดที่พับ (ไม่มีในชุด = ขยาย โหนดใหม่จึงขยายเอง)
// - groupSelected: key ของโฟลเดอร์ที่เลือก (โฟลเดอร์ไม่ใช่ object จึงไม่ผ่าน useSelection)
// - scenario อื่น = ต้นไม้คนละต้น: รีเซ็ตการพับ การกรอง การเลือกโฟลเดอร์ ตัวค้นและกล่องที่ค้างอยู่ ส่วนที่ตั้งค่าคอลัมน์เป็นของผู้ใช้ ไม่รีเซ็ต
// - เลือก object จากที่ใดก็ตาม = ไม่ได้เลือกโฟลเดอร์แล้ว

import { create } from "zustand";
import { useScenario } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";

export interface RenameTarget {
  cls: string;
  name: string;
}

interface ObjectBrowserState {
  collapsed: ReadonlySet<string>;
  groupSelected: string | null;
  flaggedOnly: boolean;
  showColors: boolean;
  showToggles: boolean;
  findOpen: boolean;
  /** เพิ่มทุกครั้งที่สั่ง Find (กล่องเปิดอยู่แล้วก็ให้โฟกัสช่องคำค้นอีกครั้ง) */
  findToken: number;
  /** ผลค้นล่าสุด: ค้นถัดไป/ก่อนหน้าต่อจากแถวนี้ ถ้าคำค้นเดิมและยังเลือกอยู่ที่แถวนี้ */
  findAnchor: { query: string; key: string } | null;
  newGroupOpen: boolean;
  renaming: RenameTarget | null;
  /** key ของแถวที่หน้าต่างต้องเลื่อนไปให้เห็นเมื่อแถวนั้นอยู่ในรายการ */
  scrollTarget: string | null;
  /**
   * key ของแถวที่ต้องได้โฟกัสคีย์บอร์ดเมื่อแถวนั้นถูกวาด (TREE_FOCUS = ตัวต้นไม้) หลัง Rename หรือ Delete แถวเดิมหายไปจาก DOM
   * (แถวผูกกับ path) กล่องโต้ตอบจึงคืนโฟกัสให้แถวเดิมไม่ได้ หน้าต่างล้างค่านี้เมื่อโฟกัสลงแล้ว
   */
  focusTarget: string | null;
  /** แถวที่กำลังเขียนอยู่: ช่องติ๊กของแถวนั้นปิดไว้จนเขียนเสร็จ */
  busy: ReadonlySet<string>;
}

const FRESH = {
  collapsed: new Set<string>(),
  groupSelected: null,
  flaggedOnly: false,
  findAnchor: null,
  newGroupOpen: false,
  renaming: null,
  scrollTarget: null,
  focusTarget: null,
} satisfies Partial<ObjectBrowserState>;

/** focusTarget ที่หมายถึงตัวต้นไม้ (ไม่มีแถวข้างเคียงให้โฟกัส) */
export const TREE_FOCUS = "tree:";

export const useObjectBrowser = create<ObjectBrowserState>()(() => ({
  ...FRESH,
  showColors: true,
  showToggles: true,
  findOpen: false,
  findToken: 0,
  busy: new Set<string>(),
}));

// (store นี้มีอายุเท่าหน้าเว็บ จึงไม่ต้องเลิกฟัง)
useScenario.subscribe((state, prev) => {
  if (state.name !== prev.name) useObjectBrowser.setState({ ...FRESH, collapsed: new Set() });
});
useSelection.subscribe((state, prev) => {
  if (state.activePath !== prev.activePath && state.activePath !== null) useObjectBrowser.setState({ groupSelected: null });
});
