// ภาพที่เปลี่ยนตามเวลาของหน้าต่าง 2D (spec §9.3): Swath, เส้นแบ่งกลางวันกลางคืน (Show Outline), จุดและเส้นทาง IPP, รอยของ sensor (sensor spec §5.3)
// (Shading ใช้แสงของ globe ของ Cesium: scene2d.ts applyProps)
//
// - swathInputs เลือกดาวที่วาด Swath จากหน้าตาของ entity (ดาวที่แสดงอยู่ ตั้ง Edge/Filled Limits และมีตำแหน่ง ณ ตอนนี้)
// - ตัวสร้าง (swathItems, terminatorItem, ippItems, sensorItems) แปลงผลของ swath.ts / night.ts / ipp.ts / sensorDraw.ts เป็นรายการเส้น จุด
//   และพื้นที่ของ Cesium พร้อมสีและขนาดจาก theme (รอยของ sensor ใช้ความหนาเส้นของ Swath, พื้นที่ใช้ความทึบจาก % Translucency ของ sensor)
// - fillStates / fillMoved: พื้นที่ Filled Limits สร้าง primitive ใหม่เฉพาะเมื่อชุดดาว สี มุมเงย หรือจุดใต้ดาว/รัศมีของรอยเท้าดวงใดเปลี่ยนเกิน 0.5°
//   (จุดใต้ดาว MEO เลื่อนราว 0.006–0.013° ต่อวินาทีของภาพ: ที่ Real Time หรือเดินทีละ step สั้น ๆ แทบไม่สร้างใหม่ แต่ที่ความเร็วตั้งต้น
//   (1,800 วินาทีของภาพต่อวินาที วาด 10 ครั้งต่อวินาที) เลื่อน 1–2° ต่อการวาด จึงยังสร้างใหม่ทุกครั้งเพื่อให้ภาพตามดาว)
// - Overlays2D วาดรายการเหล่านั้นเป็น primitive ของ scene โดยตรง (ไม่ใช่ entity): ตั้งค่าใหม่ได้ทันทีในเฟรมเดียว ไม่ผ่าน worker และไม่อยู่ใน
//   DataSourceDisplay (การข้าม update ตอนอยู่เฉย ๆ ของ idleUpdates.ts จึงไม่เกี่ยว) ผู้เรียกขอ render เองหลังตั้งค่า
//   - เส้น: PolylineCollection ต่อชั้น เก็บตาม key (รอบถัดไปแก้ตำแหน่ง/สีของเส้นเดิม) โหมด 2D ของ Cesium ตัดเส้นที่ข้ามเส้น 180° ให้เอง
//   - จุด: PointPrimitiveCollection ต่อชั้น เก็บตาม key เช่นกัน
//   - พื้นที่: Primitive แบบ synchronous หนึ่งตัวต่อชั้น (หลาย instance) สร้างใหม่ทุกรอบ จากตาข่ายตามคอลัมน์ของ lonlat.ts ซึ่งไม่มีสามเหลี่ยมพาดขั้ว
//     หรือพาดเส้น 180° (เหตุที่ไม่ใช้ PolygonGeometry อยู่ใน lonlat.ts)
//   ลำดับชั้น (ล่างขึ้นบน): Swath แบบเติม, Fill ของ sensor, เส้นแบ่งกลางวันกลางคืน, ขอบ Swath, วงรอยของ sensor, เส้นทาง IPP, จุด IPP

import {
  BoundingSphere, Cartesian3, Color, ColorGeometryInstanceAttribute, ComponentDatatype, Geometry, GeometryAttribute, GeometryAttributes, GeometryInstance,
  Material, PerInstanceColorAppearance, PointPrimitiveCollection, PolylineCollection, Primitive, PrimitiveCollection, PrimitiveType,
  type PointPrimitive, type Polyline,
} from "cesium";
import { cssColor, type EntityLook, type SceneStyle } from "./graphics";
import type { IppPoint, IppTrack } from "./ipp";
import { capColumns, columnsMesh, type Column } from "./lonlat";
import { terminator } from "./night";
import { sensorColor, sensorFillAlpha, type SensorDrawState } from "./sensorDraw";
import { footprintCentralAngleRad, subSatellite, swathShape } from "./swath";

