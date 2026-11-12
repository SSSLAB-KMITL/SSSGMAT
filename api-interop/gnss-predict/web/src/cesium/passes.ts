// ground track ของหน้าต่าง 2D (spec §9.3) และคาบวงโคจรที่ประมาณจากตัวอย่าง (ที่เดียวของสูตรคาบ: หน้าต่าง 3D ใช้ทำเส้นทางเต็มรอบด้วย)
//
// - คาบ: วงโคจรวงกลมรัศมีเท่ารัศมีเฉลี่ยของตำแหน่งตัวอย่าง T = 2π √(r³/μ) (Earth-fixed ใช้ได้: การหมุนรอบแกน z ไม่เปลี่ยนรัศมี)
// - จุดขึ้น (ascending node): z ของตัวอย่างเปลี่ยนจากลบเป็นบวก ประมาณเชิงเส้นระหว่างสองตัวอย่าง (การหมุนรอบแกน z ไม่เปลี่ยน z: ตัวอย่าง FIXED ใช้ได้)
// - leadTrailS: ระยะเวลาของเส้นทางข้างหน้า/ข้างหลังเวลาปัจจุบันตามหน้า 2D Graphics - Pass (STK ref §C):
//   Time = ค่าที่ตั้ง (ว่าง = 1800 วินาที เท่าแม่แบบของ server), Percent = % ของคาบ (ว่าง = 0), Quarter / Half / Full = ¼ / ½ / 1 คาบ,
//   All และ Current Interval = ถึงปลาย / จากต้นช่วงวิเคราะห์ (ไม่ติดลบ), None = 0,
//   One Pass = ถึงจุดขึ้นถัดไป / จากจุดขึ้นก่อนหน้า (ไม่มีจุดขึ้นข้างใดข้างหนึ่ง = ต่อจากอีกข้างทีละหนึ่งคาบ, ไม่มีเลย = ครึ่งคาบทั้งสองข้าง),
//   Same As Lead (trail เท่านั้น) = ค่าของ lead
// - leadTrailProperties: lead/trail ที่ขึ้นกับเวลา (All, Current Interval, One Pass) เป็นฟังก์ชันเชิงเส้นทีละช่วงของเวลา มีจุดหักที่ต้น/ปลายช่วงวิเคราะห์
//   และที่จุดขึ้น จึงเก็บเป็น SampledProperty แบบเชิงเส้นที่มีตัวอย่างสองข้างของทุกจุดหัก (ค่าตรงทุกเวลา ไม่ต้องคำนวณใหม่ระหว่างเล่น)
//   แบบที่ไม่ขึ้นกับเวลาเป็น ConstantProperty ค่าเหล่านี้คำนวณครั้งเดียวต่อการแก้ doc หรือการโหลด data source (ไม่ใช้ CallbackProperty: ดู idleUpdates.ts)

import { ConstantProperty, ExtrapolationType, JulianDate, SampledProperty, type Entity, type Property } from "cesium";
import type { components } from "../api/types.gen";

/** ค่าคงที่ความโน้มถ่วงของโลก (WGS 84) km³/s² */
export const MU_KM3_S2 = 398600.4418;

/** ระยะ lead/trail แบบ Time เมื่อช่องว่าง (เท่า DEFAULT_PASS_S ของแม่แบบดาวใน server) */
export const DEFAULT_PASS_S = 1800;

/** คาบ (วินาที) ของวงโคจรวงกลมรัศมี meanRadiusKm */
export function orbitPeriodS(meanRadiusKm: number): number {
  return 2 * Math.PI * Math.sqrt((meanRadiusKm * meanRadiusKm * meanRadiusKm) / MU_KM3_S2);
}

/** คาบโดยประมาณจากรัศมีเฉลี่ยของตำแหน่งตัวอย่าง (เมตร, Earth-fixed ใช้ได้) ไม่มีตัวอย่างที่ใช้ได้ = null */
export function estimatePeriod(points: readonly { x: number; y: number; z: number }[]): number | null {
  let sum = 0;
  let n = 0;
  for (const p of points) {
    const r = Math.hypot(p.x, p.y, p.z);
    if (!Number.isFinite(r) || r <= 0) continue;
    sum += r;
    n++;
  }
  return n === 0 ? null : orbitPeriodS(sum / n / 1000);
}

/** เวลาที่ z เปลี่ยนจากลบเป็นบวก (ประมาณเชิงเส้น) ตัวอย่างเรียงตามเวลา ตัวที่ z = 0 พอดีนับเป็นจุดขึ้นถ้าตัวก่อนหน้าติดลบ */
export function ascendingNodeTimes(samples: readonly { t: number; z: number }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (a.z < 0 && b.z >= 0) out.push(a.t + ((b.t - a.t) * -a.z) / (b.z - a.z));
  }
  return out;
}

