// ทะเบียนคำสั่งเดียวของแอป (W3): เมนู แถบเครื่องมือ เมนูคลิกขวา และคีย์ลัดเรียกคำสั่งผ่านที่นี่ ไม่แตะ store ตรง ๆ
//
// - CommandId ครบทุกรายการของ spec §5.1-§5.2 และ §7; COMMAND_LABELS คือชื่อตั้งต้นของแต่ละคำสั่ง (เมนูต้องมีชื่อแม้คำสั่งยังไม่ลงทะเบียน)
// - คำสั่งที่ยังไม่ลงทะเบียน = ปิดใช้ (isEnabled false, runCommand ไม่ทำอะไร) งานที่ทำหน้าต่างนั้นลงทะเบียนเอง:
//   งาน 6: view.* window.* anim.* (chrome/coreCommands.ts), งาน 7: file.* help.*, งาน 8: edit.* object.properties/rename/delete ob.*,
//   งาน 10: insert.* utilities.*, งาน 11: g3d.* object.zoomTo, งาน 12: g2d.*, งานย่อยที่ 4: analysis.* object.access object.reportGraphManager
// - ทะเบียนเป็น observable: registerCommand / invalidateCommands แจ้งผู้ฟัง (subscribeCommands) เพื่อให้เมนูและแถบเครื่องมือวาดสถานะ enabled ใหม่
//   คำสั่งที่ enabled() ขึ้นกับ store ต้องเรียก invalidateCommands() เองเมื่อค่านั้นเปลี่ยน (เช่น ฟัง store แล้วเรียก) เพราะทะเบียนไม่รู้ว่าอ่านอะไร
// - ไฟล์นี้ไม่รู้จัก React และ store ใด ๆ

import { t, type LabelKey } from "./labels/labels";
import { msg } from "./labels/messages.th";
import type { ToolbarName } from "./layout/workbook";

/** ชื่อตั้งต้นของแต่ละคำสั่ง (คีย์ใน labels.ts) บางคำสั่งมีชื่อต่างกันตามที่ใช้ เช่น Access... ของเมนู Analysis กับเมนูตามชนิด object */
export const COMMAND_LABELS = {
  "file.new": "menu.file.new",
  "file.open": "menu.file.open",
  "file.save": "menu.file.save",
  "file.saveAs": "menu.file.saveAs",
  "file.close": "menu.file.close",
  "file.exit": "menu.file.exit",
  "file.recent.1": "menu.file.recent",
  "file.recent.2": "menu.file.recent",
  "file.recent.3": "menu.file.recent",
  "file.recent.4": "menu.file.recent",

  "edit.cut": "menu.edit.cut",
  "edit.copy": "menu.edit.copy",
  "edit.paste": "menu.edit.paste",
  "edit.delete": "menu.edit.delete",
  "edit.find": "menu.edit.find",

  "view.objectBrowser": "menu.view.objectBrowser",
  "view.timelineView": "menu.view.timelineView",
  "view.messageViewer": "menu.view.messageViewer",
  "view.new3d": "menu.view.new3dWindow",
  "view.new2d": "menu.view.new2dWindow",
  "view.toolbar.default": "toolbar.default",
  "view.toolbar.animation": "toolbar.animation",
  "view.toolbar.graphics3d": "toolbar.graphics3d",
  "view.toolbar.defaults3d": "toolbar.window3dDefaults",
  "view.toolbar.defaults2d": "toolbar.window2dDefaults",
  "view.fullScreen": "menu.view.fullScreen",

  "insert.new": "menu.insert.new",
  "insert.facility": "menu.insert.facility",
  "insert.satellite": "menu.insert.satellite",
  "insert.constellation": "menu.insert.constellation",

  "analysis.access": "menu.analysis.access",
  "analysis.reportGraphManager": "menu.analysis.reportGraphManager",
  "analysis.validation": "menu.analysis.validation",

  "object.properties": "menu.object.properties",
  "object.access": "menu.object.access",
  "object.reportGraphManager": "menu.object.reportGraphManager",
  "object.zoomTo": "menu.object.zoomTo",
  "object.rename": "menu.object.rename",
  "object.delete": "menu.object.delete",

  "utilities.fetchOrbitData": "menu.utilities.fetchOrbitData",
  "utilities.dailyForecastSettings": "menu.utilities.dailyForecastSettings",

  "window.windows": "menu.window.windows",
  "window.cascade": "menu.window.cascade",
  "window.tileHorizontally": "menu.window.tileHorizontally",
  "window.tileVertically": "menu.window.tileVertically",

  "help.welcome": "help.welcome",
  "help.stkReference": "help.stkReference",
  "help.about": "help.about",

  "anim.reset": "anim.reset",
  "anim.stepBackward": "anim.stepBackward",
  "anim.reverse": "anim.reverse",
  "anim.pause": "anim.pause",
  "anim.start": "anim.start",
  "anim.stepForward": "anim.stepForward",
  "anim.decreaseStep": "anim.decreaseStep",
  "anim.increaseStep": "anim.increaseStep",
  "anim.normal": "anim.normalMode",
  "anim.realtime": "anim.realTimeMode",
  "anim.xrealtime": "anim.xRealTimeMode",

  "g3d.homeView": "toolbar.homeView",
  "g3d.viewFromTo": "toolbar.viewFromTo",
  "g3d.properties": "toolbar.properties",
  "g3d.grabGlobe": "toolbar.grabGlobe",
  "g3d.zoomIn": "toolbar.zoomIn",

  "g2d.properties": "toolbar.properties",
  "g2d.zoomIn": "toolbar.zoomIn",
  "g2d.zoomOut": "toolbar.zoomOut",

  "ob.newGroup": "ob.newGroup",
  "ob.expandAll": "ob.expandAll",
  "ob.collapseAll": "ob.collapseAll",
  "ob.colorSelectors": "ob.graphicsColorSelectors",
  "ob.onOffToggles": "ob.graphicsOnOffToggles",
  "ob.showFlagged": "status.flaggedSatellites",
} as const satisfies Record<string, LabelKey>;

