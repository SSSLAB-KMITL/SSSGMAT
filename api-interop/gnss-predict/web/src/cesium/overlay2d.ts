// ภาพที่เปลี่ยนตามเวลาของหน้าต่าง 2D (spec §9.3): Swath, กลางวันกลางคืน, จุดและเส้นทาง IPP
//
// - ตัวสร้าง (swathItems, nightItems, ippItems) แปลงผลของ swath.ts / night.ts / ipp.ts เป็นรายการเส้น จุด และพื้นที่ของ Cesium พร้อมสีและขนาดจาก theme
// - Overlays2D วาดรายการเหล่านั้นเป็น primitive ของ scene โดยตรง (ไม่ใช่ entity): ตั้งค่าใหม่ได้ทันทีในเฟรมเดียว ไม่ผ่าน worker และไม่อยู่ใน
//   DataSourceDisplay (การข้าม update ตอนอยู่เฉย ๆ ของ idleUpdates.ts จึงไม่เกี่ยว) ผู้เรียกขอ render เองหลังตั้งค่า
//   - เส้น: PolylineCollection ต่อชั้น เก็บตาม key (รอบถัดไปแก้ตำแหน่ง/สีของเส้นเดิม) โหมด 2D ของ Cesium ตัดเส้นที่ข้ามเส้น 180° ให้เอง
//   - จุด: PointPrimitiveCollection ต่อชั้น เก็บตาม key เช่นกัน
//   - พื้นที่: Primitive แบบ synchronous หนึ่งตัวต่อชั้น (หลาย instance) สร้างใหม่ทุกรอบ จากตาข่ายตามคอลัมน์ของ lonlat.ts ซึ่งไม่มีสามเหลี่ยมพาดขั้ว
//     หรือพาดเส้น 180° (เหตุที่ไม่ใช้ PolygonGeometry อยู่ใน lonlat.ts)
//   ลำดับชั้น (ล่างขึ้นบน): กลางคืน, Swath แบบเติม, เส้นแบ่งกลางวันกลางคืน, ขอบ Swath, เส้นทาง IPP, จุด IPP

import {
  BoundingSphere, Cartesian3, Color, ColorGeometryInstanceAttribute, ComponentDatatype, Geometry, GeometryAttribute, GeometryAttributes, GeometryInstance,
  Material, PerInstanceColorAppearance, PointPrimitiveCollection, PolylineCollection, Primitive, PrimitiveCollection, PrimitiveType,
  type PointPrimitive, type Polyline,
} from "cesium";
import type { SceneStyle } from "./graphics";
import { columnsMesh, type Column } from "./lonlat";
import { nightColumns, terminator } from "./night";
import type { IppPoint, IppTrack } from "./ipp";
import { swathShape } from "./swath";

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

const cssColor = (hex: string): Color => Color.fromCssColorString(hex) ?? Color.WHITE;

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

/** Lighting ของหน้าต่าง 2D ณ เวลา d: Show Outline = เส้นแบ่งกลางวันกลางคืน, Shading = พื้นที่กลางคืน */
export function nightItems(d: Date, on: { outline: boolean; shading: boolean }, style: SceneStyle): { line: LineItem | null; fill: FillItem | null } {
  const line = on.outline ? { key: "terminator", positions: lonLatPositions(terminator(d)), color: cssColor(style.terminatorLine), width: style.terminatorWidth } : null;
  const geometry = on.shading ? meshGeometry(nightColumns(d)) : null;
  return { line, fill: geometry === null ? null : { key: "night", geometry, color: cssColor(style.nightFill) } };
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

export type FillLayer = "night" | "swath";
export type LineLayer = "terminator" | "swathEdge" | "ippTrack";
export type PointLayer = "ipp";
export type OverlayLayer = FillLayer | LineLayer | PointLayer;

const ORDER: OverlayLayer[] = ["night", "swath", "terminator", "swathEdge", "ippTrack", "ipp"];

export class Overlays2D {
  private readonly root: PrimitiveCollection;
  private readonly fills = new Map<FillLayer, PrimitiveCollection>();
  private readonly fillCounts = new Map<FillLayer, number>();
  private readonly lines = new Map<LineLayer, { collection: PolylineCollection; byKey: Map<string, Polyline> }>();
  private readonly points = new Map<PointLayer, { collection: PointPrimitiveCollection; byKey: Map<string, PointPrimitive> }>();

  constructor(private readonly parent: PrimitiveCollection) {
    this.root = parent.add(new PrimitiveCollection()) as PrimitiveCollection;
    for (const layer of ORDER) {
      if (layer === "night" || layer === "swath") this.fills.set(layer, this.root.add(new PrimitiveCollection()) as PrimitiveCollection);
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

  /** จำนวนสิ่งที่วาดอยู่ในแต่ละชั้น (พื้นที่นับเป็น instance) */
  counts(): Record<OverlayLayer, number> {
    const out = {} as Record<OverlayLayer, number>;
    for (const layer of ORDER) {
      if (layer === "night" || layer === "swath") out[layer] = this.fillCounts.get(layer) ?? 0;
      else if (layer === "ipp") out[layer] = this.points.get(layer)!.byKey.size;
      else out[layer] = this.lines.get(layer)!.byKey.size;
    }
    return out;
  }

  destroy(): void {
    if (!this.parent.isDestroyed()) this.parent.remove(this.root); // ทำลายทุกชั้นด้วย
  }
}
