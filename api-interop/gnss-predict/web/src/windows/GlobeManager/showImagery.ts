// Show Imagery (ข2 Task 7, เพิ่มเอง: STK ไม่มีคำสั่งนี้) ของเมนู Satellite และเมนูคลิกขวาบนดาวในหน้าต่าง 3D
//
// - ใช้ได้เมื่อมี scenario, object ที่เลือกเป็น Satellite ที่มีใน doc และ NORAD ของมันมี preset (stores/imagingPresets.ts อ่านได้แล้ว; Ruling o)
// - ขั้นตอน:
//   1. preset ตาม NORAD ของดาว
//   2. สวิตช์ GIBS ปิด = enableSourceWithConsent("gibs") (กล่องเดียวกับ Globe Manager: Ruling f) ยกเลิกหรือบันทึกไม่สำเร็จ = จบ ไม่แตะอะไร
//   3. ชั้น GIBS ของดาวอยู่ในรายการของ server = ติ๊ก Show (% Translucency คงเดิม) ไม่อยู่ = คำเตือนไทย showImagery.noLayer
//      ชั้นทึบที่วาดอยู่เหนือมัน (EOX, OpenStreetMap หรือ GIBS ภาพคงที่: isOpaqueLayer), ชั้น GIBS ของดาวถ่ายภาพดวงอื่นที่อยู่เหนือมัน
//      และ Cesium ion ที่แสดงแทนทุกชั้น ถูกซ่อน (amendment x: Show ของแถวใน workbook / asset ของ ion = None ไม่แตะสวิตช์แหล่ง)
//      พร้อมข้อความไทยหนึ่งข้อความที่บอกชื่อชั้นเหล่านั้น (ion บอกวิธีคืนของมันเอง)
//   4. ดาวมี sensor ลูก = เปิด Sensor View ของ sensor ตัวแรกในต้นไม้ (Ruling n)
//      ไม่มี = กล้องของหน้าต่าง 3D ที่ active บินไปเหนือจุดใต้ดาว ณ เวลาปัจจุบัน ไม่สร้าง object ใด (amendment z)
//      ความสูงของกล้อง = ความสูงของดาว แต่ไม่ต่ำกว่า FLY_OVER_MIN_KM ; ไม่มีหน้าต่าง 3D ที่มีตำแหน่งของดาว = ข้อความไทย ไม่ย้ายกล้อง
// - ไฟล์นี้ไม่ import Cesium (คำสั่งอยู่ใน bundle หลัก)

import { objectPath } from "../../cesium/colors";
import { ionPlan } from "../../cesium/ionState";
import { subSatellite } from "../../cesium/swath";
import { COMMAND_LABELS, invalidateCommands, registerCommand } from "../../commands";
import { msg } from "../../labels/messages.th";
import { isOpaqueLayer, LAYER_SOURCE_ORDER, OSM_LAYER, useImagery, type ImageryLayerInfo } from "../../stores/imagery";
import { presetOfNorad, useImagingPresets, type ImagingPresetOut } from "../../stores/imagingPresets";
import { useLayout } from "../../stores/layout";
import { report } from "../../stores/messages";
import { useScenario } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";
import { activeScene } from "../Graphics3D/registry";
import { firstSensorOf, openSensorView } from "../SensorView/commands";
import { enableSourceWithConsent } from "./consent";

const SATELLITE = /^\*\/Satellite\/[^/]+$/;

/**
 * ความสูงต่ำสุดของกล้องเหนือจุดใต้ดาว (km): มุมมองตั้งต้น 60° ของ Cesium จากความสูงนี้เห็นพื้นราว 3,500 km
 * กว้างกว่าแนวถ่ายภาพที่กว้างที่สุด (VIIRS ราว 3,052 km) ดาว LEO จึงเห็นทั้งแถบ ส่วนดาวค้างฟ้ามองจากความสูงของมันเอง
 */
const FLY_OVER_MIN_KM = 3000;

const nameOf = (path: string): string => path.split("/").at(-1) ?? "";

/** NORAD ของดาวที่ path ใน doc ของ scenario ที่เปิดอยู่ ไม่ใช่ดาวหรือไม่มี = null */
function noradOf(path: string): number | null {
  const obj = useScenario.getState().doc?.objects.find((o) => objectPath(o) === path);
  return obj !== undefined && obj.class === "Satellite" ? obj.norad : null;
}

/** preset ของดาวที่ path ไม่ใช่ดาวถ่ายภาพ (หรือยังอ่าน preset ไม่ได้) = undefined */
function presetOf(path: string): ImagingPresetOut | undefined {
  if (!SATELLITE.test(path) || !useImagingPresets.getState().loaded) return undefined;
  const norad = noradOf(path);
  return norad === null ? undefined : presetOfNorad(norad);
}

/** ดาวถ่ายภาพที่เลือกอยู่ (path) ไม่ใช่ = null */
function target(): string | null {
  const path = useSelection.getState().activePath;
  return path !== null && presetOf(path) !== undefined ? path : null;
}

