// การวางหน้าต่างบน dockview (spec §4.1): ตัวกลางระหว่างชนิดหน้าต่างของ STK กับตำแหน่งของ dockview
//
//   Dockable   = edge group (กลุ่มเกาะขอบซ้าย/ขวา/บน/ล่างของพื้นที่ทำงาน ข้างนอกกริดกลาง)
//   Integrated = กลุ่มในกริดกลาง (วางข้างกัน/ซ้อนกัน/เป็นแท็บ)
//   Floating   = กลุ่มลอย
// ชนิดของหน้าต่างอ่านจากตำแหน่งจริงของมัน (windowTypeOf) จึงไม่มีสถานะแยกที่ต้องเก็บและตรงกับ toJSON/fromJSON เสมอ
// รวมถึงตอนผู้ใช้ลากแท็บไปเกาะขอบหรือวางกลางจอเอง ไฟล์นี้ไม่แตะ store และไม่รู้จักทะเบียนหน้าต่าง

import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from "dockview-react";
import type { EdgePosition, PanelKind, PanelSize, WindowType } from "./panels";

/** ขนาดตั้งต้นของ edge group ตามด้าน (px): ซ้าย/ขวา = กว้าง, บน/ล่าง = สูง */
const EDGE_SIZE: Record<EdgePosition, number> = { left: 260, right: 320, top: 200, bottom: 220 };

export function windowTypeOf(panel: IDockviewPanel): WindowType {
  switch (panel.api.location.type) {
    case "edge":
      return "dockable";
    case "grid":
      return "integrated";
    default:
      return "floating"; // floating (popout ไม่ได้ใช้)
  }
}

function edgeGroupAt(api: DockviewApi, position: EdgePosition): DockviewGroupPanel | undefined {
  return api.groups.find((g) => {
    const l = g.api.location;
    return l.type === "edge" && l.position === position;
  });
}

/** edge group ของด้านนั้นที่พร้อมรับหน้าต่าง (สร้างถ้ายังไม่มี แสดงและกางถ้าซ่อนหรือพับอยู่) */
function ensureEdgeGroup(api: DockviewApi, position: EdgePosition): DockviewGroupPanel {
  let group = edgeGroupAt(api, position);
  if (group === undefined) {
    // autoReveal: เมื่อหน้าต่างสุดท้ายออกไป กลุ่มหายไปจากจอ (ไม่ทิ้งแถบว่างไว้) แล้วกลับมาเมื่อมีหน้าต่างมาเกาะอีก
    const edge = api.addEdgeGroup(position, { id: `edge-${position}`, initialSize: EDGE_SIZE[position], autoReveal: true });
    edge.setHeaderPosition("top"); // แท็บแนวนอนเหมือนหน้าต่างทั่วไป ไม่ใช่แท็บตั้งแบบแถบเครื่องมือของ IDE
    group = edgeGroupAt(api, position);
    if (group === undefined) throw new Error(`the ${position} dock side was not created`);
  }
  if (!api.isEdgeGroupVisible(position)) api.setEdgeGroupVisible(position, true);
  if (group.api.isCollapsed()) group.api.expand();
  return group;
}

/** แสดงหน้าต่างที่ซ่อนอยู่เพราะกลุ่มเกาะขอบถูกพับ แล้วทำให้เป็นหน้าต่างที่ active */
export function revealPanel(api: DockviewApi, panel: IDockviewPanel): void {
  const location = panel.api.location;
  if (location.type === "edge") ensureEdgeGroup(api, location.position);
  panel.api.setActive();
}

// ---------- กริดกลาง ----------

type GridNode = { type: "leaf"; data: { id: string; views: string[] } } | { type: "branch"; data: GridNode[] };

function gridRoot(api: DockviewApi): GridNode {
  return api.toJSON().grid.root as unknown as GridNode;
}

/** กลุ่มของกริดกลางที่อยู่ท้ายสุด (ขวาสุด/ล่างสุดตามภาพ) ไม่มี = undefined */
function lastGridGroup(api: DockviewApi): DockviewGroupPanel | undefined {
  const lastLeaf = (n: GridNode): string | undefined => (n.type === "leaf" ? n.data.id : n.data.length === 0 ? undefined : lastLeaf(n.data[n.data.length - 1]));
  const id = lastLeaf(gridRoot(api));
  return id === undefined ? undefined : api.groups.find((g) => g.id === id);
}

/** หน้าต่าง Integrated ทั้งหมดตามลำดับในภาพ (ซ้ายไปขวา บนลงล่าง) และลำดับแท็บในกลุ่ม */
function integratedPanels(api: DockviewApi): IDockviewPanel[] {
  const out: IDockviewPanel[] = [];
  const walk = (n: GridNode): void => {
    if (n.type === "branch") n.data.forEach(walk);
    else for (const id of n.data.views) {
      const p = api.getPanel(id);
      if (p !== undefined) out.push(p);
    }
  };
  walk(gridRoot(api));
  return out;
}

// ---------- วางหน้าต่าง ----------

/** หน้าต่างลอยสูงไม่เกินความสูงของจอลบค่านี้ (แถบเมนู แถบเครื่องมือ แถบสถานะ) QA-05 */
export const FLOAT_SCREEN_MARGIN = 80;
/** ความสูงต่ำสุดเมื่อถูกจำกัด (จอหรือพื้นที่เล็กมาก): ยังเห็นแถบแท็บและเนื้อบางส่วนที่เลื่อนได้ */
const FLOAT_MIN_HEIGHT = 120;

