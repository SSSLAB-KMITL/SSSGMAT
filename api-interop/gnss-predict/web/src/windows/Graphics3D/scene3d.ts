// ภาพในหน้าต่าง 3D หนึ่งบาน (spec §9.1–§9.2): viewer + CzmlDataSource ตัวเดียว + การตามเวลา/scenario/ผลลัพธ์/ค่าตั้งของหน้าต่าง
// โหลดแบบ dynamic import จาก Graphics3D.tsx: Cesium ทั้งก้อนอยู่ใน chunk ของตัวเอง ไม่ถ่วงการเปิดหน้าเว็บ
//
// - data source (graphics/sceneSource.ts CzmlScene ที่หน้าต่าง 2D ใช้ด้วย): โหลดใหม่เมื่อ URL ของ scene.czml / access.czml (ซึ่งมี hash อยู่ใน URL) เปลี่ยนเท่านั้น
//   ผลไม่ current = data source ว่างที่มีแค่ Facility จาก doc (Review Focus 1) การแก้กราฟิกเรียก applyGraphics อย่างเดียว ไม่โหลด CZML ใหม่
//   โหลดไม่สำเร็จ = Facility อย่างเดียวพร้อมแถบแจ้ง (sceneFailed) แล้วลองใหม่ใน refresh ถัดไปแม้ hash เท่าเดิม (Review Focus 2)
// - dataSourceDisplay ข้ามการ update ตอนอยู่เฉย ๆ (cesium/idleUpdates.ts): หน้าต่างนี้จึงห้ามใช้ CallbackProperty, path ที่ relativeTo INERTIAL
//   หรือ visualizer เพิ่มเอง (ดูข้อจำกัดในไฟล์นั้น) Inertial by Window จึงวาดเป็น polyline ค่าคงที่ที่คำนวณใหม่เอง ไม่ใช่ path relativeTo
// - เวลา: bindClock (useTime → clock.currentTime + requestRender) viewer ไม่เดินเอง
// - กล้อง: Home View (ความสูง 4.5 รัศมีโลกเหนือ Facility แรก หรือ 0°,0°), Zoom To (trackedEntity + viewFrom),
//   View From/To (lookAtTransform ทุกครั้งที่เวลาเปลี่ยน; Inertial ใช้แกน ICRF เป็นกรอบของกล้อง) สถานะกล้องถูกตั้งกลับหลังโหลด data source ใหม่
// - Inertial by Window: polyline จาก toInertial ของตัวอย่างครึ่งคาบทั้งสองข้าง คำนวณใหม่ไม่เกิน 4 ครั้งต่อวินาทีขณะเวลาเปลี่ยน (แสดงผลเท่านั้น)
// - Sensor (sensor spec §5.3): entity ของเราเองใน viewer.entities (`sensor/<ชื่อ>/ring`, `/radial/<i>`, `/marker`) ค่าคงที่ที่คำนวณใหม่แบบเดียวกับ
//   Inertial by Window (ไม่เกิน 4 ครั้งต่อวินาทีขณะเวลาเปลี่ยน และทันทีใน restyle) จากตำแหน่ง FIXED ของ entity ดาวแม่ ณ t และ t ± 1 s (graphics.ts sensorStatesAt)
//   วงรอยเป็น polyline ตามผิวทรงรี (GEODESIC) ที่ความสูง 0, Radial Lines เป็นเส้นตรงจากดาว (sensorDraw.ts radialLineEnds), Boresight Marker เป็นจุด
//   สี graphics3d.color ความหนาเส้นเท่าขอบ Swath ขนาดจุดเท่าจุด IPP (theme)
// - 3D Graphics Window Properties (useLayout.windowProps[panelId]) → แสง, เส้น Lat/Lon, Label Declutter (ดู applyProps)
// - Grab Globe / Zoom In: โหมดเมาส์ของปุ่มซ้าย (Zoom In: ลากกรอบแล้วบินไปที่กรอบ คลิกเฉย ๆ ซูมเข้าครึ่งหนึ่ง จบแล้วกลับเป็น Grab Globe)
// - คลิกเลือก object (sensor spec §5.5, หน้าต่าง 3D หลักเท่านั้น: opts.pick): กดและปล่อยซ้ายในโหมด Grab Globe โดยเมาส์เลื่อนไม่เกิน 4 px = คลิก
//   (pick.ts) เลือกดาวหรือ Facility ที่จุดอยู่ใกล้เมาส์ที่สุดไม่เกิน 8 px (pathAt) ไม่ใช้ scene.pick: เส้น access ทุกเส้นมาบรรจบที่จุดของ Facility
//   และเส้นวงโคจรของดาวทุกดวงผ่านใกล้จุดของดาวอื่น เส้นซ้อนทับจุดอยู่หลายสิบชิ้น (ที่ Facility drillPick 40 ชั้นยังไม่ถึงจุด) จึงคำนวณจากตำแหน่งบนจอแทน
//   (windowPosition: ซ่อนอยู่ อยู่หลังโลก หรือนอกภาพไม่นับ)
//   โหมด Zoom In ไม่เลือก; คลิกซ้ายและดับเบิลคลิกตั้งต้นของ Viewer (pickAndSelectObject / pickAndTrackObject) ยังอยู่ตามเดิม
// - Sensor View (sensor spec §5.4, mountSensorView): scene เดียวกันนี้ใน viewer ของหน้าต่าง Sensor View ลงทะเบียนในทะเบียนของ Sensor View (P3)
//   กล้องโหมด sensor (viewFromSensor): ตำแหน่ง = ตำแหน่ง Earth-fixed ของดาวแม่, ทิศ = boresight, ด้านบน = North หรือ Velocity
//   fov ด้านสั้น = min(2α × 1.05, 120°) / zoom (sensorDraw.ts sensorViewPose) near = 1 m ตั้งใหม่ทุกครั้งที่เวลาเปลี่ยน doc เปลี่ยน หรือหน้าต่างเปลี่ยนขนาด
//   (ภาพขนาดศูนย์ เช่นแท็บที่ยุบอยู่ ไม่ตั้ง fov: คงค่าเดิมไว้) ปิดการลาก หมุน ซูมด้วยเมาส์ (enableInputs = false)
//   ไม่วาดกราฟิกของ sensor ตัวนี้เลย (Radial Lines, วงรอย, Boresight Marker: P7 ตามที่ controller ปรับ วงขอบกรวยที่เห็นคือวงบน HUD ซึ่งเป็นภาพที่แน่นอนของขอบกรวย
//   กราฟิกของ sensor วาดใหม่ช้ากว่ากล้องจึงแกว่งรอบวง HUD ตอน animation) sensor ตัวอื่นยังวาดครบ และซ่อนจุดกับป้ายของดาวแม่ที่อยู่ตรงตำแหน่งกล้อง
//   แสงกลางวัน/กลางคืนเปิดเสมอ
//   ไม่อ่าน 3D Graphics Window Properties (P8)
//   คลิกและดับเบิลคลิกตั้งต้นของ Viewer (เลือก entity / ตามหรือบินไปหา entity) ถูกถอดจาก viewer ของ Sensor View (enableInputs ไม่ได้ปิดสองอย่างนี้)
//   และทุกครั้งที่วางกล้องจะเลิกตาม entity ยกเลิกการบิน และคืน transform เป็น identity ก่อน (placeSensorCamera)
// - โหมด Camera ของ Sensor View (imagery spec §5.3, view.display = "camera"): ตั้ง show = false ที่ทุก data source ของ viewer นี้และที่ viewer.entities
//   (ทั้งคอลเลกชัน: entity.isShowing ของ Cesium รวม show ของคอลเลกชัน เส้นวงโคจร จุด ป้าย Facility เส้น access sensor และ Inertial by Window จึงหายหมด
//   รวมถึง entity ที่ applyGraphics / drawSensors / drawInertial ตั้งหรือสร้างใหม่ภายหลัง และ data source ที่เพิ่มเข้ามาทีหลัง: dataSourceAdded)
//   ไม่จำค่าเดิม: กลับเป็น Sensor = คืน show ของคอลเลกชันแล้ว restyle คำนวณการแสดงของแต่ละ entity ใหม่จาก doc (object ที่ผู้ใช้ซ่อนยังซ่อน)
//   scene นี้ไม่มี primitive ของตัวเองนอกจากที่ data source วาด ลูกโลก ชั้นภาพ บรรยากาศ ดาวพื้นหลัง และแสงคงไว้ หน้าต่างอื่นไม่ถูกแตะ (viewer ของตัวเอง)
//   zoom: fov ด้านสั้น = sensorViewShortFovDeg(α) / zoom ตำแหน่งและทิศกล้องไม่เปลี่ยน
// - ภาพพื้นโลกออนไลน์ NASA GIBS (imagery spec §5.2, ทั้งหน้าต่าง 3D และ Sensor View): cesium/imageryLayers.ts ต่อหลัง applyProps
//   (ภาพฐาน index 0 และเส้น Lat/Lon มีแล้ว: ชั้น GIBS แทรกระหว่างสองอย่างนี้) ถอดใน destroy ก่อนทำลาย viewer

