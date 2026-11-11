// กราฟิกของ object ในหน้าต่าง 3D/2D จาก scenario.json (spec §9.1): สี, ป้ายชื่อ, การซ่อน, ขนาดจุด, เส้นทาง
//
// - id ของ entity ตามที่ engine เขียน (W8): `sat/<PRN>`, `fac/<ชื่อ>`, `access/<fac>/<PRN>` ดาวใน scenario จับคู่ PRN ผ่าน NORAD
//   ใน `satellites[]` ของ manifest ephem (ดาวที่เปลี่ยนชื่อหรือคัดลอกจึงยังได้ entity เดิม: Review Focus 5)
// - ลำดับสี (graphicsFor): inherit false + สีของตัวเอง → สีตัวเอง; inherit true (ไม่ระบุ = true ตาม server) + Constellation ที่มีดาวนี้และมีสี
//   (ตัวแรกตามลำดับใน doc ที่มีสี; ตัวที่เป็นสมาชิกแต่ไม่มีสีข้ามไป) → สีนั้น; อื่น ๆ → ตัวแปร CSS ของระบบ (--color-gps/glonass/galileo/beidou,
//   Facility = --color-facility) สีของระบบอ่านจาก theme.css ครั้งเดียวแล้วจำไว้ (themeTokens) test ส่ง tokens เข้ามาเอง
// - applyGraphics ตั้งกราฟิกของ entity ใน data source ที่โหลดแล้ว ไม่โหลด CZML ใหม่: แก้ Properties แล้วเห็นทันที
//   3D: จุด (marker style → ขนาดและขอบ), ป้ายชื่อ (ชื่อ object), เส้นทางเต็มหนึ่งรอบ (lead = trail = ครึ่งคาบที่ประมาณจากรัศมีเฉลี่ยของตัวอย่าง)
//   ดาว Inertial by Window ไม่มี path ของ Cesium (Graphics3D วาด polyline จาก toInertial แทน) เส้น access ใช้ --color-access ถ้า access ไม่ได้ตั้งสีเอง
//   และคง `show` ตามช่วงเวลาใน CZML ไว้ (ซ่อนทั้งเส้นด้วย entity.show เมื่อดาวหรือ Facility ปลายทางถูกซ่อน)

import {
  Cartesian2, Color, ColorMaterialProperty, ConstantProperty, JulianDate, LabelGraphics, LabelStyle, HorizontalOrigin, NearFarScalar, PathGraphics,
  PointGraphics, PolylineDashMaterialProperty, VerticalOrigin, type Entity, type EntityCollection, type MaterialProperty,
} from "cesium";
import type { components } from "../api/types.gen";

type ScenarioDoc = components["schemas"]["ScenarioDoc"];
export type SceneObject = ScenarioDoc["objects"][number];
type SatelliteObj = components["schemas"]["SatelliteObj"];
type ConstellationObj = components["schemas"]["ConstellationObj"];

// ---------- สีของธีม ----------

export interface ColorTokens {
  gps: string;
  glonass: string;
  galileo: string;
  beidou: string;
  facility: string;
  access: string;
}
export type TokenName = keyof ColorTokens;

const TOKEN_VARS: Record<TokenName, string> = {
  gps: "--color-gps", glonass: "--color-glonass", galileo: "--color-galileo", beidou: "--color-beidou",
  facility: "--color-facility", access: "--color-access",
};

let cachedTokens: ColorTokens | null = null;

/** สีของระบบจากตัวแปร CSS ใน theme.css (อ่านครั้งแรกที่ใช้แล้วจำไว้) ตัวแปรที่อ่านไม่ได้ = ขาว */
export function themeTokens(): ColorTokens {
  if (cachedTokens !== null) return cachedTokens;
  const style = getComputedStyle(document.documentElement);
  const read = (name: TokenName): string => style.getPropertyValue(TOKEN_VARS[name]).trim() || "#ffffff";
  const tokens: ColorTokens = {
    gps: read("gps"), glonass: read("glonass"), galileo: read("galileo"), beidou: read("beidou"), facility: read("facility"), access: read("access"),
  };
  // jsdom และหน้าที่ยังไม่โหลด theme.css ไม่มีค่า: ไม่จำค่าว่างไว้ ให้รอบถัดไปอ่านใหม่
  if (Object.values(tokens).some((v) => v !== "#ffffff")) cachedTokens = tokens;
  return tokens;
}

/** ระบบของดาวจากอักษรนำของ PRN (G R E C) หรือชื่อระบบ ไม่ใช่สี่ระบบนี้ = null */
export function systemTokenOf(system: string | null | undefined): Exclude<TokenName, "facility" | "access"> | null {
  switch ((system ?? "").trim().toUpperCase()) {
    case "G": case "GPS": return "gps";
    case "R": case "GLONASS": return "glonass";
    case "E": case "GALILEO": return "galileo";
    case "C": case "BEIDOU": case "BDS": return "beidou";
    default: return null;
  }
}

// ---------- id ของ entity (W8) ----------