/** ชั้นที่ viewer วาดตามลำดับ (ล่างขึ้นบน): แหล่งที่สวิตช์เปิดและ Show ติ๊ก (ลำดับเดียวกับ cesium/imageryLayers.ts) */
function drawnLayers(): ImageryLayerInfo[] {
  const { sources, layers } = useImagery.getState();
  const globe = useLayout.getState().globe.layers;
  return [...layers, OSM_LAYER]
    .filter((l) => sources[l.source] && globe[l.id]?.show === true)
    .sort((a, b) => LAYER_SOURCE_ORDER[a.source] - LAYER_SOURCE_ORDER[b.source]);
}

/**
 * ซ่อนสิ่งที่บัง layer (amendment x และ fix round 1 M2, M4) แล้วบอกในข้อความไทยหนึ่งข้อความ:
 * - ชั้นที่วาดอยู่เหนือ layer ที่ทึบ (isOpaqueLayer) หรือเป็นชั้น GIBS ของดาวถ่ายภาพดวงอื่น (gibs_layer ของ preset เช่นภาพรายวันของ Aqua เหนือ Terra)
 *   = Show ของแถวใน workbook ปิด (สวิตช์แหล่งไม่แตะ)
 * - Cesium ion ที่แสดงแทนทุกชั้น (หรือรออ่าน token) = asset เป็น None สวิตช์ ion คงเปิด ข้อความบอกวิธีคืนของ ion เอง (เลือก asset กลับ)
 */
function uncover(layer: ImageryLayerInfo): void {
  const layout = useLayout.getState();
  const drawn = drawnLayers();
  const above = drawn.slice(drawn.findIndex((l) => l.id === layer.id) + 1);
  const imaging = new Set(useImagingPresets.getState().presets.map((p) => p.gibs_layer));
  const hidden: string[] = [];
  for (const l of above) {
    const translucency = layout.globe.layers[l.id]?.translucency ?? 0;
    if (!isOpaqueLayer(l, 1 - translucency / 100) && !imaging.has(l.id)) continue;
    layout.setGlobeLayer(l.id, { show: false });
    hidden.push(l.title);
  }
  const parts: string[] = [];
  if (hidden.length > 0) parts.push(msg("showImagery.uncovered", { layers: hidden.join(", "), layer: layer.title }));
  const ion = ionPlan().kind;
  if (ion === "shown" || ion === "waiting") {
    layout.setGlobeIon(null);
    parts.push(msg("showImagery.uncoveredIon", { layer: layer.title }));
  }
  if (parts.length > 0) report("info", "SHOW_IMAGERY_UNCOVERED", parts.join(" "));
}

/** กล้อง 3D ไปเหนือจุดใต้ดาว ณ เวลาปัจจุบัน (ไม่มีหน้าต่าง 3D หรือตำแหน่ง = ข้อความไทย) */
function flyOverSatellite(satellite: string, layerTitle: string): void {
  const scene = activeScene();
  const p = scene?.entityPositionEcef(satellite) ?? null;
  if (scene === undefined || p === null || scene.flyOver === undefined) {
    report("info", "SHOW_IMAGERY_NO_VIEW", msg("showImagery.noView", { satellite, layer: layerTitle }));
    return;
  }
  const sub = subSatellite({ x: p[0], y: p[1], z: p[2] });
  scene.flyOver(sub.lon, sub.lat, Math.max(sub.altKm, FLY_OVER_MIN_KM) * 1000);
}

/** Show Imagery ของดาวที่ satellitePath (ไม่ใช่ดาวถ่ายภาพ = ไม่ทำอะไร) */
export async function showImagery(satellitePath: string): Promise<void> {
  const preset = presetOf(satellitePath);
  if (preset === undefined) return;
  const scenario = useScenario.getState().name;
  if (!(await enableSourceWithConsent("gibs"))) return;
  if (useScenario.getState().name !== scenario) return; // สลับ scenario ระหว่างถาม: ไม่ทำต่อกับ scenario อื่น

  const layer = useImagery.getState().layers.find((l) => l.id === preset.gibs_layer);
  if (layer === undefined) {
    report("warning", "SHOW_IMAGERY_NO_LAYER", msg("showImagery.noLayer", { layer: preset.gibs_layer }));
  } else {
    useLayout.getState().setGlobeLayer(layer.id, { show: true });
    uncover(layer);
  }

  const sensor = firstSensorOf(satellitePath);
  if (sensor !== null) openSensorView(sensor);
  else flyOverSatellite(nameOf(satellitePath), layer?.title ?? preset.gibs_layer);
}

export function registerShowImageryCommand(): () => void {
  const dispose = registerCommand("object.showImagery", {
    label: COMMAND_LABELS["object.showImagery"],
    run: async () => {
      const path = target();
      if (path !== null) await showImagery(path);
    },
    enabled: () => useScenario.getState().name !== null && target() !== null,
  });
  const unsubscribe = [
    useSelection.subscribe((s, prev) => {
      if (s.activePath !== prev.activePath) invalidateCommands();
    }),
    useScenario.subscribe((s, prev) => {
      if (s.name !== prev.name || s.doc !== prev.doc) invalidateCommands();
    }),
    useImagingPresets.subscribe((s, prev) => {
      if (s.presets !== prev.presets || s.loaded !== prev.loaded) invalidateCommands();
    }),
  ];
  return () => {
    for (const off of unsubscribe) off();
    dispose();
  };
}
