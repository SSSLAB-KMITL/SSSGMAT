// กราฟิกของ object ในหน้าต่าง 3D/2D จาก scenario.json (spec §9.1): สี, ป้ายชื่อ, การซ่อน, ขนาดจุด, เส้นทาง
//
// - id ของ entity ตามที่ engine เขียน (W8): `sat/<PRN>`, `fac/<ชื่อ>`, `access/<fac>/<PRN>` ดาวใน scenario จับคู่ PRN ผ่าน NORAD
//   ใน `satellites[]` ของ manifest ephem (ดาวที่เปลี่ยนชื่อหรือคัดลอกจึงยังได้ entity เดิม: Review Focus 5)
// - ลำดับสี (graphicsFor): inherit false + สีของตัวเอง → สีตัวเอง; inherit true (ไม่ระบุ = true ตาม server) + Constellation ที่มีดาวนี้และมีสี
//   (ตัวแรกตามลำดับใน doc ที่มีสี; ตัวที่เป็นสมาชิกแต่ไม่มีสีข้ามไป) → สีนั้น; อื่น ๆ → ตัวแปร CSS ของระบบ (--color-gps/glonass/galileo/beidou,
//   ระบบที่รู้ไม่ได้ = --color-other, Facility = --color-facility) สีของระบบอ่านจาก theme.css ครั้งเดียวแล้วจำไว้ (themeTokens) test ส่ง tokens เข้ามาเอง
//   ระบบของดาว: ctx.system ถ้าผู้เรียกบอก ไม่งั้นอักษรนำของ PRN (ctx.prnByNorad) ไม่งั้น system ของ Constellation แรกที่มีดาวนี้
// - ขนาดตัวอักษร/ขอบของป้ายชื่อ ขอบจุด ความหนาเส้น access สีเส้น Lat/Lon และหน้าตาของ Swath / เส้นแบ่งกลางวันกลางคืน / IPP ในหน้าต่าง 2D
//   เป็นตัวแปร CSS เช่นกัน (sceneStyle: --scene-*)
// - applyGraphics ตั้งกราฟิกของ entity ใน data source ที่โหลดแล้ว ไม่โหลด CZML ใหม่: แก้ Properties แล้วเห็นทันที
//   3D: จุด (marker style → ขนาดและขอบ), ป้ายชื่อ (ชื่อ object), เส้นทางเต็มหนึ่งรอบ (lead = trail = ครึ่งคาบที่ประมาณจากรัศมีเฉลี่ยของตัวอย่าง: passes.ts)
//   ดาว Inertial by Window ไม่มี path ของ Cesium (Graphics3D วาด polyline จาก toInertial แทน) เส้น access ใช้ --color-access ถ้า access ไม่ได้ตั้งสีเอง
// - เส้น access/<fac>/<PRN> วาดเฉพาะคู่ที่มี access ที่ Compute แล้วครอบคลุม (accessGraphics.ts: accessFor ต่อคู่ + resolveAccessGraphics) และเปิด Show กับ Show Animate Line
//   ดาวในหน้าต่าง 3D ที่มีโมเดล (ctx.models, satModelGraphics.ts): entity.model + orientation แทนจุด (จุดถูกซ่อน ป้ายและเส้นทางคงเดิม)
//   2D: จุดและป้ายชื่อเหมือนกัน + ground track เป็น path ของ Cesium ที่ lead/trail ตามหน้า 2D Graphics - Pass (passes.ts leadTrailProperties,
//   ต้องมีช่วงวิเคราะห์ใน ctx.analysis) Visible Sides วาดแบบ Both เสมอ (W20) Show Pass/Path Labels ยังไม่วาด (เก็บค่าไว้เท่านั้น)
//   และคง `show` ตามช่วงเวลาใน CZML ไว้ (ซ่อนทั้งเส้นด้วย entity.show เมื่อดาวหรือ Facility ปลายทางถูกซ่อน)
// - ctx.showOrbits = false (Show Orbits / Show Ground Tracks ของหน้าต่าง, task 13c): ไม่มี path ของดาวดวงใด (3D และ 2D) ค่าของ object ไม่ถูกแตะ
// - Sensor (sensor spec §5.3): ไม่มี entity ใน CZML sensorStatesAt หา sensor ที่วาด (sensorDraw.ts drawableSensors) และสถานะของมันจากตำแหน่ง Earth-fixed
//   ของ entity ดาวแม่ ณ t และ t ± 1 s (P9) ดาวแม่ "แสดงอยู่" = object ดาวแสดงตามธงของตัวเองในหน้าต่างชนิดนั้น (graphicsFor) และ entity ของมันอยู่ในภาพและแสดงอยู่

