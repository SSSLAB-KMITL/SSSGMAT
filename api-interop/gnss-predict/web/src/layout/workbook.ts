// workbook.json (W6): การจัดวางหน้าต่างที่บันทึกคู่กับ scenario.json
//   {"version": 1, "dockview": <api.toJSON()>, "panels": {<panelId>: {"kind", "params"}},
//    "toolbars": {"default", "animation", "graphics3d", "defaults3d", "defaults2d": bool}, "timelineHidden": [<ชื่อแถว>], "windowProps": {<panelId>: {...}},
//    "globe": {"layers": {<id ชั้นภาพ>: {"show": bool, "translucency": 0-100}}, "ion": {"assetId": <จำนวนเต็ม > 0> | null}}}
// globe (Globe Manager, spec imagery §5.1, spec ภาพละเอียด §4) ไม่บังคับ: workbook เก่าที่ไม่มีช่องนี้ใช้ได้ ช่องที่รูปร่างผิดถูกทิ้งทั้งช่อง รายการชั้นที่ค่าผิดถูกทิ้งเป็นรายการ
// id ที่ catalog ไม่รู้จักเก็บไว้ตามเดิม (ข้ามตอนวาด) ; id ของ catalog ของ server (GIBS, EOX) และ "osm" (OpenStreetMap ที่ browser ดึงตรง)
// ion = asset ของ Cesium ion ที่แสดง (เลือกได้ชั้นเดียว) ไม่มี / ไม่ใช่จำนวนเต็ม > 0 = null ไม่ทำให้ globe ใช้ไม่ได้ (ตอนเปิด scenario globeAtOpen เปลี่ยน null เป็น Google Maps Satellite)
// ไม่เกิน 1,048,576 ไบต์ (server ตอบ 422 ถ้าเกิน)
//
// workbook เก็บเฉพาะหน้าต่างของพื้นที่ทำงาน (PanelDef.persist) withoutPanels ตัดหน้าต่างอื่นออกจาก JSON ของ dockview ก่อนบันทึก
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

/** Show และ % Translucency (จำนวนเต็ม 0–100) ของชั้นภาพหนึ่งชั้น (GIBS, EOX, OpenStreetMap) ใช้ร่วมกันทุกหน้าต่าง 3D และ Sensor View */
export interface GlobeLayerSetting {
  show: boolean;
  translucency: number;
}

/** asset ของ Cesium ion ที่แสดง (spec ภาพละเอียด §4.2) null = ไม่แสดง ion; แสดงอยู่ = ชั้นอื่นทั้งหมดถูกซ่อนในทุก viewer */
export interface GlobeIonSetting {
  assetId: number | null;
}

/** ชั้นที่ไม่มีในรายการ = ซ่อน */
export interface GlobeSettings {
  layers: Record<string, GlobeLayerSetting>;
  ion: GlobeIonSetting;
}

/** Asset ID ของ Cesium ion ที่ใช้ได้: จำนวนเต็ม > 0 (ไม่เกิน Number.MAX_SAFE_INTEGER) */
export const isIonAssetId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/**
 * asset ของ Cesium ion ตั้งต้น: Google Maps Satellite (preset แรกของ cesium/ionAssets.ts, ยืนยันจากต้นฉบับ CesiumJS 1.147)
 * มีผลเฉพาะเมื่อสวิตช์ ion เปิดและมี token แล้วเท่านั้น (ionState.ts) สวิตช์ปิดหรือไม่มี token = ไม่มีคำขอไป ion ชั้นอื่นแสดงตามเดิม
 */
export const DEFAULT_ION_ASSET_ID = 3830182;

