// ชั้นภาพออนไลน์บน viewer 3D หนึ่งตัว (spec imagery §5.2, spec ภาพละเอียด §4) หน้าต่าง 3D และ Sensor View ต่อผ่าน scene3d.ts mount (attachImageryLayers)
//
// - ตามสี่ store: useImagery (สวิตช์ต่อแหล่ง + catalog), useLayout.globe (Show / Translucency และ asset ของ ion จาก Globe Manager),
//   useTime (เวลา Animation), useSettings (Cesium ion token)
// - แหล่ง (provider kinds): gibs และ eox = ชั้นใน catalog ผ่าน server ในเครื่อง (proxy) ; osm = OSM_LAYER ที่ browser ดึงตรง ; ion = Cesium ion ที่ browser ดึงตรง
// - ชั้นที่วาด = ชั้นที่ globe บอกว่าแสดง เฉพาะของแหล่งที่สวิตช์เปิด (ปิด = ไม่มีชั้นของแหล่งนั้นเลย ไม่มีคำขอไปโฮสต์นั้นจาก browser)
//   id ใน globe ที่ catalog ไม่รู้จักข้ามไป
//   การบัง (occlusion): วาดเฉพาะชั้นทึบบนสุดที่แสดงอยู่กับชั้นที่อยู่เหนือมัน ชั้นทึบ = translucency 0 และ jpg ภาพคงที่ (Blue Marble, EOX) หรือ OSM (isOpaqueLayer)
//   ชั้นข้างใต้ไม่ถูกสร้าง จึงไม่มีคำขอชิ้นภาพของมันเลย (วัดบน SE Asia: ราวครึ่งของคำขอไปที่ชั้นที่ OSM ทึบทับอยู่) Natural Earth II ยังเป็นฐานเสมอ (ออฟไลน์ ถูก)
//   คิดใหม่ทุกครั้งที่ Show / Translucency (useLayout.globe) หรือสวิตช์ของแหล่งเปลี่ยน ชั้นที่โผล่กลับมาวางตามลำดับวาดเดิม
// - ตำแหน่ง: เหนือ index 0 (Natural Earth II: applyProps ของ scene3d.ts ใช้ index 0 เป็นภาพฐานของกลางวัน/กลางคืน ห้ามแทรกที่ 0)
//   ลำดับวาด: GIBS ตาม catalog → EOX → OpenStreetMap (ชั้นหลังทับชั้นก่อน) ชั้นของ id หนึ่งวางต่อจากชั้นบนสุดของ id ก่อนหน้าที่วาดอยู่ (ไม่มี = index 1)
//   ชั้นใหม่จึงอยู่ใต้เส้น Lat/Lon ที่วางไว้ก่อนเสมอ ส่วนเส้น Lat/Lon ที่เปิดทีหลัง scene3d.ts ต่อท้ายรายการ (บนสุด) เอง
// - ชั้นละหนึ่ง UrlTemplateImageryProvider ของ viewer นี้เอง (ไม่ใช้ร่วมกับ viewer อื่น) Web Mercator, maximumLevel = max_level (ซูมลึกกว่านั้น Cesium ขยายจากระดับสูงสุด)
//   credit ของชั้น (NASA GIBS / EOSDIS, JMA, NOAA, EOX, © OpenStreetMap contributors) เป็น Credit ที่แสดงบนภาพ (showOnScreen) ไม่ใช่แค่ในกล่อง Data attribution
//   credit ของ OpenStreetMap เป็นลิงก์ไปหน้า https://www.openstreetmap.org/copyright (OSM_CREDIT_HTML ตามนโยบายของ OSM) ของแหล่งอื่นเป็นข้อความที่กันอักขระพิเศษแล้ว
//   proxy: url /api/imagery/tiles/{id}/{token}/{z}/{y}/{x} (same-origin)
//   tileDiscardPolicy = NeverTileDiscardPolicy: ไม่ทิ้งชิ้นใด แต่ทำให้ ImageryProvider.loadImage ของ Cesium โหลดด้วย XHR (preferBlob)
//   ทุก browser รหัส HTTP จึงมาถึง errorEvent ด้วย (ไม่มี policy: Safari/Firefox ที่ createImageBitmap ไม่รับ option โหลดด้วย <img> ไม่มีรหัส HTTP)
//   osm: url OSM_URL (https://tile.openstreetmap.org/{z}/{x}/{y}.png) maximumLevel 19 นโยบายเดิมของ Cesium (ขอเฉพาะชิ้นที่มองเห็น ไม่โหลดล่วงหน้า
//   ไม่มี tileDiscardPolicy ไม่เพิ่ม header) แอปไม่ตั้ง Referrer-Policy (browser ส่ง Referer ตามค่าปกติ ตามนโยบายของ OSM)
// - Cesium ion (spec ภาพละเอียด §4.1–§4.2): แสดงเมื่อสวิตช์ ion เปิด + globe.ion.assetId ไม่ใช่ null + token ไม่ว่าง (ion "shown")
//   IonImageryProvider.fromAssetId(assetId, { accessToken }) ของ viewer นี้เอง ไม่ตั้ง Ion.defaultAccessToken ทั่วแอป token ไม่อยู่ใน url ใดที่โค้ดนี้สร้าง
//   (Cesium เองส่ง token ให้ api.cesium.com ตอนขอ endpoint ของ asset) ชั้น ion วางที่ index 1 alpha 1 ด้านกลางคืนจางตาม Ambient Level เหมือนชั้นอื่น
//   ion shown = ชั้นอื่นทั้งหมดถูกเอาออก (ไม่มีคำขอไปแหล่งอื่น) และ alpha ของ Natural Earth II = 0 ในทุก viewer (ทุก viewer อ่าน store ชุดเดียวกัน)
//   ตั้งแต่ขอ provider (ไม่รอให้ ion ตอบ) จนเลิกแสดง ion แล้วคืนชั้นเดิมตาม store และ alpha เดิมของ Natural Earth II
//   token ว่าง (หลังอ่านค่าตั้งแล้ว) = ไม่มีชั้น ion ชั้นอื่นแสดงตามเดิม คำเตือนไทยครั้งเดียว ; ยังไม่ได้อ่านค่าตั้ง = รอ (ไม่ทำอะไร)
//   ion ปฏิเสธ (401/404, ไม่ใช่ภาพ, เครือข่าย) หรือชิ้นภาพของ ion พลาดเกินเกณฑ์ (tilesFailing: เกณฑ์เดียวกันทุก viewer) = failIon: ถอดชั้น ion ทุก viewer
//   ข้อความไทยครั้งเดียว (ไม่มี token) แล้วไม่ลองซ้ำกับ asset + token เดิมจนกว่าแผนของ ion เปลี่ยน (asset, None, สวิตช์, token: ionState.ts ลืมการปฏิเสธให้เอง
//   แม้ไม่มี viewer) ; IonImageryProvider.fromAssetId ของ Cesium จำ promise ของ endpoint ต่อ asset + token + server ไว้ใน _endpointCache และไม่ลบตัวที่ล้มเหลว
//   failIon จึงลบรายการนั้นเอง (ionEndpointCacheKey: คีย์แบบเดียวกับ Cesium) การลองใหม่จึงขอ endpoint ใหม่จริง
// - alpha = 1 − translucency/100 ; Ambient Level แบบภาพฐาน (scene3d.ts applyProps): dayAlpha = 1, nightAlpha = ระดับ/100
//   (Cesium คูณ alpha ด้วย mix(dayAlpha, nightAlpha) ด้านกลางคืนจึงจางเท่าภาพฐานโดยไม่แตะ translucency) ค่าจาก opts.nightAlpha และ setImageryNightAlpha
// - token ของเวลา (imageryTime.ts) เปลี่ยน → เปลี่ยนชั้นนั้นเป็น provider ของ token ใหม่ ไม่เกิน 1 ครั้งต่อ TOKEN_INTERVAL_MS ต่อ viewer
//   (Throttle: ครั้งแรกทำทันที ครั้งท้ายตามมาเสมอ) เวลาเปลี่ยนแต่ token เท่าเดิม = ไม่ทำอะไร
//   ชั้นเดิมอยู่ใต้ชั้นใหม่จนชั้นใหม่เริ่มโหลด (ชิ้นแรกได้ผล สำเร็จหรือไม่มีภาพ) จึงเอาออก ภาพไม่กะพริบ
//   ชั้นที่ยังไม่เริ่มโหลดแล้วถูกแทนอีก (animation เร็ว) เอาออกทันที: id หนึ่งมีไม่เกินสองชั้น (ชั้นที่รอ + ชั้นเดิมที่ยังแสดงอยู่)
//   ระหว่างนั้น HUD (imageryStatus) บอกเวลาและสัดส่วนชิ้นของชั้นเดิม เพราะเป็นภาพที่อยู่บนจอ
// - ชิ้นที่โหลดไม่ได้ (errorEvent ของ provider): ไม่ลองซ้ำ (retry = false) มีตัวฟังแล้ว Cesium จึงไม่พิมพ์ error ของมันเอง ชิ้นนั้นโปร่งใส
//   404 = ไม่มีภาพเวลานี้ นับต่อ (ชั้น, token) ไว้ให้ HUD (imageryStatus) ; 403 ของ proxy = server ปิดสวิตช์ของแหล่งนั้น (IMAGERY_DISABLED)
//   → useImagery.sources[แหล่งของชั้น] = false ทุก viewer เอาชั้นของแหล่งนั้นออก (403 ของ OpenStreetMap ไม่แตะสวิตช์ใด)
//   ข้อผิดพลาดอื่นของ GIBS/EOX (503 BUSY/PAUSED, เครือข่าย) ไม่นับเป็นไม่มีภาพ
//   รหัส HTTP มาจาก RequestErrorEvent.statusCode (XHR ของ preferBlob ข้างบน)
// - OpenStreetMap และ ion (browser ดึงตรง): ทุกข้อผิดพลาดนับเป็นชิ้นที่ขาด ไม่ว่ามีรหัส HTTP หรือไม่ (OSM ไม่มี tileDiscardPolicy: Safari โหลดด้วย <img> ไม่มีรหัส)
//   HUD จึงบอกสัดส่วนชิ้นที่ขาดจริง ; ชิ้นที่ได้ผลครบ TILE_FAILURE_MIN_SETTLED และพลาด ≥ TILE_FAILURE_RATIO (tilesFailing) =
//   OSM: ข้อความไทยครั้งเดียวต่อการเปิดหน้า (OSM อาจบล็อก หรือเน็ตหลุด) ไม่เปลี่ยนวิธีขอชิ้นภาพของ OSM ; ion: failIon (ข้างบน)
// - ทุกการเปลี่ยนเรียก scene.requestRender() (viewer ใช้ requestRenderMode)