import {
  ArcType, Cartesian2, Cartesian3, Color, ColorMaterialProperty, ConstantPositionProperty, ConstantProperty, EllipsoidalOccluder, JulianDate,
  Math as CesiumMath, Matrix3, Matrix4, PerspectiveFrustum, PointGraphics, PolylineDashMaterialProperty, PolylineGraphics, ReferenceFrame,
  SceneTransforms, ScreenSpaceEventHandler, ScreenSpaceEventType, TimeInterval, TrackingReferenceFrame, Transforms, type Camera, type Entity, type ImageryLayer,
  type Viewer,
} from "cesium";
import type { components } from "../../api/types.gen";
import { bindClock } from "../../cesium/clockSync";
import { ensureFacilities } from "../../cesium/czml";
import { attachImageryLayers, imageryStatus } from "../../cesium/imageryLayers";
import {
  applyGraphics, cssColor, dashFor, entityIdFor, entityIdForName, entityPeriod, fixedPositionAt, graphicsFor, objectPath, pathForEntityId, sceneStyle,
  sensorStateAt, sensorStatesAt, type SceneObject, type SceneStyle, type SensorCtx,
} from "../../cesium/graphics";
import { skipIdleDisplayUpdates } from "../../cesium/idleUpdates";
import { toInertial } from "../../cesium/inertial";
import { coneHalfAngleOf, sensor3dParts, sensorViewPose, type SensorDrawState, type SensorObj, type SensorViewPose } from "../../cesium/sensorDraw";
import { sensorViewShortFovDeg, type Vec3 } from "../../cesium/sensorGeometry";
import { subSatellite } from "../../cesium/swath";
import { createViewer, destroyViewer, latLonGrid, watchRenderFailure, type RenderFailure } from "../../cesium/viewer";
import { satelliteInfo } from "../../data/catalog";
import { useLayout } from "../../stores/layout";
import { useResults } from "../../stores/results";
import { useScenario } from "../../stores/scenario";
import { useTime } from "../../stores/time";
import { parseIsoUtc } from "../../time/parse";
import { markersNear, selectOnClick } from "./pick";
import { DEFAULT_PROPS_3D, props3d, type Props3D } from "./props";
import {
  noteSceneLoaded, notifyScenes, type MouseMode, type Scene3DHandle, type ViewFromToRequest, type ViewFromToResult,
} from "./registry";
import {
  notifySensorViews, type SensorCamera, type SensorHud, type SensorViewDisplay, type SensorViewHandle, type SensorViewResult, type SensorViewUp,
  type SensorViewZoom,
} from "../SensorView/registry";
import { currentSceneUrls, CzmlScene } from "../graphics/sceneSource";
import { Throttle } from "../graphics/throttle";
import { boxRectangle, ZoomBox } from "../graphics/zoomBox";

type FacilityObj = components["schemas"]["FacilityObj"];

/** รัศมีโลกตามแนวศูนย์สูตร (WGS 84) */
const EARTH_RADIUS_M = 6_378_137;
/** Home View: กล้องสูง 4.5 รัศมีโลกเหนือพื้นผิว (ห่างศูนย์กลาง 5.5 รัศมี อยู่นอกวงโคจร MEO ของทุกระบบ) มองลงศูนย์กลางโลก */
export const HOME_ALTITUDE_M = 4.5 * EARTH_RADIUS_M;
/**
 * Zoom To: ตำแหน่งกล้องเทียบกับ object ในกรอบ east-north-up ของมัน (ตั้ง trackingReferenceFrame = ENU เอง: ค่าตั้งต้น AUTODETECT ของ Cesium
 * ใช้กรอบ "north-up" ที่แกน x ชี้ลงโลกกับดาววงโคจรสูง ทำให้ offset เดียวกันมีความหมายต่างกันตามวงโคจร)
 * ดาว: สูงกว่าดาว 10,000 กม. และเยื้องไปทางใต้ 3,000 กม. มองลงเกือบตรง โลกอยู่ด้านหลังดาวในภาพ (ศูนย์กลางโลกห่างแกนภาพราว 12° สำหรับดาว MEO)
 */
const SATELLITE_VIEW_FROM = new Cartesian3(0, -3_000_000, 10_000_000);
const FACILITY_VIEW_FROM = new Cartesian3(0, -1_500_000, 1_500_000);
/** Inertial by Window: ระยะห่างของตัวอย่าง (วินาที) เท่าตัวอย่างใน CZML และความถี่สูงสุดของการคำนวณใหม่ */
const INERTIAL_STEP_S = 300;
const INERTIAL_INTERVAL_MS = 250;
const INERTIAL_BY_WINDOW = "Inertial by Window";
/** Sensor: คำนวณใหม่ไม่เกิน 4 ครั้งต่อวินาทีขณะเวลาเปลี่ยน (เท่า Inertial by Window) */
const SENSOR_INTERVAL_MS = 250;
/** Sensor View: near ของ frustum (เมตร) กล้องอยู่ที่ดาวพอดี (ความเสี่ยง S3) */
const SENSOR_VIEW_NEAR_M = 1;
/** HUD: ชั้นบนสุดที่ไม่มีภาพเกินสัดส่วนนี้ของชิ้นที่ได้ผลแล้ว = "ไม่มีภาพเวลานี้" (imagery spec §5.3) */
const IMAGERY_MISSING_RATIO = 0.5;
/** Sensor View: แสงกลางวัน/กลางคืนเปิดเสมอ ค่าอื่นตามค่าตั้งต้นของหน้าต่าง 3D (P8: ไม่มี 3D Graphics Window Properties ของตัวเอง) */
const SENSOR_VIEW_PROPS: Readonly<Props3D> = { ...DEFAULT_PROPS_3D, enableLighting: true };

/** entity หนึ่งชิ้นของ sensor ในหน้าต่าง 3D: เส้น (วงรอย / Radial Line) หรือจุด (Boresight Marker) */
export type SensorPart =
  | { kind: "line"; positions: Cartesian3[]; arcType: ArcType; color: Color; width: number }
  | { kind: "point"; position: Cartesian3; color: Color; pixelSize: number; outline: Color };

const groundPoint = ([lon, lat]: [number, number]): Cartesian3 => Cartesian3.fromDegrees(lon, lat, 0);

