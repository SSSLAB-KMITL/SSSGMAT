// หน้าตาของ access ที่ใช้จริง (access spec §4, STK ref §F "Access graphics"): ที่เดียวที่อ่าน `accesses[].graphics`
// ผู้ใช้: เส้น access ของหน้าต่าง 3D/2D (graphics.ts applyGraphics) และ Static/Animate Highlight ของหน้าต่าง 2D (accessHighlight.ts)
//
// - ความหมายแบบ STK: วาดเฉพาะ access ที่ `computed: true` (Compute แล้ว ยังไม่ Clear) ไม่ computed = ไม่มีหน้าตา (null)
// - Inherit Settings from Scenario (inherit ไม่เป็น false) หรือไม่มี graphics = ค่าตั้งต้นของ scenario (แสดงเส้น ไม่มี highlight สี --color-access)
// - หาต่อคู่ (Facility, ดาว) ด้วย accessFor ไม่ใช่ access แรกของ Facility: Facility เดียวกันมีหลาย access ที่ครอบคลุมดาวต่างกันได้
// ไฟล์นี้ไม่ import Cesium

import type { components } from "../api/types.gen";
import type { ScenarioDoc } from "../stores/scenario";
import { constellations } from "../windows/AccessTool/state";

type AccessDef = components["schemas"]["AccessDef"];

/**
 * หน้าตาของ access หนึ่งตัว: line = Show Animate Line, custom = สีที่ผู้ใช้เลือก (#rrggbb ตัวเล็ก) null = สีตั้งต้นของที่วาด
 * (เส้นและแถว Timeline: accessColor, highlight: สีของดาว) objectColors = Use Object Colors ของ graphics ของ access เอง (ไม่ inherit)
 */
export interface AccessLook {
  show: boolean;
  line: boolean;
  staticHighlight: boolean;
  animateHighlight: boolean;
  custom: string | null;
  objectColors: boolean;
}

/** ค่าตั้งต้นของ scenario (ตรงกับค่าตั้งต้นของ AccessGraphics ใน server): เส้นสี --color-access แช่แข็งไว้เพราะทุก access ที่ inherit ได้ตัวเดียวกัน */
export const SCENARIO_ACCESS_DEFAULTS: Readonly<AccessLook> = Object.freeze({
  show: true,
  line: true,
  staticHighlight: false,
  animateHighlight: false,
  custom: null,
  objectColors: false,
});

/** รูปแบบสีของ server (`Color` ใน schema.py) */
const HEX = /^#[0-9a-fA-F]{6}$/;

/** หน้าตาของ access: ไม่มี access หรือไม่ computed = null, inherit (หรือไม่มี graphics) = SCENARIO_ACCESS_DEFAULTS ไม่งั้นตามที่ตั้งไว้ */
export function resolveAccessGraphics(a: AccessDef | undefined): Readonly<AccessLook> | null {
  if (a?.computed !== true) return null;
  const g = a.graphics;
  if (g === null || g === undefined || g.inherit !== false) return SCENARIO_ACCESS_DEFAULTS;
  const custom = g.color_mode === "custom" && typeof g.custom_color === "string" && HEX.test(g.custom_color) ? g.custom_color.toLowerCase() : null;
  return {
    show: g.show ?? true,
    line: g.animate_line ?? true,
    staticHighlight: g.static_highlight === true,
    animateHighlight: g.animate_highlight === true,
    custom,
    objectColors: g.color_mode !== "custom",
  };
}

/**
 * สีเส้น access และแถว Timeline ของคู่ (access, ดาว) กฎเดียวกันทั้งสองที่: สีที่ผู้ใช้เลือก > สีของดาว (Use Object Colors ของ access เอง)
 * > --color-access objectColor = สีที่ใช้จริงของดาว (colors.ts effectiveColor) ไม่รู้ = undefined
 */
export function accessColor(look: Readonly<AccessLook>, objectColor: string | null | undefined, tokens: { access: string }): string {
  return look.custom ?? (look.objectColors && typeof objectColor === "string" ? objectColor : tokens.access);
}

const FACILITY = "*/Facility/";
const SATELLITE = "*/Satellite/";

/**
 * access ที่ Compute แล้วของ Facility (ชื่อ เช่น THBK หรือ path `*\/Facility/THBK`) ที่มีดาวชื่อ satName อยู่ใน `to` (Constellation ขยายเป็นสมาชิก)
 * ไม่มี = undefined
 */
export function accessFor(doc: ScenarioDoc, facility: string, satName: string): AccessDef | undefined {
  const from = facility.startsWith(FACILITY) ? facility : `${FACILITY}${facility}`;
  const candidates = (doc.accesses ?? []).filter((a) => a.computed === true && a.from === from);
  if (candidates.length === 0) return undefined;
  const satPath = `${SATELLITE}${satName}`;
  const members = new Map(constellations(doc));
  // หลายตัวตรงกัน: path ของดาวตรง ๆ ชนะ Constellation ที่มีดาวนั้น ชนิดเดียวกันตัวหลังใน doc ชนะ (เหมือนค่าที่ตั้งทีหลังทับค่าเดิม)
  let best: AccessDef | undefined;
  let bestRank = 0;
  for (const a of candidates) {
    const rank = a.to.includes(satPath) ? 2 : a.to.some((to) => members.get(to)?.includes(satPath) === true) ? 1 : 0;
    if (rank > 0 && rank >= bestRank) {
      best = a;
      bestRank = rank;
    }
  }
  return best;
}
