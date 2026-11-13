// ภาพในหน้าต่าง 2D หนึ่งบาน (spec §9.1, §9.3): viewer โหมด SCENE2D + CzmlDataSource ตัวเดียว + ภาพที่เปลี่ยนตามเวลา (Swath, เส้นแบ่งกลางวันกลางคืน, IPP)
// โหลดแบบ dynamic import จาก Graphics2D.tsx: Cesium ทั้งก้อนอยู่ใน chunk ของตัวเอง
//
// - Projection ตั้งตอนสร้าง viewer (Graphics2D สร้างใหม่เมื่อเปลี่ยน พร้อมพื้นที่ที่เห็นอยู่) Display Coordinate Frame = ECF เสมอใน v1
// - data source: CzmlScene + currentSceneUrls (graphics/sceneSource.ts) ตัวเดียวกับหน้าต่าง 3D ผลไม่ current = Facility จาก doc
//   กราฟิกจาก scenario.json ผ่าน applyGraphics(mode "2d"): จุด ป้ายชื่อ และ ground track เป็น path ของ Cesium ที่ lead/trail ตามหน้า Pass
//   (passes.ts: ค่าที่ขึ้นกับเวลาเป็น SampledProperty ที่ตรงทุกเวลา จึงไม่ต้องคำนวณใหม่ระหว่างเล่น) Visible Sides วาดแบบ Both (W20)
//   applyGraphics คืนหน้าตาของทุก entity (entityLooks ครั้งเดียวต่อการตั้งกราฟิก) ภาพที่เปลี่ยนตามเวลาใช้ชุดนั้นต่อ
// - dataSourceDisplay ข้ามการ update ตอนอยู่เฉย ๆ (cesium/idleUpdates.ts) เหมือนหน้าต่าง 3D: path ของดาวราว 130 ดวงไม่ถูกคำนวณใหม่ทุกเฟรมตอนไม่มีอะไรเปลี่ยน
//   หน้าต่างนี้ไม่ใช้ CallbackProperty, path ที่ relativeTo INERTIAL หรือ visualizer เพิ่มเอง ค่าทุกตัวของ entity ขึ้นกับเวลาหรือถูกตั้งผ่าน property
//   (ส่ง event) ส่วนภาพที่เปลี่ยนตามเวลาเป็น primitive ของ scene โดยตรง (cesium/overlay2d.ts) ไม่อยู่ใน DataSourceDisplay จึงไม่ถูกข้าม
// - Lighting → Shading = globe.enableLighting (spec §17 W2: ตรวจแล้วว่าแสงของ globe ใน SCENE2D ของ Cesium 1.147 ทำให้ด้านกลางคืนมืดลง
//   ตามเวลาของ clock ทุกเฟรม ไม่ต้องวาดพื้นที่เอง)
// - ภาพที่เปลี่ยนตามเวลา วาดใหม่ (drawOverlays) เมื่อเวลา animation เปลี่ยน ไม่เกิน 10 ครั้งต่อวินาที (ครั้งสุดท้ายตามมาเสมอ) และหนึ่งครั้งต่อหนึ่งเหตุการณ์
//   เมื่อ doc / ผลลัพธ์ / ช่วงวิเคราะห์ / ค่าตั้งของหน้าต่างเปลี่ยน (restyle และ refreshIpp ไม่วาดเอง ผู้ฟังเหตุการณ์เรียก redraw ครั้งเดียวตอนท้าย):
//   - Swath ของดาวที่ตั้ง Edge Limits / Filled Limits (overlay2d.ts swathInputs): ศูนย์กลางคือจุดใต้ดาว ณ เวลาปัจจุบัน (ละติจูด geodetic)
//     ความสูง = รัศมีของตำแหน่ง − EARTH_RADIUS_KM พื้นที่ Filled Limits สร้างใหม่เฉพาะเมื่อรอยเท้าดวงใดเลื่อนเกิน 0.5° (fillMoved)
//   - รอยของ sensor (sensor spec §5.3) ในรอบเดียวกับ Swath: sensor ที่วาดและสถานะจากตำแหน่งของ entity ดาวแม่ ณ t และ t ± 1 s (graphics.ts sensorStatesAt)
//     วงรอยตั้งใหม่ทุกรอบ พื้นที่ Fill (boresight ชี้ลงศูนย์กลางโลกเท่านั้น) สร้างใหม่ด้วยกติกา fillMoved เดียวกับ Filled Limits (sensorFillStates)
//   - Show Outline: เส้นแบ่งกลางวันกลางคืน คำนวณใหม่เมื่อเวลาของภาพเลื่อนไปอย่างน้อย 1 วินาที
//   - IPP (ของเราเอง): aer.csv ของ Facility จาก ipp.ts ippSource โหลดเมื่อเปิดตัวเลือกเท่านั้น ผลไม่ current = ไม่แสดง
//     โหลดไม่สำเร็จ = แจ้งเตือนแล้วลืมกุญแจ: การ refresh ผลลัพธ์ครั้งถัดไปโหลดใหม่
// - เมาส์: พิกัดใต้เมาส์ → useSelection.cursorLatLon (ไม่เกินหนึ่งครั้งต่อเฟรม ออกจากภาพ = null), Zoom In ลากกรอบแล้วบินไปที่กรอบ
//   (คลิกเฉย ๆ ซูมเข้าสองเท่า แล้วกลับเป็นลากเลื่อนแผนที่), Zoom Out = ภาพกว้างขึ้นสองเท่า