/**
 * ชิ้นที่ต้องวาดของ sensor ตาม id ของ entity: วงรอยตามผิวทรงรี, Radial Lines เป็นเส้นตรงจากตำแหน่งดาว, Boresight Marker เป็นจุดขนาดเท่าจุด IPP
 * ownPath = sensor ของ Sensor View ที่กล้องมองผ่าน (null = หน้าต่าง 3D หลัก): sensor ตัวนั้นไม่วาดอะไรเลย (Radial Lines, วงรอย, Boresight Marker)
 * กล้องตั้งใหม่ทุกครั้งที่เวลาเปลี่ยน แต่กราฟิกของ sensor วาดใหม่ไม่เกินทุก 250 ms วงรอยกับจุดจึงแกว่งรอบวงขอบกรวยบน HUD ตอน animation
 * วงบน HUD คือภาพที่แน่นอนของขอบกรวย (controller ปรับ P7) sensor ตัวอื่นยังวาดครบ
 */
export function sensorPartsOf(states: readonly SensorDrawState[], ownPath: string | null, style: SceneStyle): Map<string, SensorPart> {
  const out = new Map<string, SensorPart>();
  for (const st of states) {
    if (objectPath(st.sensor) === ownPath) continue; // ไม่วาดชิ้นใดของ sensor ที่กล้องมองผ่าน
    const parts = sensor3dParts(st);
    const color = cssColor(parts.color);
    const id = `sensor/${st.sensor.name}`;
    const sat = new Cartesian3(st.pos.x, st.pos.y, st.pos.z);
    if (parts.ring !== null) {
      out.set(`${id}/ring`, { kind: "line", positions: parts.ring.map(groundPoint), arcType: ArcType.GEODESIC, color, width: style.swathEdgeWidth });
    }
    parts.radials.forEach((end, i) => {
      out.set(`${id}/radial/${i}`, { kind: "line", positions: [sat, new Cartesian3(end.x, end.y, end.z)], arcType: ArcType.NONE, color, width: style.swathEdgeWidth });
    });
    if (parts.marker !== null) {
      out.set(`${id}/marker`, { kind: "point", position: groundPoint(parts.marker), color, pixelSize: style.ippPointSize, outline: cssColor(style.pointOutline) });
    }
  }
  return out;
}

type View =
  | { kind: "free" }
  | { kind: "track"; path: string }
  | { kind: "fromTo"; req: ViewFromToRequest }
  | { kind: "sensor"; path: string; up: SensorViewUp; display: SensorViewDisplay; zoom: SensorViewZoom };

/** หน้าต่างที่ใช้ scene นี้: ทะเบียนที่ต้องแจ้งเมื่อสถานะเปลี่ยน และค่าตั้งคงที่ (ไม่ระบุ = อ่าน 3D Graphics Window Properties ของ panel) */
interface SceneOptions {
  notify(): void;
  props?: Readonly<Props3D>;
  /** คลิกซ้ายบนดาวหรือ Facility เลือก object นั้น (หน้าต่าง 3D หลัก; Sensor View ไม่เลือก) */
  pick?: boolean;
}

/** สิ่งที่กล้องของ Sensor View ใช้ ณ เวลาปัจจุบัน */
interface SensorTarget {
  sensor: SensorObj;
  satellite: string;
  state: SensorDrawState;
}

const cartesian = (v: Vec3): Cartesian3 => new Cartesian3(v.x, v.y, v.z);
const tuple = (c: Cartesian3): [number, number, number] => [c.x, c.y, c.z];

const hexOf = (c: Color): string => `#${[c.red, c.green, c.blue].map((v) => Color.floatToByte(v).toString(16).padStart(2, "0")).join("")}`;

function julianOf(iso: string): JulianDate | null {
  const d = parseIsoUtc(iso);
  return d === null ? null : JulianDate.fromDate(d, new JulianDate());
}

/**
 * ปลายทั้งสองของ View From/To: ไม่มีในภาพหรือถูกซ่อน (isShowing เหมือน Zoom To) = notFound; entity เดียวกัน (ดาวกับสำเนาของมันใช้ entity เดียวกัน) = same
 */
export function fromToResult(from: Entity | undefined, to: Entity | undefined): ViewFromToResult {
  if (from === undefined || to === undefined || !from.isShowing || !to.isShowing) return "notFound";
  return from === to ? "same" : "ok";
}

/**
 * สร้าง viewer ใน el แล้วเริ่มภาพของหน้าต่าง panelId ไม่มี WebGL = โยน (ผู้เรียกแสดงข้อความไทยแทน)
 * onRenderStopped: ภาพหยุด (ข้อผิดพลาดตอนวาดหรือ WebGL context หาย) เรียกครั้งเดียว ผู้เรียกแสดงข้อความไทยแทนภาพ
 */
export function mountScene3D(panelId: string, el: HTMLElement, onRenderStopped?: (reason: RenderFailure, error?: unknown) => void): Scene3DHandle {
  return mount(panelId, el, onRenderStopped, { notify: notifyScenes, pick: true }, releaseContextMenu);
}

/**
 * viewer ของหน้าต่าง Sensor View (sensor spec §5.4): scene เดียวกับหน้าต่าง 3D แสงกลางวัน/กลางคืนเปิดเสมอ ไม่อ่าน windowProps
 * แจ้งทะเบียนของ Sensor View (P3) กล้องตาม sensor เมื่อหน้าต่างเรียก viewFromSensor ไม่มี WebGL = โยน
 */
export function mountSensorView(panelId: string, el: HTMLElement, onRenderStopped?: (reason: RenderFailure, error?: unknown) => void): SensorViewHandle {
  return mount(panelId, el, onRenderStopped, { notify: notifySensorViews, props: SENSOR_VIEW_PROPS }, removeViewerPicking);
}

/** prepare: ปรับ viewer ก่อนสร้างภาพ (หน้าต่าง 3D หลัก: คืนเมนูคลิกขวาให้ React, Sensor View: ถอดคลิกและดับเบิลคลิกตั้งต้นของ Viewer) */
function mount(
  panelId: string,
  el: HTMLElement,
  onRenderStopped: ((reason: RenderFailure, error?: unknown) => void) | undefined,
  opts: SceneOptions,
  prepare?: (viewer: Viewer) => void,
): Scene3D {
  const viewer = createViewer(el, "3d");
  try {
    prepare?.(viewer);
    return new Scene3D(panelId, el, viewer, opts, onRenderStopped);
  } catch (e) {
    destroyViewer(viewer);
    throw e;
  }
}

/**
 * หน้าต่าง 3D หลัก: Cesium ตั้ง canvas.oncontextmenu = () => false (ไม่ให้ browser เปิดเมนูของมันเอง) ตัวนี้ทำงานที่ canvas ก่อนที่ event จะขึ้นไปถึงตัวฟังของ React
 * และ Radix ContextMenu ไม่เปิดเมนูเมื่อ event ถูก preventDefault ไปแล้ว เมนูคลิกขวาของดาว (Graphics3D.tsx) จึงไม่เคยเปิดบน canvas จริง ต้องถอดตัวนี้ออก
 * Graphics3D.tsx ยกเลิกเมนูของ browser เองเมื่อคลิกขวาไม่โดน object (Sensor View ไม่มีเมนูคลิกขวา ยังใช้ตัวของ Cesium)
 */
export function releaseContextMenu(viewer: { readonly scene: { readonly canvas: Pick<HTMLCanvasElement, "oncontextmenu"> } }): void {
  viewer.scene.canvas.oncontextmenu = null;
}

/**
 * Sensor View: ถอดคลิกซ้าย (เลือก entity) และดับเบิลคลิก (pickAndTrackObject: ตั้ง trackedEntity หรือ zoomTo บินไปหา entity) ที่ Viewer ของ Cesium
 * ใส่ไว้ใน handler ของมันเอง screenSpaceCameraController.enableInputs = false ไม่ได้ปิดสองอย่างนี้ ดับเบิลคลิกจึงพากล้องหลุดจาก sensor
 * ใช้กับ viewer ของ Sensor View เท่านั้น (หน้าต่าง 3D ยังดับเบิลคลิกตาม object ได้ตามเดิม)
 */