import {
  Cartesian2, Cartesian3, Color, ColorMaterialProperty, ConstantProperty, JulianDate, LabelGraphics, LabelStyle, HorizontalOrigin, NearFarScalar, PathGraphics,
  PointGraphics, PolylineDashMaterialProperty, ReferenceFrame, VerticalOrigin, type Entity, type EntityCollection, type MaterialProperty,
} from "cesium";
import type { components } from "../api/types.gen";
import { accessColor, accessFor, resolveAccessGraphics } from "./accessGraphics";
import { effectiveColor, objectPath, readCssVar, themeTokens, type ColorTokens, type SceneObject } from "./colors";
import { entityOrbit, leadTrailProperties, type PassLike } from "./passes";
import { applySatelliteModel, type SatModelSpec } from "./satModelGraphics";
import { drawableSensors, sensorDrawState, VELOCITY_STEP_S, type SensorDrawState, type SensorObj } from "./sensorDraw";
import type { Vec3 } from "./sensorGeometry";

type ScenarioDoc = components["schemas"]["ScenarioDoc"];
type SatelliteObj = components["schemas"]["SatelliteObj"];

// สีของธีม ระบบของดาว และสีที่ใช้จริงของ object อยู่ใน colors.ts (ไม่ import Cesium: Timeline View ใช้ร่วม) ส่งต่อที่นี่ให้ผู้ใช้เดิมไม่ต้องเปลี่ยน
export { objectPath, systemTokenOf, themeTokens } from "./colors";
export type { ColorTokens, SceneObject, TokenName } from "./colors";

/** หน้าตาของสิ่งที่วาดในภาพ 3D/2D นอกจากสีของ object (theme.css: --scene-*) */
export interface SceneStyle {
  /** font ของป้ายชื่อแบบ CSS shorthand (ขนาด + ตระกูลตัวอักษรของแอป) */
  labelFont: string;
  labelOutline: string;
  pointOutline: string;
  /** ความหนาเส้น access (พิกเซล) */
  accessWidth: number;
  /** สีเส้น Lat/Lon (#rrggbbaa) */
  gridLine: string;
  // หน้าต่าง 2D (spec §9.3)
  /** ความทึบของพื้นที่ Swath แบบ Filled Limits (0–1, สีของดาว) */
  swathFillOpacity: number;
  /** ความหนาเส้น Swath แบบ Edge Limits (พิกเซล) */
  swathEdgeWidth: number;
  /** สีและความหนาของเส้นแบ่งกลางวันกลางคืน (Lighting → Show Outline) */
  terminatorLine: string;
  terminatorWidth: number;
  /** ขนาดจุด IPP และความหนาเส้นทาง IPP (พิกเซล) */
  ippPointSize: number;
  ippTrackWidth: number;
}

/**
 * อ่าน SceneStyle จากตัวแปร CSS ผ่าน read (ชื่อตัวแปร → ค่า) ค่าที่ไม่มี (jsdom, หน้าที่ยังไม่โหลด theme.css) ใช้ค่ากลาง ๆ ที่วาดได้
 * ค่าจริงอยู่ใน theme.css ที่เดียว
 */