// ---------- lead / trail ----------

type PassSettings = components["schemas"]["PassSettings"];
export type LeadType = NonNullable<PassSettings["lead_type"]>;
export type TrailType = NonNullable<PassSettings["trail_type"]>;

/** ส่วนของหน้า 2D Graphics - Pass ที่ใช้คำนวณ (ช่องที่ไม่มี = ค่าตั้งต้นของ server) */
export interface PassLike {
  lead_type?: LeadType;
  lead_time_s?: number | null;
  lead_percent?: number | null;
  trail_type?: TrailType;
  trail_time_s?: number | null;
  trail_percent?: number | null;
}

export interface PassCtx {
  /** เวลาปัจจุบัน (วินาที ฐานเดียวกับ start/stop/ascendingNodes) */
  t: number;
  /** ต้น/ปลายช่วงวิเคราะห์ */
  start: number;
  stop: number;
  periodS: number;
  ascendingNodes: readonly number[];
}

/** ระยะของ One Pass: ถึงจุดขึ้นแรกที่หลัง t และจากจุดขึ้นล่าสุดที่ ≤ t */
function onePass(ctx: PassCtx): { lead: number; trail: number } {
  const { t } = ctx;
  const p = ctx.periodS > 0 ? ctx.periodS : 0;
  let prev = Number.NEGATIVE_INFINITY;
  let next = Number.POSITIVE_INFINITY;
  for (const n of ctx.ascendingNodes) {
    if (n <= t) prev = Math.max(prev, n);
    else next = Math.min(next, n);
  }
  const hasPrev = prev > Number.NEGATIVE_INFINITY;
  const hasNext = next < Number.POSITIVE_INFINITY;
  if (!hasPrev && !hasNext) return { lead: p / 2, trail: p / 2 };
  if (p === 0) return { lead: hasNext ? next - t : 0, trail: hasPrev ? t - prev : 0 };
  if (!hasNext) {
    prev += Math.floor((t - prev) / p) * p; // เลยจุดขึ้นสุดท้ายไปหลายรอบ: จุดขึ้นที่ต่อออกไปทีละคาบ
    next = prev + p;
  } else if (!hasPrev) {
    prev = next - Math.ceil((next - t) / p) * p;
    next = prev + p;
  }
  return { lead: next - t, trail: t - prev };
}

function side(type: LeadType, time: number | null | undefined, percent: number | null | undefined, ctx: PassCtx, lead: boolean): number {
  const p = ctx.periodS > 0 ? ctx.periodS : 0;
  switch (type) {
    case "Time":
      return Math.max(0, time ?? DEFAULT_PASS_S);
    case "Percent":
      return Math.max(0, ((percent ?? 0) / 100) * p);
    case "Quarter":
      return p / 4;
    case "Half":
      return p / 2;
    case "Full":
      return p;
    case "All":
    case "Current Interval":
      return Math.max(0, lead ? ctx.stop - ctx.t : ctx.t - ctx.start);
    case "One Pass": {
      const o = onePass(ctx);
      return lead ? o.lead : o.trail;
    }
    default:
      return 0; // None
  }
}

/** ระยะเวลา (วินาที) ของเส้นทางข้างหน้าและข้างหลังเวลา ctx.t ตามหน้า Pass (ไม่มีหน้า Pass = ค่าตั้งต้นของ server: Time ทั้งสองข้าง) */
export function leadTrailS(pass: PassLike | null | undefined, ctx: PassCtx): { leadS: number; trailS: number } {
  const leadS = side(pass?.lead_type ?? "Time", pass?.lead_time_s, pass?.lead_percent, ctx, true);
  const trailType = pass?.trail_type ?? "Time";
  const trailS = trailType === "Same As Lead" ? leadS : side(trailType, pass?.trail_time_s, pass?.trail_percent, ctx, false);
  return { leadS, trailS };
}

// ---------- Cesium: วงโคจรของ entity และ lead/trail ที่ขึ้นกับเวลา ----------

export interface OrbitInfo {
  periodS: number;
  /** จุดขึ้นในช่วงที่มีข้อมูล */
  nodes: JulianDate[];
}

/** ระยะห่างของตัวอย่าง (วินาที) เท่าตัวอย่างใน scene.czml: จุดขึ้นจากการประมาณเชิงเส้นคลาดราว 0.01 วินาทีสำหรับดาว MEO */
const ORBIT_STEP_S = 300;

/** วงโคจรของ entity ดาว จำไว้ต่อ entity (ตำแหน่งของ entity ใน data source หนึ่งไม่เปลี่ยน) */
const orbitCache = new WeakMap<Entity, OrbitInfo | null>();

