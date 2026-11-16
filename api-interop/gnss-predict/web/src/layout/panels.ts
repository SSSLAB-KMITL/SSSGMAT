// ทะเบียนหน้าต่างของแอป (spec §4.1): ชนิดหน้าต่างทุกแบบ ชื่อ ชนิดตั้งต้น (Dockable / Integrated / Floating) และ component ที่วาดข้างใน
//
// - งานนี้ลงทะเบียนตัวแทนชั่วคราวให้ทุก PanelKind (ชื่อหน้าต่าง + ข้อความ "ยังไม่ทำ") งานของแต่ละหน้าต่างเรียก registerPanel(kind, ...) ซ้ำเพื่อแทนด้วยของจริง
// - Workspace หา component จากทะเบียนตอน render (ไม่ใช่ตอนสร้าง panel) การลงทะเบียนซ้ำจึงมีผลทันทีกับหน้าต่างที่เปิดอยู่ (subscribePanels)
// - ไฟล์นี้ไม่รู้จัก dockview: การวางหน้าต่างอยู่ใน placement.ts และ stores/layout.ts

import { createElement, type FC } from "react";
import { reportTitle } from "../data/reports";
import { labels, t, type LabelKey } from "../labels/labels";
import { msg } from "../labels/messages.th";
import { parentOf } from "../stores/scenario";

export const PANEL_KINDS = [
  "objectBrowser", "graphics3d", "graphics2d", "timelineView", "messageViewer", "propertiesBrowser", "insertObjects", "satelliteCatalog",
  "newScenarioWizard", "welcome", "viewFromTo", "windowProperties3d", "windowProperties2d", "fetchOrbitData", "dailyForecastSettings", "about",
  "stkReference", "sensorView", "globeManager", "report", "graph", "accessTool", "reportGraphManager", "styleEditor", "validation",
] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

/** ชื่อ component ของ dockview ที่ใช้แทนหน้าต่างชนิดที่ไม่รู้จักชั่วคราวตอนโหลด workbook (วาดว่าง แล้วถูกลบทันที) */
export const UNKNOWN_PANEL = "__unknown__";

export type WindowType = "dockable" | "integrated" | "floating";
/** ขอบของพื้นที่ทำงานที่หน้าต่าง Dockable เกาะ */
export type EdgePosition = "left" | "right" | "top" | "bottom";