export function sceneStyleFrom(read: (name: string) => string): SceneStyle {
  const get = (name: string, missing: string): string => read(name).trim() || missing;
  /** ขนาดบวก (พิกเซลหรือตัวเลขเฉย ๆ) อ่านไม่ได้หรือไม่บวก = missing */
  const size = (name: string, missing: number): number => {
    const v = Number.parseFloat(read(name));
    return Number.isFinite(v) && v > 0 ? v : missing;
  };
  const opacity = Number.parseFloat(read("--scene-swath-fill-opacity"));
  return {
    labelFont: `${get("--scene-label-font-size", "12px")} ${get("--font-ui", "sans-serif")}`,
    labelOutline: get("--scene-label-outline", "#000000"),
    pointOutline: get("--scene-point-outline", "#000000"),
    accessWidth: size("--scene-access-width", 1),
    gridLine: get("--scene-grid-line", "#ffffff"),
    swathFillOpacity: Number.isFinite(opacity) && opacity > 0 && opacity <= 1 ? opacity : 0.25,
    swathEdgeWidth: size("--scene-swath-edge-width", 1),
    terminatorLine: get("--scene-terminator-line", "#ffffff"),
    terminatorWidth: size("--scene-terminator-width", 1),
    ippPointSize: size("--scene-ipp-point-size", 6),
    ippTrackWidth: size("--scene-ipp-track-width", 2),
  };
}

let cachedStyle: SceneStyle | null = null;

/** SceneStyle ของหน้า (อ่านครั้งแรกที่ใช้แล้วจำไว้ เหมือน themeTokens; ยังไม่มี theme.css = ไม่จำ) */
export function sceneStyle(): SceneStyle {
  if (cachedStyle !== null) return cachedStyle;
  const style = sceneStyleFrom(readCssVar);
  if (readCssVar("--scene-access-width") !== "") cachedStyle = style;
  return style;
}

// ---------- id ของ entity (W8) ----------

/** id ของ entity ใน CZML ของ object: Facility = fac/<ชื่อ>, Satellite = sat/<PRN จาก NORAD> (ไม่มีใน manifest = undefined), Constellation = undefined */
export function entityIdFor(obj: SceneObject, prnByNorad: ReadonlyMap<number, string>): string | undefined {
  if (obj.class === "Facility") return `fac/${obj.name}`;
  if (obj.class === "Satellite") {
    const prn = prnByNorad.get((obj as SatelliteObj).norad);
    return prn === undefined ? undefined : `sat/${prn}`;
  }
  return undefined;
}

/** ชื่อ object ใน scenario → id ของ entity (ฟังก์ชันของ window.__gnssStudioTest ใช้) ไม่มี object ชื่อนั้น = undefined */
export function entityIdForName(name: string, doc: ScenarioDoc | null, prnByNorad: ReadonlyMap<number, string>): string | undefined {
  const obj = doc?.objects.find((o) => o.name === name);
  return obj === undefined ? undefined : entityIdFor(obj, prnByNorad);
}

// ---------- กราฟิกของ object ----------

export interface GraphicsCtx {
  /** ซ่อนตามธงของดาว (W9) */
  hidden: boolean;
  mode: "3d" | "2d";
  /** ระบบของดาว (อักษรนำของ PRN หรือชื่อระบบ) ใช้เลือกสีเมื่อไม่มีสีอื่น ไม่ระบุ = หาจาก prnByNorad แล้วจาก Constellation */
  system?: string | null;
  /** NORAD → PRN ของ manifest ephem (หาระบบของดาวเมื่อไม่ระบุ system) */
  prnByNorad?: ReadonlyMap<number, string>;
  /** สีของระบบ (ไม่ระบุ = อ่านจาก theme.css) */
  tokens?: ColorTokens;
}

export interface ObjectGraphics {
  show: boolean;
  /** #rrggbb */
  color: string;
  labelShow: boolean;
  pointPixelSize: number;
  markerStyle: string;
  lineStyle: string;
  lineWidth: number;
}

interface Graphics2DLike {
  show?: boolean;
  pass?: unknown;
  inherit?: boolean;
  color?: string | null;
  marker_style?: string | null;
  line_style?: string | null;
  line_width?: number | null;
}

const DEFAULT_MARKER = "Point";
const DEFAULT_LINE_STYLE = "Solid";
const DEFAULT_LINE_WIDTH = 1;

