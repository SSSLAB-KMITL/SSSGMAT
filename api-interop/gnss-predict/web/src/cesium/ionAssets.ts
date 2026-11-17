// asset ภาพตั้งต้นของ Cesium ion (spec ภาพละเอียด §4.1) ให้ Globe Manager เลือกแบบ radio คู่กับช่อง Asset ID ที่กรอกเองได้
// Asset ID ทุกตัวยืนยันจากต้นฉบับของ CesiumJS 1.147 ที่แอปใช้อยู่ (ไม่ได้เรียก API ของ ion): Base Layer Picker ของ Cesium สร้างชั้นภาพชื่อเดียวกันนี้ด้วย
// - Google Maps 2D: IonImageryProvider.fromAssetId(<id>) ใน packages/widgets/Source/BaseLayerPicker/createDefaultImageryProviderViewModels.js
//   (node_modules/@cesium/widgets 16.3.1 = CesiumJS 1.147)
// - Bing Maps: createWorldImageryAsync({ style: IonWorldImageryStyle.<STYLE> }) ในไฟล์เดียวกัน ค่าของ style คือ Asset ID
//   ("these values map directly to ion asset ids") ใน packages/engine/Source/Scene/IonWorldImageryStyle.js (@cesium/engine 26.5.0)
// tests/unit/ion-assets.test.ts ตรวจทุก preset กับสองไฟล์นี้ใน node_modules
// Bing บน ion ประกาศให้ใช้ถึง ก.ย. 2026 (spec §5) จึงวาง Google ไว้ก่อน asset ที่บัญชีไม่มีหรือถูกถอด ion ตอบ 404 แล้วแอปแจ้งเป็นข้อความไทย

export interface IonPreset {
  id: number;
  /** ชื่อตามที่ Cesium ใช้ใน Base Layer Picker */
  title: string;
  /** ที่ยืนยัน Asset ID (ต้นฉบับ CesiumJS 1.147) */
  verifiedFrom: string;
}

const PICKER = "https://github.com/CesiumGS/cesium/blob/1.147/packages/widgets/Source/BaseLayerPicker/createDefaultImageryProviderViewModels.js";
const WORLD_STYLE = "https://github.com/CesiumGS/cesium/blob/1.147/packages/engine/Source/Scene/IonWorldImageryStyle.js";

export const ION_PRESETS: readonly IonPreset[] = Object.freeze([
  // "Google Maps Satellite": fromAssetId(3830182)
  { id: 3830182, title: "Google Maps Satellite", verifiedFrom: PICKER },
  // "Google Maps Satellite with Labels": fromAssetId(3830183)
  { id: 3830183, title: "Google Maps Satellite with Labels", verifiedFrom: PICKER },
  // "Google Maps Roadmap": fromAssetId(3830184)
  { id: 3830184, title: "Google Maps Roadmap", verifiedFrom: PICKER },
  // "Bing Maps Aerial": IonWorldImageryStyle.AERIAL = 2
  { id: 2, title: "Bing Maps Aerial", verifiedFrom: WORLD_STYLE },
  // "Bing Maps Aerial with Labels": IonWorldImageryStyle.AERIAL_WITH_LABELS = 3
  { id: 3, title: "Bing Maps Aerial with Labels", verifiedFrom: WORLD_STYLE },
  // "Bing Maps Roads": IonWorldImageryStyle.ROAD = 4
  { id: 4, title: "Bing Maps Roads", verifiedFrom: WORLD_STYLE },
].map((p) => Object.freeze(p)));

/** ชื่อบนจอของ asset: ชื่อของ preset หรือ "Cesium ion <id>" */
export function ionAssetTitle(assetId: number): string {
  return ION_PRESETS.find((p) => p.id === assetId)?.title ?? `Cesium ion ${assetId}`;
}