/**
 * ค่าตั้งต้นเมื่อ workbook ไม่มี globe (spec imagery §5.1, spec ภาพละเอียด §4): Blue Marble + VIIRS NOAA-20 True Color และ
 * Sentinel-2 cloudless แสดง (แต่ละชั้นมีผลเมื่อเปิดสวิตช์ของแหล่งนั้นแล้วเท่านั้น: เปิดสวิตช์แล้วเห็นภาพทันที) ชั้นอื่นซ่อน
 * OpenStreetMap ซ่อน (task 13c: แผนที่ถนนทึบสีอ่อนทับภาพถ่าย โลกตอนเปิดโปรแกรมจึงขาวซีด ดู globeAtOpen)
 * asset ของ Cesium ion = Google Maps Satellite (DEFAULT_ION_ASSET_ID: แสดงเมื่อเปิด ion และมี token เท่านั้น และแสดงแทนชั้นอื่นทั้งหมด)
 */
export const DEFAULT_GLOBE: Readonly<GlobeSettings> = Object.freeze({
  layers: Object.freeze({
    BlueMarble_NextGeneration: Object.freeze({ show: true, translucency: 0 }),
    VIIRS_NOAA20_CorrectedReflectance_TrueColor: Object.freeze({ show: true, translucency: 0 }),
    "s2cloudless-2024_3857": Object.freeze({ show: true, translucency: 0 }),
    osm: Object.freeze({ show: false, translucency: 0 }),
  }),
  ion: Object.freeze({ assetId: DEFAULT_ION_ASSET_ID }),
});

/**
 * globe ที่ใช้ตอนเปิด scenario (task 13c): OpenStreetMap ซ่อนเสมอไม่ว่า workbook จะเก็บอะไรไว้ (% Translucency คงเดิม) ชั้นอื่นตามที่เก็บไว้
 * ผู้ใช้ติ๊กแสดงเองได้ในการใช้งานครั้งนั้นและ Save เก็บได้ แต่การเปิดครั้งถัดไปเริ่มแบบซ่อนอีก ไม่แตะสวิตช์แหล่ง OSM ใน settings.json
 * asset ของ ion ที่ไม่มีหรือเป็น null = Google Maps Satellite (DEFAULT_ION_ASSET_ID) ; preset อื่นหรือ Asset ID ที่กรอกเอง = ผู้ใช้เลือกไว้ คงเดิม
 * (Ruling: None ที่บันทึกไว้แยกไม่ออกจาก "ไม่เลือก" ซึ่งเคยเป็นค่าตั้งต้น จึงเปิดเป็น Google Maps Satellite ด้วย ; เลือก None ได้ในการใช้งานครั้งนั้น
 *  และ Show Imagery ยังตั้ง None เพื่อเปิดภาพ GIBS ให้เห็น) ไม่แตะ settings.json
 * ไม่มีอะไรต้องเปลี่ยน = คืนตัวเดิม ไม่แก้ตัวที่รับมา
 */
export function globeAtOpen(globe: GlobeSettings): GlobeSettings {
  let out = globe;
  if (!isIonAssetId(globe.ion?.assetId)) out = { ...out, ion: { assetId: DEFAULT_ION_ASSET_ID } };
  const osm = globe.layers.osm;
  if (osm !== undefined && osm.show) out = { ...out, layers: { ...globe.layers, osm: { ...osm, show: false } } };
  return out;
}

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
  /** ชั้นภาพบนลูกโลก (Globe Manager) ไม่มี = workbook ก่อนมีช่องนี้ */
  globe?: GlobeSettings;
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

const isTranslucency = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100;

/** globe ที่ใช้ได้ หรือ undefined (ไม่มี หรือรูปร่างผิด: ทิ้งทั้งช่อง ไม่ทำให้ workbook ใช้ไม่ได้) รายการที่ค่าผิดถูกทิ้ง ion ที่ไม่มีหรือผิด = ไม่เลือก */
function parseGlobe(x: unknown): GlobeSettings | undefined {
  if (!isRecord(x) || !isRecord(x.layers)) return undefined;
  const layers: Record<string, GlobeLayerSetting> = {};
  for (const [id, entry] of Object.entries(x.layers)) {
    if (!isRecord(entry) || typeof entry.show !== "boolean" || !isTranslucency(entry.translucency)) continue;
    layers[id] = { show: entry.show, translucency: entry.translucency };
  }
  const assetId = isRecord(x.ion) && isIonAssetId(x.ion.assetId) ? x.ion.assetId : null;
  return { layers, ion: { assetId } };
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
  const globe = parseGlobe(x.globe);
  if (globe !== undefined) w.globe = globe;
  return workbookBytes(w) > WORKBOOK_MAX_BYTES ? null : w;
}