/** ขนาดจุด (พิกเซล) และความหนาขอบของแต่ละ Marker Style (Cesium วาดจุดกลมได้แบบเดียว: รูปทรงอื่นแทนด้วยจุดใหญ่ขึ้นที่มีขอบ) */
const MARKERS: Record<string, { pixelSize: number; outlineWidth: number }> = {
  Point: { pixelSize: 6, outlineWidth: 0 },
  Circle: { pixelSize: 9, outlineWidth: 1 },
  Square: { pixelSize: 9, outlineWidth: 1 },
  Diamond: { pixelSize: 9, outlineWidth: 1 },
  Triangle: { pixelSize: 9, outlineWidth: 1 },
  Plus: { pixelSize: 8, outlineWidth: 2 },
  Cross: { pixelSize: 8, outlineWidth: 2 },
  Star: { pixelSize: 10, outlineWidth: 2 },
};

export function markerPoint(style: string): { pixelSize: number; outlineWidth: number } {
  return { ...(Object.hasOwn(MARKERS, style) ? MARKERS[style] : MARKERS[DEFAULT_MARKER]) };
}

/** Line Style → รูปแบบเส้นประของ Cesium (pattern 16 บิต, length = พิกเซลต่อรอบ) Solid = null */
const DASHES: Record<string, { pattern: number; length: number }> = {
  Dashed: { pattern: 0xff00, length: 16 },
  Dotted: { pattern: 0xcccc, length: 16 },
  "Dot Dashed": { pattern: 0xff18, length: 16 },
  "Long Dashed": { pattern: 0xfff0, length: 32 },
  "Dash Dot Dot": { pattern: 0xfc66, length: 24 },
  "Medium Dashed": { pattern: 0xff00, length: 24 },
  "Short Dashed": { pattern: 0xf0f0, length: 16 },
};

export function dashFor(style: string): { pattern: number; length: number } | null {
  return Object.hasOwn(DASHES, style) ? { ...DASHES[style] } : null;
}

const graphics2dOf = (obj: SceneObject): Graphics2DLike => ((obj as { graphics2d?: Graphics2DLike | null }).graphics2d ?? {});
const graphics3dOf = (obj: SceneObject): { show?: boolean; orbit_system?: string } =>
  ((obj as { graphics3d?: { show?: boolean; orbit_system?: string } | null }).graphics3d ?? {});

export function graphicsFor(obj: SceneObject, doc: ScenarioDoc, ctx: GraphicsCtx): ObjectGraphics {
  const tokens = ctx.tokens ?? themeTokens();
  const g2 = graphics2dOf(obj);
  const g3 = graphics3dOf(obj);
  const shownHere = ctx.mode === "3d" ? (g3.show ?? true) : (g2.show ?? true);
  const show = shownHere && !ctx.hidden;

  const color = effectiveColor(obj, doc, { system: ctx.system, prnByNorad: ctx.prnByNorad, tokens });

  const markerStyle = g2.marker_style ?? DEFAULT_MARKER;
  return {
    show,
    color,
    labelShow: show && (doc.graphics2d_global?.show_labels ?? true),
    pointPixelSize: markerPoint(markerStyle).pixelSize,
    markerStyle,
    lineStyle: g2.line_style ?? DEFAULT_LINE_STYLE,
    lineWidth: typeof g2.line_width === "number" && g2.line_width > 0 ? g2.line_width : DEFAULT_LINE_WIDTH,
  };
}

// ---------- ตั้งกราฟิกให้ entity (ไม่โหลด CZML ใหม่) ----------

export interface ApplyCtx {
  mode: "3d" | "2d";
  prnByNorad: ReadonlyMap<number, string>;
  /** ดาวที่ซ่อนตามธง (W9) */
  isHidden(norad: number): boolean;
  tokens?: ColorTokens;
  /** หน้าตาจาก theme.css (ไม่ระบุ = sceneStyle()) */
  style?: SceneStyle;
  /** Label Declutter ของหน้าต่าง */
  declutter?: boolean;
  /** ช่วงวิเคราะห์ (2D: lead/trail แบบ All, Current Interval) ไม่ระบุ = ไม่มี ground track ในหน้าต่าง 2D */
  analysis?: { start: JulianDate; stop: JulianDate };
  /** โมเดล 3 มิติของดาว (หน้าต่าง 3D ที่เปิด Satellite Models) ไม่ระบุ = ดาวเป็นจุดทุกดวง */
  models?: SatelliteModels;
  /**
   * ตัวเลือกของหน้าต่าง Show Orbits (3D) / Show Ground Tracks (2D) (task 13c): false = ไม่มีเส้นวงโคจร/ground track ของดาวดวงใดในหน้าต่างนี้
   * (ค่าของ object ไม่ถูกแตะ จุด ป้าย โมเดล เส้น access คงเดิม) ไม่ระบุ = true: เส้นตามค่าของแต่ละ object
   */
  showOrbits?: boolean;
}

