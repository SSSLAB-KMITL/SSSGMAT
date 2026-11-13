// สีของ object ที่ไม่พึ่ง Cesium (graphics.ts ใช้สำหรับภาพ 3D/2D, Timeline View ใช้สำหรับแถวช่วงเวลา และ Object Browser ใช้กับกล่องสี:
// ต้องเลือกสีของดาวให้ตรงกันทุกหน้าต่าง)
//
// - ลำดับสี (effectiveColor): inherit false + สีของตัวเอง → สีตัวเอง; inherit true (ไม่ระบุ = true ตาม server) + Constellation ที่มีดาวนี้และมีสี
//   (ตัวแรกตามลำดับใน doc ที่มีสี; ตัวที่เป็นสมาชิกแต่ไม่มีสีข้ามไป) → สีนั้น; อื่น ๆ → ตัวแปร CSS ของระบบ (--color-gps/glonass/galileo/beidou,
//   ระบบที่รู้ไม่ได้ = --color-other, Facility = --color-facility) สีของระบบอ่านจาก theme.css ครั้งเดียวแล้วจำไว้ (themeTokens) test ส่ง tokens เข้ามาเอง
//   ระบบของดาว: ctx.system ถ้าผู้เรียกบอก ไม่งั้นอักษรนำของ PRN (ctx.prnByNorad) ไม่งั้น system ของ Constellation แรกที่มีดาวนี้
//   Sensor ไม่ inherit: สี graphics2d.color ของมันเอง ไม่มี = SENSOR_COLOR (#e8c547)
// - ไฟล์นี้ห้าม import Cesium (หรือไฟล์ที่ import Cesium) test ตรวจ

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
  /** ดาวที่รู้ระบบไม่ได้ */
  other: string;
  facility: string;
  access: string;
}
export type TokenName = keyof ColorTokens;
type SystemToken = Exclude<TokenName, "other" | "facility" | "access">;

const TOKEN_VARS: Record<TokenName, string> = {
  gps: "--color-gps", glonass: "--color-glonass", galileo: "--color-galileo", beidou: "--color-beidou", other: "--color-other",
  facility: "--color-facility", access: "--color-access",
};

/** ค่าตัวแปร CSS ของหน้า (ตัดช่องว่าง) ไม่มี = "" */
export const readCssVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let cachedTokens: ColorTokens | null = null;

/** สีของระบบจากตัวแปร CSS ใน theme.css (อ่านครั้งแรกที่ใช้แล้วจำไว้) ตัวแปรที่อ่านไม่ได้ = ขาว */
export function themeTokens(): ColorTokens {
  if (cachedTokens !== null) return cachedTokens;
  const tokens = Object.fromEntries(
    (Object.keys(TOKEN_VARS) as TokenName[]).map((k) => [k, readCssVar(TOKEN_VARS[k]) || "#ffffff"]),
  ) as unknown as ColorTokens;
  // jsdom และหน้าที่ยังไม่โหลด theme.css ไม่มีค่า: ไม่จำค่าว่างไว้ ให้รอบถัดไปอ่านใหม่
  if (Object.values(tokens).some((v) => v !== "#ffffff")) cachedTokens = tokens;
  return tokens;
}

/** ระบบของดาวจากอักษรนำของ PRN (G R E C) หรือชื่อระบบ ไม่ใช่สี่ระบบนี้ = null */
export function systemTokenOf(system: string | null | undefined): SystemToken | null {
  switch ((system ?? "").trim().toUpperCase()) {
    case "G": case "GPS": return "gps";
    case "R": case "GLONASS": return "glonass";
    case "E": case "GALILEO": return "galileo";
    case "C": case "BEIDOU": case "BDS": return "beidou";
    default: return null;
  }
}

export const objectPath = (obj: Pick<SceneObject, "class" | "name">): string => `*/${obj.class}/${obj.name}`;

// ---------- สีของ object ----------