import {
  Credit, ImageryLayer, IonImageryProvider, NeverTileDiscardPolicy, RuntimeError, UrlTemplateImageryProvider, WebMercatorTilingScheme, type Viewer,
} from "cesium";
import { msg } from "../labels/messages.th";
import { OSM_LAYER, OSM_URL, useImagery, type ImageryLayerInfo, type ImagerySourceId, type LayerSourceId } from "../stores/imagery";
import { useLayout } from "../stores/layout";
import { report } from "../stores/messages";
import { useSettings } from "../stores/settings";
import { useTime } from "../stores/time";
import { Throttle } from "../windows/graphics/throttle";
import { timeToken, tokenLabel } from "./imageryTime";
import { ionAssetTitle } from "./ionAssets";
import { getIonFailure, ionPlan, notifyIonListeners, onIonStatusChange, setIonFailure, type IonPlan } from "./ionState";

export { ionStatus, onIonStatusChange, type IonStatus } from "./ionState";

/** เปลี่ยนชั้นตามเวลาได้ไม่เกินหนึ่งครั้งต่อช่วงนี้ต่อ viewer */
export const TOKEN_INTERVAL_MS = 1000;

/** เกณฑ์ "ชิ้นภาพพลาดต่อเนื่อง" ของ OSM และ ion (ทุก viewer ใช้เกณฑ์เดียวกัน): ได้ผลแล้วอย่างน้อยเท่านี้ชิ้น ... */
export const TILE_FAILURE_MIN_SETTLED = 8;
/** ... และสัดส่วนที่พลาดอย่างน้อยเท่านี้ */
export const TILE_FAILURE_RATIO = 0.75;