/** โมเดลของดาวในหน้าต่าง 3D (models integration spec §4) */
export interface SatelliteModels {
  /** Model Pixel Size (พิกเซล) */
  pixelSize: number;
  /** โมเดลที่พร้อมวาดของดาว NORAD นี้ ไม่มี (ยังโหลดไม่เสร็จ โหลดล้มเหลว) = วาดเป็นจุด */
  specFor(norad: number): SatModelSpec | null;
  /** id ของ entity ดาวที่ถูกเลือก (ขอบสีของดาวรอบโมเดล) */
  selectedId?: string | null;
}

const INERTIAL_BY_WINDOW = "Inertial by Window";
/** ความละเอียดของ path (วินาที) เท่าระยะห่างของตัวอย่างใน CZML: จุดยอดของเส้นอยู่ที่ตัวอย่างพอดี */
const PATH_RESOLUTION_S = 300;

/** คาบโดยประมาณของ entity ดาวจากรัศมีเฉลี่ยของตัวอย่าง (passes.ts entityOrbit จำไว้ต่อ entity) ไม่มีตัวอย่าง = null */
export function entityPeriod(entity: Entity): number | null {
  return entityOrbit(entity)?.periodS ?? null;
}

/** สี CSS (#rrggbb, #rrggbbaa ฯลฯ) → Color ของ Cesium อ่านไม่ได้ = ขาว (ใช้ร่วมทั้ง graphics, overlay2d และหน้าต่าง 2D) */
export const cssColor = (hex: string): Color => Color.fromCssColorString(hex) ?? Color.WHITE;

function lineMaterial(color: Color, lineStyle: string): MaterialProperty {
  const dash = dashFor(lineStyle);
  return dash === null
    ? new ColorMaterialProperty(color)
    : new PolylineDashMaterialProperty({ color, dashPattern: dash.pattern, dashLength: dash.length });
}

function labelFor(text: string, show: boolean, color: Color, declutter: boolean, style: SceneStyle): LabelGraphics {
  return new LabelGraphics({
    text,
    show,
    font: style.labelFont,
    style: LabelStyle.FILL_AND_OUTLINE,
    fillColor: color,
    outlineColor: cssColor(style.labelOutline),
    outlineWidth: 2,
    horizontalOrigin: HorizontalOrigin.LEFT,
    verticalOrigin: VerticalOrigin.CENTER,
    pixelOffset: new Cartesian2(8, 0),
    // Label Declutter: Cesium ไม่มีการหลบป้ายที่ทับกัน จึงย่อและจางป้ายที่อยู่ไกลกล้อง (ป้ายด้านหลังวงโคจรซึ่งมักซ้อนกันอยู่หลังโลก)
    // ป้ายที่ถูกโลกบังถูกซ่อนด้วย depth test ตามปกติอยู่แล้ว
    scaleByDistance: declutter ? new NearFarScalar(1.5e7, 1.0, 8.0e7, 0.6) : undefined,
    translucencyByDistance: declutter ? new NearFarScalar(3.0e7, 1.0, 9.0e7, 0.0) : undefined,
  });
}

function pointFor(g: ObjectGraphics, color: Color, style: SceneStyle): PointGraphics {
  const marker = markerPoint(g.markerStyle);
  return new PointGraphics({ pixelSize: marker.pixelSize, color, outlineColor: cssColor(style.pointOutline), outlineWidth: marker.outlineWidth });
}

