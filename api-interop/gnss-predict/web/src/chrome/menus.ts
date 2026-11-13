// รายการของแต่ละเมนูเป็นข้อมูล (spec §5.1): อาร์เรย์ของ {command} หรือตัวคั่น แล้ว menuItems.tsx วาดทั้งเมนูบาร์และเมนูคลิกขวา
// ชื่อรายการมาจากทะเบียนคำสั่ง (commands.ts) ไม่เขียนข้อความที่นี่

import type { CommandId } from "../commands";
import type { LabelKey } from "../labels/labels";
import type { RowClass } from "../windows/ObjectBrowser/tree";

export type MenuEntry =
  /** optional: แสดงเฉพาะเมื่อคำสั่งลงทะเบียนแล้ว (File → รายการล่าสุด 1–4 ที่งาน 7 ลงทะเบียน) */
  | { command: CommandId; optional?: boolean }
  | { separator: true }
  /** เมนูย่อย (View → Toolbars ▸) */
  | { submenu: LabelKey; items: readonly MenuEntry[] }
  /** รายชื่อหน้าต่างที่เปิดอยู่ของเมนู Window (ไม่ใช่คำสั่ง: เลือกแล้วโฟกัสหน้าต่างนั้น) */
  | { windowList: true };

const cmd = (command: CommandId): MenuEntry => ({ command });
const optional = (command: CommandId): MenuEntry => ({ command, optional: true });
export const SEPARATOR: MenuEntry = { separator: true };

export const FILE_MENU: readonly MenuEntry[] = [
  cmd("file.new"), cmd("file.open"), cmd("file.save"), cmd("file.saveAs"), cmd("file.close"),
  SEPARATOR,
  optional("file.recent.1"), optional("file.recent.2"), optional("file.recent.3"), optional("file.recent.4"),
  SEPARATOR,
  cmd("file.exit"),
];

export const EDIT_MENU: readonly MenuEntry[] = [
  cmd("edit.cut"), cmd("edit.copy"), cmd("edit.paste"),
  SEPARATOR,
  cmd("edit.delete"), cmd("edit.find"),
];

export const VIEW_MENU: readonly MenuEntry[] = [
  cmd("view.objectBrowser"), cmd("view.timelineView"), cmd("view.messageViewer"),
  SEPARATOR,
  cmd("view.new3d"), cmd("view.new2d"),
  SEPARATOR,
  {
    submenu: "menu.view.toolbars",
    items: [
      cmd("view.toolbar.default"), cmd("view.toolbar.animation"), cmd("view.toolbar.graphics3d"),
      cmd("view.toolbar.defaults3d"), cmd("view.toolbar.defaults2d"),
    ],
  },
  SEPARATOR,
  cmd("view.fullScreen"),
];

export const INSERT_MENU: readonly MenuEntry[] = [
  cmd("insert.new"), cmd("insert.facility"), cmd("insert.satellite"), cmd("insert.sensor"), cmd("insert.constellation"),
];

export const ANALYSIS_MENU: readonly MenuEntry[] = [cmd("analysis.access"), cmd("analysis.reportGraphManager"), cmd("analysis.validation")];

/** เมนูของ object ชนิดทั่วไป (Scenario, Facility, Constellation) */
export const OBJECT_MENU: readonly MenuEntry[] = [
  cmd("object.properties"), cmd("object.access"), cmd("object.reportGraphManager"),
  SEPARATOR,
  cmd("object.zoomTo"),
  SEPARATOR,
  cmd("object.rename"), cmd("object.delete"),
];

/** เมนูของ Satellite: เมนูทั่วไป + Sensor View (เพิ่มเอง, sensor spec §5.1) ต่อจาก Properties */
export const SATELLITE_MENU: readonly MenuEntry[] = [
  cmd("object.properties"), cmd("object.sensorView"), cmd("object.access"), cmd("object.reportGraphManager"),
  SEPARATOR,
  cmd("object.zoomTo"),
  SEPARATOR,
  cmd("object.rename"), cmd("object.delete"),
];

/** เมนูของ Sensor: Sensor View (เพิ่มเอง) ต่อจาก Properties ไม่มี Report & Graph Manager; Zoom To ไปที่ดาวแม่ (commands3d.ts) */
export const SENSOR_MENU: readonly MenuEntry[] = [
  cmd("object.properties"), cmd("object.sensorView"), cmd("object.access"),
  SEPARATOR,
  cmd("object.zoomTo"),
  SEPARATOR,
  cmd("object.rename"), cmd("object.delete"),
];

/**
 * เมนูตามชนิดของ object ที่เลือก: แถบเมนู (ชื่อเมนูที่ 6) และเมนูคลิกขวาของ Object Browser ใช้ชุดเดียวกันตามชนิดนี้
 * ชนิดที่ไม่มีเมนูของตัวเอง (และไม่เลือกอะไร) ใช้ OBJECT_MENU
 */
export function objectMenuFor(cls: RowClass | undefined): readonly MenuEntry[] {
  if (cls === "Sensor") return SENSOR_MENU;
  return cls === "Satellite" ? SATELLITE_MENU : OBJECT_MENU;
}

export const UTILITIES_MENU: readonly MenuEntry[] = [cmd("utilities.fetchOrbitData"), cmd("utilities.dailyForecastSettings")];

export const WINDOW_MENU: readonly MenuEntry[] = [
  cmd("window.windows"), cmd("window.cascade"), cmd("window.tileHorizontally"), cmd("window.tileVertically"),
  SEPARATOR,
  { windowList: true },
];

export const HELP_MENU: readonly MenuEntry[] = [cmd("help.welcome"), cmd("help.stkReference"), cmd("help.about")];

/** ข้อความคีย์ลัดทางขวาของรายการ */
export const SHORTCUT_LABELS: Partial<Record<CommandId, LabelKey>> = {
  "file.save": "menu.shortcut.save",
  "edit.delete": "menu.shortcut.delete",
  "edit.find": "menu.shortcut.find",
};

const CLASS_LABELS: Record<RowClass, LabelKey> = {
  Scenario: "ob.class.scenario",
  Facility: "ob.class.facility",
  Satellite: "ob.class.satellite",
  Constellation: "ob.class.constellation",
  Sensor: "ob.class.sensor",
};

/** ชนิดของ object จาก path ("*\/Satellite/G01" -> Satellite) ไม่เลือก, ราก หรือไม่ใช่ object (โฟลเดอร์, path เพี้ยน) = undefined */
export function objectClassOf(activePath: string | null): RowClass | undefined {
  const cls = activePath === null ? "" : (activePath.split("/")[1] ?? "");
  return Object.hasOwn(CLASS_LABELS, cls) ? (cls as RowClass) : undefined;
}

// ชื่อเมนูที่ 6: ชนิดของ object ที่เลือก ไม่เลือกหรือไม่ใช่ object = Scenario
export function objectClassLabel(activePath: string | null): LabelKey {
  return CLASS_LABELS[objectClassOf(activePath) ?? "Scenario"];
}
