// ภาพในหน้าต่าง 3D หนึ่งบาน (spec §9.1–§9.2): viewer + CzmlDataSource ตัวเดียว + การตามเวลา/scenario/ผลลัพธ์/ค่าตั้งของหน้าต่าง
// โหลดแบบ dynamic import จาก Graphics3D.tsx: Cesium ทั้งก้อนอยู่ใน chunk ของตัวเอง ไม่ถ่วงการเปิดหน้าเว็บ
//
// - data source (sceneSource.ts): โหลดใหม่เมื่อ URL ของ scene.czml / access.czml (ซึ่งมี hash อยู่ใน URL) เปลี่ยนเท่านั้น
//   ผลไม่ current = data source ว่างที่มีแค่ Facility จาก doc (Review Focus 1) การแก้กราฟิกเรียก applyGraphics อย่างเดียว ไม่โหลด CZML ใหม่
//   โหลดไม่สำเร็จ = Facility อย่างเดียวพร้อมแถบแจ้ง (sceneFailed) แล้วลองใหม่ใน refresh ถัดไปแม้ hash เท่าเดิม (Review Focus 2)
// - dataSourceDisplay ข้ามการ update ตอนอยู่เฉย ๆ (cesium/idleUpdates.ts): หน้าต่างนี้จึงห้ามใช้ CallbackProperty, path ที่ relativeTo INERTIAL
//   หรือ visualizer เพิ่มเอง (ดูข้อจำกัดในไฟล์นั้น) Inertial by Window จึงวาดเป็น polyline ค่าคงที่ที่คำนวณใหม่เอง ไม่ใช่ path relativeTo
// - เวลา: bindClock (useTime → clock.currentTime + requestRender) viewer ไม่เดินเอง
// - กล้อง: Home View (ความสูง 4.5 รัศมีโลกเหนือ Facility แรก หรือ 0°,0°), Zoom To (trackedEntity + viewFrom),
//   View From/To (lookAtTransform ทุกครั้งที่เวลาเปลี่ยน; Inertial ใช้แกน ICRF เป็นกรอบของกล้อง) สถานะกล้องถูกตั้งกลับหลังโหลด data source ใหม่
// - Inertial by Window: polyline จาก toInertial ของตัวอย่างครึ่งคาบทั้งสองข้าง คำนวณใหม่ไม่เกิน 4 ครั้งต่อวินาทีขณะเวลาเปลี่ยน (แสดงผลเท่านั้น)
// - 3D Graphics Window Properties (useLayout.windowProps[panelId]) → แสง, เส้น Lat/Lon, Label Declutter (ดู applyProps)
// - Grab Globe / Zoom In: โหมดเมาส์ของปุ่มซ้าย (Zoom In: ลากกรอบแล้วบินไปที่กรอบ คลิกเฉย ๆ ซูมเข้าครึ่งหนึ่ง จบแล้วกลับเป็น Grab Globe)

import {
  ArcType, Cartesian2, Cartesian3, Color, ColorMaterialProperty, ConstantProperty, CzmlDataSource, JulianDate, Matrix3, Matrix4,
  PolylineDashMaterialProperty, PolylineGraphics, ReferenceFrame, ScreenSpaceEventHandler, ScreenSpaceEventType, TimeInterval,
  TrackingReferenceFrame, Transforms, type Entity, type ImageryLayer, type Viewer,
} from "cesium";
import { errorText } from "../../api/client";
import type { components } from "../../api/types.gen";
import { bindClock } from "../../cesium/clockSync";
import { ensureFacilities, loadScene } from "../../cesium/czml";
import {
  applyGraphics, dashFor, entityIdFor, entityIdForName, entityPeriod, graphicsFor, objectPath, sceneStyle, type SceneObject,
} from "../../cesium/graphics";
import { skipIdleDisplayUpdates } from "../../cesium/idleUpdates";
import { toInertial } from "../../cesium/inertial";
import { createViewer, latLonGrid } from "../../cesium/viewer";
import { satelliteInfo } from "../../data/catalog";
import { msg } from "../../labels/messages.th";
import { useLayout } from "../../stores/layout";
import { report } from "../../stores/messages";
import { useResults } from "../../stores/results";
import { useScenario } from "../../stores/scenario";
import { useTime } from "../../stores/time";
import { parseIsoUtc } from "../../time/parse";
import { props3d, type Props3D } from "./props";
import {
  noteSceneLoaded, notifyScenes, type MouseMode, type Scene3DHandle, type ViewFromToRequest, type ViewFromToResult,
} from "./registry";
import { SceneSource } from "../graphics/sceneSource";
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
const DATA_SOURCE_NAME = "gnss-studio";

