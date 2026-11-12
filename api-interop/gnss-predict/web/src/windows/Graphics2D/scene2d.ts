// ภาพในหน้าต่าง 2D หนึ่งบาน (spec §9.1, §9.3): viewer โหมด SCENE2D + CzmlDataSource ตัวเดียว + ภาพที่เปลี่ยนตามเวลา (Swath, กลางวันกลางคืน, IPP)
// โหลดแบบ dynamic import จาก Graphics2D.tsx: Cesium ทั้งก้อนอยู่ใน chunk ของตัวเอง
//
// - Projection ตั้งตอนสร้าง viewer (Graphics2D สร้างใหม่เมื่อเปลี่ยน พร้อมพื้นที่ที่เห็นอยู่) Display Coordinate Frame = ECF เสมอใน v1
// - data source (graphics/sceneSource.ts) เหมือนหน้าต่าง 3D: โหลดใหม่เมื่อ URL ของ scene.czml / access.czml เปลี่ยนเท่านั้น ผลไม่ current = Facility จาก doc
//   กราฟิกจาก scenario.json ผ่าน applyGraphics(mode "2d"): จุด ป้ายชื่อ และ ground track เป็น path ของ Cesium ที่ lead/trail ตามหน้า Pass
//   (passes.ts: ค่าที่ขึ้นกับเวลาเป็น SampledProperty ที่ตรงทุกเวลา จึงไม่ต้องคำนวณใหม่ระหว่างเล่น) Visible Sides วาดแบบ Both (W20)
// - dataSourceDisplay ข้ามการ update ตอนอยู่เฉย ๆ (cesium/idleUpdates.ts) เหมือนหน้าต่าง 3D: path ของดาวราว 130 ดวงไม่ถูกคำนวณใหม่ทุกเฟรมตอนไม่มีอะไรเปลี่ยน
//   หน้าต่างนี้ไม่ใช้ CallbackProperty, path ที่ relativeTo INERTIAL หรือ visualizer เพิ่มเอง ค่าทุกตัวของ entity ขึ้นกับเวลาหรือถูกตั้งผ่าน property
//   (ส่ง event) ส่วนภาพที่เปลี่ยนตามเวลาเป็น primitive ของ scene โดยตรง (cesium/overlay2d.ts) ไม่อยู่ใน DataSourceDisplay จึงไม่ถูกข้าม
// - ภาพที่เปลี่ยนตามเวลา วาดใหม่เมื่อเวลา animation เปลี่ยน ไม่เกิน 10 ครั้งต่อวินาที (ครั้งสุดท้ายตามมาเสมอ) และทันทีเมื่อ doc/ผล/ค่าตั้งเปลี่ยน:
//   - Swath ของดาวที่ตั้ง Edge Limits / Filled Limits: ศูนย์กลางคือจุดใต้ดาว ณ เวลาปัจจุบัน ความสูง = รัศมีของตำแหน่ง − EARTH_RADIUS_KM
//   - Lighting: Show Outline (เส้นแบ่งกลางวันกลางคืน) และ Shading (พื้นที่กลางคืนโปร่งแสง) คำนวณใหม่เมื่อเวลาของภาพเลื่อนไปอย่างน้อย 1 วินาที
//     Shading เป็นแผ่นที่วาดเอง ไม่ใช่ globe.enableLighting (spec §17 W2: ตรวจแล้วว่าแสงของ globe ใน SCENE2D ของ Cesium 1.147 แสดงด้านกลางคืนได้
//     แต่แผ่นโปร่งแสงมีขอบตรงกับเส้นของ Show Outline พอดีเพราะใช้จุดใต้ดวงอาทิตย์เดียวกัน สีอยู่ใน theme.css และเป็นแบบ Shading ของ STK)
//   - IPP (ของเราเอง): aer.csv ของ Facility แรกใน doc ที่ผล access เป็น current โหลดเมื่อเปิดตัวเลือกเท่านั้น ผลไม่ current = ไม่แสดง
// - เมาส์: พิกัดใต้เมาส์ → useSelection.cursorLatLon (ไม่เกินหนึ่งครั้งต่อเฟรม ออกจากภาพ = null), Zoom In ลากกรอบแล้วบินไปที่กรอบ
//   (คลิกเฉย ๆ ซูมเข้าสองเท่า แล้วกลับเป็นลากเลื่อนแผนที่), Zoom Out = ภาพกว้างขึ้นสองเท่า