/** ละติจูดสูงสุดของจุดที่วาด: ที่ขั้วพอดีทุกลองจิจูดเป็นจุดเดียวกัน Cesium จะหาลองจิจูดคืนไม่ได้เมื่อฉายลง 2D */
export const MAX_LAT = 89.99;

export interface LineItem {
  key: string;
  positions: Cartesian3[];
  color: Color;
  width: number;
}

export interface PointItem {
  key: string;
  position: Cartesian3;
  color: Color;
  pixelSize: number;
  outlineColor: Color;
}

export interface FillItem {
  key: string;
  geometry: Geometry;
  color: Color;
}

/** [lon, lat] องศา → ตำแหน่งบนทรงรีที่ความสูง 0 (ละติจูดถูกบีบไว้ใน ±MAX_LAT) */
export function lonLatPositions(points: readonly [number, number][]): Cartesian3[] {
  return points.map(([lon, lat]) => Cartesian3.fromDegrees(lon, Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))));
}

/** พื้นที่จากคอลัมน์เป็น Geometry สามเหลี่ยม (ตำแหน่ง double ตามที่ Primitive ต้องใช้ฉายลง 2D) ไม่มีสามเหลี่ยม = null */
export function meshGeometry(columns: readonly Column[]): Geometry | null {
  const mesh = columnsMesh(columns);
  if (mesh.indices.length === 0) return null;
  const positions = lonLatPositions(mesh.lonLat);
  const values = new Float64Array(positions.length * 3);
  positions.forEach((p, i) => values.set([p.x, p.y, p.z], 3 * i));
  const attributes = new GeometryAttributes();
  attributes.position = new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values });
  return new Geometry({
    attributes,
    indices: positions.length > 65_535 ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices),
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere: BoundingSphere.fromPoints(positions),
  });
}

// ---------- ตัวสร้างรายการ ----------

export type SwathOption = "No Graphics" | "Edge Limits" | "Filled Limits";

export interface SwathInput {
  /** id ของ entity ดาว */
  key: string;
  /** ตำแหน่ง Earth-fixed ณ เวลาปัจจุบัน */
  position: Cartesian3;
  color: Color;
  elevationDeg: number;
  options: SwathOption;
}

const DEFAULT_SWATH_ELEVATION_DEG = 10;
/** หน้า 2D Graphics - Swath ของดาว (ไม่มี = No Graphics ที่มุมเงย 10° ตามค่าตั้งต้นของ server) */
function swathOf(obj: EntityLook["obj"]): { options: SwathOption; elevationDeg: number } {
  const sw = (obj as { graphics2d?: { swath?: { options?: SwathOption; elevation_deg?: number } | null } | null }).graphics2d?.swath;
  return { options: sw?.options ?? "No Graphics", elevationDeg: sw?.elevation_deg ?? DEFAULT_SWATH_ELEVATION_DEG };
}

/**
 * ดาวที่วาด Swath: id `sat/…` ที่หน้าตาบอกว่าแสดงอยู่ ตั้ง Edge Limits หรือ Filled Limits และ positionOf(id) ให้ตำแหน่ง Earth-fixed ณ ตอนนี้
 * (ผู้เรียกคืน undefined เมื่อไม่มี entity, entity ถูกซ่อน หรืออยู่นอกช่วงที่มีข้อมูล) สีตามหน้าตา มุมเงยตามหน้า Swath
 */
export function swathInputs(looks: ReadonlyMap<string, EntityLook>, positionOf: (id: string) => Cartesian3 | undefined): SwathInput[] {
  const out: SwathInput[] = [];
  for (const [id, look] of looks) {
    if (!id.startsWith("sat/") || !look.g.show) continue;
    const { options, elevationDeg } = swathOf(look.obj);
    if (options === "No Graphics") continue;
    const position = positionOf(id);
    if (position === undefined) continue;
    out.push({ key: id, position, color: cssColor(look.g.color), elevationDeg, options });
  }
  return out;
}

/** สถานะของพื้นที่ Filled Limits หนึ่งดวง: จุดใต้ดาว รัศมีเชิงมุมของรอยเท้า และสี */
export interface FillState {
  key: string;
  lat: number;
  lon: number;
  angleDeg: number;
  color: string;
}

/** พื้นที่ Filled Limits เปลี่ยนเกินเท่านี้ (องศา: จุดใต้ดาวหรือรัศมีของรอยเท้า) จึงสร้างใหม่ */
export const FILL_MOVE_DEG = 0.5;