/** credit ของ OpenStreetMap บนจอ: ลิงก์ไปหน้าลิขสิทธิ์ตามนโยบายของ OSM (Cesium กรอง HTML ของ credit ด้วย DOMPurify ก่อนวาด) */
const OSM_CREDIT_HTML = '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';

/** ส่วนของ Viewer ที่ใช้ (test ส่งตัวปลอมได้) */
type ImageryViewer = Pick<Viewer, "imageryLayers" | "scene">;

export interface ImageryTopLayer {
  id: string;
  title: string;
  /** เวลาของภาพสำหรับ HUD (tokenLabel) static = "" */
  label: string;
  /**
   * สัดส่วนชิ้นที่ขาดในชิ้นที่ได้ผลแล้วของ token ที่แสดงอยู่ ยังไม่มีชิ้นใด = 0
   * GIBS/EOX: ชิ้นที่ server ตอบ 404 (ไม่มีภาพเวลานี้) ; OSM และ ion: ทุกชิ้นที่โหลดไม่ได้ (ไม่ว่ารหัสใด)
   */
  missingRatio: number;
  source: ImagerySourceId;
  /** ระดับซูมละเอียดสุดของชั้น null = ยังไม่รู้ (ชั้น ion ที่ยังไม่ได้ provider) */
  max_level: number | null;
}

interface TileCounts {
  loaded: number;
  missing: number;
  failed: number;
}

/** ชิ้นภาพพลาดเกินเกณฑ์ (ได้ผลครบ TILE_FAILURE_MIN_SETTLED ชิ้น และพลาด ≥ TILE_FAILURE_RATIO) ชิ้นที่ "พลาด" = missing + failed */
const tilesFailing = (c: TileCounts): boolean => {
  const settled = c.loaded + c.missing + c.failed;
  return settled >= TILE_FAILURE_MIN_SETTLED && c.missing + c.failed >= TILE_FAILURE_RATIO * settled;
};

/** สัดส่วนชิ้นที่ขาดสำหรับ HUD: GIBS/EOX นับแค่ 404 (ไม่มีภาพเวลานี้) ; OSM และ ion นับทุกข้อผิดพลาด (ชิ้นนั้นว่างบนจอ) */
const missingRatioOf = (c: TileCounts, source: ImagerySourceId): number => {
  const settled = c.loaded + c.missing + c.failed;
  if (settled === 0) return 0;
  return (source === "osm" || source === "ion" ? c.missing + c.failed : c.missing) / settled;
};