export const objectPath = (obj: Pick<SceneObject, "class" | "name">): string => `*/${obj.class}/${obj.name}`;

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
  /** ระบบของดาว (อักษรนำของ PRN หรือชื่อระบบ) ใช้เลือกสีเมื่อไม่มีสีอื่น */
  system?: string | null;
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

/** สีของ Constellation ตัวแรก (ตามลำดับใน doc) ที่มี object นี้และตั้งสีไว้ */
function constellationColor(path: string, doc: ScenarioDoc): string | null {
  for (const o of doc.objects) {
    if (o.class !== "Constellation") continue;
    const c = o as ConstellationObj;
    if ((c.assigned_objects ?? []).includes(path) && typeof c.color === "string" && c.color !== "") return c.color;
  }
  return null;
}

export function graphicsFor(obj: SceneObject, doc: ScenarioDoc, ctx: GraphicsCtx): ObjectGraphics {
  const tokens = ctx.tokens ?? themeTokens();
  const g2 = graphics2dOf(obj);
  const g3 = graphics3dOf(obj);
  const shownHere = ctx.mode === "3d" ? (g3.show ?? true) : (g2.show ?? true);
  const show = shownHere && !ctx.hidden;

  let color: string;
  const own = typeof g2.color === "string" && g2.color !== "" ? g2.color : null;
  const fallback = obj.class === "Facility" ? tokens.facility : tokens[systemTokenOf(ctx.system) ?? "gps"];
  if (g2.inherit === false) color = own ?? fallback;
  else color = constellationColor(objectPath(obj), doc) ?? fallback;

  const markerStyle = g2.marker_style ?? DEFAULT_MARKER;
  return {
    show,
    color: color.toLowerCase(),
    labelShow: show && (doc.graphics2d_global?.show_labels ?? true),
    pointPixelSize: markerPoint(markerStyle).pixelSize,
    markerStyle,
    lineStyle: g2.line_style ?? DEFAULT_LINE_STYLE,
    lineWidth: typeof g2.line_width === "number" && g2.line_width > 0 ? g2.line_width : DEFAULT_LINE_WIDTH,
  };
}

// ---------- คาบวงโคจร ----------

/** ค่าคงที่ความโน้มถ่วงของโลก (WGS 84, m³/s²) */
export const MU_EARTH = 3.986004418e14;

/** คาบของวงโคจรวงกลมรัศมี r เมตร (วินาที) */
export const periodFromRadius = (r: number): number => 2 * Math.PI * Math.sqrt((r * r * r) / MU_EARTH);

/** คาบโดยประมาณจากรัศมีเฉลี่ยของตำแหน่งตัวอย่าง (Earth-fixed ใช้ได้: การหมุนไม่เปลี่ยนรัศมี) ไม่มีตัวอย่างที่ใช้ได้ = null */
export function estimatePeriod(points: readonly { x: number; y: number; z: number }[]): number | null {
  let sum = 0;
  let n = 0;
  for (const p of points) {
    const r = Math.hypot(p.x, p.y, p.z);
    if (!Number.isFinite(r) || r <= 0) continue;
    sum += r;
    n++;
  }
  return n === 0 ? null : periodFromRadius(sum / n);
}

// ---------- ตั้งกราฟิกให้ entity (ไม่โหลด CZML ใหม่) ----------

export interface ApplyCtx {
  mode: "3d" | "2d";
  prnByNorad: ReadonlyMap<number, string>;
  /** ดาวที่ซ่อนตามธง (W9) */
  isHidden(norad: number): boolean;
  tokens?: ColorTokens;
  /** Label Declutter ของหน้าต่าง */
  declutter?: boolean;
}

const INERTIAL_BY_WINDOW = "Inertial by Window";
const LABEL_FONT = "12px system-ui, sans-serif";
/** ความละเอียดของ path (วินาที) เท่าระยะห่างของตัวอย่างใน CZML: จุดยอดของเส้นอยู่ที่ตัวอย่างพอดี */
const PATH_RESOLUTION_S = 300;
/** จำนวนจุดที่ใช้ประมาณรัศมีเฉลี่ย (กระจายทั่วช่วงที่มีข้อมูล) */
const PERIOD_SAMPLES = 48;

/** คาบโดยประมาณของ entity ดาว จำไว้ต่อ entity (ตำแหน่งของ entity ใน data source หนึ่งไม่เปลี่ยน) */
const periodCache = new WeakMap<Entity, number | null>();

export function entityPeriod(entity: Entity): number | null {
  if (periodCache.has(entity)) return periodCache.get(entity) ?? null;
  let period: number | null = null;
  const interval = entity.availability?.start !== undefined ? entity.availability : undefined;
  const position = entity.position;
  if (interval !== undefined && position !== undefined) {
    const span = JulianDate.secondsDifference(interval.stop, interval.start);
    const points: { x: number; y: number; z: number }[] = [];
    if (Number.isFinite(span) && span > 0) {
      for (let i = 0; i <= PERIOD_SAMPLES; i++) {
        const p = position.getValue(JulianDate.addSeconds(interval.start, (span * i) / PERIOD_SAMPLES, new JulianDate()));
        if (p !== undefined) points.push(p);
      }
    }
    period = estimatePeriod(points);
  }
  periodCache.set(entity, period);
  return period;
}