type View = { kind: "free" } | { kind: "track"; path: string } | { kind: "fromTo"; req: ViewFromToRequest };

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

/** สร้าง viewer ใน el แล้วเริ่มภาพของหน้าต่าง panelId ไม่มี WebGL = โยน (ผู้เรียกแสดงข้อความไทยแทน) */
export function mountScene3D(panelId: string, el: HTMLElement): Scene3DHandle {
  const viewer = createViewer(el, "3d");
  try {
    return new Scene3D(panelId, el, viewer);
  } catch (e) {
    viewer.destroy();
    throw e;
  }
}

class Scene3D implements Scene3DHandle {
  private ds: CzmlDataSource | null = null;
  private readonly source: SceneSource<CzmlDataSource>;
  private destroyed = false;
  private frames = 0;
  private view: View = { kind: "free" };
  private mode: MouseMode = "grab";
  private props: Props3D;
  private grid: ImageryLayer | null = null;
  private readonly offs: (() => void)[] = [];
  private readonly inertialPaths = new Map<string, Entity>();
  private readonly inertialThrottle = new Throttle(INERTIAL_INTERVAL_MS, () => this.drawInertial());
  private readonly handler: ScreenSpaceEventHandler;
  private readonly zoom: ZoomBox;
  private icrfPreloaded = false;