/** ชั้นของ id หนึ่งบน viewer: ชั้นปัจจุบัน + ชั้นเดิมที่ยังแสดงอยู่จนชั้นปัจจุบันเริ่มโหลด */
interface Managed {
  info: ImageryLayerInfo;
  token: string;
  layer: ImageryLayer;
  /** ชั้นปัจจุบันได้ผลชิ้นแรกแล้ว */
  started: boolean;
  retiring: ImageryLayer | null;
  /** token ของชั้นเดิมที่ยังแสดงอยู่ (null = ไม่มีชั้นเดิม) */
  retiringToken: string | null;
}

interface Manager {
  status(): { topLayer: ImageryTopLayer | null };
  setNightAlpha(alpha: number): void;
}

const managers = new WeakMap<object, Manager>();

// ---------- Cesium ion: สถานะร่วมของทุก viewer (ตัวแผน ionPlan/ionStatus อยู่ใน ionState.ts: ไม่ import cesium จึงให้ Globe Manager ใช้ได้) ----------

/** คำเตือน "ไม่มี token" ที่แจ้งไปแล้ว (แจ้งครั้งเดียวต่อการเข้าสถานะนี้ ไม่ว่ามีกี่ viewer) */
let ionNotice: string | null = null;
/** แจ้งเรื่องชิ้นภาพ OpenStreetMap พลาดต่อเนื่องไปแล้วในหน้านี้ (ครั้งเดียวต่อการเปิดหน้า) */
let osmNoticeShown = false;

/** สำหรับ test: ลืมคำเตือนที่แจ้งไปแล้ว (เหมือนเปิดหน้าใหม่) */
export function resetImageryNoticesForTest(): void {
  ionNotice = null;
  osmNoticeShown = false;
}

/** หลังอ่านแผน: ไม่มี token = คำเตือนไทยครั้งเดียว (การลืมการปฏิเสธเมื่อแผนเปลี่ยนอยู่ใน ionState.ts) */
function noteIon(plan: IonPlan): void {
  if (plan.kind !== "noToken") {
    ionNotice = null;
    return;
  }
  const key = String(plan.assetId);
  if (ionNotice === key) return;
  ionNotice = key;
  report("warning", "IMAGERY_ION_TOKEN", msg("imagery.ionNoToken"));
}

const statusOf = (e: unknown): number | undefined => {
  const o = e as { statusCode?: unknown; error?: { statusCode?: unknown } } | null;
  const code = o?.statusCode ?? o?.error?.statusCode;
  return typeof code === "number" ? code : undefined;
};

/** เหตุผลภาษาไทยของการปฏิเสธ (ไม่ใช้ข้อความดิบของ Cesium: กันไม่ให้มีอะไรของคำขอหลุดเข้า Message Viewer) */
function ionReason(error: unknown): string {
  const status = statusOf(error);
  if (status === 401 || status === 403) return msg("imagery.ionReasonToken", { status });
  if (status === 404) return msg("imagery.ionReasonAsset");
  if (status !== undefined) return msg("imagery.ionReasonOther", { status });
  if (error instanceof RuntimeError) return msg("imagery.ionReasonNotImagery");
  return msg("imagery.ionReasonNetwork");
}

/** option ของ IonImageryProvider.fromAssetId: token อย่างเดียว ไม่มี server (ใช้ทั้งตอนขอและตอนสร้างคีย์ของ cache) */
const ionOptions = (token: string): { accessToken: string; server?: undefined } => ({ accessToken: token });

/**
 * คีย์ของ IonImageryProvider._endpointCache แบบเดียวกับ Cesium 1.147 (IonImageryProvider.fromAssetId):
 * assetId.toString() + options.accessToken + options.server (ไม่ส่ง server จึงต่อท้ายด้วย "undefined")
 */
export function ionEndpointCacheKey(assetId: number, token: string): string {
  const options = ionOptions(token);
  return assetId.toString() + options.accessToken + String(options.server);
}

/** ลบ promise ของ endpoint ที่ Cesium จำไว้ (Cesium ไม่ลบตัวที่ล้มเหลวเอง: ลองใหม่ด้วยค่าเดิมจะได้ผลเดิมจนโหลดหน้าใหม่) */
function forgetIonEndpoint(assetId: number, token: string): void {
  const cache = (IonImageryProvider as unknown as { _endpointCache?: Record<string, unknown> })._endpointCache;
  if (cache !== undefined) delete cache[ionEndpointCacheKey(assetId, token)];
}

/** ion ใช้ asset + token นี้ไม่ได้: ลืม endpoint ที่ Cesium จำไว้ จำการปฏิเสธ แจ้งครั้งเดียว แล้วบอกทุก viewer (ถอดชั้น ion คืนชั้นอื่น) เรียกซ้ำได้ */
function failIon(assetId: number, token: string, reason: string): void {
  forgetIonEndpoint(assetId, token);
  const failure = getIonFailure();
  if (failure !== null && failure.assetId === assetId && failure.token === token) return;
  setIonFailure({ assetId, token });
  report("warning", "IMAGERY_ION_FAILED", msg("imagery.ionFailed", { assetId, reason }));
  notifyIonListeners();
}