import {
  Cartesian2, Cartesian3, Color, CzmlDataSource, JulianDate, Math as CesiumMath, Rectangle, ReferenceFrame, ScreenSpaceEventHandler,
  ScreenSpaceEventType, type ImageryLayer, type Viewer,
} from "cesium";
import { errorText } from "../../api/client";
import type { components } from "../../api/types.gen";
import { bindClock } from "../../cesium/clockSync";
import { ensureFacilities, loadScene } from "../../cesium/czml";
import { applyGraphics, entityLooks, sceneStyle, type ApplyCtx, type EntityLook } from "../../cesium/graphics";
import { skipIdleDisplayUpdates } from "../../cesium/idleUpdates";
import { indexAer, ippAt, type IppIndex } from "../../cesium/ipp";
import { ippItems, nightItems, Overlays2D, swathItems, type SwathInput, type SwathOption } from "../../cesium/overlay2d";
import { createViewer, latLonGrid } from "../../cesium/viewer";
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
import { SceneSource } from "../graphics/sceneSource";
import { Throttle } from "../graphics/throttle";
import { boxRectangle, ZoomBox } from "../graphics/zoomBox";
import { CursorTracker } from "./cursor";
import { props2d, type Projection2D, type Props2D } from "./props2d";
import { notifyScenes2D, type Scene2DHandle, type ViewRect } from "./registry2d";
import { viewRectOf } from "./view2d";

type FacilityObj = components["schemas"]["FacilityObj"];
type SatelliteObj = components["schemas"]["SatelliteObj"];

/** ภาพที่เปลี่ยนตามเวลาวาดใหม่ไม่เกิน 10 ครั้งต่อวินาที */
const OVERLAY_INTERVAL_MS = 100;
/** กลางวันกลางคืนคำนวณใหม่เมื่อเวลาของภาพเลื่อนอย่างน้อยเท่านี้ (วินาที): ดวงอาทิตย์เลื่อน 0.004° ต่อวินาที */
const NIGHT_MIN_STEP_S = 1;
const DATA_SOURCE_NAME = "gnss-studio";
const WORLD: ViewRect = [-180, -90, 180, 90];
const DEFAULT_SWATH_ELEVATION_DEG = 10;

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

/** หน้า 2D Graphics - Swath ของดาว (ไม่มี = No Graphics ที่มุมเงย 10° ตามค่าตั้งต้นของ server) */
function swathOf(obj: EntityLook["obj"]): { options: SwathOption; elevationDeg: number } {
  const sw = (obj as SatelliteObj).graphics2d?.swath;
  return { options: sw?.options ?? "No Graphics", elevationDeg: sw?.elevation_deg ?? DEFAULT_SWATH_ELEVATION_DEG };
}

const cssColor = (hex: string): Color => Color.fromCssColorString(hex) ?? Color.WHITE;

/** สร้าง viewer 2D ใน el แล้วเริ่มภาพของหน้าต่าง panelId ไม่มี WebGL = โยน (ผู้เรียกแสดงข้อความไทยแทน) */
export function mountScene2D(panelId: string, el: HTMLElement, opts: { projection: Projection2D; view: ViewRect | null }): Scene2DHandle {
  const viewer = createViewer(el, "2d", { projection: opts.projection === "mercator" ? "mercator" : "geographic" });
  try {
    return new Scene2D(panelId, el, viewer, opts.view);
  } catch (e) {
    viewer.destroy();
    throw e;
  }
}

