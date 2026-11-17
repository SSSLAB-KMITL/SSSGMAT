// Viewer ของ Cesium ที่ไม่ต่อเน็ต (W7, spec §9.1):
// - ภาพโลก NaturalEarthII ที่มากับ Cesium (/cesium/Assets/Textures/NaturalEarthII) ไม่มี Ion, Bing, terrain (ใช้ทรงรีเรียบ) หรือ geocoder
//   Ion.defaultAccessToken = "" กันโค้ดใดเผลอเรียก Ion ด้วย token ตั้งต้น
// - ปิด widget สำเร็จรูปทุกตัว เหลือ credit ที่มุมล่างของ viewer (Cesium วางเอง)
// - shouldAnimate = false และไม่ตามนาฬิกาของ data source: เวลามาจาก useTime ผ่าน clockSync เท่านั้น
// - requestRenderMode: วาดเมื่อขอ (เวลา กราฟิก หรือกล้องเปลี่ยน) maximumRenderTimeChange = ∞ เพราะเราขอเองทุกครั้งที่ตั้งเวลา
// - เครื่องที่ไม่มี WebGL: new Viewer โยน ผู้เรียกจับแล้วแสดงข้อความไทยแทน (ผู้เรียกล้าง el เผื่อ Cesium วาดอะไรค้างไว้)
// - showRenderLoopErrors = false: ไม่มีกล่อง error ภาษาอังกฤษของ Cesium ข้อผิดพลาดตอนวาดและ context ที่หาย ผู้เรียกฟังผ่าน watchRenderFailure
//   แล้วแสดงข้อความไทยในหน้าต่าง (Cesium หยุด render loop เองหลังข้อผิดพลาด ภาพจึงค้าง)
// - ปิดหน้าต่าง: destroyViewer (ไม่ใช่ viewer.destroy() ตรง ๆ) เพราะ Cesium ไม่เรียก WEBGL_lose_context context จึงค้างจน GC
//   และ Chrome ทิ้ง context ที่เก่าที่สุด (มักเป็นหน้าต่าง 3D ตั้งต้น) เมื่อมีเกินราว 16 ตัว เช่น หลังเปิดปิดหน้าต่างหรือเปลี่ยน Projection ของ 2D หลายครั้ง
// - หน้าต่าง 2D: map projection ตั้งได้ตอนสร้าง viewer เท่านั้น (Equidistant Cylindrical = GeographicProjection, Mercator = WebMercatorProjection)
// - คำขอของ Cesium (ชิ้นภาพ GIBS) ไป server ของหน้านี้พร้อมกันไม่เกิน LOCAL_SERVER_REQUESTS (ตั้งตอนโหลดโมดูลนี้ ก่อนสร้าง viewer ตัวแรก):
//   browser มี HTTP/1.1 ได้ 6 connection ต่อ server หนึ่งถูก SSE (/api/events) ถือไว้ ส่วน Cesium ขอได้ 18 ต่อ server
//   ชิ้นภาพที่ server ยังรอ NASA (ถึง 20 วินาที) จึงกันคำขอ API ของหน้าได้ทั้งหมด จำกัดไว้ 4 = เหลืออย่างน้อยหนึ่ง connection ให้ API
// CESIUM_BASE_URL (vite.config.ts define) = "/cesium": Workers, Assets, Widgets ถูกคัดลอกไปที่นั่นทั้งตอน build และเสิร์ฟตอน dev

import "cesium/Build/Cesium/Widgets/widgets.css";
import {
  buildModuleUrl, Color, GeographicProjection, GridImageryProvider, ImageryLayer, Ion, RequestScheduler, SceneMode, ScreenSpaceEventType,
  TileMapServiceImageryProvider, Viewer, WebMercatorProjection, type ScreenSpaceEventHandler,
} from "cesium";

Ion.defaultAccessToken = "";

/** คำขอของ Cesium ไป server ของหน้านี้พร้อมกันได้ไม่เกินนี้ (ค่าตั้งต้นของ Cesium 18 ต่อ server) */
export const LOCAL_SERVER_REQUESTS = 4;

/**
 * key ของ server ของหน้านี้ในรูปเดียวกับ RequestScheduler.getServerKey ของ Cesium (ของภายใน ไม่อยู่ใน type):
 * authority ของ URL ถ้าไม่มี ":" ต่อท้ายด้วย port ตั้งต้น 443 (https) หรือ 80 (อื่น ๆ) location.host ไม่มี port ตั้งต้นอยู่แล้ว
 */
