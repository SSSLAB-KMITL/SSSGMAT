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
// CESIUM_BASE_URL (vite.config.ts define) = "/cesium": Workers, Assets, Widgets ถูกคัดลอกไปที่นั่นทั้งตอน build และเสิร์ฟตอน dev

import "cesium/Build/Cesium/Widgets/widgets.css";
import {
  buildModuleUrl, Color, GeographicProjection, GridImageryProvider, ImageryLayer, Ion, SceneMode, TileMapServiceImageryProvider, Viewer,
  WebMercatorProjection,
} from "cesium";

Ion.defaultAccessToken = "";

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


/** เหตุที่ภาพหยุด: ข้อผิดพลาดตอนวาด (scene.renderError) หรือ browser ทิ้ง WebGL context ของหน้าต่างนี้ (webglcontextlost) */
export type RenderFailure = "renderError" | "contextLost";

/** ส่วนของ Viewer ที่สองฟังก์ชันด้านล่างใช้ (Scene.context เป็นของภายในของ Cesium ไม่อยู่ใน type) test ส่งตัวปลอมได้ */
interface ViewerParts {
  scene: { renderError: Viewer["scene"]["renderError"]; canvas: HTMLCanvasElement };
  destroy(): void;
}
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
 * ฟังข้อผิดพลาดตอนวาดและ context ที่หาย แจ้ง onFailure ครั้งเดียว (ภาพหยุดแล้วทั้งสองแบบ) คืนฟังก์ชันถอดตัวฟังทั้งสอง
 * ต้องถอดก่อน destroyViewer: loseContext ที่ตั้งใจทำตอนปิดหน้าต่างก็ยิง webglcontextlost
 */
export function watchRenderFailure(viewer: ViewerParts, onFailure: (reason: RenderFailure, error?: unknown) => void): () => void {
  let told = false;
  const fail = (reason: RenderFailure, error?: unknown): void => {
    if (told) return;
    told = true;
    onFailure(reason, error);
  };
  const offRender = viewer.scene.renderError.addEventListener((_scene: unknown, error: unknown) => fail("renderError", error));
  const canvas = viewer.scene.canvas;
  const lost = (): void => fail("contextLost", undefined);
  canvas.addEventListener("webglcontextlost", lost);
  return () => {
    offRender();
    canvas.removeEventListener("webglcontextlost", lost);
  };
}