/** สถานะของดาวที่ตั้ง Filled Limits และมีรอยเท้า (เรียงตาม sats) */
export function fillStates(sats: readonly SwathInput[]): FillState[] {
  const out: FillState[] = [];
  for (const s of sats) {
    if (s.options !== "Filled Limits") continue;
    const sub = subSatellite(s.position);
    if (!(sub.altKm > 0)) continue;
    const angle = footprintCentralAngleRad(sub.altKm, s.elevationDeg);
    if (!(angle > 0)) continue;
    out.push({ key: s.key, lat: sub.lat, lon: sub.lon, angleDeg: (angle * 180) / Math.PI, color: s.color.toCssHexString() });
  }
  return out;
}

/** มุมระหว่างสองจุดบนทรงกลม (องศา) */
function separationDeg(a: FillState, b: FillState): number {
  const r = Math.PI / 180;
  const v = (lat: number, lon: number) => [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)];
  const [p, q] = [v(a.lat, a.lon), v(b.lat, b.lon)];
  const cross = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  return Math.atan2(Math.hypot(cross[0], cross[1], cross[2]), p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / r;
}

/** ต้องสร้างพื้นที่ Filled Limits ใหม่ไหม: ยังไม่เคยสร้าง, ชุดดาวหรือสีเปลี่ยน, หรือจุดใต้ดาว/รัศมีดวงใดเปลี่ยนเกิน minDeg */
export function fillMoved(prev: readonly FillState[] | null, next: readonly FillState[], minDeg = FILL_MOVE_DEG): boolean {
  if (prev === null || prev.length !== next.length) return true;
  return next.some((n, i) => {
    const p = prev[i];
    return p.key !== n.key || p.color !== n.color || Math.abs(p.angleDeg - n.angleDeg) > minDeg || separationDeg(p, n) > minDeg;
  });
}

/** Swath ของดาวแต่ละดวง: Edge Limits = วงขอบรอยเท้า, Filled Limits = พื้นที่โปร่งแสงสีของดาว, No Graphics หรือไม่มีรอยเท้า = ไม่วาด */
export function swathItems(sats: readonly SwathInput[], style: SceneStyle): { edges: LineItem[]; fills: FillItem[] } {
  const edges: LineItem[] = [];
  const fills: FillItem[] = [];
  for (const s of sats) {
    if (s.options === "No Graphics") continue;
    const shape = swathShape(s.position, s.elevationDeg);
    if (shape === null) continue;
    if (s.options === "Edge Limits") {
      edges.push({ key: s.key, positions: lonLatPositions(shape.ring), color: Color.clone(s.color), width: style.swathEdgeWidth });
    } else {
      const geometry = meshGeometry(shape.columns);
      if (geometry !== null) fills.push({ key: s.key, geometry, color: Color.clone(s.color).withAlpha(style.swathFillOpacity) });
    }
  }
  return { edges, fills };
}

/** key ของเส้นและพื้นที่ของ sensor ชื่อ name ในหน้าต่าง 2D */
export const sensorKey = (name: string): string => `sensor/${name}`;

/** พื้นที่ของ sensor หนึ่งตัว: Fill เปิด, boresight ชี้ลงศูนย์กลางโลก (P2) มีรอย และความทึบ > 0 ไม่งั้น null */
function sensorFillOf(st: SensorDrawState): { key: string; lat: number; lon: number; angleRad: number; color: Color } | null {
  const angle = st.centralAngleRad;
  if (st.sensor.graphics2d?.fill !== true || !st.nadir || angle === null || !(angle > 0)) return null;
  const alpha = sensorFillAlpha(st.sensor);
  if (!(alpha > 0)) return null;
  const sub = subSatellite(st.pos);
  return { key: sensorKey(st.sensor.name), lat: sub.lat, lon: sub.lon, angleRad: angle, color: cssColor(sensorColor(st.sensor, "2d")).withAlpha(alpha) };
}

/** สถานะของพื้นที่ sensor ที่มี Fill (ใช้กับ fillMoved แบบ Filled Limits: สีรวมความทึบ จึงเปลี่ยน % Translucency แล้วสร้างใหม่) */
export function sensorFillStates(states: readonly SensorDrawState[]): FillState[] {
  const out: FillState[] = [];
  for (const st of states) {
    const f = sensorFillOf(st);
    if (f !== null) out.push({ key: f.key, lat: f.lat, lon: f.lon, angleDeg: (f.angleRad * 180) / Math.PI, color: f.color.toCssHexString() });
  }
  return out;
}