export function localServerKey(loc: { protocol: string; host: string }): string {
  return /:/.test(loc.host) ? loc.host : `${loc.host}:${loc.protocol === "https:" ? "443" : "80"}`;
}

if (typeof location !== "undefined") RequestScheduler.requestsByServer[localServerKey(location)] = LOCAL_SERVER_REQUESTS;

/** ภาพโลกที่มากับ Cesium (ความละเอียดต่ำ ระดับ 0–2: ประหยัดหน่วยความจำ GPU เมื่อเปิดหลายหน้าต่าง, spec §17 W1) */
export function naturalEarthLayer(): ImageryLayer {
  return ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII")));
}

/**
 * ชั้นเส้น Lat/Lon (Details → Lat/Lon Lines ของหน้าต่าง 3D และ 2D): เส้นทุก 30° ที่ระยะไกล (6 ช่องต่อ tile ระดับ 0) ถี่ขึ้นเมื่อซูม
 * สีจาก --scene-grid-line (ผู้เรียกส่งมา) tile เป็นแบบ geographic: ใน Mercator เส้นก็ยังอยู่ที่ละติจูด/ลองจิจูดเดิม
 */
export function latLonGrid(color: string): GridImageryProvider {
  return new GridImageryProvider({
    cells: 6,
    color: Color.fromCssColorString(color) ?? Color.WHITE,
    glowColor: Color.TRANSPARENT,
    glowWidth: 2,
    backgroundColor: Color.TRANSPARENT,
  });
}

export function createViewer(el: HTMLElement, mode: "3d" | "2d", opts: { projection?: "geographic" | "mercator" } = {}): Viewer {
  const viewer = new Viewer(el, {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    vrButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,
    projectionPicker: false,
    baseLayer: naturalEarthLayer(),
    shouldAnimate: false,
    automaticallyTrackDataSourceClocks: false,
    showRenderLoopErrors: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    sceneMode: mode === "2d" ? SceneMode.SCENE2D : SceneMode.SCENE3D,
    scene3DOnly: mode === "3d",
    ...(mode === "2d" ? { mapProjection: opts.projection === "mercator" ? new WebMercatorProjection() : new GeographicProjection() } : {}),
  });
  viewer.clock.shouldAnimate = false;
  return viewer;
}


/**
 * เหตุที่ภาพหยุด: ข้อผิดพลาดตอนวาด (scene.renderError), render loop ของ Cesium หยุดเงียบ ๆ (loopStopped: useDefaultRenderLoop กลายเป็น false)
 * หรือ browser ทิ้ง WebGL context ของหน้าต่างนี้ (webglcontextlost)
 */
export type RenderFailure = "renderError" | "loopStopped" | "contextLost";

/** ตรวจว่า render loop ยังวิ่งอยู่ทุกช่วงนี้ (ms) */
export const RENDER_LOOP_POLL_MS = 1000;
/** หยุดอีกภายในช่วงนี้ (ms) หลังเริ่มใหม่ = เลิกเริ่มใหม่ */
export const RENDER_RETRY_WINDOW_MS = 5000;

/** ส่วนของ Viewer ที่ฟังก์ชันด้านล่างใช้ (Scene.context เป็นของภายในของ Cesium ไม่อยู่ใน type) test ส่งตัวปลอมได้ */
interface ViewerParts {
  scene: { renderError: Viewer["scene"]["renderError"]; canvas: HTMLCanvasElement; requestRender(): void };
  /** viewer ปลอมของ test อาจไม่มี: ไม่มี = ไม่นับว่า loop หยุด */
  useDefaultRenderLoop?: boolean;
  destroy(): void;
}

/** เวลาและตัวตั้งเวลาที่ watchRenderFailure ใช้ (test ส่งตัวปลอมได้) */
export interface RenderWatchEnv {
  now(): number;
  /** เรียก cb ทุก ms คืนตัวเลิก */
  every(ms: number, cb: () => void): () => void;
}

const BROWSER_ENV: RenderWatchEnv = {
  now: () => performance.now(),
  every: (ms, cb) => {
    const id = setInterval(cb, ms);
    return () => clearInterval(id);
  },
};
type LoseContext = { loseContext(): void };
type SceneInternals = { context?: { _gl?: { getExtension(name: string): unknown } | null } | null };