/** คาบและจุดขึ้นของ entity จากตัวอย่างตำแหน่ง Earth-fixed ทุก 300 วินาทีตลอด availability ไม่มี availability หรือตำแหน่ง = null */
export function entityOrbit(entity: Entity): OrbitInfo | null {
  if (orbitCache.has(entity)) return orbitCache.get(entity) ?? null;
  let orbit: OrbitInfo | null = null;
  const interval = entity.availability?.start !== undefined ? entity.availability : undefined;
  const position = entity.position;
  if (interval !== undefined && position !== undefined) {
    const span = JulianDate.secondsDifference(interval.stop, interval.start);
    const points: { x: number; y: number; z: number }[] = [];
    const zs: { t: number; z: number }[] = [];
    if (Number.isFinite(span) && span > 0) {
      const at = new JulianDate();
      for (let s = 0; ; s = Math.min(s + ORBIT_STEP_S, span)) {
        const p = position.getValue(JulianDate.addSeconds(interval.start, s, at));
        if (p !== undefined) {
          points.push({ x: p.x, y: p.y, z: p.z });
          zs.push({ t: s, z: p.z });
        }
        if (s >= span) break;
      }
    }
    const periodS = estimatePeriod(points);
    if (periodS !== null) {
      orbit = { periodS, nodes: ascendingNodeTimes(zs).map((s) => JulianDate.addSeconds(interval.start, s, new JulianDate())) };
    }
  }
  orbitCache.set(entity, orbit);
  return orbit;
}

/**
 * จุดขึ้นที่รู้ + จุดที่ต่อออกไปทีละคาบจนคลุม [start, stop] (ทุกเวลาในช่วงมีจุดขึ้น ≤ t และ > t): จุดที่ leadTrailS ต่อเองจะได้เป็นจุดหักของ
 * SampledProperty ด้วย (ไม่งั้นการประมาณเชิงเส้นระหว่างตัวอย่างข้ามจุดขึ้นที่ไม่ได้อยู่ในข้อมูล)
 */
export function extendNodes(nodes: readonly number[], periodS: number, start: number, stop: number): number[] {
  const out = [...nodes].sort((a, b) => a - b);
  if (out.length === 0 || !(periodS > 0)) return out;
  while (out[0] > start) out.unshift(out[0] - periodS);
  while (out[out.length - 1] <= stop) out.push(out[out.length - 1] + periodS);
  return out;
}

const VARYING = new Set<string>(["All", "Current Interval", "One Pass"]);
/** ระยะของตัวอย่างฝั่งซ้ายของจุดหัก (วินาที) */
const EDGE_S = 1e-3;

/**
 * leadTime / trailTime ของ path ของ Cesium ตามหน้า Pass: ConstantProperty เมื่อไม่ขึ้นกับเวลา ไม่งั้น SampledProperty เชิงเส้นที่ตรงกับ leadTrailS
 * ทุกเวลา (ตัวอย่างที่จุดหักและก่อนจุดหัก EDGE_S วินาที; นอกช่วงตัวอย่างคงค่าที่ปลาย)
 */
export function leadTrailProperties(
  pass: PassLike | null | undefined,
  orbit: OrbitInfo,
  analysis: { start: JulianDate; stop: JulianDate },
): { leadTime: Property; trailTime: Property } {
  const base = analysis.start;
  const sec = (j: JulianDate): number => JulianDate.secondsDifference(j, base);
  const stop = sec(analysis.stop);
  const nodes = extendNodes(orbit.nodes.map(sec), orbit.periodS, 0, stop);
  const at = (t: number) => leadTrailS(pass, { t, start: 0, stop, periodS: orbit.periodS, ascendingNodes: nodes });
  const leadVaries = VARYING.has(pass?.lead_type ?? "Time");
  const trailType = pass?.trail_type ?? "Time";
  const trailVaries = trailType === "Same As Lead" ? leadVaries : VARYING.has(trailType);
  const breaks = [...new Set([0, stop, ...nodes])].sort((a, b) => a - b);

  const make = (varies: boolean, pick: (v: { leadS: number; trailS: number }) => number): Property => {
    if (!varies) return new ConstantProperty(pick(at(0)));
    const prop = new SampledProperty(Number);
    breaks.forEach((b, i) => {
      if (i > 0 && b - EDGE_S > breaks[i - 1]) prop.addSample(JulianDate.addSeconds(base, b - EDGE_S, new JulianDate()), pick(at(b - EDGE_S)));
      prop.addSample(JulianDate.addSeconds(base, b, new JulianDate()), pick(at(b)));
    });
    prop.forwardExtrapolationType = ExtrapolationType.HOLD;
    prop.backwardExtrapolationType = ExtrapolationType.HOLD;
    return prop;
  };
  return { leadTime: make(leadVaries, (v) => v.leadS), trailTime: make(trailVaries, (v) => v.trailS) };
}