import {
  Cartesian2, Cartesian3, JulianDate, Math as CesiumMath, Rectangle, ReferenceFrame, ScreenSpaceEventHandler, ScreenSpaceEventType,
  type Color, type ImageryLayer, type Viewer,
} from "cesium";
import { errorText } from "../../api/client";
import { bindClock } from "../../cesium/clockSync";
import { ensureFacilities } from "../../cesium/czml";
import { applyGraphics, cssColor, entityLooks, sceneStyle, sensorStatesAt, type ApplyCtx, type EntityLook } from "../../cesium/graphics";
import { skipIdleDisplayUpdates } from "../../cesium/idleUpdates";
import { indexAer, ippAt, ippSource, type IppIndex, type IppSource } from "../../cesium/ipp";
import {
  fillMoved, fillStates, ippItems, Overlays2D, sensorFillStates, sensorItems, sensorKey, swathInputs, swathItems, terminatorItem, type FillState,
} from "../../cesium/overlay2d";
import { createViewer, destroyViewer, latLonGrid, watchRenderFailure, type RenderFailure } from "../../cesium/viewer";
import { satelliteInfo } from "../../data/catalog";
import type { AerRow } from "../../data/files";
import { msg } from "../../labels/messages.th";
import { useLayout } from "../../stores/layout";
import { report } from "../../stores/messages";
import { useResults } from "../../stores/results";
import { useScenario } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";
import { useTime } from "../../stores/time";
import type { MouseMode } from "../graphics/sceneRegistry";
import { currentSceneUrls, CzmlScene } from "../graphics/sceneSource";
import { Throttle } from "../graphics/throttle";
import { boxRectangle, ZoomBox } from "../graphics/zoomBox";
import { CursorTracker } from "./cursor";
import { props2d, type Projection2D, type Props2D } from "./props2d";
import { notifyScenes2D, type Scene2DHandle, type ViewRect } from "./registry2d";
import { viewRectOf } from "./view2d";

/** ภาพที่เปลี่ยนตามเวลาวาดใหม่ไม่เกิน 10 ครั้งต่อวินาที */
const OVERLAY_INTERVAL_MS = 100;
/** เส้นแบ่งกลางวันกลางคืนคำนวณใหม่เมื่อเวลาของภาพเลื่อนอย่างน้อยเท่านี้ (วินาที): ดวงอาทิตย์เลื่อน 0.004° ต่อวินาที */
const OUTLINE_MIN_STEP_S = 1;
const WORLD: ViewRect = [-180, -90, 180, 90];