/** ชิ้นภาพ OpenStreetMap พลาดเกินเกณฑ์: ข้อความไทยครั้งเดียวต่อการเปิดหน้า (ไม่ว่ามีกี่ viewer) */
function noteOsmFailing(): void {
  if (osmNoticeShown) return;
  osmNoticeShown = true;
  report("warning", "IMAGERY_OSM_FAILED", msg("imagery.osmFailed"));
}

// ---------- ชั้นของ catalog และ OpenStreetMap ----------

/** ลำดับวาดของแหล่ง (ชั้นหลังทับชั้นก่อน) ภายในแหล่งเดียวกันตามลำดับ catalog */
const SOURCE_ORDER: Readonly<Record<LayerSourceId, number>> = { gibs: 0, eox: 1, osm: 2 };

const alphaOf = (id: string): number => {
  const t = useLayout.getState().globe.layers[id]?.translucency ?? 0;
  return 1 - t / 100;
};

/**
 * ชั้นนี้บังทุกอย่างข้างใต้ทั้งลูกโลกเสมอ: translucency 0 และภาพทึบที่มีทุกชิ้นทุกเวลา = jpg ภาพคงที่ (Blue Marble, EOX) หรือ OpenStreetMap (png แต่ทึบ)
 * ชั้นที่ผูกเวลา (daily: VIIRS, MODIS ; 10min: Himawari, GOES) ไม่นับว่าทึบ แม้เป็น jpg: เวลาที่ยังไม่มีภาพ (scenario พยากรณ์ล่วงหน้า) server ตอบ 404
 * ชิ้นนั้นโปร่งใส ชั้นข้างใต้ (Blue Marble) ต้องยังอยู่ให้เห็น และ GOES/Himawari เห็นแค่จานโลกของดาวค้างฟ้า png ของ GIBS (Himawari) ไม่ทึบอยู่แล้ว
 */
export const isOpaqueLayer = (info: ImageryLayerInfo, alpha: number): boolean =>
  alpha === 1 && (info.source === "osm" || (info.format === "jpg" && info.period === "static"));

/**
 * ชั้นที่ควรวาด (ion shown = ไม่มีเลย) ตามลำดับวาด: ชั้นที่แสดงอยู่ตั้งแต่ชั้นทึบบนสุด (isOpaqueLayer) ขึ้นไป
 * ชั้นใต้ชั้นทึบมองไม่เห็นอยู่แล้ว จึงไม่สร้าง (ไม่มีคำขอชิ้นภาพของมัน) Natural Earth II (index 0) ไม่อยู่ในรายการนี้ ยังเป็นภาพฐานเสมอ
 */
const shownLayers = (): ImageryLayerInfo[] => {
  if (ionPlan().kind === "shown") return [];
  const { sources, layers } = useImagery.getState();
  const globe = useLayout.getState().globe;
  const order = [...layers, OSM_LAYER]
    .filter((l) => sources[l.source] && globe.layers[l.id]?.show === true)
    .sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]);
  for (let i = order.length - 1; i > 0; i--) if (isOpaqueLayer(order[i], alphaOf(order[i].id))) return order.slice(i);
  return order;
};

/** ข้อความเครดิตเป็น HTML ของ Credit: กันอักขระพิเศษไว้ (ค่ามาจาก catalog ของ server) */
const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** ชั้น ion บน viewer: layer = null ระหว่างรอ provider ; tiles = ชิ้นของชั้นนี้ (ทุกข้อผิดพลาดนับใน failed) */
interface IonManaged {
  key: string;
  assetId: number;
  layer: ImageryLayer | null;
  maxLevel: number | null;
  tiles: TileCounts;
}

/**
 * ต่อชั้นภาพออนไลน์เข้ากับ viewer ตามสวิตช์ globe และเวลา คืนฟังก์ชันถอด (เอาชั้นออก คืน alpha ของภาพฐาน และเลิกฟัง) เรียกก่อนทำลาย viewer
 * opts.now: นาฬิกาของ Throttle (test ฉีดได้) ; opts.nightAlpha: Ambient Level/100 ของหน้าต่าง (ไม่ระบุ = 1) เปลี่ยนทีหลังด้วย setImageryNightAlpha
 */