/** object ของ scenario ตาม id ของ entity (ตามลำดับใน doc: ดาวที่คัดลอกได้ entity เดียวกันหลายตัว) */
function objectsByEntity(doc: ScenarioDoc, prnByNorad: ReadonlyMap<number, string>): Map<string, SceneObject[]> {
  const out = new Map<string, SceneObject[]>();
  for (const obj of doc.objects) {
    const id = entityIdFor(obj, prnByNorad);
    if (id === undefined) continue;
    const list = out.get(id);
    if (list === undefined) out.set(id, [obj]);
    else list.push(obj);
  }
  return out;
}

/**
 * path ของ object ที่ entity id นี้แทน (ย้อนของ entityIdFor) ใช้เมื่อคลิกบน entity ในหน้าต่าง 3D: `fac/<ชื่อ>` = Facility ชื่อนั้น,
 * `sat/<PRN>` = ดาวที่ NORAD ตรงกับ PRN ใน manifest (ดาวที่เปลี่ยนชื่อจึงยังเลือกได้) ดาวที่คัดลอกมีหลายตัวต่อ entity เดียว: ตัวแรกที่เปิด Show
 * ของหน้า 3D ไม่มีก็ตัวแรก entity อื่น (sensor/…, access/…, ดาวนอก manifest, ไม่มีใน doc) = null: เลือกไม่ได้
 */
export function pathForEntityId(id: string, doc: ScenarioDoc | null, prnByNorad: ReadonlyMap<number, string>): string | null {
  const objs = doc === null ? undefined : objectsByEntity(doc, prnByNorad).get(id);
  if (objs === undefined) return null;
  return objectPath(objs.find((o) => graphics3dOf(o).show ?? true) ?? objs[0]);
}

/** หลาย object ต่อ entity เดียว (ดาวที่คัดลอก): ใช้ตัวแรกที่แสดงอยู่ ไม่มีตัวที่แสดง = ตัวแรก */
function pick(objs: SceneObject[], doc: ScenarioDoc, ctxOf: (o: SceneObject) => GraphicsCtx): EntityLook {
  const all = objs.map((obj) => ({ obj, g: graphicsFor(obj, doc, ctxOf(obj)) }));
  return all.find((x) => x.g.show) ?? all[0];
}

/** object ของ scenario ที่ entity ใช้หน้าตาของมัน และหน้าตานั้น */
export interface EntityLook {
  obj: SceneObject;
  g: ObjectGraphics;
}

/** id ของ entity (sat/…, fac/…) → object ที่กำหนดหน้าตาและหน้าตาของมันในหน้าต่างชนิด ctx.mode (กติกาเดียวกับ applyGraphics) */
export function entityLooks(doc: ScenarioDoc, ctx: ApplyCtx): Map<string, EntityLook> {
  const tokens = ctx.tokens ?? themeTokens();
  const out = new Map<string, EntityLook>();
  for (const [id, objs] of objectsByEntity(doc, ctx.prnByNorad)) {
    const system = id.startsWith("sat/") ? id.slice(4, 5) : null;
    out.set(
      id,
      pick(objs, doc, (o) => ({
        hidden: o.class === "Satellite" && ctx.isHidden((o as SatelliteObj).norad),
        mode: ctx.mode,
        system,
        tokens,
      })),
    );
  }
  return out;
}

/**
 * เส้น access ของคู่ (Facility, ดาว): access ที่ Compute แล้วของคู่นั้น (accessFor) ที่เปิด Show และ Show Animate Line
 * สีตาม accessColor (ตัวเดียวกับแถว Timeline) satColor = สีที่ใช้จริงของดาว ไม่มี access ที่ Compute แล้ว = ไม่วาด (show false)
 */
function accessStyle(doc: ScenarioDoc, facility: string, sat: { name: string; color: string } | undefined, tokens: ColorTokens): { show: boolean; color: string } {
  const look = sat === undefined ? null : resolveAccessGraphics(accessFor(doc, facility, sat.name));
  return { show: look !== null && look.show && look.line, color: look === null ? tokens.access : accessColor(look, sat?.color, tokens) };
}