/** aer.csv ที่จัดดัชนีแล้ว ต่อแถวชุดเดียวกัน (useResults.loadAer คืนชุดเดิมจาก cache: หลายหน้าต่างใช้ดัชนีเดียวกัน) */
const ippIndexes = new WeakMap<AerRow[], IppIndex>();
function ippIndexOf(rows: AerRow[]): IppIndex {
  let index = ippIndexes.get(rows);
  if (index === undefined) {
    index = indexAer(rows);
    ippIndexes.set(rows, index);
  }
  return index;
}

/**
 * สร้าง viewer 2D ใน el แล้วเริ่มภาพของหน้าต่าง panelId ไม่มี WebGL = โยน (ผู้เรียกแสดงข้อความไทยแทน)
 * onRenderStopped: ภาพหยุด (ข้อผิดพลาดตอนวาดหรือ WebGL context หาย) เรียกครั้งเดียว ผู้เรียกแสดงข้อความไทยแทนภาพ
 */
export function mountScene2D(
  panelId: string,
  el: HTMLElement,
  opts: { projection: Projection2D; view: ViewRect | null },
  onRenderStopped?: (reason: RenderFailure, error?: unknown) => void,
): Scene2DHandle {
  const viewer = createViewer(el, "2d", { projection: opts.projection === "mercator" ? "mercator" : "geographic" });
  try {
    return new Scene2D(panelId, el, viewer, opts.view, onRenderStopped);
  } catch (e) {
    destroyViewer(viewer);
    throw e;
  }
}

class Scene2D implements Scene2DHandle {
  private readonly czml: CzmlScene;
  private destroyed = false;
  private mode: MouseMode = "grab";
  private props: Props2D;
  private grid: ImageryLayer | null = null;
  private looks = new Map<string, EntityLook>();
  private readonly overlays: Overlays2D;
  private readonly overlayThrottle = new Throttle(OVERLAY_INTERVAL_MS, () => this.drawOverlays());
  /** จำนวนครั้งที่วาดภาพที่เปลี่ยนตามเวลา และที่สร้างพื้นที่ Filled Limits ใหม่ (window.__gnssStudioTest.overlays2d) */
  private redraws = 0;
  private fillBuilds = 0;
  /** เวลาของภาพตอนวาดเส้นแบ่งกลางวันกลางคืนครั้งล่าสุด (null = ต้องวาดใหม่) */
  private outlineAt: JulianDate | null = null;
  /** สถานะของพื้นที่ Filled Limits ที่วาดอยู่ (null = ต้องสร้างใหม่) */
  private fills: FillState[] | null = null;
  /** สถานะของพื้นที่ Fill ของ sensor ที่วาดอยู่ (null = ต้องสร้างใหม่) */
  private sensorFills: FillState[] | null = null;
  /** aer.csv ที่ใช้อยู่: key = scenario/Facility/hash, seq กันคำตอบที่มาช้า */
  private ipp: { key: string | null; index: IppIndex | null; seq: number } = { key: null, index: null, seq: 0 };
  private readonly offs: (() => void)[] = [];
  private readonly handler: ScreenSpaceEventHandler;
  private readonly zoom: ZoomBox;
  private readonly cursor: CursorTracker;