export function attachImageryLayers(viewer: ImageryViewer, opts: { now?: () => number; nightAlpha?: number } = {}): () => void {
  const layers = viewer.imageryLayers;
  /** Natural Earth II (index 0 ตอนต่อ ชั้นของที่นี่ไม่แทรกที่ 0 จึงยังเป็นตัวเดิม) */
  const base: ImageryLayer | undefined = layers.length > 0 ? layers.get(0) : undefined;
  /** alpha ของภาพฐานก่อน ion ซ่อน (null = ไม่ได้ซ่อนอยู่) */
  let baseAlpha: number | null = null;
  let ion: IonManaged | null = null;
  const managed = new Map<string, Managed>();
  /** จำนวนชิ้นต่อ "id/token" ของชั้นปัจจุบันและชั้นเดิมที่ยังแสดงอยู่ */
  const counts = new Map<string, TileCounts>();
  let detached = false;
  let nightAlpha = opts.nightAlpha ?? 1;

  /** ลบยอดนับของ id นี้ ยกเว้นของ token ที่ยังใช้อยู่ */
  const dropCounts = (id: string, keep: readonly (string | null)[]): void => {
    for (const key of [...counts.keys()]) {
      if (key.startsWith(`${id}/`) && !keep.some((token) => token !== null && key === `${id}/${token}`)) counts.delete(key);
    }
  };

  const countsFor = (id: string, token: string): TileCounts => {
    const key = `${id}/${token}`;
    let c = counts.get(key);
    if (c === undefined) {
      c = { loaded: 0, missing: 0, failed: 0 };
      counts.set(key, c);
    }
    return c;
  };

  const drop = (layer: ImageryLayer | null): void => {
    if (layer !== null && layers.contains(layer)) layers.remove(layer, true);
  };

  /** index ที่ชั้นใหม่ของ id นี้ควรอยู่: ต่อจากชั้นเดิมที่ยังแสดงของมันเอง หรือชั้นบนสุดของ id ก่อนหน้าใน catalog ที่วาดอยู่ หรือ index 1 */
  const insertIndex = (id: string, order: readonly ImageryLayerInfo[]): number => {
    const own = managed.get(id)?.retiring;
    const ownAt = own ? layers.indexOf(own) : -1;
    if (ownAt >= 0) return ownAt + 1;
    const at = order.findIndex((l) => l.id === id);
    for (let i = at - 1; i >= 0; i--) {
      const m = managed.get(order[i].id);
      const below = m === undefined ? -1 : layers.indexOf(m.layer);
      if (below >= 0) return below + 1;
    }
    return Math.min(1, layers.length);
  };

  const makeLayer = (info: ImageryLayerInfo, token: string): ImageryLayer => {
    const credit = new Credit(info.source === "osm" ? OSM_CREDIT_HTML : escapeHtml(info.credit), true);
    const common = { tilingScheme: new WebMercatorTilingScheme(), maximumLevel: info.max_level, credit };
    const provider = info.source === "osm"
      ? new UrlTemplateImageryProvider({ url: OSM_URL, ...common })
      : new UrlTemplateImageryProvider({ url: `/api/imagery/tiles/${info.id}/${token}/{z}/{y}/{x}`, ...common, tileDiscardPolicy: new NeverTileDiscardPolicy() });
    const tiles = countsFor(info.id, token);
    /** OSM: ชิ้นพลาดเกินเกณฑ์ = ข้อความไทย (ครั้งเดียวต่อหน้า) */
    const checkFailing = (): void => {
      if (info.source === "osm" && tilesFailing(tiles)) noteOsmFailing();
    };
    const started = (): void => {
      const m = managed.get(info.id);
      if (detached || m === undefined || m.layer !== layer || m.started) return;
      m.started = true;
      drop(m.retiring);
      m.retiring = null;
      m.retiringToken = null;
      dropCounts(info.id, [m.token]);
      viewer.scene.requestRender();
    };
    const request = provider.requestImage.bind(provider);
    provider.requestImage = (x, y, level, req) => {
      const p = request(x, y, level, req);
      p?.then(
        () => {
          tiles.loaded++;
          checkFailing();
          started();
        },
        () => undefined, // ข้อผิดพลาดนับใน errorEvent (การยกเลิกของ Cesium ไม่ใช่ข้อผิดพลาด)
      );
      return p;
    };
    provider.errorEvent.addEventListener((error: { retry?: boolean }) => {
      error.retry = false;
      if (detached) return;
      const code = statusOf(error);
      const source = info.source;
      if (code === 403 && source !== "osm") {
        // หลังตัวแจ้งของ Cesium จบ: ไม่เอาชั้นออกระหว่างที่ ImageryLayer ของมันยังอยู่ในตัวจัดการข้อผิดพลาดของตัวเอง
        queueMicrotask(() => useImagery.setState((s) => ({ sources: { ...s.sources, [source]: false } })));
        return;
      }
      if (code === 404) tiles.missing++;
      else tiles.failed++;
      checkFailing();
      started();
    });
    const layer = new ImageryLayer(provider);
    layer.alpha = alphaOf(info.id);
    layer.dayAlpha = 1;
    layer.nightAlpha = nightAlpha;
    return layer;
  };

  const remove = (id: string): void => {
    const m = managed.get(id);
    if (m === undefined) return;
    drop(m.retiring);
    drop(m.layer);
    managed.delete(id);
    for (const key of [...counts.keys()]) if (key.startsWith(`${id}/`)) counts.delete(key);
  };

  /** ชั้นของ id นี้เป็น token ใหม่: ชั้นปัจจุบันที่เริ่มโหลดแล้วกลายเป็นชั้นเดิมที่รอ ที่ยังไม่เริ่มโหลดเอาออกทันที */
  const replace = (m: Managed, token: string, order: readonly ImageryLayerInfo[]): void => {
    if (m.started) {
      drop(m.retiring);
      m.retiring = m.layer;
      m.retiringToken = m.token;
    } else {
      drop(m.layer);
    }
    dropCounts(m.info.id, [m.retiringToken]);
    const layer = makeLayer(m.info, token);
    layers.add(layer, insertIndex(m.info.id, order));
    m.layer = layer;
    m.token = token;
    m.started = false;
  };

  /** ion shown = alpha ของภาพฐาน 0 (จำค่าเดิมไว้) เลิกแสดง = คืนค่าเดิม คืนว่าเปลี่ยนไหม */
  const syncBase = (hide: boolean): boolean => {
    if (base === undefined) return false;
    if (hide && baseAlpha === null) {
      baseAlpha = base.alpha;
      base.alpha = 0;
      return true;
    }
    if (!hide && baseAlpha !== null) {
      base.alpha = baseAlpha;
      baseAlpha = null;
      return true;
    }
    return false;
  };

  /** ชั้น ion ตรงกับแผน: asset/token เปลี่ยน = ชั้นใหม่ ; ไม่ shown = เอาออก คืนว่าเปลี่ยนไหม */
  const syncIon = (plan: IonPlan): boolean => {
    const key = plan.kind === "shown" ? `${plan.assetId}\n${plan.token}` : null;
    if (ion === null ? key === null : ion.key === key) return false;
    if (ion !== null) {
      drop(ion.layer);
      ion = null;
    }
    if (plan.kind !== "shown" || key === null) return true;
    const { assetId, token } = plan;
    const cur: IonManaged = { key, assetId, layer: null, maxLevel: null, tiles: { loaded: 0, missing: 0, failed: 0 } };
    ion = cur;
    /** ชิ้นของ ion พลาดเกินเกณฑ์: failIon หลังตัวแจ้งของ Cesium จบ (ไม่ถอดชั้นระหว่างที่ ImageryLayer ยังอยู่ในตัวจัดการของตัวเอง) */
    const checkFailing = (): void => {
      if (!tilesFailing(cur.tiles)) return;
      const settled = cur.tiles.loaded + cur.tiles.missing + cur.tiles.failed;
      const failed = cur.tiles.missing + cur.tiles.failed;
      queueMicrotask(() => {
        if (detached || ion !== cur) return;
        failIon(assetId, token, msg("imagery.ionReasonTiles", { failed, settled }));
        sync(); // viewer อื่นบันทึกไปก่อนแล้ว: failIon ไม่แจ้งซ้ำ viewer นี้คืนชั้นเอง
      });
    };
    let pending: Promise<IonImageryProvider>;
    try {
      pending = IonImageryProvider.fromAssetId(assetId, ionOptions(token));
    } catch (e) {
      pending = Promise.reject(e);
    }
    pending.then(
      (provider) => {
        if (detached || ion !== cur) return; // เลิกต้องการแล้ว (asset/token เปลี่ยน, เลิกแสดง, ถอด viewer)
        const request = provider.requestImage.bind(provider);
        provider.requestImage = (x, y, level, req) => {
          const p = request(x, y, level, req);
          p?.then(
            () => {
              if (detached || ion !== cur) return;
              cur.tiles.loaded++;
              checkFailing();
            },
            () => undefined, // ข้อผิดพลาดนับใน errorEvent (การยกเลิกของ Cesium ไม่ใช่ข้อผิดพลาด)
          );
          return p;
        };
        provider.errorEvent.addEventListener((error: { retry?: boolean }) => {
          error.retry = false; // ชิ้นที่โหลดไม่ได้ไม่ลองซ้ำ (มีตัวฟังแล้ว Cesium จึงไม่พิมพ์ error เอง)
          if (detached || ion !== cur) return;
          cur.tiles.failed++; // ทุกรหัส หรือไม่มีรหัส
          checkFailing();
        });
        const layer = new ImageryLayer(provider);
        layer.alpha = 1;
        layer.dayAlpha = 1;
        layer.nightAlpha = nightAlpha;
        layers.add(layer, Math.min(1, layers.length));
        cur.layer = layer;
        cur.maxLevel = provider.maximumLevel ?? null;
        viewer.scene.requestRender();
      },
      (error: unknown) => {
        if (detached || ion !== cur) return;
        ion = null;
        failIon(assetId, token, ionReason(error));
        sync(); // viewer อื่นบันทึกการปฏิเสธไปก่อนแล้ว: failIon ไม่แจ้งซ้ำ viewer นี้คืนชั้นเอง
      },
    );
    return true;
  };

  /** ทำให้ชั้นบน viewer ตรงกับ store; replaceTokens = false: ชั้นที่ token เก่าแล้วยังไม่เปลี่ยน (รอ Throttle) คืนว่ามีชั้นที่ token เก่าอยู่ไหม */
  const reconcile = (replaceTokens: boolean): boolean => {
    if (detached) return false;
    const plan = ionPlan();
    noteIon(plan);
    let changed = syncIon(plan);
    if (syncBase(plan.kind === "shown")) changed = true;
    const order = shownLayers();
    const wanted = new Set(order.map((l) => l.id));
    for (const id of [...managed.keys()]) {
      if (!wanted.has(id)) {
        remove(id);
        changed = true;
      }
    }
    const now = useTime.getState().current;
    let stale = false;
    for (const info of order) {
      const token = timeToken(info.period, now);
      const m = managed.get(info.id);
      if (m === undefined) {
        const layer = makeLayer(info, token);
        layers.add(layer, insertIndex(info.id, order));
        managed.set(info.id, { info, token, layer, started: false, retiring: null, retiringToken: null });
        changed = true;
        continue;
      }
      m.info = info;
      const alpha = alphaOf(info.id);
      if (m.layer.alpha !== alpha) {
        m.layer.alpha = alpha;
        if (m.retiring !== null) m.retiring.alpha = alpha;
        changed = true;
      }
      if (m.token !== token) {
        if (replaceTokens) {
          replace(m, token, order);
          changed = true;
        } else stale = true;
      }
    }
    if (changed) viewer.scene.requestRender();
    return stale;
  };

  const throttle = new Throttle(TOKEN_INTERVAL_MS, () => void reconcile(true), opts.now);
  function sync(): void {
    if (reconcile(false)) throttle.request();
  }

  // ชั้นแรกใช้ token ของเวลาตอนนี้ ไม่ใช่การเปลี่ยน token จึงไม่นับเป็นครั้งของ Throttle
  reconcile(true);

  const offs = [
    useImagery.subscribe((s, prev) => {
      if (s.sources !== prev.sources || s.layers !== prev.layers) sync();
    }),
    useSettings.subscribe((s, prev) => {
      if (s.settings !== prev.settings) sync(); // Cesium ion token
    }),
    onIonStatusChange(sync),
    useLayout.subscribe((s, prev) => {
      if (s.globe !== prev.globe) sync();
    }),
    useTime.subscribe((s, prev) => {
      if (s.current !== prev.current) sync();
    }),
  ];

  const manager: Manager = {
    status: () => {
      if (ion !== null) {
        return {
          topLayer: { id: "ion", title: ionAssetTitle(ion.assetId), label: "", missingRatio: missingRatioOf(ion.tiles, "ion"), source: "ion", max_level: ion.maxLevel },
        };
      }
      const order = shownLayers();
      for (let i = order.length - 1; i >= 0; i--) {
        const m = managed.get(order[i].id);
        if (m === undefined) continue;
        // ชั้นใหม่ยังไม่ได้ชิ้นใด: ภาพบนจอยังเป็นชั้นเดิม
        const token = !m.started && m.retiringToken !== null ? m.retiringToken : m.token;
        const c = counts.get(`${m.info.id}/${token}`) ?? { loaded: 0, missing: 0, failed: 0 };
        return {
          topLayer: {
            id: m.info.id, title: m.info.title, label: tokenLabel(m.info.period, token), missingRatio: missingRatioOf(c, m.info.source),
            source: m.info.source, max_level: m.info.max_level,
          },
        };
      }
      return { topLayer: null };
    },
    setNightAlpha: (alpha) => {
      if (detached || alpha === nightAlpha) return;
      nightAlpha = alpha;
      for (const m of managed.values()) {
        m.layer.nightAlpha = alpha;
        if (m.retiring !== null) m.retiring.nightAlpha = alpha;
      }
      if (ion?.layer) ion.layer.nightAlpha = alpha;
      viewer.scene.requestRender();
    },
  };
  managers.set(viewer, manager);

  return () => {
    if (detached) return;
    for (const off of offs) off();
    throttle.dispose();
    for (const id of [...managed.keys()]) remove(id);
    if (ion !== null) drop(ion.layer);
    ion = null;
    syncBase(false);
    detached = true;
    if (managers.get(viewer) === manager) managers.delete(viewer);
    viewer.scene.requestRender();
  };
}

/** Ambient Level ของหน้าต่างเปลี่ยน (scene3d.ts applyProps): nightAlpha ของทุกชั้นออนไลน์บน viewer นี้ (viewer ที่ไม่ได้ต่อ = ไม่ทำอะไร) */
export function setImageryNightAlpha(viewer: object, alpha: number): void {
  managers.get(viewer)?.setNightAlpha(alpha);
}

/**
 * สถานะสำหรับ HUD ของ Sensor View: ชั้นบนสุดที่แสดงอยู่ (ชั้น ion เมื่อแสดง ion แม้ยังรอ provider, ไม่งั้นชั้นสุดท้ายตามลำดับวาด)
 * null = ไม่มี (Natural Earth II) หรือ viewer ไม่ได้ต่อ
 */
export function imageryStatus(viewer: object): { topLayer: ImageryTopLayer | null } {
  return managers.get(viewer)?.status() ?? { topLayer: null };
}