export interface ColorCtx {
  /** ระบบของดาว (อักษรนำของ PRN หรือชื่อระบบ) ไม่ระบุ = หาจาก prnByNorad แล้วจาก Constellation */
  system?: string | null;
  /** NORAD → PRN ของ manifest ephem (หาระบบของดาวเมื่อไม่ระบุ system) */
  prnByNorad?: ReadonlyMap<number, string>;
  /** สีของระบบ (ไม่ระบุ = อ่านจาก theme.css) */
  tokens?: ColorTokens;
}

/** สีของ Constellation ตัวแรก (ตามลำดับใน doc) ที่มี object นี้และตั้งสีไว้ */
function constellationColor(path: string, doc: ScenarioDoc): string | null {
  for (const o of doc.objects) {
    if (o.class !== "Constellation") continue;
    const c = o as ConstellationObj;
    if ((c.assigned_objects ?? []).includes(path) && typeof c.color === "string" && c.color !== "") return c.color;
  }
  return null;
}

/** ระบบของดาว: อักษรนำของ PRN ตาม NORAD ไม่งั้น system ของ Constellation แรก (ตามลำดับใน doc) ที่มีดาวนี้และระบุระบบไว้ ไม่รู้ = null */
function systemOfSatellite(obj: SceneObject, doc: ScenarioDoc, prnByNorad: ReadonlyMap<number, string> | undefined): string | null {
  if (obj.class !== "Satellite") return null;
  const prn = prnByNorad?.get((obj as SatelliteObj).norad);
  if (prn !== undefined && prn !== "") return prn.slice(0, 1);
  const path = objectPath(obj);
  for (const o of doc.objects) {
    if (o.class !== "Constellation") continue;
    const c = o as ConstellationObj;
    if (typeof c.system === "string" && (c.assigned_objects ?? []).includes(path)) return c.system;
  }
  return null;
}

/** สีตั้งต้นของ Sensor (ตรงกับ Graphics2DSensor.color ของ server) */
export const SENSOR_COLOR = "#e8c547";

/** สีของ object ที่ใช้จริง (#rrggbb ตัวพิมพ์เล็ก) ลำดับตามหัวไฟล์ Sensor ไม่ inherit: สี graphics2d ของมันเอง ไม่มี = SENSOR_COLOR */
export function effectiveColor(obj: SceneObject, doc: ScenarioDoc, ctx: ColorCtx = {}): string {
  const tokens = ctx.tokens ?? themeTokens();
  const g2 = (obj as { graphics2d?: { inherit?: boolean; color?: string | null } | null }).graphics2d ?? {};
  const own = typeof g2.color === "string" && g2.color !== "" ? g2.color : null;
  if (obj.class === "Sensor") return (own ?? SENSOR_COLOR).toLowerCase();
  const system = ctx.system ?? systemOfSatellite(obj, doc, ctx.prnByNorad);
  const fallback = obj.class === "Facility" ? tokens.facility : tokens[systemTokenOf(system) ?? "other"];
  const color = g2.inherit === false ? (own ?? fallback) : (constellationColor(objectPath(obj), doc) ?? fallback);
  return color.toLowerCase();
}

/**
 * สีของกล่องสีใน Object Browser: Facility, Satellite และ Sensor = effectiveColor (สีที่หน้าต่าง 3D, 2D และ Timeline วาดจริง ไม่ใช่สีสำรองที่ server เก็บ)
 * Constellation (ไม่ถูกวาดเอง) = สีของตัวเองที่สมาชิกที่ inherit ใช้ ไม่มีก็สีของระบบที่ระบุ ระบุไม่ได้ = --color-other
 */
export function objectBoxColor(obj: SceneObject, doc: ScenarioDoc, ctx: ColorCtx = {}): string {
  if (obj.class !== "Constellation") return effectiveColor(obj, doc, ctx);
  const tokens = ctx.tokens ?? themeTokens();
  const c = obj as ConstellationObj;
  const own = typeof c.color === "string" && c.color !== "" ? c.color : null;
  return (own ?? tokens[systemTokenOf(c.system) ?? "other"]).toLowerCase();
}