/** ground track ของดาวในหน้าต่าง 2D: path ที่ lead/trail ตามหน้า Pass (ไม่มีช่วงวิเคราะห์หรือตัวอย่างตำแหน่ง = ซ่อน) */
function groundTrack(entity: Entity, obj: SceneObject, g: ObjectGraphics, color: Color, analysis: ApplyCtx["analysis"]): PathGraphics {
  const orbit = analysis === undefined ? null : entityOrbit(entity);
  if (orbit === null || analysis === undefined) return new PathGraphics({ show: false });
  const pass = graphics2dOf(obj).pass as PassLike | null | undefined;
  const { leadTime, trailTime } = leadTrailProperties(pass, orbit, analysis);
  return new PathGraphics({ show: true, leadTime, trailTime, width: g.lineWidth, resolution: PATH_RESOLUTION_S, material: lineMaterial(color, g.lineStyle) });
}

/**
 * ตั้งกราฟิกของทุก entity ใน collection ตาม doc (ไม่มี doc = ซ่อนทั้งหมด)
 * คืนหน้าตาของทุก entity ตาม doc (entityLooks ชุดเดียวที่ใช้ตั้ง: หน้าต่าง 2D ใช้ต่อกับ Swath และ IPP ไม่ต้องคำนวณซ้ำ)
 */
export function applyGraphics(ds: { entities: EntityCollection }, doc: ScenarioDoc | null, ctx: ApplyCtx): Map<string, EntityLook> {
  const tokens = ctx.tokens ?? themeTokens();
  const style = ctx.style ?? sceneStyle();
  const looks = doc === null ? new Map<string, EntityLook>() : entityLooks(doc, { ...ctx, tokens });
  const entities = ds.entities;
  const orbits = ctx.showOrbits ?? true;
  const shown = new Set<string>();
  entities.suspendEvents();
  try {
    for (const entity of entities.values) {
      const id = entity.id;
      const look = looks.get(id);
      if (id.startsWith("access/")) continue; // ทำหลังรู้ว่าปลายทางไหนแสดงอยู่
      if (look === undefined || doc === null || !(id.startsWith("sat/") || id.startsWith("fac/"))) {
        entity.show = false;
        continue;
      }
      const { obj, g } = look;
      const color = cssColor(g.color);
      entity.show = g.show;
      entity.name = obj.name;
      entity.point = pointFor(g, color, style);
      entity.label = labelFor(obj.name, g.labelShow, color, ctx.declutter === true, style);
      if (g.show) shown.add(id);
      if (obj.class === "Satellite" && ctx.mode === "3d") {
        const spec = ctx.models?.specFor((obj as SatelliteObj).norad) ?? null;
        applySatelliteModel(
          entity,
          spec === null || ctx.models === undefined ? null : { spec, pixelSize: ctx.models.pixelSize, color, selected: ctx.models.selectedId === id },
        );
        const period = entityPeriod(entity);
        const inertial = graphics3dOf(obj).orbit_system === INERTIAL_BY_WINDOW;
        entity.path =
          period === null || inertial || !orbits
            ? new PathGraphics({ show: false })
            : new PathGraphics({
                show: true,
                leadTime: period / 2,
                trailTime: period / 2,
                width: g.lineWidth,
                resolution: PATH_RESOLUTION_S,
                material: lineMaterial(color, g.lineStyle),
              });
      }
      if (obj.class === "Satellite" && ctx.mode === "2d") entity.path = orbits ? groundTrack(entity, obj, g, color, ctx.analysis) : new PathGraphics({ show: false });
    }
    for (const entity of entities.values) {
      const parts = entity.id.split("/");
      if (parts[0] !== "access") continue;
      if (parts.length !== 3 || doc === null) {
        entity.show = false;
        continue;
      }
      const [, facility, prn] = parts;
      const satLook = looks.get(`sat/${prn}`);
      const look = accessStyle(doc, facility, satLook === undefined ? undefined : { name: satLook.obj.name, color: satLook.g.color }, tokens);
      entity.show = look.show && shown.has(`fac/${facility}`) && shown.has(`sat/${prn}`);
      if (entity.polyline !== undefined) {
        entity.polyline.material = new ColorMaterialProperty(cssColor(look.color));
        entity.polyline.width = new ConstantProperty(style.accessWidth);
      }
    }
  } finally {
    entities.resumeEvents();
  }
  return looks;
}