  constructor(
    readonly panelId: string,
    private readonly el: HTMLElement,
    private readonly viewer: Viewer,
    view: ViewRect | null,
    onRenderStopped?: (reason: RenderFailure, error?: unknown) => void,
  ) {
    const scene = viewer.scene;
    const idle = skipIdleDisplayUpdates(viewer);
    this.offs.push(() => idle.dispose()); // คืน update เดิมของ dataSourceDisplay ก่อน viewer ถูกทำลาย
    this.czml = new CzmlScene(viewer, {
      window: "2D",
      adopted: () => {
        if (this.destroyed) return;
        this.restyle();
        this.redraw();
      },
      changed: notifyScenes2D,
    });
    this.overlays = new Overlays2D(scene.primitives);
    this.props = props2d(useLayout.getState().windowProps[panelId]);
    this.applyProps();

    this.zoom = new ZoomBox(el);
    this.cursor = new CursorTracker(
      (x, y) => this.pickLatLon(x, y),
      (latLon) => useSelection.getState().setCursor(latLon),
    );
    this.handler = new ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => {
      if (this.mode === "zoomIn") this.zoom.start(e.position);
    }, ScreenSpaceEventType.LEFT_DOWN);
    this.handler.setInputAction((e: ScreenSpaceEventHandler.MotionEvent) => {
      this.zoom.move(e.endPosition);
      this.cursor.move(e.endPosition.x, e.endPosition.y);
    }, ScreenSpaceEventType.MOUSE_MOVE);
    this.handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => this.dragEnd(e.position), ScreenSpaceEventType.LEFT_UP);
    const leave = (): void => this.cursor.leave();
    scene.canvas.addEventListener("pointerleave", leave);
    this.offs.push(() => scene.canvas.removeEventListener("pointerleave", leave));

    this.offs.push(bindClock(viewer, () => this.overlayThrottle.request()));
    this.offs.push(
      useScenario.subscribe((s, prev) => {
        if (s.doc === prev.doc && s.catalog === prev.catalog) return;
        this.restyle();
        this.refreshIpp();
        this.redraw();
      }),
    );
    this.offs.push(
      useResults.subscribe((s, prev) => {
        if (s.info === prev.info && s.prnByNorad === prev.prnByNorad && s.status === prev.status) return;
        this.refreshScene();
        this.refreshIpp();
        this.redraw();
      }),
    );
    this.offs.push(
      useTime.subscribe((s, prev) => {
        if (s.periodStart === prev.periodStart && s.periodStop === prev.periodStop) return;
        this.restyle(); // All / Current Interval / One Pass
        this.redraw();
      }),
    );
    this.offs.push(
      useLayout.subscribe((s, prev) => {
        if (s.windowProps[panelId] === prev.windowProps[panelId]) return;
        const before = this.props;
        this.props = props2d(s.windowProps[panelId]);
        this.applyProps();
        if (before.showIpp !== this.props.showIpp) this.refreshIpp();
        this.redraw();
      }),
    );
    this.showRect(view ?? WORLD);
    this.refreshScene();
    this.refreshIpp();
    this.redraw();
    // ฟังท้ายสุด: constructor ที่โยนก่อนถึงตรงนี้ไม่ทิ้งตัวฟังไว้ให้ loseContext ของ destroyViewer ใน mountScene2D ยิงใส่ (ถอดใน destroy() ก่อน destroyViewer)
    this.offs.push(watchRenderFailure(viewer, (reason, error) => onRenderStopped?.(reason, error)));
  }

  /** วาดภาพที่เปลี่ยนตามเวลาใหม่ทันที (หนึ่งครั้งต่อเหตุการณ์) */
  private redraw(): void {
    this.overlayThrottle.flush();
  }

  // ---------- data source ----------

  private get ds() {
    return this.czml.ds;
  }

  /** โหลดผลที่ใช้ได้ตอนนี้ URL เท่าเดิม = ตั้งกราฟิกใหม่อย่างเดียว (ไม่วาด: ผู้เรียกวาด) */
  private refreshScene(): void {
    if (this.destroyed) return;
    if (!this.czml.update(currentSceneUrls(useResults.getState()))) this.restyle();
  }

  sceneFailed(): boolean {
    return this.czml.failed();
  }

  private applyCtx(): ApplyCtx {
    const { periodStart, periodStop } = useTime.getState();
    return {
      mode: "2d",
      prnByNorad: useResults.getState().prnByNorad,
      isHidden: (norad) => satelliteInfo(norad)?.hidden ?? false,
      analysis: { start: JulianDate.fromDate(periodStart), stop: JulianDate.fromDate(periodStop) },
    };
  }

  /** Facility ที่ขาด + กราฟิกตาม doc ทั้งหมด (ไม่โหลด CZML ใหม่) และหน้าตาของ entity ที่ภาพที่เปลี่ยนตามเวลาใช้ (ไม่วาด: ผู้เรียกวาด) */
  private restyle(): void {
    if (this.destroyed) return;
    const ds = this.ds;
    const { doc } = useScenario.getState();
    const ctx = this.applyCtx();
    if (ds !== null) {
      ensureFacilities(ds.entities, doc);
      this.looks = applyGraphics(ds, doc, ctx);
    } else {
      this.looks = doc === null ? new Map() : entityLooks(doc, ctx);
    }
    this.fills = null; // สีหรือดาวอาจเปลี่ยน
    this.sensorFills = null;
  }

  // ---------- ค่าตั้งของหน้าต่าง ----------

  /**
   * Details → Lat/Lon Lines (ชั้นภาพ GridImageryProvider เหมือนหน้าต่าง 3D)
   * Lighting → Shading = แสงอาทิตย์ของ globe: Cesium ทำให้ด้านกลางคืนมืดลงตามเวลาของ clock เองทุกเฟรม (ภาพโลกใช้ dayAlpha/nightAlpha ตั้งต้น = 1)
   * Show Outline และ IPP วาดใน drawOverlays
   */
  private applyProps(): void {
    const { imageryLayers, scene } = this.viewer;
    scene.globe.enableLighting = this.props.shading;
    if (this.props.latLonLines && this.grid === null) {
      this.grid = imageryLayers.addImageryProvider(latLonGrid(sceneStyle().gridLine));
    } else if (!this.props.latLonLines && this.grid !== null) {
      imageryLayers.remove(this.grid, true);
      this.grid = null;
    }
    this.outlineAt = null;
    scene.requestRender();
  }

  // ---------- IPP ----------

  /** Facility ที่ใช้ทำ IPP (ปิดตัวเลือก = null) */
  private currentIppSource(): IppSource | null {
    if (!this.props.showIpp) return null;
    const { name, doc } = useScenario.getState();
    return ippSource(doc, name, useResults.getState());
  }

  /**
   * โหลด aer.csv เมื่อ Facility หรือผลของมันเปลี่ยน (ตัวที่โหลดอยู่ของชุดเก่าถูกทิ้ง) ไม่วาด: ผู้เรียกวาด ส่วนเมื่อโหลดเสร็จวาดเอง
   * โหลดไม่สำเร็จ = แจ้งเตือนแล้วลืมกุญแจ การ refresh ผลลัพธ์ครั้งถัดไป (เช่น หลัง server กลับมา) จึงโหลดใหม่
   */
  private refreshIpp(): void {
    if (this.destroyed) return;
    const src = this.currentIppSource();
    const key = src?.key ?? null;
    if (key === this.ipp.key) return;
    const seq = this.ipp.seq + 1;
    this.ipp = { key, index: null, seq };
    if (src === null) return;
    useResults
      .getState()
      .loadAer(src.facility)
      .then(
        (rows) => {
          if (this.destroyed || this.ipp.seq !== seq) return;
          this.ipp.index = ippIndexOf(rows);
          this.redraw();
        },
        (e: unknown) => {
          if (this.destroyed || this.ipp.seq !== seq) return;
          this.ipp = { key: null, index: null, seq };
          report("warning", "IPP_LOAD", msg("ipp.loadFailed", { facility: src.facility, message: errorText(e) }));
        },
      );
  }

  // ---------- ภาพที่เปลี่ยนตามเวลา ----------

  /** สีของดาวที่แสดงอยู่ตาม PRN (ไม่อยู่ใน scenario, ถูกซ่อน หรือไม่มีในภาพ = null) */
  private satelliteColor(prn: string): Color | null {
    const look = this.looks.get(`sat/${prn}`);
    const entity = this.ds?.entities.getById(`sat/${prn}`);
    return look === undefined || !look.g.show || entity === undefined || !entity.show ? null : cssColor(look.g.color);
  }

  private drawOverlays(): void {
    if (this.destroyed) return;
    this.redraws++;
    const time = this.viewer.clock.currentTime;
    const style = sceneStyle();

    // Swath: ขอบตั้งใหม่ทุกครั้ง (เส้นเดิมถูกแก้ตำแหน่ง) พื้นที่สร้างใหม่เมื่อรอยเท้าดวงใดเลื่อนเกิน 0.5°
    const ds = this.ds;
    const inputs =
      ds === null
        ? []
        : swathInputs(this.looks, (id) => {
            const entity = ds.entities.getById(id);
            return entity === undefined || !entity.show ? undefined : entity.position?.getValueInReferenceFrame(time, ReferenceFrame.FIXED, new Cartesian3());
          });
    const states = fillStates(inputs);
    const rebuildFills = fillMoved(this.fills, states);
    const swath = swathItems(rebuildFills ? inputs : inputs.filter((s) => s.options !== "Filled Limits"), style);
    this.overlays.setLines("swathEdge", swath.edges);
    if (rebuildFills) {
      this.overlays.setFills("swath", swath.fills);
      this.fills = states;
      this.fillBuilds++;
    }

    // Sensor: วงรอยตั้งใหม่ทุกครั้ง พื้นที่ Fill สร้างใหม่เมื่อรอยดวงใดเลื่อนเกิน 0.5° หรือสี/ความทึบเปลี่ยน
    const sensorStates = ds === null ? [] : sensorStatesAt(useScenario.getState().doc, ds.entities, this.applyCtx(), time);
    const sensorFills = sensorFillStates(sensorStates);
    const rebuildSensorFills = fillMoved(this.sensorFills, sensorFills);
    const sensor = sensorItems(sensorStates, style, rebuildSensorFills);
    this.overlays.setLines("sensorEdge", sensor.lines);
    if (rebuildSensorFills) {
      this.overlays.setFills("sensor", sensor.fills);
      this.sensorFills = sensorFills;
    }

    if (this.outlineAt === null || Math.abs(JulianDate.secondsDifference(time, this.outlineAt)) >= OUTLINE_MIN_STEP_S) {
      this.overlays.setLines("terminator", this.props.showOutline ? [terminatorItem(JulianDate.toDate(time), style)] : []);
      this.outlineAt = JulianDate.clone(time);
    }

    const src = this.currentIppSource();
    const index = src !== null && src.key === this.ipp.key ? this.ipp.index : null;
    if (src !== null && index !== null) {
      const items = ippItems(ippAt(index, JulianDate.toDate(time).getTime(), src.minEl), (prn) => this.satelliteColor(prn), style);
      this.overlays.setPoints("ipp", items.points);
      this.overlays.setLines("ippTrack", items.tracks);
    } else {
      this.overlays.setPoints("ipp", []);
      this.overlays.setLines("ippTrack", []);
    }
    this.viewer.scene.requestRender();
  }

  // ---------- กล้องและเมาส์ ----------

  private showRect(r: ViewRect): void {
    this.viewer.camera.setView({ destination: Rectangle.fromDegrees(r[0], r[1], r[2], r[3]) });
    this.viewer.scene.requestRender();
  }

  /** พื้นที่ที่เห็นจากตำแหน่งกล้องและ frustum ของโหมด 2D (view2d.ts: computeViewRectangle ของ Cesium ผิดเมื่อภาพกว้างกว่าโลก) */
  viewRectangle(): ViewRect | null {
    if (this.destroyed) return null;
    const { camera, scene } = this.viewer;
    const f = camera.frustum as { left?: number; right?: number; bottom?: number; top?: number };
    if (f.left === undefined || f.right === undefined || f.bottom === undefined || f.top === undefined) return null;
    return viewRectOf(camera.position, { left: f.left, right: f.right, bottom: f.bottom, top: f.top }, scene.mapProjection);
  }

  /** ตำแหน่งบน canvas → [lat, lon] องศา (นอกแผนที่ = null) */
  private pickLatLon(x: number, y: number): [number, number] | null {
    if (this.destroyed) return null;
    const ellipsoid = this.viewer.scene.globe.ellipsoid;
    const hit = this.viewer.camera.pickEllipsoid(new Cartesian2(x, y), ellipsoid);
    const c = hit === undefined ? undefined : ellipsoid.cartesianToCartographic(hit);
    return c === undefined ? null : [CesiumMath.toDegrees(c.latitude), CesiumMath.toDegrees(c.longitude)];
  }

  mouseMode(): MouseMode {
    return this.mode;
  }

  setMouseMode(mode: MouseMode): void {
    if (this.destroyed || this.mode === mode) return;
    this.mode = mode;
    const grab = mode === "grab";
    this.viewer.scene.screenSpaceCameraController.enableTranslate = grab; // ลากเลื่อนแผนที่ 2D
    this.el.classList.toggle("gfx-zoom-mode", !grab);
    if (grab) this.zoom.cancel();
    notifyScenes2D();
  }

  /** ความกว้างของภาพ (เมตรบนแผนที่ที่ฉายแล้ว) จาก frustum แบบ orthographic ของโหมด 2D */
  private frustumWidth(): number {
    const f = this.viewer.camera.frustum as { left?: number; right?: number };
    return f.left !== undefined && f.right !== undefined ? f.right - f.left : 0;
  }

  private dragEnd(at: Cartesian2): void {
    const box = this.zoom.end(at);
    if (box === null) return;
    const camera = this.viewer.camera;
    const rect = boxRectangle(camera, this.viewer.scene.globe.ellipsoid, box.a, box.b);
    if (rect !== null) camera.flyTo({ destination: rect, duration: 0.8 });
    else camera.zoomIn(this.frustumWidth() / 2); // คลิก: กว้างลงครึ่งหนึ่ง
    this.viewer.scene.requestRender();
    this.setMouseMode("grab");
  }

  zoomOut(): void {
    if (this.destroyed) return;
    this.viewer.camera.zoomOut(this.frustumWidth()); // กว้างขึ้นสองเท่า (Cesium จำกัดไม่ให้เกินทั้งโลก)
    this.viewer.scene.requestRender();
  }

  // ---------- อื่น ๆ ----------

  resize(): void {
    if (this.destroyed) return;
    this.viewer.resize();
    this.viewer.scene.requestRender();
  }

  sensorFootprintPoints(name: string): number | null {
    return this.destroyed ? null : this.overlays.linePoints("sensorEdge", sensorKey(name));
  }

  overlayCounts(): Record<string, number> {
    const time = this.viewer.clock.currentTime;
    let groundTracks = 0;
    for (const e of this.ds?.entities.values ?? []) if (e.show && e.path?.show?.getValue(time) === true) groundTracks++;
    return { groundTracks, ...this.overlays.counts(), shading: this.viewer.scene.globe.enableLighting ? 1 : 0, redraws: this.redraws, fillBuilds: this.fillBuilds };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.czml.dispose();
    for (const off of this.offs) off();
    this.overlayThrottle.dispose();
    this.cursor.dispose();
    this.handler.destroy();
    this.zoom.destroy();
    this.overlays.destroy();
    destroyViewer(this.viewer); // ทำลาย data source, entity, primitive และคืน WebGL context ของหน้าต่างนี้ทันที (เปลี่ยน Projection ก็ผ่านทางนี้)
  }
}