/**
 * รอยของ sensor ในหน้าต่าง 2D (sensor spec §5.3): วงรอยบนพื้นโลกในสี graphics2d.color ทุกตัวที่ boresight โดนโลก (ไม่โดน = ไม่วาดรอย: spec §3.3)
 * Fill = พื้นที่แบบ Filled Limits ของ Swath (capColumns รอบจุดใต้ดาวที่มุมศูนย์กลางของรอย) เฉพาะ boresight ที่ชี้ลงศูนย์กลางโลก (P2)
 * ความทึบ 1 − % Translucency / 100 (100% = ไม่สร้าง) withFills = false: ไม่สร้างพื้นที่ (ผู้เรียกไม่ต้องสร้างใหม่รอบนี้)
 * ผู้เรียกเลือก sensor ที่วาดเอง (drawableSensors) ที่นี่จัดรูปอย่างเดียว
 */
export function sensorItems(states: readonly SensorDrawState[], style: SceneStyle, withFills = true): { lines: LineItem[]; fills: FillItem[] } {
  const lines: LineItem[] = [];
  const fills: FillItem[] = [];
  for (const st of states) {
    if (st.footprint.boresightHit === null) continue;
    const key = sensorKey(st.sensor.name);
    lines.push({ key, positions: lonLatPositions(st.footprint.ring), color: cssColor(sensorColor(st.sensor, "2d")), width: style.swathEdgeWidth });
    const f = withFills ? sensorFillOf(st) : null;
    const geometry = f === null ? null : meshGeometry(capColumns(f.lat, f.lon, f.angleRad));
    if (f !== null && geometry !== null) fills.push({ key, geometry, color: f.color });
  }
  return { lines, fills };
}

/** Lighting → Show Outline ณ เวลา d: เส้นแบ่งกลางวันกลางคืน (181 จุด) สีและความหนาจาก theme */
export function terminatorItem(d: Date, style: SceneStyle): LineItem {
  return { key: "terminator", positions: lonLatPositions(terminator(d)), color: cssColor(style.terminatorLine), width: style.terminatorWidth };
}

/** จุดและเส้นทาง IPP ที่ ipp.ts เลือก ในสีของดาว (colorOf คืน null = ดาวที่ไม่แสดง: ไม่วาด) */
export function ippItems(
  sel: { points: readonly IppPoint[]; tracks: readonly IppTrack[] },
  colorOf: (prn: string) => Color | null,
  style: SceneStyle,
): { points: PointItem[]; tracks: LineItem[] } {
  const outline = cssColor(style.pointOutline);
  const points: PointItem[] = [];
  for (const p of sel.points) {
    const color = colorOf(p.prn);
    if (color === null) continue;
    points.push({ key: `ipp/${p.prn}`, position: lonLatPositions([[p.lon, p.lat]])[0], color: Color.clone(color), pixelSize: style.ippPointSize, outlineColor: outline });
  }
  const tracks: LineItem[] = [];
  for (const tr of sel.tracks) {
    const color = colorOf(tr.prn);
    if (color === null) continue;
    tr.segments.forEach((seg, i) => tracks.push({ key: `ipp/${tr.prn}/${i}`, positions: lonLatPositions(seg), color: Color.clone(color), width: style.ippTrackWidth }));
  }
  return { points, tracks };
}

// ---------- ชั้นของ primitive ----------

export type FillLayer = "swath" | "sensor";
export type LineLayer = "terminator" | "swathEdge" | "sensorEdge" | "ippTrack";
export type PointLayer = "ipp";
export type OverlayLayer = FillLayer | LineLayer | PointLayer;

const ORDER: OverlayLayer[] = ["swath", "sensor", "terminator", "swathEdge", "sensorEdge", "ippTrack", "ipp"];
const isFill = (layer: OverlayLayer): layer is FillLayer => layer === "swath" || layer === "sensor";