/**
 * ความสูงตั้งต้นของหน้าต่างลอย (QA-05: Globe Manager ล้นจอเล็ก ขอบล่างถูกตัด): ตามที่ชนิดหน้าต่างกำหนด แต่ไม่เกิน
 * ความสูงของจอ - FLOAT_SCREEN_MARGIN และไม่เกินพื้นที่ที่ลอยได้ (areaHeight > 0) เนื้อที่เหลือเลื่อนดูในหน้าต่าง (theme.css: .dv-resize-container)
 */
export function floatingHeight(want: number, screenHeight: number, areaHeight: number): number {
  let height = Math.min(want, screenHeight - FLOAT_SCREEN_MARGIN);
  if (areaHeight > 0) height = Math.min(height, areaHeight);
  return Math.max(FLOAT_MIN_HEIGHT, Math.floor(height));
}

/**
 * กรอบของหน้าต่างลอยที่อยู่กลางพื้นที่ทำงาน: dockview วางและจำกัดหน้าต่างลอยไว้ในพื้นที่กลาง (กริด) ที่เหลือหลังหัก edge group ที่เกาะขอบอยู่
 * พิกัดจึงนับจากมุมของพื้นที่นั้น และ api.width/height คือขนาดของมันพอดี (หน้าต่างลอยลงไปทับ edge group ไม่ได้ จึงไม่มีกลางจอทั้งหมดให้อิง)
 * ความสูงถูกจำกัดตาม floatingHeight
 */
function centredBox(api: DockviewApi, size: PanelSize) {
  const height = floatingHeight(size.height, typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerHeight, api.height);
  return {
    x: Math.max(0, (api.width - size.width) / 2),
    y: Math.max(0, (api.height - height) / 2),
    width: size.width,
    height,
  };
}

export interface NewPanel {
  id: string;
  kind: PanelKind;
  title: string;
  params: Record<string, unknown>;
  type: WindowType;
  edge: EdgePosition;
  size: PanelSize;
}

/** เพิ่มหน้าต่างใหม่ตามชนิด: Floating กลางพื้นที่, Dockable ที่ edge group ของด้าน, Integrated เป็นกลุ่มใหม่ทางขวาสุดของกริดกลาง */
export function addPanelAs(api: DockviewApi, p: NewPanel): IDockviewPanel {
  const base = { id: p.id, component: p.kind, title: p.title, params: p.params };
  switch (p.type) {
    case "floating":
      return api.addPanel({ ...base, floating: centredBox(api, p.size) });
    case "dockable":
      return api.addPanel({ ...base, position: { referenceGroup: ensureEdgeGroup(api, p.edge) } });
    case "integrated": {
      const last = lastGridGroup(api);
      return api.addPanel({ ...base, position: last === undefined ? { referenceGroup: api.addGroup() } : { referenceGroup: last, direction: "right" } });
    }
  }
}

export interface MoveHints {
  edge: EdgePosition;
  size: PanelSize;
}

/** ย้ายหน้าต่างที่เปิดอยู่ไปเป็นชนิดใหม่ (ชนิดเดิมไม่ทำอะไร) */
export function moveToType(api: DockviewApi, panel: IDockviewPanel, type: WindowType, hints: MoveHints): void {
  if (windowTypeOf(panel) === type) return;
  switch (type) {
    case "floating":
      api.addFloatingGroup(panel, centredBox(api, hints.size));
      break;
    case "dockable":
      panel.api.moveTo({ group: ensureEdgeGroup(api, hints.edge) });
      break;
    case "integrated": {
      const last = lastGridGroup(api);
      if (last === undefined) panel.api.moveTo({ group: api.addGroup() });
      else panel.api.moveTo({ group: last, position: "right" });
      break;
    }
  }
  panel.api.setActive();
}

/** ย้ายหน้าต่างลอยมากลางพื้นที่ทำงาน */
export function centrePanel(api: DockviewApi, panel: IDockviewPanel, hints: MoveHints): void {
  if (windowTypeOf(panel) !== "floating") return;
  api.addFloatingGroup(panel, centredBox(api, hints.size));
  panel.api.setActive();
}

/** Tile: หน้าต่าง Integrated ทุกบาน อยู่กลุ่มละบาน เรียงข้างกัน (vertical) หรือซ้อนกัน (horizontal) แบ่งพื้นที่เท่ากัน */
export function tileIntegrated(api: DockviewApi, direction: "horizontal" | "vertical"): void {
  const panels = integratedPanels(api);
  if (panels.length < 2) return;
  const active = api.activePanel;
  const side = direction === "vertical" ? "right" : "bottom";
  const grid = api.toJSON().grid;
  let previous = panels[0];
  for (const p of panels.slice(1)) {
    p.api.moveTo({ group: previous.group, position: side, skipSetActive: true });
    previous = p;
  }
  // กลุ่มใหม่แต่ละกลุ่มแบ่งครึ่งกับกลุ่มก่อนหน้า จึงต้องปรับให้เท่ากัน (ตั้งทีละกลุ่มจากต้นทาง กลุ่มสุดท้ายรับส่วนที่เหลือ)
  const total = direction === "vertical" ? grid.width : grid.height;
  if (total > 0) {
    const each = total / panels.length;
    for (const p of panels.slice(0, -1)) p.group.api.setSize(direction === "vertical" ? { width: each } : { height: each });
  }
  active?.api.setActive();
}

/** Cascade: รวมหน้าต่าง Integrated ทั้งหมดเป็นแท็บในกลุ่มเดียว (ลำดับแท็บตามลำดับในภาพ) */
export function cascadeIntegrated(api: DockviewApi): void {
  const panels = integratedPanels(api);
  if (panels.length < 2) return;
  const active = api.activePanel;
  const target = panels[0].group;
  for (const p of panels.slice(1)) if (p.group !== target) p.api.moveTo({ group: target, skipSetActive: true });
  active?.api.setActive();
}