const cssColor = (hex: string): Color => Color.fromCssColorString(hex) ?? Color.WHITE;

function lineMaterial(color: Color, lineStyle: string): MaterialProperty {
  const dash = dashFor(lineStyle);
  return dash === null
    ? new ColorMaterialProperty(color)
    : new PolylineDashMaterialProperty({ color, dashPattern: dash.pattern, dashLength: dash.length });
}

function labelFor(text: string, show: boolean, color: Color, declutter: boolean): LabelGraphics {
  return new LabelGraphics({
    text,
    show,
    font: LABEL_FONT,
    style: LabelStyle.FILL_AND_OUTLINE,
    fillColor: color,
    outlineColor: Color.BLACK,
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

function pointFor(g: ObjectGraphics, color: Color): PointGraphics {
  const marker = markerPoint(g.markerStyle);
  return new PointGraphics({ pixelSize: marker.pixelSize, color, outlineColor: Color.BLACK, outlineWidth: marker.outlineWidth });
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

/** หลาย object ต่อ entity เดียว (ดาวที่คัดลอก): ใช้ตัวแรกที่แสดงอยู่ ไม่มีตัวที่แสดง = ตัวแรก */
function pick(objs: SceneObject[], doc: ScenarioDoc, ctxOf: (o: SceneObject) => GraphicsCtx): { obj: SceneObject; g: ObjectGraphics } {
  const all = objs.map((obj) => ({ obj, g: graphicsFor(obj, doc, ctxOf(obj)) }));
  return all.find((x) => x.g.show) ?? all[0];
}

/** ค่ากราฟิกของ access จาก Access tool: ไม่มีหรือ inherit = ใช้ค่าตั้งต้น (แสดง, สี --color-access) */
function accessStyle(doc: ScenarioDoc, facility: string, tokens: ColorTokens): { show: boolean; color: string } {
  const def = (doc.accesses ?? []).find((a) => a.from === `*/Facility/${facility}` || a.from === facility);
  const g = def?.graphics;
  if (g === null || g === undefined || g.inherit !== false) return { show: true, color: tokens.access };
  const custom = g.color_mode === "custom" && typeof g.custom_color === "string" && g.custom_color !== "" ? g.custom_color : null;
  return { show: (g.show ?? true) && (g.animate_line ?? true), color: custom ?? tokens.access };
}

/** ตั้งกราฟิกของทุก entity ใน collection ตาม doc (ไม่มี doc = ซ่อนทั้งหมด) */
export function applyGraphics(ds: { entities: EntityCollection }, doc: ScenarioDoc | null, ctx: ApplyCtx): void {
  const tokens = ctx.tokens ?? themeTokens();
  const byEntity = doc === null ? new Map<string, SceneObject[]>() : objectsByEntity(doc, ctx.prnByNorad);
  const entities = ds.entities;
  const shown = new Set<string>();
  entities.suspendEvents();
  try {
    for (const entity of entities.values) {
      const id = entity.id;
      const objs = byEntity.get(id);
      if (id.startsWith("access/")) continue; // ทำหลังรู้ว่าปลายทางไหนแสดงอยู่
      if (objs === undefined || doc === null || !(id.startsWith("sat/") || id.startsWith("fac/"))) {
        entity.show = false;
        continue;
      }
      const system = id.startsWith("sat/") ? id.slice(4, 5) : null;
      const { obj, g } = pick(objs, doc, (o) => ({
        hidden: o.class === "Satellite" && ctx.isHidden((o as SatelliteObj).norad),
        mode: ctx.mode,
        system,
        tokens,
      }));
      const color = cssColor(g.color);
      entity.show = g.show;
      entity.name = obj.name;
      entity.point = pointFor(g, color);
      entity.label = labelFor(obj.name, g.labelShow, color, ctx.declutter === true);
      if (g.show) shown.add(id);
      if (obj.class === "Satellite" && ctx.mode === "3d") {
        const period = entityPeriod(entity);
        const inertial = graphics3dOf(obj).orbit_system === INERTIAL_BY_WINDOW;
        entity.path =
          period === null || inertial
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
    }
    for (const entity of entities.values) {
      const parts = entity.id.split("/");
      if (parts[0] !== "access") continue;
      if (parts.length !== 3 || doc === null) {
        entity.show = false;
        continue;
      }
      const [, facility, prn] = parts;
      const style = accessStyle(doc, facility, tokens);
      entity.show = style.show && shown.has(`fac/${facility}`) && shown.has(`sat/${prn}`);
      if (entity.polyline !== undefined) {
        entity.polyline.material = new ColorMaterialProperty(cssColor(style.color));
        entity.polyline.width = new ConstantProperty(1.5);
      }
    }
  } finally {
    entities.resumeEvents();
  }
}