export function removeViewerPicking(viewer: { readonly screenSpaceEventHandler: ScreenSpaceEventHandler }): void {
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK);
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
}

/**
 * วางกล้องของ Sensor View ที่ pose (Earth-fixed): เลิกตาม entity ยกเลิกการบินที่ค้าง และคืน transform เป็น identity ก่อนเสมอ
 * (ไม่งั้น EntityView ตั้งกล้องทับทุกเฟรม หรือการบินดึงกล้องไปที่อื่น และตำแหน่ง Earth-fixed ถูกตีความในกรอบของ entity ที่ตามอยู่)
 * แล้วตั้งตำแหน่ง ทิศ ด้านบน near และ fov (fov null = ภาพไม่มีขนาด: คงค่าเดิม)
 */
export function placeSensorCamera(viewer: { trackedEntity: Entity | undefined; readonly camera: Camera }, pose: SensorViewPose, near: number): void {
  if (viewer.trackedEntity !== undefined) viewer.trackedEntity = undefined;
  const camera = viewer.camera;
  camera.cancelFlight();
  if (!Matrix4.equals(camera.transform, Matrix4.IDENTITY)) camera.lookAtTransform(Matrix4.IDENTITY);
  camera.position = cartesian(pose.position);
  camera.direction = cartesian(pose.direction);
  camera.up = cartesian(pose.up);
  camera.right = Cartesian3.cross(camera.direction, camera.up, new Cartesian3());
  const frustum = camera.frustum;
  if (frustum instanceof PerspectiveFrustum) {
    frustum.near = near;
    if (pose.fovDeg !== null) frustum.fov = CesiumMath.toRadians(pose.fovDeg);
  }
}

class Scene3D implements Scene3DHandle, SensorViewHandle {
  private readonly czml: CzmlScene;
  private destroyed = false;
  private frames = 0;
  private view: View = { kind: "free" };
  private mode: MouseMode = "grab";
  private props: Props3D;
  private grid: ImageryLayer | null = null;
  private readonly offs: (() => void)[] = [];
  private readonly inertialPaths = new Map<string, Entity>();
  private readonly inertialThrottle = new Throttle(INERTIAL_INTERVAL_MS, () => this.drawInertial());
  /** entity ของ sensor ที่วาดอยู่ใน viewer.entities ตาม id */
  private readonly sensorEntities = new Map<string, Entity>();
  private readonly sensorThrottle = new Throttle(SENSOR_INTERVAL_MS, () => this.drawSensors());
  private readonly handler: ScreenSpaceEventHandler;
  private readonly zoom: ZoomBox;
  /** ตำแหน่งที่กดปุ่มซ้ายในโหมด Grab Globe ค้างอยู่ (null = ไม่ได้กดอยู่) ไว้ดูว่าตอนปล่อยเป็นคลิกหรือลาก */
  private pressAt: Cartesian2 | null = null;
  private icrfPreloaded = false;
  /** Sensor View: กล้องตั้งตาม sensor ณ เวลาปัจจุบันแล้ว (false = ไม่มีตำแหน่ง) */
  private sensorCameraSet = false;
  /** Sensor View: fov และ near ของ frustum ก่อนเข้าโหมด sensor (คืนตอนออก) */
  private savedFrustum: { fov: number | undefined; near: number } | null = null;