export type CommandId = keyof typeof COMMAND_LABELS;

// ชื่อแถบเครื่องมือใน workbook ต้องมีคำสั่ง view.toolbar.<ชื่อ> ครบ (ตรวจตอน compile)
void (COMMAND_LABELS satisfies Record<`view.toolbar.${ToolbarName}`, LabelKey>);

export interface CommandDef {
  /** ชื่อที่แสดง (ใช้แทนชื่อตั้งต้นของ COMMAND_LABELS) */
  label: LabelKey;
  run(): void | Promise<void>;
  /** ไม่ระบุ = ใช้ได้ตลอด */
  enabled?(): boolean;
  /**
   * ข้อความอธิบายที่แสดงคู่กับปุ่ม/รายการเมนู: เหตุผลที่ปิดใช้ หรือข้อสังเกตที่ควรบอก (ไม่ระบุหรือคืน undefined = ไม่มี)
   * ข้อความเป็นภาษาไทยจาก messages.th.ts
   */
  tooltip?(): string | undefined;
  /** รายการเมนูแบบติ๊กถูก (View → Toolbars): สถานะที่ติ๊กอยู่ */
  checked?(): boolean;
  /** ข้อความที่แสดงแทนชื่อ เมื่อชื่อเปลี่ยนตามข้อมูล (File → รายการล่าสุด แสดงชื่อ scenario) */
  text?(): string;
}

/** คำสั่งที่ยังไม่ลงทะเบียนแต่มีเหตุผลที่ผู้ใช้ควรรู้ (W4: รอ งานย่อยที่ 4) หายไปเองเมื่อมีผู้ลงทะเบียนคำสั่งนั้น */
const PENDING_TOOLTIPS: Partial<Record<CommandId, () => string>> = {
  "analysis.access": () => msg("tooltip.subtask4"),
  "analysis.reportGraphManager": () => msg("tooltip.subtask4"),
  "analysis.validation": () => msg("tooltip.subtask4"),
  "object.access": () => msg("tooltip.subtask4"),
  "object.reportGraphManager": () => msg("tooltip.subtask4"),
};