  constructor(
    readonly panelId: string,
    private readonly el: HTMLElement,
    private readonly viewer: Viewer,
  ) {
    const scene = viewer.scene;
    scene.globe.baseColor = Color.BLACK; // ด้านกลางคืนที่ภาพโลกจางลง (Ambient Level) จางเป็นดำ ไม่ใช่สีน้ำเงินตั้งต้นของ Cesium
    const idle = skipIdleDisplayUpdates(viewer);
    this.offs.push(() => idle.dispose()); // คืน update เดิมของ dataSourceDisplay ก่อน viewer ถูกทำลาย
    this.source = new SceneSource<CzmlDataSource>({
      load: (url, access, signal) => loadScene(viewer, url, access, { signal }),
      empty: async () => {
        const ds = new CzmlDataSource(DATA_SOURCE_NAME);
        await viewer.dataSources.add(ds);
        return ds;
      },
      adopt: (ds, scene) => this.adopt(ds, scene),
      discard: (ds) => {
        if (!this.destroyed) viewer.dataSources.remove(ds, true);
      },
      failed: (e) => report("warning", "SCENE_LOAD", msg("scene.loadFailed", { window: "3D", message: errorText(e) })),
      changed: notifyScenes,
    });
    this.offs.push(scene.postRender.addEventListener(() => void this.frames++));
    this.props = props3d(useLayout.getState().windowProps[panelId]);
    this.applyProps();

    this.zoom = new ZoomBox(el);
    this.handler = new ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => this.dragStart(e.position), ScreenSpaceEventType.LEFT_DOWN);
    this.handler.setInputAction((e: ScreenSpaceEventHandler.MotionEvent) => this.dragMove(e.endPosition), ScreenSpaceEventType.MOUSE_MOVE);
    this.handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => this.dragEnd(e.position), ScreenSpaceEventType.LEFT_UP);

    this.offs.push(bindClock(viewer, () => this.onTime()));
    this.offs.push(
      useScenario.subscribe((s, prev) => {
        if (s.name !== prev.name) this.homeView(); // เปิด scenario ใหม่ = มุมมองตั้งต้นเหนือ Facility ของมัน
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
        if (s.windowProps[panelId] === prev.windowProps[panelId]) return;
        const before = this.props;
        this.props = props3d(s.windowProps[panelId]);
        this.applyProps();
        if (before.labelDeclutter !== this.props.labelDeclutter) this.restyle();
      }),
    );
    this.homeView();
    this.refreshScene();
  }

  // ---------- data source ----------

  /** URL ของผลที่ใช้ได้ตอนนี้: scene.czml ของ ephem ที่ current + access.czml ของทุก Facility ที่ current (เฉพาะเมื่อมี scene) */
  private refreshScene(): void {
    if (this.destroyed) return;
    const results = useResults.getState();
    const sceneUrl = results.ephemUrl("scene.czml");
    const accessUrls =
      sceneUrl === null
        ? []
        : Object.keys(results.info?.access ?? {})
            .sort()
            .flatMap((f) => {
              const url = results.accessUrl(f, "access.czml");
              return url === null ? [] : [url];
            });
    // URL เท่าเดิม: manifest (NORAD → PRN) มาทีหลังสถานะ หรือ doc เปลี่ยน: entity เดิม กราฟิกใหม่
    if (!this.source.update({ sceneUrl, accessUrls })) this.restyle();
  }

  /** ใช้ data source ใหม่แทนตัวเก่า แล้วตั้งกราฟิกและกล้องตามเดิม (entity เป็นตัวใหม่) */
  private adopt(ds: CzmlDataSource, scene: boolean): void {
    if (this.destroyed) return;
    const old = this.ds;
    this.ds = ds;
    if (old !== null && old !== ds) this.viewer.dataSources.remove(old, true);
    this.restyle();
    this.restoreView();
    if (scene) noteSceneLoaded();
  }

  sceneFailed(): boolean {
    return this.source.failed();
  }

  /** Facility ที่ขาด + กราฟิกตาม doc ทั้งหมด (ไม่โหลด CZML ใหม่) */
  private restyle(): void {
    const ds = this.ds;
    if (ds === null || this.destroyed) return;
    const { doc } = useScenario.getState();
    ensureFacilities(ds.entities, doc);
    applyGraphics(ds, doc, {
      mode: "3d",
      prnByNorad: useResults.getState().prnByNorad,
      isHidden: (norad) => satelliteInfo(norad)?.hidden ?? false,
      declutter: this.props.labelDeclutter,
    });
    this.updateInertial(true);
    this.viewer.scene.requestRender();
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
    this.updateInertial(false);
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

  /** ปล่อยกล้องจากการตาม object และจาก transform ของ View From/To */
  private release(): void {
    this.viewer.trackedEntity = undefined;
    this.view = { kind: "free" };
    this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
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
    }
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
    notifyScenes();
  }

  private dragStart(at: Cartesian2): void {
    if (this.mode === "zoomIn") this.zoom.start(at);
  }

  private dragMove(at: Cartesian2): void {
    this.zoom.move(at);
  }

  private dragEnd(at: Cartesian2): void {
    const box = this.zoom.end(at);
    if (box === null) return;
    this.zoomBox(box.a, box.b);
    this.setMouseMode("grab");
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

  // ---------- อื่น ๆ ----------

  resize(): void {
    if (this.destroyed) return;
    this.viewer.resize();
    this.viewer.scene.requestRender();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.source.dispose();
    for (const off of this.offs) off();
    this.inertialThrottle.dispose();
    this.handler.destroy();
    this.zoom.destroy();
    this.inertialPaths.clear();
    this.ds = null;
    this.viewer.destroy(); // ทำลาย data source, entity, primitive และ WebGL context ของหน้าต่างนี้ทั้งหมด
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

  frameCount(): number {
    return this.frames;
  }
}
