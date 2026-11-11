// workbook.json (W6): การจัดวางหน้าต่างที่บันทึกคู่กับ scenario.json
//   {"version": 1, "dockview": <api.toJSON()>, "panels": {<panelId>: {"kind", "params"}},
//    "toolbars": {"default", "animation", "graphics3d", "defaults3d", "defaults2d": bool}, "timelineHidden": [<ชื่อแถว>], "windowProps": {<panelId>: {...}}}
// ไม่เกิน 1,048,576 ไบต์ (server ตอบ 422 ถ้าเกิน)
//
// validateWorkbook ตรวจรูปร่างและขนาดเท่านั้น: ไม่ตรวจเนื้อของ dockview (dockview เป็นคนตรวจตอน fromJSON) และไม่ตรวจว่ารู้จัก kind ไหม
// (kind ที่ไม่รู้จักข้ามตอนสร้างหน้าต่างพร้อมคำเตือน ไม่ทำให้ทั้ง workbook ใช้ไม่ได้)

export const WORKBOOK_MAX_BYTES = 1_048_576;

export const TOOLBAR_NAMES = ["default", "animation", "graphics3d", "defaults3d", "defaults2d"] as const;
export type ToolbarName = (typeof TOOLBAR_NAMES)[number];
export type Toolbars = Record<ToolbarName, boolean>;

/** แถบที่เห็นตอนเริ่ม: Default + Animation (spec §4.2) แถบอื่นเปิดจาก View → Toolbars */
export const DEFAULT_TOOLBARS: Readonly<Toolbars> = { default: true, animation: true, graphics3d: false, defaults3d: false, defaults2d: false };

export type WindowProps = Record<string, Record<string, unknown>>;

export interface WorkbookPanel {
  kind: string;
  params: Record<string, unknown>;
}

export interface Workbook {
  version: 1;
  /** ผลของ DockviewApi.toJSON() */
  dockview: Record<string, unknown>;
  panels: Record<string, WorkbookPanel>;
  toolbars: Toolbars;
  /** ชื่อแถวที่ซ่อนใน Timeline View (งานของ Timeline View) */
  timelineHidden: string[];
  /** ตั้งค่าเฉพาะหน้าต่าง ตาม panelId (งานของหน้าต่าง 3D/2D) */
  windowProps: WindowProps;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** ขนาดเป็นไบต์ UTF-8 ของ JSON ที่จะส่งให้ server */
export function workbookBytes(w: unknown): number {
  return new TextEncoder().encode(JSON.stringify(w)).length;
}

function parsePanels(x: unknown): Record<string, WorkbookPanel> | null {
  if (!isRecord(x)) return null;
  const out: Record<string, WorkbookPanel> = {};
  for (const [id, entry] of Object.entries(x)) {
    if (!isRecord(entry) || typeof entry.kind !== "string") return null;
    if (entry.params !== undefined && !isRecord(entry.params)) return null;
    out[id] = { kind: entry.kind, params: entry.params ?? {} };
  }
  return out;
}

function parseToolbars(x: unknown): Toolbars | null {
  if (x === undefined) return { ...DEFAULT_TOOLBARS };
  if (!isRecord(x)) return null;
  const out = { ...DEFAULT_TOOLBARS };
  for (const name of TOOLBAR_NAMES) {
    const v = x[name];
    if (v === undefined) continue;
    if (typeof v !== "boolean") return null;
    out[name] = v;
  }
  return out;
}

function parseWindowProps(x: unknown): WindowProps | null {
  if (x === undefined) return {};
  if (!isRecord(x)) return null;
  const out: WindowProps = {};
  for (const [id, props] of Object.entries(x)) {
    if (!isRecord(props)) return null;
    out[id] = props;
  }
  return out;
}

/** workbook ที่ใช้ได้ (เติมช่องที่ขาดด้วยค่าตั้งต้น) หรือ null: ไม่ใช่ object, version ไม่ใช่ 1, รูปร่างผิด หรือเกิน 1,048,576 ไบต์ */
export function validateWorkbook(x: unknown): Workbook | null {
  if (!isRecord(x) || x.version !== 1 || !isRecord(x.dockview)) return null;
  const panels = parsePanels(x.panels);
  const toolbars = parseToolbars(x.toolbars);
  const windowProps = parseWindowProps(x.windowProps);
  if (panels === null || toolbars === null || windowProps === null) return null;
  const hidden = x.timelineHidden ?? [];
  if (!Array.isArray(hidden) || !hidden.every((n) => typeof n === "string")) return null;
  const w: Workbook = { version: 1, dockview: x.dockview, panels, toolbars, timelineHidden: [...hidden], windowProps };
  return workbookBytes(w) > WORKBOOK_MAX_BYTES ? null : w;
}