  constructor(
    readonly panelId: string,
    private readonly el: HTMLElement,
    private readonly viewer: Viewer,
    private readonly opts: SceneOptions,
    onRenderStopped?: (reason: RenderFailure, error?: unknown) => void,
  ) {
    const scene = viewer.scene;
    scene.globe.baseColor = Color.BLACK; // ด้านกลางคืนที่ภาพโลกจางลง (Ambient Level) จางเป็นดำ ไม่ใช่สีน้ำเงินตั้งต้นของ Cesium
    const idle = skipIdleDisplayUpdates(viewer);
    this.offs.push(() => idle.dispose()); // คืน update เดิมของ dataSourceDisplay ก่อน viewer ถูกทำลาย
    this.czml = new CzmlScene(viewer, { window: "3D", adopted: (_ds, fromScene) => this.adopted(fromScene), changed: opts.notify });
    this.offs.push(scene.postRender.addEventListener(() => void this.frames++));
    this.props = opts.props ?? props3d(useLayout.getState().windowProps[panelId]);
    this.applyProps();
    this.offs.push(attachImageryLayers(viewer)); // หลังภาพฐานและเส้น Lat/Lon: ชั้น GIBS อยู่ระหว่างสองอย่างนี้
    // โหมด Camera: data source ที่เพิ่มเข้ามา (CZML ชุดใหม่ก่อน adopted) ซ่อนทันที ไม่รอ restyle
    this.offs.push(viewer.dataSources.dataSourceAdded.addEventListener((_c: unknown, ds: { show: boolean }) => {
      if (this.cameraDisplay()) ds.show = false;
    }));

    this.zoom = new ZoomBox(el);
    this.handler = new ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => this.dragStart(e.position), ScreenSpaceEventType.LEFT_DOWN);
    this.handler.setInputAction((e: ScreenSpaceEventHandler.MotionEvent) => this.dragMove(e.endPosition), ScreenSpaceEventType.MOUSE_MOVE);
    this.handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => this.dragEnd(e.position), ScreenSpaceEventType.LEFT_UP);

    this.offs.push(bindClock(viewer, () => this.onTime()));
    this.offs.push(
      useScenario.subscribe((s, prev) => {
        // เปิด scenario ใหม่ = มุมมองตั้งต้นเหนือ Facility ของมัน (Sensor View คงล็อกที่ sensor: หน้าต่างถูกแทนด้วย workbook ของ scenario ใหม่)
        if (s.name !== prev.name && this.view.kind !== "sensor") this.homeView();
        if (s.doc !== prev.doc || s.catalog !== prev.catalog) this.restyle();
      }),
    );
    this.offs.push(
      useResults.subscribe((s, prev) => {
        if (s.info !== prev.info || s.prnByNorad !== prev.prnByNorad) this.refreshScene();
      }),
    );
    this.offs.push(
      useLayout.subscribe((s, prev) => {
        if (opts.props !== undefined || s.windowProps[panelId] === prev.windowProps[panelId]) return;
        const before = this.props;
        this.props = props3d(s.windowProps[panelId]);
        this.applyProps();
        if (before.labelDeclutter !== this.props.labelDeclutter) this.restyle();
      }),
    );
    this.homeView();
    this.refreshScene();
    // ฟังท้ายสุด: constructor ที่โยนก่อนถึงตรงนี้ไม่ทิ้งตัวฟังไว้ให้ loseContext ของ destroyViewer ใน mountScene3D ยิงใส่ (ถอดใน destroy() ก่อน destroyViewer)
    this.offs.push(watchRenderFailure(viewer, (reason, error) => onRenderStopped?.(reason, error)));
  }

  // ---------- data source ----------

  /** data source ที่ใช้อยู่ (CzmlScene สลับให้) */
  private get ds() {
    return this.czml.ds;
  }

  /** โหลดผลที่ใช้ได้ตอนนี้ (currentSceneUrls) URL เท่าเดิม: manifest (NORAD → PRN) มาทีหลังสถานะ หรือ doc เปลี่ยน: entity เดิม กราฟิกใหม่ */
  private refreshScene(): void {
    if (this.destroyed) return;
    if (!this.czml.update(currentSceneUrls(useResults.getState()))) this.restyle();
  }

  /** ได้ data source ใหม่ (ตัวเก่าถูกเอาออกแล้ว): ตั้งกราฟิกและกล้องตามเดิม (entity เป็นตัวใหม่) */
  private adopted(fromScene: boolean): void {
    if (this.destroyed) return;
    this.restyle();
    this.restoreView();
    if (fromScene) noteSceneLoaded();
  }

  sceneFailed(): boolean {
    return this.czml.failed();
  }

  /** ชนิดหน้าต่าง ดาวที่ซ่อนตามธง (W9) และ NORAD → PRN: ใช้ตั้งกราฟิก (applyGraphics) และหาดาวแม่ของ sensor (sensorStatesAt) */
  private sceneCtx(): SensorCtx {
    return { mode: "3d", prnByNorad: useResults.getState().prnByNorad, isHidden: (norad) => satelliteInfo(norad)?.hidden ?? false };
  }

  /** Facility ที่ขาด + กราฟิกตาม doc ทั้งหมด (ไม่โหลด CZML ใหม่) แล้ววาดเส้นทาง Inertial by Window และ sensor ใหม่ทันที (ตาม entity.show ที่เพิ่งตั้ง) */
  private restyle(): void {
    const ds = this.ds;
    if (ds === null || this.destroyed) return;
    const { doc } = useScenario.getState();
    ensureFacilities(ds.entities, doc);
    applyGraphics(ds, doc, { ...this.sceneCtx(), declutter: this.props.labelDeclutter });
    this.hideCameraSatellite();
    this.updateInertial(true);
    this.updateSensors(true);
    this.updateSensorCamera();
    if (this.view.kind === "sensor") this.applyDisplay();
    this.viewer.scene.requestRender();
    if (this.view.kind === "sensor") this.opts.notify(); // ข้อความบนภาพอ่านใหม่ (doc หรือ entity เปลี่ยนโดยที่เวลาไม่เปลี่ยน)
  }

  /** Sensor View ในโหมด Camera */
  private cameraDisplay(): boolean {
    return this.view.kind === "sensor" && this.view.display === "camera";
  }

  /**
   * show ของทุก data source และของ viewer.entities ใน viewer นี้: โหมด Camera = false, อื่น ๆ = true (ไม่มีโค้ดอื่นตั้งค่านี้ จึงไม่ต้องจำค่าเดิม)
   * การแสดงของแต่ละ entity (ตาม doc) อยู่ที่ entity.show ซึ่ง restyle ตั้ง ไม่ถูกแตะที่นี่
   */
  private applyDisplay(): void {
    const show = !this.cameraDisplay();
    const { dataSources, entities } = this.viewer;
    for (let i = 0; i < dataSources.length; i++) {
      const ds = dataSources.get(i);
      if (ds.show !== show) ds.show = show;
    }
    if (entities.show !== show) entities.show = show;
  }

  private entityForPath(path: string): Entity | undefined {
    const obj = useScenario.getState().doc?.objects.find((o) => objectPath(o) === path);
    const id = obj === undefined ? undefined : entityIdFor(obj, useResults.getState().prnByNorad);
    return id === undefined ? undefined : this.ds?.entities.getById(id);
  }

  private entityByName(name: string): Entity | undefined {
    const id = entityIdForName(name, useScenario.getState().doc, useResults.getState().prnByNorad);
    return id === undefined ? undefined : this.ds?.entities.getById(id);
  }

  // ---------- เวลา ----------

  private onTime(): void {
    if (this.view.kind === "fromTo") this.updateFromTo();
    this.updateSensorCamera();
    this.updateInertial(false);
    this.updateSensors(false);
  }

  // ---------- Inertial by Window ----------

  /** ดาวที่ตั้ง Inertial by Window และแสดงอยู่ → entity + object ของมัน */
  private inertialTargets(): Map<string, { entity: Entity; obj: SceneObject }> {
    const out = new Map<string, { entity: Entity; obj: SceneObject }>();
    const ds = this.ds;
    const doc = useScenario.getState().doc;
    if (ds === null || doc === null) return out;
    const prnByNorad = useResults.getState().prnByNorad;
    for (const obj of doc.objects) {
      if (obj.class !== "Satellite") continue;
      const g3 = (obj as { graphics3d?: { orbit_system?: string } | null }).graphics3d;
      if (g3?.orbit_system !== INERTIAL_BY_WINDOW) continue;
      const id = entityIdFor(obj, prnByNorad);
      const entity = id === undefined ? undefined : ds.entities.getById(id);
      if (id === undefined || entity === undefined || !entity.show || out.has(id)) continue;
      out.set(id, { entity, obj });
    }
    return out;
  }

  /** ตำแหน่ง FIXED ณ เวลา t ± ครึ่งคาบ หมุนเป็นกรอบ inertial ที่ตรึงไว้ ณ t (มีตัวอย่างที่ t พอดี: เส้นผ่านจุดของดาว) */
  private inertialOrbit(entity: Entity, time: JulianDate): Cartesian3[] {
    const period = entityPeriod(entity);
    const position = entity.position;
    if (period === null || position === undefined) return [];
    const half = period / 2;
    const n = Math.floor(half / INERTIAL_STEP_S);
    const offsets = Array.from({ length: 2 * n + 1 }, (_, i) => (i - n) * INERTIAL_STEP_S);
    if (n * INERTIAL_STEP_S < half) {
      offsets.unshift(-half);
      offsets.push(half);
    }
    const samples: { t: JulianDate; p: Cartesian3 }[] = [];
    for (const offset of offsets) {
      const t = JulianDate.addSeconds(time, offset, new JulianDate());
      if (entity.availability !== undefined && !entity.availability.contains(t)) continue;
      const p = position.getValueInReferenceFrame(t, ReferenceFrame.FIXED, new Cartesian3());
      if (p !== undefined) samples.push({ t, p });
    }
    return toInertial(samples, time);
  }

  /** วาดเส้นทาง Inertial by Window ใหม่ (force = ทันที, ไม่งั้นไม่เกิน 4 ครั้งต่อวินาทีโดยรอบสุดท้ายตามมาเสมอ) */
  private updateInertial(force: boolean): void {
    if (this.destroyed) return;
    if (force) this.inertialThrottle.flush();
    else this.inertialThrottle.request();
  }

  private drawInertial(): void {
    if (this.destroyed) return;
    const targets = this.inertialTargets();
    const entities = this.viewer.entities;
    const time = this.viewer.clock.currentTime;
    const doc = useScenario.getState().doc;
    entities.suspendEvents();
    try {
      for (const [id, path] of this.inertialPaths) {
        if (targets.has(id)) continue;
        entities.remove(path);
        this.inertialPaths.delete(id);
      }
      for (const [id, { entity, obj }] of targets) {
        const positions = doc === null ? [] : this.inertialOrbit(entity, time);
        let path = this.inertialPaths.get(id);
        if (positions.length < 2 || doc === null) {
          if (path !== undefined) {
            entities.remove(path);
            this.inertialPaths.delete(id);
          }
          continue;
        }
        if (path === undefined) {
          path = entities.add({ id: `inertial/${id}`, polyline: new PolylineGraphics({ arcType: ArcType.NONE }) });
          this.inertialPaths.set(id, path);
        }
        const g = graphicsFor(obj, doc, { hidden: false, mode: "3d", system: id.slice(4, 5) });
        const color = Color.fromCssColorString(g.color) ?? Color.WHITE;
        const dash = dashFor(g.lineStyle);
        const polyline = path.polyline!;
        polyline.positions = new ConstantProperty(positions);
        polyline.width = new ConstantProperty(g.lineWidth);
        polyline.material =
          dash === null ? new ColorMaterialProperty(color) : new PolylineDashMaterialProperty({ color, dashPattern: dash.pattern, dashLength: dash.length });
      }
    } finally {
      entities.resumeEvents();
    }
    this.viewer.scene.requestRender();
  }

  // ---------- Sensor ----------

  /** วาด sensor ใหม่ (force = ทันที, ไม่งั้นไม่เกิน 4 ครั้งต่อวินาทีโดยรอบสุดท้ายตามมาเสมอ) */
  private updateSensors(force: boolean): void {
    if (this.destroyed) return;
    if (force) this.sensorThrottle.flush();
    else this.sensorThrottle.request();
  }

  /** ชิ้นที่ต้องวาดของทุก sensor ณ เวลาปัจจุบัน ตาม id ของ entity (sensor ที่ซ่อน ดาวแม่ที่ซ่อนหรือไม่มีตำแหน่ง ไม่มีชิ้นใด: sensorStatesAt) */
  private sensorParts(): Map<string, SensorPart> {
    const ds = this.ds;
    if (ds === null) return new Map();
    const states = sensorStatesAt(useScenario.getState().doc, ds.entities, this.sceneCtx(), this.viewer.clock.currentTime);
    return sensorPartsOf(states, this.view.kind === "sensor" ? this.view.path : null, sceneStyle());
  }

  private drawSensors(): void {
    if (this.destroyed) return;
    const parts = this.sensorParts();
    if (parts.size === 0 && this.sensorEntities.size === 0) return; // scenario ที่ไม่มี sensor (หรือไม่มีตัวที่วาด) ไม่มีอะไรเปลี่ยน
    const entities = this.viewer.entities;
    entities.suspendEvents();
    try {
      for (const [id, entity] of this.sensorEntities) {
        if (parts.has(id)) continue;
        entities.remove(entity);
        this.sensorEntities.delete(id);
      }
      for (const [id, part] of parts) {
        let entity = this.sensorEntities.get(id); // id บอกชนิดของชิ้นอยู่แล้ว: entity เดิมเป็นชนิดเดียวกันเสมอ
        if (entity === undefined) {
          entity = entities.add(part.kind === "line" ? { id, polyline: new PolylineGraphics() } : { id, point: new PointGraphics() });
          this.sensorEntities.set(id, entity);
        }
        if (part.kind === "line") {
          const polyline = entity.polyline!;
          polyline.positions = new ConstantProperty(part.positions);
          polyline.arcType = new ConstantProperty(part.arcType);
          polyline.width = new ConstantProperty(part.width);
          polyline.material = new ColorMaterialProperty(part.color);
        } else {
          const point = entity.point!;
          entity.position = new ConstantPositionProperty(part.position);
          point.pixelSize = new ConstantProperty(part.pixelSize);
          point.color = new ConstantProperty(part.color);
          point.outlineColor = new ConstantProperty(part.outline);
          point.outlineWidth = new ConstantProperty(1);
        }
      }
    } finally {
      entities.resumeEvents();
    }
    this.viewer.scene.requestRender();
  }

  // ---------- ค่าตั้งของหน้าต่าง ----------

  /**
   * 3D Graphics Window Properties → Cesium (ตัวที่ใกล้ที่สุดที่มีในโหมดออฟไลน์):
   * - Enable Lighting → globe.enableLighting (แสงอาทิตย์ตามเวลา: กลางวัน/กลางคืน)
   * - Sun Level → scene.light.intensity = ระดับ/100 (Cesium บีบสีแสงที่เกิน 1 ลงมาที่ 1: 100% สว่างเต็มเท่าค่าตั้งต้นของ Cesium) มีผลเมื่อเปิดแสง
   * - Ambient Level → nightAlpha ของภาพโลก = ระดับ/100 บนพื้นสีดำ: ทรงรีเรียบไม่มี normal ของ terrain Cesium จึงใช้ ambient คงที่ 0.3 ใน shader
   *   ความสว่างของภาพด้านกลางคืนจึงเป็นตัวปรับที่ใกล้ที่สุด มีผลเมื่อเปิดแสง
   * - Night Lights Level → ภาพแสงไฟเมือง (Black Marble) ของ Cesium อยู่บน Cesium ion ต้องต่อเน็ต ไม่มีในโหมดออฟไลน์: ค่าเก็บไว้แต่ไม่มีผลต่อภาพ
   *   (หน้าต่าง Properties แสดงหมายเหตุไทย)
   * - Lat/Lon Lines → ชั้นภาพ GridImageryProvider (เส้นทุก 30° ที่ระยะไกล ถี่ขึ้นเมื่อซูม สีจาก --scene-grid-line)
   * - Label Declutter → ย่อและจางป้ายชื่อที่อยู่ไกล (applyGraphics) Cesium ไม่มีการหลบป้ายที่ทับกัน
   * - Show Time → ข้อความเวลาบนภาพ (Graphics3D.tsx)
   */
  private applyProps(): void {
    const { scene, imageryLayers } = this.viewer;
    const p = this.props;
    scene.globe.enableLighting = p.enableLighting;
    scene.light.intensity = p.sunLevel / 100;
    const base = imageryLayers.length > 0 ? imageryLayers.get(0) : undefined;
    if (base !== undefined) {
      base.dayAlpha = 1;
      base.nightAlpha = p.ambientLevel / 100;
    }
    if (p.latLonLines && this.grid === null) {
      this.grid = imageryLayers.addImageryProvider(latLonGrid(sceneStyle().gridLine));
    } else if (!p.latLonLines && this.grid !== null) {
      imageryLayers.remove(this.grid, true);
      this.grid = null;
    }
    scene.requestRender();
  }

  // ---------- กล้อง ----------

  /** ปล่อยกล้องจากการตาม object, จาก transform ของ View From/To และจากโหมด sensor (คืนการลาก/หมุน/ซูม fov, near, จุดและป้ายของดาวแม่) */
  private release(): void {
    const wasSensor = this.view.kind === "sensor";
    this.viewer.trackedEntity = undefined;
    this.view = { kind: "free" };
    this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    if (wasSensor) {
      this.lockCamera(false);
      this.applyDisplay(); // ไม่ใช่โหมด sensor แล้ว: คืน show ของคอลเลกชัน
      this.restyle();
    }
  }

  homeView(): void {
    if (this.destroyed) return;
    this.release();
    const facility = useScenario.getState().doc?.objects.find((o): o is FacilityObj & SceneObject => o.class === "Facility");
    const lon = facility?.position.lon_deg ?? 0;
    const lat = facility?.position.lat_deg ?? 0;
    this.viewer.camera.setView({ destination: Cartesian3.fromDegrees(lon, lat, HOME_ALTITUDE_M) });
    this.viewer.scene.requestRender();
  }

  zoomTo(path: string): boolean {
    if (this.destroyed) return false;
    const entity = this.entityForPath(path);
    if (entity === undefined || !entity.isShowing) return false;
    this.release();
    this.view = { kind: "track", path };
    this.track(entity, path);
    return true;
  }

  private track(entity: Entity, path: string): void {
    entity.viewFrom = new ConstantProperty(path.startsWith("*/Facility/") ? FACILITY_VIEW_FROM : SATELLITE_VIEW_FROM);
    entity.trackingReferenceFrame = TrackingReferenceFrame.ENU;
    this.viewer.trackedEntity = entity;
    this.viewer.scene.requestRender();
  }

  viewFromTo(req: ViewFromToRequest): ViewFromToResult {
    if (this.destroyed) return "notFound";
    const result = fromToResult(this.entityForPath(req.from), this.entityForPath(req.to));
    if (result !== "ok") return result;
    this.release();
    this.view = { kind: "fromTo", req };
    if (req.frame === "inertial") this.preloadIcrf();
    this.updateFromTo();
    return "ok";
  }

  /** ข้อมูลแกน ICRF (Assets/IAU2006_XYS จาก /cesium ในเครื่อง) ของช่วงวิเคราะห์ ระหว่างโหลดใช้แกน TEME แทน */
  private preloadIcrf(): void {
    if (this.icrfPreloaded) return;
    this.icrfPreloaded = true;
    const { periodStart, periodStop } = useTime.getState();
    const interval = new TimeInterval({ start: JulianDate.fromDate(periodStart), stop: JulianDate.fromDate(periodStop) });
    Transforms.preloadIcrfFixed(interval).then(
      () => this.updateFromTo(),
      () => undefined, // โหลดไม่ได้: ใช้ TEME ต่อไป
    );
  }

  /** กล้องอยู่ที่ตำแหน่ง From มองไปที่ To (Fixed: แกนของโลก, Inertial: แกน ICRF) */
  private updateFromTo(): void {
    if (this.destroyed || this.view.kind !== "fromTo") return;
    const { req } = this.view;
    const from = this.entityForPath(req.from);
    const to = this.entityForPath(req.to);
    const time = this.viewer.clock.currentTime;
    const p1 = from?.position?.getValueInReferenceFrame(time, ReferenceFrame.FIXED, new Cartesian3());
    const p2 = to?.position?.getValueInReferenceFrame(time, ReferenceFrame.FIXED, new Cartesian3());
    if (p1 === undefined || p2 === undefined) return;
    const offset = Cartesian3.subtract(p1, p2, new Cartesian3());
    if (Cartesian3.magnitude(offset) < 1) return;
    const camera = this.viewer.camera;
    if (req.frame === "inertial") {
      const icrfToFixed = Transforms.computeIcrfToFixedMatrix(time, new Matrix3()) ?? Transforms.computeTemeToPseudoFixedMatrix(time, new Matrix3());
      const local = Matrix3.multiplyByVector(Matrix3.transpose(icrfToFixed, new Matrix3()), offset, new Cartesian3());
      camera.lookAtTransform(Matrix4.fromRotationTranslation(icrfToFixed, p2, new Matrix4()), local);
    } else {
      camera.lookAtTransform(Matrix4.fromTranslation(p2, new Matrix4()), offset);
    }
    this.viewer.scene.requestRender();
  }

  /** หลังโหลด data source ใหม่ (entity เป็นตัวใหม่): ตามหรือมองจาก object เดิมต่อ */
  private restoreView(): void {
    const view = this.view;
    if (view.kind === "track") {
      const entity = this.entityForPath(view.path);
      if (entity !== undefined) this.track(entity, view.path);
      else this.release();
    } else if (view.kind === "fromTo") {
      this.updateFromTo();
    } else if (view.kind === "sensor") {
      this.updateSensorCamera();
    }
  }

  // ---------- Sensor View ----------

  viewFromSensor(path: string, up: SensorViewUp, display: SensorViewDisplay, zoom: SensorViewZoom): SensorViewResult {
    if (this.destroyed) return "notFound";
    if (this.view.kind !== "sensor") {
      this.release();
      this.lockCamera(true);
    }
    // จำ path ไว้แม้ doc ยังไม่มี sensor นี้ (เช่น Rename ที่มาถึงก่อน doc ใหม่): กล้องตามเองเมื่อ doc มี
    this.view = { kind: "sensor", path, up, display, zoom };
    this.applyDisplay(); // ก่อน restyle: กลับเป็น Sensor แล้ว restyle วาด sensor และ Inertial by Window ใหม่ตาม entity.show ของ doc
    this.restyle();
    if (this.ds === null) this.updateSensorCamera(); // ยังไม่มี data source (restyle ไม่ทำงาน): กล้องรอ adopted
    return this.sensorObj(path) === undefined ? "notFound" : "ok";
  }

  /** ล็อกกล้อง (โหมด sensor: ปิดเมาส์ near = 1 m) หรือคืนค่าเดิม */
  private lockCamera(lock: boolean): void {
    const frustum = this.viewer.camera.frustum;
    this.viewer.scene.screenSpaceCameraController.enableInputs = !lock;
    if (lock) {
      if (frustum instanceof PerspectiveFrustum && this.savedFrustum === null) {
        this.savedFrustum = { fov: frustum.fov, near: frustum.near };
        frustum.near = SENSOR_VIEW_NEAR_M;
      }
    } else {
      if (frustum instanceof PerspectiveFrustum && this.savedFrustum !== null) {
        frustum.fov = this.savedFrustum.fov;
        frustum.near = this.savedFrustum.near;
      }
      this.savedFrustum = null;
      this.sensorCameraSet = false;
    }
  }

  private sensorObj(path: string): SensorObj | undefined {
    return useScenario.getState().doc?.objects.find((o): o is SensorObj & SceneObject => o.class === "Sensor" && objectPath(o) === path);
  }

  /**
   * sensor ของโหมด sensor และสถานะของมัน ณ เวลาปัจจุบันจากตำแหน่งของ entity ดาวแม่ (ดาวที่ซ่อนอยู่ก็ใช้ได้: กล้องไม่ขึ้นกับการแสดงของดาว)
   * ไม่มี sensor, ไม่มี entity ของดาวแม่ (ไม่มีผล) หรือไม่มีตำแหน่ง ณ เวลานี้ (นอกช่วง) = null
   */
  private sensorTarget(): SensorTarget | null {
    if (this.view.kind !== "sensor") return null;
    const sensor = this.sensorObj(this.view.path);
    if (sensor === undefined) return null;
    const entity = this.entityForPath(sensor.parent);
    const state = entity === undefined ? null : sensorStateAt(sensor, entity, this.viewer.clock.currentTime);
    return state === null ? null : { sensor, satellite: sensor.parent.split("/").at(-1) ?? "", state };
  }

  /** P7: ดาวแม่อยู่ตรงตำแหน่งกล้อง ซ่อนจุดและป้ายของมัน (เส้นวงโคจรยังอยู่) applyGraphics สร้างจุดและป้ายใหม่ทุกครั้ง จึงเรียกต่อจากมันเสมอ */
  private hideCameraSatellite(): void {
    if (this.view.kind !== "sensor") return;
    const parent = this.sensorObj(this.view.path)?.parent;
    const entity = parent === undefined ? undefined : this.entityForPath(parent);
    if (entity?.point !== undefined) entity.point.show = new ConstantProperty(false);
    if (entity?.label !== undefined) entity.label.show = new ConstantProperty(false);
  }

  /** กล้องของโหมด sensor ณ เวลาปัจจุบัน (spec §5.4) ไม่มีตำแหน่ง = ไม่ขยับกล้อง (หน้าต่างแสดงข้อความแทนภาพ) */
  private updateSensorCamera(): void {
    if (this.destroyed || this.view.kind !== "sensor") return;
    const target = this.sensorTarget();
    this.sensorCameraSet = target !== null;
    if (target === null) {
      this.viewer.scene.requestRender();
      return;
    }
    // ภาพขนาดศูนย์ (แท็บที่ยุบ หรือยังไม่ได้วางในหน้า): pose ไม่มี fov จนกว่าภาพจะมีขนาด (คงค่าเดิมไว้)
    const { clientWidth: width, clientHeight: height } = this.viewer.scene.canvas;
    placeSensorCamera(this.viewer, sensorViewPose(target.state, this.view.up, width / height, this.view.zoom), SENSOR_VIEW_NEAR_M);
    this.viewer.scene.requestRender();
  }

  sensorHud(): SensorHud | null {
    if (this.destroyed) return null;
    const target = this.sensorTarget();
    if (target === null) return null;
    const sub = subSatellite(target.state.pos);
    const coneHalfAngle = coneHalfAngleOf(target.sensor);
    const zoom = this.view.kind === "sensor" ? this.view.zoom : 1;
    const top = imageryStatus(this.viewer).topLayer;
    return {
      sensor: target.sensor.name, satellite: target.satellite, lat: sub.lat, lon: sub.lon, altKm: sub.altKm, coneHalfAngle,
      fovDeg: sensorViewShortFovDeg(coneHalfAngle, zoom), zoom,
      imagery: top === null ? null : { title: top.title, label: top.label, missing: top.missingRatio > IMAGERY_MISSING_RATIO },
    };
  }

  sensorCamera(): SensorCamera | null {
    if (this.destroyed || this.view.kind !== "sensor" || !this.sensorCameraSet) return null;
    const camera = this.viewer.camera;
    const frustum = camera.frustum;
    if (!(frustum instanceof PerspectiveFrustum) || frustum.fov === undefined) return null;
    return {
      position: tuple(camera.positionWC), direction: tuple(camera.directionWC), up: tuple(camera.upWC), fovDeg: CesiumMath.toDegrees(frustum.fov),
      display: this.view.display, zoom: this.view.zoom, visibleEntityCount: this.visibleEntityCount(),
    };
  }

  /** จำนวน entity ที่แสดงอยู่จริง (isShowing: รวม show ของคอลเลกชันและ data source) ในทุก data source และ viewer.entities ของ viewer นี้ */
  private visibleEntityCount(): number {
    const { dataSources, entities } = this.viewer;
    const collections = [entities, ...Array.from({ length: dataSources.length }, (_, i) => dataSources.get(i).entities)];
    let n = 0;
    for (const c of collections) for (const e of c.values) if (e.isShowing) n++;
    return n;
  }

  // ---------- Grab Globe / Zoom In ----------

  mouseMode(): MouseMode {
    return this.mode;
  }

  setMouseMode(mode: MouseMode): void {
    if (this.destroyed || this.mode === mode) return;
    this.mode = mode;
    const grab = mode === "grab";
    const c = this.viewer.scene.screenSpaceCameraController;
    c.enableRotate = grab;
    c.enableTranslate = grab;
    c.enableTilt = grab;
    c.enableLook = grab;
    this.el.classList.toggle("gfx-zoom-mode", !grab);
    if (grab) this.zoom.cancel();
    this.opts.notify();
  }

  private dragStart(at: Cartesian2): void {
    if (this.mode === "zoomIn") this.zoom.start(at);
    else this.pressAt = Cartesian2.clone(at);
  }

  private dragMove(at: Cartesian2): void {
    this.zoom.move(at);
  }

  private dragEnd(at: Cartesian2): void {
    const box = this.zoom.end(at);
    if (box === null) {
      this.clicked(at);
      return;
    }
    this.pressAt = null;
    this.zoomBox(box.a, box.b);
    this.setMouseMode("grab");
  }

  /** ปล่อยปุ่มซ้ายโดยไม่ได้ลากกรอบ Zoom In: ถ้าเป็นคลิก (เมาส์เลื่อนไม่เกิน 4 px) เลือก object ใต้เมาส์ */
  private clicked(at: Cartesian2): void {
    const down = this.pressAt;
    this.pressAt = null;
    if (down !== null && this.opts.pick === true && this.mode === "grab") selectOnClick(down, at, (x, y) => this.pathAt(x, y));
  }

  /** กรอบเล็กกว่า 4 px = คลิก: ซูมเข้าครึ่งหนึ่งของความสูงกล้อง ไม่งั้นบินไปที่พื้นที่บนโลกในกรอบ (มุมที่ไม่ตกบนโลกถูกข้าม) */
  private zoomBox(a: Cartesian2, b: Cartesian2): void {
    const camera = this.viewer.camera;
    this.release();
    const rect = boxRectangle(camera, this.viewer.scene.globe.ellipsoid, a, b);
    if (rect !== null) camera.flyTo({ destination: rect, duration: 0.8 });
    else camera.zoomIn(camera.positionCartographic.height / 2);
    this.viewer.scene.requestRender();
  }

  // ---------- เลือก object ด้วยเมาส์ ----------

  pathAt(x: number, y: number): string | null {
    const doc = useScenario.getState().doc;
    const entities = this.ds?.entities.values;
    if (this.destroyed || doc === null || entities === undefined) return null;
    const prnByNorad = useResults.getState().prnByNorad;
    const occluder = this.occluder();
    // เส้น access และ sensor ไม่ใช่ object ที่เลือกได้ (ดาวหรือ Facility เท่านั้น)
    const markers = entities
      .filter((entity) => entity.id.startsWith("sat/") || entity.id.startsWith("fac/"))
      .map((entity) => ({ id: entity.id, at: this.windowPosition(entity, occluder) }));
    for (const id of markersNear(markers, { x, y })) {
      const path = pathForEntityId(id, doc, prnByNorad);
      if (path !== null) return path;
    }
    return null;
  }

  /** ขอบฟ้าของโลกจากตำแหน่งกล้องตอนนี้ (ของที่อยู่หลังโลกมองไม่เห็น) */
  private occluder(): EllipsoidalOccluder {
    return new EllipsoidalOccluder(this.viewer.scene.globe.ellipsoid, this.viewer.camera.positionWC);
  }

  /** ตำแหน่ง (พิกเซลใน canvas) ของ entity ในภาพตอนนี้ ไม่แสดง ไม่มีตำแหน่ง อยู่หลังกล้อง อยู่หลังโลก (ขอบฟ้า) หรือนอกภาพ = null */
  private windowPosition(entity: Entity, occluder: EllipsoidalOccluder = this.occluder()): Cartesian2 | null {
    if (!entity.isShowing) return null;
    const scene = this.viewer.scene;
    const camera = this.viewer.camera;
    const fixed = fixedPositionAt(entity, this.viewer.clock.currentTime);
    if (fixed === null) return null;
    const p = cartesian(fixed);
    const ahead = Cartesian3.dot(camera.directionWC, Cartesian3.subtract(p, camera.positionWC, new Cartesian3())) > 0;
    if (!ahead || !occluder.isPointVisible(p)) return null;
    const at = SceneTransforms.worldToWindowCoordinates(scene, p);
    const { clientWidth: width, clientHeight: height } = scene.canvas;
    return at === undefined || at.x < 0 || at.y < 0 || at.x > width || at.y > height ? null : at;
  }

  // ---------- อื่น ๆ ----------

  resize(): void {
    if (this.destroyed) return;
    this.viewer.resize();
    this.updateSensorCamera(); // Sensor View: fov ตามสัดส่วนใหม่ของภาพ
    this.viewer.scene.requestRender();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.czml.dispose();
    for (const off of this.offs) off();
    this.inertialThrottle.dispose();
    this.sensorThrottle.dispose();
    this.handler.destroy();
    this.zoom.destroy();
    this.inertialPaths.clear();
    this.sensorEntities.clear();
    destroyViewer(this.viewer); // ทำลาย data source, entity, primitive และคืน WebGL context ของหน้าต่างนี้ทันที
  }

  // ---------- window.__gnssStudioTest ----------

  entityPositionEcef(name: string, iso?: string): [number, number, number] | null {
    const time = iso === undefined ? this.viewer.clock.currentTime : julianOf(iso);
    const position = this.entityByName(name)?.position;
    if (time === null || position === undefined) return null;
    const p = position.getValueInReferenceFrame(time, ReferenceFrame.FIXED, new Cartesian3());
    return p === undefined ? null : [p.x, p.y, p.z];
  }

  entityColor(name: string): string | null {
    const color = this.entityByName(name)?.point?.color?.getValue(this.viewer.clock.currentTime) as Color | undefined;
    return color === undefined ? null : hexOf(color);
  }

  labelShown(name: string): boolean | null {
    const entity = this.entityByName(name);
    if (entity === undefined) return null;
    const label = entity.label;
    return entity.isShowing && label !== undefined && (label.show?.getValue(this.viewer.clock.currentTime) ?? true) === true;
  }

  entityScreenPosition(name: string): [number, number] | null {
    const entity = this.entityByName(name);
    const at = entity === undefined ? null : this.windowPosition(entity);
    return at === null ? null : [at.x, at.y];
  }

  frameCount(): number {
    return this.frames;
  }

  sensorFootprintPoints(name: string): number | null {
    const ring = this.sensorEntities.get(`sensor/${name}/ring`);
    const positions = ring?.polyline?.positions?.getValue(this.viewer.clock.currentTime) as Cartesian3[] | undefined;
    return ring === undefined || !ring.isShowing || positions === undefined ? null : positions.length;
  }
}