/** จำนวนเส้น access (access/<fac>/<PRN>) ที่ applyGraphics เปิดไว้ (test hook accessLines: access ที่ไม่ได้ Compute ต้องเป็น 0) */
export function shownAccessLines(entities: EntityCollection): number {
  let n = 0;
  for (const e of entities.values) if (e.id.startsWith("access/") && e.show) n++;
  return n;
}

// ---------- Sensor (sensor spec §5.3) ----------

/** สิ่งที่ต้องรู้เพื่อบอกว่าดาวแม่แสดงอยู่ในหน้าต่างไหน (ส่วนหนึ่งของ ApplyCtx) */
export type SensorCtx = Pick<ApplyCtx, "mode" | "prnByNorad" | "isHidden" | "tokens">;

/** ตำแหน่ง Earth-fixed (เมตร) ของ entity ณ time นอกช่วง availability หรือไม่มีค่า (นอกช่วงของตัวอย่าง) = null */
export function fixedPositionAt(entity: Entity, time: JulianDate): Vec3 | null {
  if (entity.availability !== undefined && !entity.availability.contains(time)) return null;
  const p = entity.position?.getValueInReferenceFrame(time, ReferenceFrame.FIXED, new Cartesian3());
  return p === undefined ? null : { x: p.x, y: p.y, z: p.z };
}

/**
 * entity ของดาวที่ path นี้เมื่อดาวแสดงอยู่ในหน้าต่างชนิด ctx.mode: object ดาวแสดงตามธงของตัวเอง (graphicsFor: Show ของหน้านั้นและธงซ่อน W9)
 * และ entity ของมัน (ตาม NORAD) อยู่ใน entities และแสดงอยู่ ไม่งั้น undefined
 */
export function shownSatelliteEntity(path: string, doc: ScenarioDoc, entities: EntityCollection, ctx: SensorCtx): Entity | undefined {
  const obj = doc.objects.find((o) => o.class === "Satellite" && objectPath(o) === path);
  if (obj === undefined) return undefined;
  const g = graphicsFor(obj, doc, { hidden: ctx.isHidden((obj as SatelliteObj).norad), mode: ctx.mode, prnByNorad: ctx.prnByNorad, tokens: ctx.tokens });
  const id = entityIdFor(obj, ctx.prnByNorad);
  const entity = g.show && id !== undefined ? entities.getById(id) : undefined;
  return entity?.show === true ? entity : undefined;
}

/** สถานะสำหรับวาดของ sensor จากตำแหน่งของ entity ดาวแม่ ณ time และ time ∓ VELOCITY_STEP_S (P9) ไม่มีตำแหน่ง ณ time = null */
export function sensorStateAt(sensor: SensorObj, parent: Entity, time: JulianDate): SensorDrawState | null {
  const at = (dt: number): Vec3 | null => fixedPositionAt(parent, dt === 0 ? time : JulianDate.addSeconds(time, dt, new JulianDate()));
  return sensorDrawState(sensor, at(0), at(-VELOCITY_STEP_S), at(VELOCITY_STEP_S));
}

/**
 * สถานะของทุก sensor ที่วาดในหน้าต่างชนิด ctx.mode ณ time (ตามลำดับใน doc): Show ของหน้านั้นเปิดอยู่ ดาวแม่แสดงอยู่ (shownSatelliteEntity)
 * และดาวแม่มีตำแหน่ง ณ เวลานั้น (spec §5.3) ไม่มี doc = ไม่มี
 */
export function sensorStatesAt(doc: ScenarioDoc | null, entities: EntityCollection, ctx: SensorCtx, time: JulianDate): SensorDrawState[] {
  if (doc === null) return [];
  const parents = new Map<string, Entity | undefined>();
  const parentOf = (path: string): Entity | undefined => {
    if (!parents.has(path)) parents.set(path, shownSatelliteEntity(path, doc, entities, ctx));
    return parents.get(path);
  };
  const out: SensorDrawState[] = [];
  for (const sensor of drawableSensors(doc, ctx.mode, (path) => parentOf(path) !== undefined)) {
    const state = sensorStateAt(sensor, parentOf(sensor.parent)!, time);
    if (state !== null) out.push(state);
  }
  return out;
}