/** ทำลาย viewer และคืน WebGL context ทันที (loseContext ก่อน destroy) ส่วนที่คืน context ล้มเหลวไม่ขวางการทำลาย */
export function destroyViewer(viewer: ViewerParts): void {
  try {
    const gl = (viewer.scene as unknown as SceneInternals).context?._gl;
    (gl?.getExtension("WEBGL_lose_context") as LoseContext | null | undefined)?.loseContext();
  } catch {
    // context หายไปแล้วหรือ browser ไม่มี extension นี้: ทำลายตามปกติ
  }
  viewer.destroy();
}

/**
 * เฝ้าภาพที่หยุด (QA-01, follow-up 13b-2) คืนฟังก์ชันเลิกเฝ้า (ต้องเรียกก่อน destroyViewer: loseContext ที่ตั้งใจทำตอนปิดหน้าต่างก็ยิง webglcontextlost)
 * - ข้อผิดพลาดตอนวาด (scene.renderError) หรือ render loop หยุด: Cesium จับข้อผิดพลาดนอก Scene.render (resize, initializeFrame, clock.tick
 *   ซึ่งรวม dataSourceDisplay.update) แล้วตั้ง useDefaultRenderLoop = false เงียบ ๆ (showRenderLoopErrors = false ไม่ยิง renderError)
 *   ตรวจทุก RENDER_LOOP_POLL_MS ภาพค้างที่เฟรมสุดท้าย และดำทันทีที่ canvas เปลี่ยนขนาด
 *   ครั้งแรก = เริ่มใหม่หนึ่งครั้ง (useDefaultRenderLoop = true แล้ว requestRender) แจ้ง onFailure(เหตุ, error, true)
 *   หยุดอีกภายใน RENDER_RETRY_WINDOW_MS หลังเริ่มใหม่ = เลิก (ไม่วนเริ่มใหม่) แจ้ง onFailure(เหตุ, error, false) ครั้งเดียว
 *   หยุดหลังจากนั้นนานกว่านั้น = นับเป็นครั้งใหม่ (เริ่มใหม่อีกหนึ่งครั้ง)
 * - context หาย = เลิกทันที แจ้ง false (เริ่ม loop ใหม่ไม่ช่วย)
 */
export function watchRenderFailure(
  viewer: ViewerParts,
  onFailure: (reason: RenderFailure, error: unknown, recovering: boolean) => void,
  env: RenderWatchEnv = BROWSER_ENV,
): () => void {
  let gaveUp = false;
  let restartedAt: number | null = null;
  const fail = (reason: RenderFailure, error?: unknown): void => {
    if (gaveUp) return;
    const now = env.now();
    if (reason !== "contextLost" && (restartedAt === null || now - restartedAt > RENDER_RETRY_WINDOW_MS)) {
      restartedAt = now;
      try {
        viewer.useDefaultRenderLoop = true; // setter ของ Cesium เริ่ม render loop ใหม่เมื่อมันไม่วิ่งอยู่
        viewer.scene.requestRender();
      } catch {
        // viewer เสียจนเริ่มใหม่ไม่ได้: ครั้งต่อไปที่ตรวจเจอจะเลิกเอง
      }
      onFailure(reason, error, true);
      return;
    }
    gaveUp = true;
    onFailure(reason, error, false);
  };
  const offRender = viewer.scene.renderError.addEventListener((_scene: unknown, error: unknown) => fail("renderError", error));
  const canvas = viewer.scene.canvas;
  const lost = (): void => fail("contextLost", undefined);
  canvas.addEventListener("webglcontextlost", lost);
  const stopPolling = env.every(RENDER_LOOP_POLL_MS, () => {
    if (viewer.useDefaultRenderLoop === false) fail("loopStopped", undefined);
  });
  return () => {
    offRender();
    canvas.removeEventListener("webglcontextlost", lost);
    stopPolling();
  };
}

/**
 * ถอดคลิกซ้าย (เลือก entity) และดับเบิลคลิก (pickAndTrackObject: ตาม entity หรือ zoomTo บินไปหา) ที่ Viewer ของ Cesium ใส่ไว้ใน handler ของมันเอง
 * (screenSpaceCameraController.enableInputs = false ไม่ได้ปิดสองอย่างนี้) ใช้กับ Sensor View และหน้าต่าง 2D:
 * ใน 2D คลิกซ้ายของ Viewer เรียก pickImageryLayerFeatures ซึ่งโยน DeveloperError "Ray intersections are only supported in 3D mode" ทุกครั้ง
 * หน้าต่าง 2D เลือก object เองด้วย pick.ts แบบหน้าต่าง 3D
 */
export function removeViewerPicking(viewer: { readonly screenSpaceEventHandler: ScreenSpaceEventHandler }): void {
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK);
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
}