export interface PanelProps {
  /** รูปร่างขึ้นกับชนิดหน้าต่าง (แต่ละงานกำหนดเองในหน้าต่างของตน) จึงเป็น any */
  params: any;
  panelId: string;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface PanelDef {
  component: FC<PanelProps>;
  /** ชื่อบนแถบชื่อหน้าต่าง (ขึ้นกับ params เช่นเลขของหน้าต่าง 3D/2D) */
  title(params: any): string;
  /** ชนิดตอนเปิดครั้งแรก */
  type: WindowType;
  /** true = เปิดซ้ำแล้วโฟกัสหน้าต่างเดิม และ params ใหม่ (ถ้ามี) ไปอัปเดตหน้าต่างเดิม (3D/2D Graphics ไม่เป็น singleton ตลอด) */
  singleton: boolean;
  /**
   * สำหรับ singleton ที่มีได้หนึ่งบานต่อกุญแจ (Properties Browser: หนึ่งบานต่อ object): กุญแจคำนวณจาก params
   * เปิดซ้ำด้วยกุญแจเดียวกัน = หน้าต่างเดิม, กุญแจต่าง = หน้าต่างใหม่อีกบาน ไม่ระบุ = ทั้งชนิดมีบานเดียว
   */
  instanceKey?(params: any): string;
  /** ด้านที่เกาะเมื่อเป็น Dockable (ไม่ระบุ = ล่าง) */
  edge?: EdgePosition;
  /** ขนาดเมื่อเป็น Floating (ไม่ระบุ = DEFAULT_FLOAT_SIZE) */
  size?: PanelSize;
  /**
   * true = หน้าต่างของพื้นที่ทำงาน บันทึกลง workbook (ตำแหน่ง ขนาด params และ windowProps) และจัดกลับตอนเปิด scenario
   * false = หน้าต่างลอยหรือชั่วคราว (Welcome, Wizard, Properties Browser ฯลฯ) ไม่บันทึกและไม่คืนจาก workbook แม้มีอยู่ในไฟล์เก่า
   */
  persist: boolean;
  /** true = หน้าต่างที่ต้องมี scenario ที่เปิดอยู่ (อ้าง object หรือผลของมัน) ปิดพร้อม scenario ตอน Close/Exit; false = ไม่ปิด */
  scenarioBound: boolean;
}

export const DEFAULT_FLOAT_SIZE: PanelSize = { width: 480, height: 360 };

const registry = new Map<PanelKind, PanelDef>();
const listeners = new Set<() => void>();
let registryVersion = 0;

export function isPanelKind(x: unknown): x is PanelKind {
  return typeof x === "string" && (PANEL_KINDS as readonly string[]).includes(x);
}

/** ลงทะเบียน (หรือแทนที่) ชนิดหน้าต่าง หน้าต่างที่เปิดอยู่ถูกวาดใหม่ด้วย component ใหม่ */
export function registerPanel(kind: PanelKind, def: PanelDef): void {
  registry.set(kind, def);
  registryVersion++;
  for (const l of [...listeners]) l();
}

export function getPanelDef(kind: string): PanelDef | undefined {
  return isPanelKind(kind) ? registry.get(kind) : undefined;
}

/** สำหรับ useSyncExternalStore: Workspace วาดหน้าต่างใหม่เมื่อมีการลงทะเบียนซ้ำ */
export function subscribePanels(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const panelRegistryVersion = (): number => registryVersion;

// ---------- ชื่อหน้าต่าง 3D/2D ----------

export type GraphicsKind = "graphics3d" | "graphics2d";

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** เลข n ของหน้าต่างกราฟิกชนิดนั้นที่ชื่อ title ("3D Graphics 2 - Earth" -> 2) ไม่ใช่ชื่อของชนิดนั้น = null */
export function graphicsNumber(title: string, kind: GraphicsKind): number | null {
  const [before, after] = labels[`window.${kind}`].text.split("{n}").map(escapeRegExp);
  const m = new RegExp(`^${before}(\\d+)${after}$`).exec(title);
  return m === null ? null : Number(m[1]);
}

/** ชื่อของหน้าต่างกราฟิกใหม่: เลขที่ว่างน้อยสุดนับจาก 1 ("3D Graphics 1 - Earth" มีอยู่ -> "3D Graphics 2 - Earth"; มี 1 กับ 3 -> 2) */
export function nextGraphicsTitle(existing: readonly string[], kind: GraphicsKind): string {
  return t(`window.${kind}`, { n: nextGraphicsNumber(existing, kind) });
}

export function nextGraphicsNumber(existing: readonly string[], kind: GraphicsKind): number {
  const used = new Set<number>();
  for (const title of existing) {
    const n = graphicsNumber(title, kind);
    if (n !== null) used.add(n);
  }
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

// ---------- ตัวแทนชั่วคราว ----------

interface Base {
  label: LabelKey;
  type: WindowType;
  /** ไม่ระบุ = singleton */
  multiple?: boolean;
  title?: PanelDef["title"];
  instanceKey?: PanelDef["instanceKey"];
  edge?: EdgePosition;
  size?: PanelSize;
  persist: boolean;
  scenarioBound: boolean;
}

/**
 * ชนิดตั้งต้นตาม spec §4.1: Object Browser / Timeline View / Message Viewer = Dockable, 3D/2D และ Sensor View = Integrated, ที่เหลือ = Floating
 * persist: เฉพาะห้าหน้าต่างของพื้นที่ทำงานและ Sensor View บันทึกลง workbook; หน้าต่างลอยและชั่วคราวไม่บันทึก
 * scenarioBound: หน้าต่างที่อ้าง object หรือผลของ scenario ที่เปิดอยู่ ปิดพร้อม scenario; หน้าต่างอื่น (Welcome, About, Fetch Orbit Data ฯลฯ) ไม่ปิด
 * หน้าต่างชนิดใหม่ต้องตัดสินใจสองค่านี้เอง (ฟิลด์บังคับ)
 */
const BASE: Record<PanelKind, Base> = {
  objectBrowser: { label: "window.objectBrowser", type: "dockable", edge: "left", size: { width: 320, height: 520 }, persist: true, scenarioBound: false },
  graphics3d: { label: "window.graphics3d", type: "integrated", multiple: true, size: { width: 640, height: 480 }, persist: true, scenarioBound: false },
  graphics2d: { label: "window.graphics2d", type: "integrated", multiple: true, size: { width: 640, height: 400 }, persist: true, scenarioBound: false },
  timelineView: { label: "window.timelineView", type: "dockable", edge: "bottom", size: { width: 720, height: 280 }, persist: true, scenarioBound: false },
  messageViewer: { label: "window.messageViewer", type: "dockable", edge: "bottom", size: { width: 720, height: 280 }, persist: true, scenarioBound: false },
  // หนึ่งบานต่อหนึ่ง object (กุญแจ = params.path) ชื่อมีชื่อ object ("G01 Properties"); ไม่มี path = "Properties Browser" เฉยๆ
  propertiesBrowser: {
    label: "window.propertiesBrowser", type: "floating", size: { width: 640, height: 480 }, persist: false, scenarioBound: true,
    title: (params) => {
      const name = objectName(params);
      return name === null ? t("window.propertiesBrowser") : t("window.propertiesBrowserFor", { name });
    },
    instanceKey: (params) => (typeof params?.path === "string" ? params.path : ""),
  },
  insertObjects: { label: "window.insertObjects", type: "floating", size: { width: 560, height: 420 }, persist: false, scenarioBound: true },
  satelliteCatalog: { label: "window.satelliteCatalog", type: "floating", size: { width: 760, height: 480 }, persist: false, scenarioBound: true },
  newScenarioWizard: { label: "window.newScenarioWizard", type: "floating", size: { width: 560, height: 420 }, persist: false, scenarioBound: false },
  welcome: { label: "window.welcome", type: "floating", size: { width: 560, height: 400 }, persist: false, scenarioBound: false },
  viewFromTo: { label: "window.viewFromTo", type: "floating", size: { width: 400, height: 300 }, persist: false, scenarioBound: true },
  windowProperties3d: { label: "window.properties3d", type: "floating", size: { width: 560, height: 440 }, persist: false, scenarioBound: true },
  windowProperties2d: { label: "window.properties2d", type: "floating", size: { width: 560, height: 440 }, persist: false, scenarioBound: true },
  fetchOrbitData: { label: "window.fetchOrbitData", type: "floating", size: { width: 520, height: 360 }, persist: false, scenarioBound: false },
  dailyForecastSettings: { label: "window.dailyForecastSettings", type: "floating", size: { width: 520, height: 360 }, persist: false, scenarioBound: false },
  // Globe Manager (imagery spec §5.1): ชั้นภาพของลูกโลก ใช้ร่วมกันทุกหน้าต่าง 3D จึงไม่ผูก scenario และไม่เก็บตำแหน่งลง workbook (ชั้นที่เลือกเก็บใน workbook ผ่าน layout.globe)
  globeManager: { label: "window.globeManager", type: "floating", size: { width: 560, height: 480 }, persist: false, scenarioBound: false },
  about: { label: "help.about", type: "floating", size: { width: 480, height: 320 }, persist: false, scenarioBound: false },
  stkReference: { label: "help.stkReference", type: "floating", size: { width: 760, height: 520 }, persist: false, scenarioBound: false },
  // Sensor View (sensor spec §5.4): หนึ่งบานต่อ sensor (กุญแจ = params.path) บันทึกใน workbook และปิดพร้อม scenario
  // ชื่อ "Sensor View - Sensor1 (G01)" ใช้ชื่อดาวแม่ปัจจุบันจาก doc (ดาวเปลี่ยนชื่อ = windows/SensorView/track.ts ตั้งชื่อใหม่)
  sensorView: {
    label: "window.sensorView", type: "integrated", size: { width: 640, height: 480 }, persist: true, scenarioBound: true,
    title: sensorViewTitle,
    instanceKey: (params) => (typeof params?.path === "string" ? params.path : ""),
  },
  // หน้าต่างรายงาน (spec §6, P11): Integrated เป็นแท็บกลาง บันทึกใน workbook (คืนแล้วสร้างรายงานใหม่) ปิดพร้อม scenario
  // ชื่อ "THBK-To-G01: Access" / "Multiple Objects: Access"; หนึ่งบานต่อรายงาน (style, ชนิด, object, เวลา, Dynamic Display) เปิดซ้ำ = โฟกัสบานเดิม
  // รายงานต่างกันเปิดได้หลายบาน (singleton ต่อกุญแจแบบ Properties Browser: layout.test ตรวจว่ามีแค่ 3D/2D ที่ไม่ใช่ singleton)
  report: {
    label: "window.report", type: "integrated", size: { width: 720, height: 420 }, persist: true, scenarioBound: true,
    title: (params) => reportTitle(Array.isArray(params?.objects) ? params.objects : [], typeof params?.style === "string" ? params.style : t("window.report")),
    instanceKey: (params) => JSON.stringify([params?.style, params?.kind, params?.objects, params?.time, params?.dynamic]),
  },
  // หน้าต่างกราฟ (spec §6.2, P11): เหมือนหน้าต่างรายงานทุกอย่าง (ชื่อ กุญแจ หนึ่งบานต่อกุญแจ บันทึกใน workbook ปิดพร้อม scenario) ต่างแค่ชื่อชนิด
  graph: {
    label: "window.graph", type: "integrated", size: { width: 720, height: 420 }, persist: true, scenarioBound: true,
    title: (params) => reportTitle(Array.isArray(params?.objects) ? params.objects : [], typeof params?.style === "string" ? params.style : t("window.graph")),
    instanceKey: (params) => JSON.stringify([params?.style, params?.kind, params?.objects, params?.time, params?.dynamic]),
  },
  // Access tool (spec §4): หน้าต่างลอยบานเดียว params {from: path ของ Access For | null} เปิดซ้ำด้วย from ใหม่ = เปลี่ยน Access For ของบานเดิม
  // ไม่บันทึกใน workbook (เครื่องมือชั่วคราวแบบ Properties Browser) ปิดพร้อม scenario
  accessTool: { label: "toolbar.access", type: "floating", size: { width: 640, height: 560 }, persist: false, scenarioBound: true },
  // Report & Graph Manager (spec §5): หน้าต่างลอยบานเดียว params {objectType?, objects?} เปิดซ้ำ = เลือกตาม params ใหม่ ไม่บันทึกใน workbook ปิดพร้อม scenario
  reportGraphManager: { label: "window.reportGraphManager", type: "floating", size: { width: 760, height: 540 }, persist: false, scenarioBound: true },
  // หน้าต่างแก้ style (spec §5.1): หนึ่งบานต่อ (ชั้น, ชื่อ, ชนิด) ของ style (Installed AER รายงานกับกราฟเป็นสองบาน)
  // style ใหม่ = ("new", ชนิด, Object Type) ชื่อ "<style> Style Properties"
  styleEditor: {
    label: "window.styleEditor", type: "floating", size: { width: 720, height: 520 }, persist: false, scenarioBound: true,
    title: (params) => (typeof params?.style?.name === "string" ? t("window.styleEditorFor", { name: params.style.name }) : t("window.styleEditor")),
    instanceKey: (params) => (typeof params?.style?.name === "string"
      ? JSON.stringify([params?.tier ?? null, params.style.name, params.style.kind ?? null])
      : JSON.stringify(["new", params?.kind ?? null, params?.objectType ?? null])),
  },
  // หน้า Validation (spec §7): หน้าต่าง Integrated เป็นแท็บกลาง บานเดียว อ่านประวัติของทั้งเครื่อง (history.jsonl) ไม่ผูกกับ scenario จึงไม่ปิดพร้อม scenario
  // และไม่บันทึกใน workbook (เปิดใหม่จากเมนู Analysis ได้ทุกเมื่อ)
  validation: { label: "window.validation", type: "integrated", size: { width: 760, height: 520 }, persist: false, scenarioBound: false },
};

// ชื่อ object ของหน้าต่างที่เปิดเพื่อ object หนึ่ง: params.name ถ้าระบุ ไม่งั้นส่วนท้ายของ params.path (path ของ G01 -> "G01")
// ไม่มี path หรือเป็น Scenario ("*") = null
function objectName(params: { name?: unknown; path?: unknown } | undefined): string | null {
  if (typeof params?.name === "string" && params.name !== "") return params.name;
  if (typeof params?.path !== "string") return null;
  const last = params.path.split("/").at(-1) ?? "";
  return last === "" || last === "*" ? null : last;
}

/** ชื่อของ Sensor View: ชื่อ sensor จาก params.path และชื่อดาวที่มันติดอยู่ตอนนี้ (ยังหาดาวไม่ได้ เช่น sensor ไม่อยู่ใน doc = "?") */
function sensorViewTitle(params: { path?: unknown } | undefined): string {
  const path = typeof params?.path === "string" ? params.path : "";
  const parent = path === "" ? null : parentOf(path);
  return t("window.sensorView", { sensor: objectName({ path }) ?? "?", satellite: parent === null ? "?" : (objectName({ path: parent }) ?? "?") });
}

function titleFor(label: LabelKey): PanelDef["title"] {
  // หน้าต่าง 3D/2D มี {n} ในชื่อ (params.n; ไม่มี = 1) ชื่ออื่นไม่มีช่องแทนค่า
  return label === "window.graphics3d" || label === "window.graphics2d"
    ? (params) => t(label, { n: typeof params?.n === "number" ? params.n : 1 })
    : () => t(label);
}

function placeholder(title: PanelDef["title"]): FC<PanelProps> {
  return function Placeholder({ params }) {
    return createElement(
      "div",
      { className: "panel-placeholder" },
      createElement("div", { className: "panel-placeholder-title" }, title(params)),
      createElement("div", { className: "panel-placeholder-note" }, msg("panel.placeholder")),
    );
  };
}

for (const kind of PANEL_KINDS) {
  const b = BASE[kind];
  const title = titleFor(b.label);
  registerPanel(kind, {
    component: placeholder(b.title ?? title), title: b.title ?? title, type: b.type, singleton: b.multiple !== true, instanceKey: b.instanceKey,
    edge: b.edge, size: b.size, persist: b.persist, scenarioBound: b.scenarioBound,
  });
}
