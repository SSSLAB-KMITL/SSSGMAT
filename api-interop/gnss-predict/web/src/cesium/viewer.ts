// Viewer ของ Cesium ที่ไม่ต่อเน็ต (W7, spec §9.1):
// - ภาพโลก NaturalEarthII ที่มากับ Cesium (/cesium/Assets/Textures/NaturalEarthII) ไม่มี Ion, Bing, terrain (ใช้ทรงรีเรียบ) หรือ geocoder
//   Ion.defaultAccessToken = "" กันโค้ดใดเผลอเรียก Ion ด้วย token ตั้งต้น
// - ปิด widget สำเร็จรูปทุกตัว เหลือ credit ที่มุมล่างของ viewer (Cesium วางเอง)
// - shouldAnimate = false และไม่ตามนาฬิกาของ data source: เวลามาจาก useTime ผ่าน clockSync เท่านั้น
// - requestRenderMode: วาดเมื่อขอ (เวลา กราฟิก หรือกล้องเปลี่ยน) maximumRenderTimeChange = ∞ เพราะเราขอเองทุกครั้งที่ตั้งเวลา
// - เครื่องที่ไม่มี WebGL: new Viewer โยน ผู้เรียกจับแล้วแสดงข้อความไทยแทน (Cesium วาดกล่อง error ของตัวเองใน el ไว้ ผู้เรียกล้าง el)
// CESIUM_BASE_URL (vite.config.ts define) = "/cesium": Workers, Assets, Widgets ถูกคัดลอกไปที่นั่นทั้งตอน build และเสิร์ฟตอน dev

import "cesium/Build/Cesium/Widgets/widgets.css";
import { buildModuleUrl, ImageryLayer, Ion, SceneMode, TileMapServiceImageryProvider, Viewer } from "cesium";

Ion.defaultAccessToken = "";

/** ภาพโลกที่มากับ Cesium (ความละเอียดต่ำ ระดับ 0–2: ประหยัดหน่วยความจำ GPU เมื่อเปิดหลายหน้าต่าง, spec §17 W1) */
export function naturalEarthLayer(): ImageryLayer {
  return ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII")));
}

export function createViewer(el: HTMLElement, mode: "3d" | "2d"): Viewer {
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
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    sceneMode: mode === "2d" ? SceneMode.SCENE2D : SceneMode.SCENE3D,
    scene3DOnly: mode === "3d",
  });
  viewer.clock.shouldAnimate = false;
  return viewer;
}