const registry = new Map<CommandId, CommandDef>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const listener of [...listeners]) listener();
}

/**
 * ลงทะเบียน (หรือแทนที่) คำสั่ง คืนฟังก์ชันถอนซึ่งถอนเฉพาะเมื่อทะเบียนของ id นั้นยังเป็นตัวที่ลงไว้นี้เอง
 * (ถูกลงทะเบียนทับโดยผู้อื่นแล้ว = ไม่แตะ) ใช้ตอนลงทะเบียนใน effect ของ React: คืนค่านี้เป็น cleanup ได้เลย
 */
export function registerCommand(id: CommandId, def: CommandDef): () => void {
  registry.set(id, def);
  notify();
  return () => {
    if (registry.get(id) !== def) return;
    registry.delete(id);
    notify();
  };
}

/** ถอนคำสั่งไม่ว่าใครลงไว้ (กลับเป็นปิดใช้) ปกติใช้ตัวถอนที่ registerCommand คืนให้ */
export function unregisterCommand(id: CommandId): void {
  if (registry.delete(id)) notify();
}

/** ล้างทั้งทะเบียน (ไว้ให้ test ใช้) */
export function resetCommands(): void {
  const had = registry.size > 0;
  registry.clear();
  if (had) notify();
}

export const isRegistered = (id: CommandId): boolean => registry.has(id);

/** คำสั่งที่ enabled() ขึ้นกับสถานะข้างนอกเรียกเมื่อสถานะนั้นเปลี่ยน เพื่อให้เมนูและแถบเครื่องมือวาดใหม่ */
export function invalidateCommands(): void {
  notify();
}

export function subscribeCommands(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** สำหรับ useSyncExternalStore */
export const commandsVersion = (): number => version;

/** ยังไม่ลงทะเบียน = ปิดใช้; enabled() ที่โยน = ปิดใช้ */
export function isEnabled(id: CommandId): boolean {
  const def = registry.get(id);
  if (def === undefined) return false;
  try {
    return def.enabled === undefined || def.enabled();
  } catch {
    return false;
  }
}

/** คำสั่งที่ปิดใช้ไม่ทำอะไร; คำสั่งที่โยนหรือ reject ไม่ทำให้ผู้เรียกล้ม (คำสั่งแจ้งข้อผิดพลาดของตัวเองใน Message Viewer เอง) */
export function runCommand(id: CommandId): void {
  if (!isEnabled(id)) return;
  const def = registry.get(id);
  if (def === undefined) return;
  try {
    const result = def.run();
    if (result instanceof Promise) result.catch((e: unknown) => console.error(`command ${id} failed`, e));
  } catch (e) {
    console.error(`command ${id} failed`, e);
  }
}

/** ข้อความอธิบายของคำสั่ง (เหตุผลที่ปิดใช้หรือข้อสังเกต) ไม่มี = undefined */
export function commandTooltip(id: CommandId): string | undefined {
  const def = registry.get(id);
  if (def === undefined) return PENDING_TOOLTIPS[id]?.();
  try {
    return def.tooltip?.();
  } catch {
    return undefined;
  }
}

/** ข้อความของรายการเมนู: text() ของผู้ลงทะเบียน ไม่งั้นชื่อที่ลงทะเบียน ไม่งั้นชื่อตั้งต้น */
export function commandText(id: CommandId): string {
  const def = registry.get(id);
  if (def?.text !== undefined) {
    try {
      return def.text();
    } catch {
      // ใช้ชื่อแทน
    }
  }
  return t(def?.label ?? COMMAND_LABELS[id]);
}

/** รายการเมนูนี้เป็นแบบติ๊กถูก (ลงทะเบียนพร้อม checked()) */
export const isCheckable = (id: CommandId): boolean => registry.get(id)?.checked !== undefined;

/** รายการเมนูแบบติ๊กถูกที่ติ๊กอยู่ไหม */
export function isChecked(id: CommandId): boolean {
  try {
    return registry.get(id)?.checked?.() ?? false;
  } catch {
    return false;
  }
}