export class Overlays2D {
  private readonly root: PrimitiveCollection;
  private readonly fills = new Map<FillLayer, PrimitiveCollection>();
  private readonly fillCounts = new Map<FillLayer, number>();
  private readonly lines = new Map<LineLayer, { collection: PolylineCollection; byKey: Map<string, Polyline> }>();
  private readonly points = new Map<PointLayer, { collection: PointPrimitiveCollection; byKey: Map<string, PointPrimitive> }>();

  constructor(private readonly parent: PrimitiveCollection) {
    this.root = parent.add(new PrimitiveCollection()) as PrimitiveCollection;
    for (const layer of ORDER) {
      if (isFill(layer)) this.fills.set(layer, this.root.add(new PrimitiveCollection()) as PrimitiveCollection);
      else if (layer === "ipp") this.points.set(layer, { collection: this.root.add(new PointPrimitiveCollection()) as PointPrimitiveCollection, byKey: new Map() });
      else this.lines.set(layer, { collection: this.root.add(new PolylineCollection()) as PolylineCollection, byKey: new Map() });
    }
  }

  /** collection ของชั้นนั้น (test) */
  layer(name: OverlayLayer): PrimitiveCollection | PolylineCollection | PointPrimitiveCollection {
    return (this.fills.get(name as FillLayer) ?? this.lines.get(name as LineLayer)?.collection ?? this.points.get(name as PointLayer)?.collection)!;
  }

  setFills(layer: FillLayer, items: readonly FillItem[]): void {
    const collection = this.fills.get(layer)!;
    collection.removeAll(); // ทำลาย primitive เดิม
    this.fillCounts.set(layer, items.length);
    if (items.length === 0) return;
    collection.add(
      new Primitive({
        geometryInstances: items.map((it) => new GeometryInstance({ geometry: it.geometry, id: it.key, attributes: { color: ColorGeometryInstanceAttribute.fromColor(it.color) } })),
        appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: false,
        allowPicking: false,
      }),
    );
  }

  setLines(layer: LineLayer, items: readonly LineItem[]): void {
    const { collection, byKey } = this.lines.get(layer)!;
    const keep = new Set(items.map((it) => it.key));
    for (const [key, pl] of byKey) {
      if (keep.has(key)) continue;
      collection.remove(pl);
      byKey.delete(key);
    }
    for (const it of items) {
      const pl = byKey.get(it.key);
      if (pl === undefined) {
        byKey.set(it.key, collection.add({ positions: it.positions, width: it.width, material: Material.fromType(Material.ColorType, { color: it.color }) }));
      } else {
        pl.positions = it.positions;
        pl.width = it.width;
        pl.material.uniforms.color = it.color;
      }
    }
  }

  setPoints(layer: PointLayer, items: readonly PointItem[]): void {
    const { collection, byKey } = this.points.get(layer)!;
    const keep = new Set(items.map((it) => it.key));
    for (const [key, pt] of byKey) {
      if (keep.has(key)) continue;
      collection.remove(pt);
      byKey.delete(key);
    }
    for (const it of items) {
      const pt = byKey.get(it.key);
      if (pt === undefined) {
        byKey.set(it.key, collection.add({ position: it.position, color: it.color, pixelSize: it.pixelSize, outlineColor: it.outlineColor, outlineWidth: 1 }));
      } else {
        pt.position = it.position;
        pt.color = it.color;
        pt.pixelSize = it.pixelSize;
        pt.outlineColor = it.outlineColor;
      }
    }
  }

  /** จำนวนจุดของเส้น key ในชั้นนั้นที่วาดอยู่ ไม่มีเส้นนั้น = null (window.__gnssStudioTest.sensorFootprint) */
  linePoints(layer: LineLayer, key: string): number | null {
    return this.lines.get(layer)!.byKey.get(key)?.positions.length ?? null;
  }

  /** จำนวนสิ่งที่วาดอยู่ในแต่ละชั้น (พื้นที่นับเป็น instance) */
  counts(): Record<OverlayLayer, number> {
    const out = {} as Record<OverlayLayer, number>;
    for (const layer of ORDER) {
      if (isFill(layer)) out[layer] = this.fillCounts.get(layer) ?? 0;
      else if (layer === "ipp") out[layer] = this.points.get(layer)!.byKey.size;
      else out[layer] = this.lines.get(layer)!.byKey.size;
    }
    return out;
  }

  destroy(): void {
    if (!this.parent.isDestroyed()) this.parent.remove(this.root); // ทำลายทุกชั้นด้วย
  }
}