class Scene2D implements Scene2DHandle {
  private ds: CzmlDataSource | null = null;
  private readonly source: SceneSource<CzmlDataSource>;
  private destroyed = false;
  private mode: MouseMode = "grab";
  private props: Props2D;
  private grid: ImageryLayer | null = null;
  private looks = new Map<string, EntityLook>();
  private readonly overlays: Overlays2D;
  private readonly overlayThrottle = new Throttle(OVERLAY_INTERVAL_MS, () => this.drawOverlays());
  /** เวลาของภาพตอนวาดกลางวันกลางคืนครั้งล่าสุด (null = ต้องวาดใหม่) */
  private nightAt: JulianDate | null = null;
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
  ) {
    const scene = viewer.scene;
    const idle = skipIdleDisplayUpdates(viewer);
    this.offs.push(() => idle.dispose()); // คืน update เดิมของ dataSourceDisplay ก่อน viewer ถูกทำลาย
    this.source = new SceneSource<CzmlDataSource>({
      load: (url, access, signal) => loadScene(viewer, url, access, { signal }),
      empty: async () => {
        const ds = new CzmlDataSource(DATA_SOURCE_NAME);
        await viewer.dataSources.add(ds);
        return ds;
      },
      adopt: (ds) => this.adopt(ds),
      discard: (ds) => {
        if (!this.destroyed) viewer.dataSources.remove(ds, true);
      },
      failed: (e) => report("warning", "SCENE_LOAD", msg("scene.loadFailed", { window: "2D", message: errorText(e) })),
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
      }),
    );
    this.offs.push(
      useResults.subscribe((s, prev) => {
        if (s.info === prev.info && s.prnByNorad === prev.prnByNorad && s.status === prev.status) return;
        this.refreshScene();
        this.refreshIpp();
      }),
    );
    this.offs.push(
      useTime.subscribe((s, prev) => {
        if (s.periodStart !== prev.periodStart || s.periodStop !== prev.periodStop) this.restyle(); // All / Current Interval / One Pass
      }),
    );
    this.offs.push(
      useLayout.subscribe((s, prev) => {
        if (s.windowProps[panelId] === prev.windowProps[panelId]) return;
        const before = this.props;
        this.props = props2d(s.windowProps[panelId]);
        this.applyProps();
        if (before.showIpp !== this.props.showIpp) this.refreshIpp();
        else this.overlayThrottle.flush();
      }),
    );
    this.showRect(view ?? WORLD);
    this.refreshScene();
    this.refreshIpp();
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
    if (!this.source.update({ sceneUrl, accessUrls })) this.restyle();
  }

  private adopt(ds: CzmlDataSource): void {
    if (this.destroyed) return;
    const old = this.ds;
    this.ds = ds;
    if (old !== null && old !== ds) this.viewer.dataSources.remove(old, true);
    this.restyle();
  }

  sceneFailed(): boolean {
    return this.source.failed();
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

  /** Facility ที่ขาด + กราฟิกตาม doc ทั้งหมด (ไม่โหลด CZML ใหม่) แล้ววาดภาพที่เปลี่ยนตามเวลาใหม่ทันที */
  private restyle(): void {
    if (this.destroyed) return;
    const ds = this.ds;
    const { doc } = useScenario.getState();
    const ctx = this.applyCtx();
    if (ds !== null) {
      ensureFacilities(ds.entities, doc);
      applyGraphics(ds, doc, ctx);
    }
    this.looks = doc === null ? new Map() : entityLooks(doc, ctx);
    this.overlayThrottle.flush();
  }

  // ---------- ค่าตั้งของหน้าต่าง ----------

  /** Details → Lat/Lon Lines (ชั้นภาพ GridImageryProvider เหมือนหน้าต่าง 3D) แสงและ IPP วาดใน drawOverlays */
  private applyProps(): void {
    const { imageryLayers, scene } = this.viewer;
    if (this.props.latLonLines && this.grid === null) {
      this.grid = imageryLayers.addImageryProvider(latLonGrid(sceneStyle().gridLine));
    } else if (!this.props.latLonLines && this.grid !== null) {
      imageryLayers.remove(this.grid, true);
      this.grid = null;
    }
    this.nightAt = null;
    scene.requestRender();
  }

  // ---------- IPP ----------

  /** Facility ที่ใช้ทำ IPP: ตัวแรกใน doc ที่ผล access เป็น current (ephem ต้อง current ด้วย) ปิดตัวเลือกหรือไม่มี = null */
  private ippSource(): { facility: string; minEl: number; key: string } | null {
    if (!this.props.showIpp) return null;
    const { name, doc } = useScenario.getState();
    const results = useResults.getState();
    if (name === null || doc === null || results.status !== "current") return null;
    for (const o of doc.objects) {
      if (o.class !== "Facility") continue;
      const e = results.info?.access[o.name];
      if (e?.status !== "current" || !e.hash) continue;
      const minEl = (o as FacilityObj).constraints?.elevation_angle_min_deg ?? 0;
      return { facility: o.name, minEl, key: `${name}/${o.name}/${e.hash}` };
    }
    return null;
  }

  /** โหลด aer.csv เมื่อ Facility หรือผลของมันเปลี่ยน (ตัวที่โหลดอยู่ของชุดเก่าถูกทิ้ง) แล้ววาดใหม่ */
  private refreshIpp(): void {
    if (this.destroyed) return;
    const src = this.ippSource();
    const key = src?.key ?? null;
    if (key !== this.ipp.key) {
      const seq = this.ipp.seq + 1;
      this.ipp = { key, index: null, seq };
      if (src !== null) {
        useResults
          .getState()
          .loadAer(src.facility)
          .then(
            (rows) => {
              if (this.destroyed || this.ipp.seq !== seq) return;
              this.ipp.index = ippIndexOf(rows);
              this.overlayThrottle.flush();
            },
            (e: unknown) => {
              if (this.destroyed || this.ipp.seq !== seq) return;
              report("warning", "IPP_LOAD", msg("ipp.loadFailed", { facility: src.facility, message: errorText(e) }));
            },
          );
      }
    }
    this.overlayThrottle.flush();
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
    const time = this.viewer.clock.currentTime;
    const style = sceneStyle();

    const swaths: SwathInput[] = [];
    const ds = this.ds;
    if (ds !== null) {
      for (const [id, look] of this.looks) {
        if (!id.startsWith("sat/") || !look.g.show) continue;
        const { options, elevationDeg } = swathOf(look.obj);
        if (options === "No Graphics") continue;
        const entity = ds.entities.getById(id);
        if (entity === undefined || !entity.show) continue;
        const position = entity.position?.getValueInReferenceFrame(time, ReferenceFrame.FIXED, new Cartesian3());
        if (position === undefined) continue; // นอกช่วงที่มีข้อมูล
        swaths.push({ key: id, position, color: cssColor(look.g.color), elevationDeg, options });
      }
    }
    const swath = swathItems(swaths, style);
    this.overlays.setLines("swathEdge", swath.edges);
    this.overlays.setFills("swath", swath.fills);

    if (this.nightAt === null || Math.abs(JulianDate.secondsDifference(time, this.nightAt)) >= NIGHT_MIN_STEP_S) {
      const night = nightItems(JulianDate.toDate(time), { outline: this.props.showOutline, shading: this.props.shading }, style);
      this.overlays.setLines("terminator", night.line === null ? [] : [night.line]);
      this.overlays.setFills("night", night.fill === null ? [] : [night.fill]);
      this.nightAt = JulianDate.clone(time);
    }

    const src = this.ippSource();
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

  overlayCounts(): Record<string, number> {
    const time = this.viewer.clock.currentTime;
    let groundTracks = 0;
    for (const e of this.ds?.entities.values ?? []) if (e.show && e.path?.show?.getValue(time) === true) groundTracks++;
    return { groundTracks, ...this.overlays.counts() };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.source.dispose();
    for (const off of this.offs) off();
    this.overlayThrottle.dispose();
    this.cursor.dispose();
    this.handler.destroy();
    this.zoom.destroy();
    this.overlays.destroy();
    this.ds = null;
    this.viewer.destroy(); // ทำลาย data source, entity, primitive และ WebGL context ของหน้าต่างนี้ทั้งหมด
  }
}