type Json = Record<string, unknown>;

/** ตัด ids ออกจากรายการ views ของกลุ่มหนึ่ง (อ่านจาก JSON ของ dockview) activeView ที่ถูกตัดย้ายไปอันแรกที่เหลือ; คืนจำนวน view ที่เหลือ */
function pruneViews(group: Json, drop: ReadonlySet<string>): number {
  const views = Array.isArray(group.views) ? (group.views as unknown[]).filter((v) => !(typeof v === "string" && drop.has(v))) : [];
  group.views = views;
  const active = group.activeView;
  if (typeof active === "string" && drop.has(active)) {
    if (views.length > 0) group.activeView = views[0];
    else delete group.activeView;
  }
  return views.length;
}

function pruneGrid(node: unknown, drop: ReadonlySet<string>): void {
  if (!isRecord(node)) return;
  if (node.type === "leaf" && isRecord(node.data)) pruneViews(node.data, drop);
  else if (node.type === "branch" && Array.isArray(node.data)) for (const child of node.data) pruneGrid(child, drop);
}

/**
 * สำเนาของ JSON จาก DockviewApi.toJSON() ที่ไม่มีหน้าต่าง ids: ตัดออกจากตาราง panels และจากทุกกลุ่ม
 * - กลุ่มลอยที่ไม่เหลือหน้าต่างถูกลบ (ไม่เหลือกลุ่มลอยเลย = ไม่มี key floatingGroups เหมือนที่ dockview ทำ); กลุ่ม popout เช่นเดียวกัน
 * - edge group ที่เหลือว่างเพราะการตัดถูกลบ (กลุ่มที่ว่างมาก่อนคงเดิม)
 * - กลุ่มในกริดกลางที่เหลือว่างอยู่เป็นกลุ่มว่างเหมือนเดิม ไม่แตะขนาดของกลุ่มอื่น: ตอนจัดกลับ fromWorkbook ลบกลุ่มว่างด้วย api.removeGroup
 *   ซึ่ง dockview ขยายกลุ่มข้างเคียงเองให้ (คำนวณสัดส่วนของกริดเองจาก JSON เสี่ยงกว่า)
 * ไม่มี ids ให้ตัด = สำเนาที่เท่ากันทุกประการ; ไม่แก้ค่าที่รับเข้ามา
 */
export function withoutPanels(dockview: Json, drop: ReadonlySet<string>): Json {
  const out = JSON.parse(JSON.stringify(dockview)) as Json;
  if (drop.size === 0) return out;

  if (isRecord(out.panels)) for (const id of drop) delete out.panels[id];

  if (isRecord(out.grid)) pruneGrid(out.grid.root, drop);

  for (const key of ["floatingGroups", "popoutGroups"] as const) {
    const groups = out[key];
    if (!Array.isArray(groups)) continue;
    const kept = groups.filter((g) => !(isRecord(g) && isRecord(g.data)) || pruneViews(g.data, drop) > 0);
    if (kept.length > 0) out[key] = kept;
    else delete out[key];
  }

  if (isRecord(out.edgeGroups)) {
    for (const [side, edge] of Object.entries(out.edgeGroups)) {
      if (!isRecord(edge) || !isRecord(edge.group)) continue;
      const before = Array.isArray(edge.group.views) ? edge.group.views.length : 0;
      if (pruneViews(edge.group, drop) === 0 && before > 0) delete out.edgeGroups[side];
    }
  }
  return out;
}
