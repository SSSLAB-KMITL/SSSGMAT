// หน้าต่าง Sensor View - <sensor> (<ดาว>) (เพิ่มเอง, sensor spec §5.4) ส่วน React: แถบ Up (North / Velocity), แถบแจ้งผลลัพธ์,
// ข้อความแทนภาพ และข้อความบนภาพ ส่วน Cesium อยู่ใน Graphics3D/scene3d.ts (mountSensorView: scene เดียวกับหน้าต่าง 3D, dynamic import)
//
// - params ของ panel = { path, up, display, zoom } (registry.ts) เปลี่ยนค่าใด (รวม path จาก Rename) = handle.viewFromSensor ใหม่ ค่าเก็บใน params (P8)
// - ข้อความบนภาพ (P4): handle.sensorHud() อ่านใหม่ทุกครั้งที่เวลา (useThrottledTime) หรือ doc เปลี่ยน และเมื่อภาพแจ้ง (ทะเบียน Sensor View)
//   ชื่อ sensor และดาว, เวลารูปแบบเดียวกับแถบ Animation, จุดใต้ดาว (ทศนิยม 2 ตำแหน่ง), ความสูง km (ทศนิยม 0), Cone Half Angle (ทศนิยม 1)
//   และวงขอบกรวย (SVG ที่ viewBox [−1, 1] พอดีด้านสั้นของภาพ: รัศมี = tan α / tan(fs/2) เท่าของครึ่งด้านสั้น)
// - ดาวแม่ไม่มีตำแหน่ง (sensorHud() = null: ไม่มีผลหรือนอกช่วงเวลา) = ภาพว่างพร้อมข้อความไทย (ไม่ใช่ error)
// - Shift + ล้อเมาส์ = Step Forward / Backward แบบหน้าต่าง 3D; ลาก หมุน ซูมด้วยเมาส์ถูกปิดใน scene (กล้องล็อก)
// - โหมดกล้อง (imagery spec §5.3): แถบ Display (Camera ตั้งต้น | Sensor) และ Zoom In / Zoom Out พร้อม "×n" เก็บใน params (display, zoom) แบบ Up
//   zoom ต่อเนื่องใน [1, 262144] ปุ่มและล้อก้าวทีละ ×√2 บนตาราง 2^(k/2) (zoom.ts) ป้าย "×n" ตาม zoomText
//   ช่อง Width (ours): ความกว้างพื้นที่ที่จุดใต้ดาวตอนนี้ พิมพ์ "500 m" / "1.5 km" / "500" แล้ว Enter = zoom ที่ให้ความกว้างนั้น
//   (sensorViewZoomForGroundWidth: แบ่งครึ่งบน zoom ไม่เกินช่วง) พิมพ์ผิด = กลับเป็นค่าเดิมพร้อมคำแนะนำไทย ; ความกว้างที่เกินช่วงที่ความสูงนี้ซูมถึง = ตั้งเป็นปลายช่วงให้
//   พร้อมคำแนะนำไทยที่บอกความกว้างแคบสุด/กว้างสุดที่ตั้งได้ (sensorViewGroundWidthRangeM) คำแนะนำหายเมื่อซูมเปลี่ยนด้วยปุ่มหรือล้อ (ผูกกับ zoom ตอนแสดง)
//   ล้อเมาส์ไม่กด Shift บนภาพ (รวม pinch) = ซูมตามยอดสะสม (wheelZoom.ts: trackpad ไม่กระโดดจาก ×1 ไปสุดทาง, deltaY < 0 = เข้า)
//   ตัวฟังแบบ capture ไม่ passive: preventDefault (หน้าไม่เลื่อน) และไม่ส่งต่อถึง canvas
//   Camera ไม่วาดวงขอบกรวย; วงในโหมด Sensor ใช้ fov ด้านสั้นที่หารด้วย zoom แล้ว
//   HUD เพิ่มบรรทัดมุมกว้าง (FOV ×zoom) และแหล่งภาพพื้นโลก (ชั้นออนไลน์บนสุดจาก handle.sensorHud().imagery หรือ Natural Earth II ออฟไลน์)
//   ซูมถึง ×262144 (imagery spec §4.4 เดิม ×8192) FOV ต่ำกว่า 1° เป็นเลขนัยสำคัญ 2 ตัว (fovText): HUD เพิ่มความกว้างพื้นที่ที่จุดใต้ดาวตามด้านสั้น (sensorViewGroundWidthM จาก altKm และ FOV ด้านสั้น km เมื่อ ≥ 1 km ไม่งั้น m)
//   และ "ภาพละเอียดสุดของแหล่งนี้แล้ว" เมื่อชั้นบนสุดเป็น GIBS/EOX/OSM ที่ max_level ต่ำกว่าระดับที่ภาพต้องใช้ลบหนึ่ง (finestLevelReached: Cesium เลือกภาพที่ราว
//   2 พิกเซลต่อ texel; neededImageryLevel จากความกว้างนั้นและความสูงด้านสั้นของภาพ ชิ้น 256 px Web Mercator ที่เส้นศูนย์สูตร) ชั้น ion ไม่เตือน (ระดับสูงสุดของ asset ไม่รู้ล่วงหน้า)
//   ไม่มีชั้นออนไลน์แสดงอยู่จริง (ชั้นบนสุด null แม้สวิตช์บางแหล่งเปิด) + Camera + zoom ≥ 8 = แนะนำ Globe Manager
//   สวิตช์แหล่งใดเปิดอยู่ HUD อ่านใหม่ทุก IMAGERY_POLL_MS (ชิ้นภาพโหลดโดยที่เวลาไม่เปลี่ยน)

import { ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useReducer, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { objectPath } from "../../cesium/colors";
import { sensorColor, type SensorObj } from "../../cesium/sensorDraw";
import { neededImageryLevel, sensorViewGroundWidthM, sensorViewGroundWidthRangeM, sensorViewShortFovDeg, sensorViewZoomForGroundWidth } from "../../cesium/sensorGeometry";
import { useThrottledTime, useTimeFormatter } from "../../chrome/hooks";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useImagery } from "../../stores/imagery";
import { useLayout } from "../../stores/layout";
import { parentOf, useScenario } from "../../stores/scenario";
import { ResultsBanner, SceneFailedBanner, SceneMessage, useSceneMount, useShiftWheelSteps } from "../graphics/GraphicsFrame";
import {
  registerSensorViewScene, sensorViewParams, sensorViewScenes, SENSOR_VIEW_KIND, type SensorHudImagery, type SensorViewDisplay, type SensorViewParams,
  type SensorViewUp, type SensorViewZoom,
} from "./registry";
import { createWheelZoom } from "./wheelZoom";
import { nextZoom, parseGroundWidth, ZOOM_MAX, ZOOM_MIN, zoomText } from "./zoom";

const RAD = Math.PI / 180;
const UPS: readonly SensorViewUp[] = ["north", "velocity"];
const DISPLAYS: readonly SensorViewDisplay[] = ["camera", "sensor"];
/** แนะนำ Globe Manager เมื่อซูมถึงขั้นนี้ในโหมด Camera และไม่มีชั้นภาพออนไลน์แสดงอยู่ */
const HINT_ZOOM = 8;
/** สวิตช์ภาพออนไลน์เปิดอยู่: อ่าน HUD ใหม่ทุกช่วงนี้ (สัดส่วนชิ้นที่ไม่มีภาพเปลี่ยนระหว่างโหลดโดยที่เวลาไม่เปลี่ยน) */
const IMAGERY_POLL_MS = 1000;

/**
 * รัศมีของวงขอบกรวยบนภาพ เทียบกับครึ่งด้านสั้นของภาพ: tan α / tan(fs/2) (fs = fov ด้านสั้นหลังซูม) กรวยพอดีด้านสั้นที่ขยาย 5% = 1/1.05 โดยประมาณ
 * fov ถูกจำกัดที่ 120° (α > 57°) หรือซูมเข้า วงจึงเกินด้านสั้นได้ α ≥ 90° ไม่มีวง (null)
 */
export function coneCircleRadius(halfAngleDeg: number, zoom: number = 1): number | null {
  if (!(halfAngleDeg > 0 && halfAngleDeg < 90)) return null;
  return Math.tan(halfAngleDeg * RAD) / Math.tan((sensorViewShortFovDeg(halfAngleDeg, zoom) * RAD) / 2);
}

/** ทศนิยม digits ตำแหน่ง ไม่มี "-0.00" (ค่าลบที่ปัดแล้วเป็นศูนย์) */
function fixed(value: number, digits: number): string {
  const s = value.toFixed(digits);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

const nameOf = (path: string | null): string => (path === null ? "?" : (path.split("/").at(-1) ?? "?"));

/**
 * ผลของการตั้งความกว้างพื้นที่จากช่อง Width: ok, ดาวยังไม่มีตำแหน่ง (ไม่รู้ความสูง),
 * หรือเกินช่วงที่ซูมถึงที่ความสูงนี้ (zoom = ปลายช่วงที่ตั้งให้, minM/maxM = ความกว้างแคบสุด/กว้างสุดที่ตั้งได้)
 */
type WidthResult = { kind: "ok" } | { kind: "noPosition" } | { kind: "clamped"; zoom: number; minM: number; maxM: number };

/** ความกว้างพร้อมหน่วยสำหรับข้อความ ("500 m", "1.30 km") */
const widthWithUnit = (widthM: number): string => {
  const { unit, width } = groundWidthText(widthM);
  return `${width} ${unit}`;
};

/**
 * ช่อง Width (ours): แสดงความกว้างพื้นที่ที่จุดใต้ดาวตอนนี้ (รูปแบบเดียวกับ HUD) ไม่มีตำแหน่ง = ว่าง
 * พิมพ์แล้ว Enter = ตั้ง zoom ให้ได้ความกว้างนั้น (parseGroundWidth: "500 m", "1.5 km", "500" = m) อ่านไม่ได้ = กลับเป็นค่าเดิมพร้อมคำแนะนำไทย
 * Escape หรือออกจากช่อง = ทิ้งที่พิมพ์ (ไม่ตั้ง)
 */
function WidthBox({ panelId, zoom, onWidth }: { panelId: string; zoom: number; onWidth(widthM: number): WidthResult }) {
  useThrottledTime();
  useSyncExternalStore(sensorViewScenes.subscribe, sensorViewScenes.version);
  const [draft, setDraft] = useState<string | null>(null);
  /** คำแนะนำพร้อม zoom ที่มันเป็นจริงด้วย (ปลายช่วงที่ตั้งให้ หรือ zoom ตอนนี้): zoom เปลี่ยนไปจากนั้น (ปุ่ม ล้อ) = หาย */
  const [hintState, setHintState] = useState<{ text: string; zoom: number } | null>(null);
  const hint = hintState !== null && hintState.zoom === zoom ? hintState.text : null;
  useEffect(() => {
    setHintState((h) => (h !== null && h.zoom !== zoom ? null : h));
  }, [zoom]);
  const hud = sensorViewScenes.get(panelId)?.sensorHud() ?? null;
  const widthM = hud === null ? 0 : sensorViewGroundWidthM(hud.altKm, hud.fovDeg);
  const now = widthM > 0 ? (({ unit, width }) => `${width} ${unit}`)(groundWidthText(widthM)) : "";
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") {
      setDraft(null);
      return;
    }
    if (e.key !== "Enter" || draft === null) return;
    const metres = parseGroundWidth(draft);
    setDraft(null);
    if (metres === null) {
      setHintState({ text: msg("sensorView.widthInvalid"), zoom });
      return;
    }
    const result = onWidth(metres);
    if (result.kind === "ok") setHintState(null);
    else if (result.kind === "noPosition") setHintState({ text: msg("sensorView.widthNoPosition"), zoom });
    else setHintState({ text: msg("sensorView.widthClamped", { min: widthWithUnit(result.minM), max: widthWithUnit(result.maxM) }), zoom: result.zoom });
  };
  return (
    <>
      <label className="sensor-view-up-label sensor-view-width-label">
        {t("sensorView.width")}
        <input type="text" className="sensor-view-width" aria-label={t("sensorView.width")} spellCheck={false} value={draft ?? now}
          onChange={(e) => {
            setDraft(e.target.value);
            setHintState(null);
          }}
          onKeyDown={onKeyDown} onBlur={() => setDraft(null)} />
      </label>
      {hint !== null && <span className="sensor-view-width-hint" role="status">{hint}</span>}
    </>
  );
}

/**
 * แถบของหน้าต่าง: ด้านบนของภาพ North (ตั้งต้น) หรือ Velocity, Display: Camera (ตั้งต้น) หรือ Sensor,
 * Zoom In / Zoom Out (ทีละ ×√2) พร้อม "×n" และช่อง Width
 */
function SensorViewBar({ panelId, params, onChange, onWidth }: {
  panelId: string;
  params: SensorViewParams;
  onChange(next: Partial<SensorViewParams>): void;
  onWidth(widthM: number): WidthResult;
}) {
  const { up, display, zoom } = params;
  const zoomBy = (dir: 1 | -1): void => onChange({ zoom: nextZoom(zoom, dir) });
  return (
    <div className="gfx-toolbars">
      <div className="toolbar sensor-view-up" role="group" aria-label={t("sensorView.up")}>
        <span className="sensor-view-up-label" aria-hidden="true">{t("sensorView.up")}</span>
        {UPS.map((value) => (
          <button key={value} type="button" className="tool-btn sensor-view-up-btn" aria-pressed={up === value} onClick={() => onChange({ up: value })}>
            {t(`sensorView.up.${value}`)}
          </button>
        ))}
      </div>
      <div className="toolbar sensor-view-up sensor-view-display" role="group" aria-label={t("sensorView.display")}>
        <span className="sensor-view-up-label" aria-hidden="true">{t("sensorView.display")}</span>
        {DISPLAYS.map((value) => (
          <button key={value} type="button" className="tool-btn sensor-view-up-btn" aria-pressed={display === value} onClick={() => onChange({ display: value })}>
            {t(`sensorView.display.${value}`)}
          </button>
        ))}
      </div>
      <div className="toolbar sensor-view-up sensor-view-zoom" role="group" aria-label={t("sensorView.zoom")}>
        <button type="button" className="tool-btn" aria-label={t("toolbar.zoomIn")} title={t("toolbar.zoomIn")}
          disabled={zoom >= ZOOM_MAX} onClick={() => zoomBy(1)}>
          <ZoomIn size={16} aria-hidden="true" />
        </button>
        <button type="button" className="tool-btn" aria-label={t("toolbar.zoomOut")} title={t("toolbar.zoomOut")} disabled={zoom <= ZOOM_MIN} onClick={() => zoomBy(-1)}>
          <ZoomOut size={16} aria-hidden="true" />
        </button>
        <span className="sensor-view-zoom-value">{`×${zoomText(zoom)}`}</span>
        <WidthBox panelId={panelId} zoom={zoom} onWidth={onWidth} />
      </div>
    </div>
  );
}

/**
 * ทศนิยม 1 ตำแหน่งตั้งแต่ 1° ขึ้นไป ต่ำกว่า 1° เป็นเลขนัยสำคัญ 2 ตัวโดยไม่ใช้รูปเลขยกกำลัง
 * (×128 ของดาว GPS ≈ 0.24°, ×8192 ≈ 0.0037°, ×262144 ≈ 0.00012° ไม่ปัดเป็น 0.0001 หรือ 0.0000)
 */
export function fovText(deg: number): string {
  if (!(deg > 0) || deg >= 1) return fixed(deg, 1);
  return fixed(deg, Math.min(20, 1 - Math.floor(Math.log10(deg))));
}

/** ความกว้างพื้นที่เป็น km (ตั้งแต่ 1 km ขึ้นไป: 100+ ไม่มีทศนิยม, 10+ หนึ่งตำแหน่ง, ไม่งั้นสองตำแหน่ง) หรือ m (เต็มหน่วย) ปัดเป็น 1000 m แล้วถือเป็น 1 km */
export function groundWidthText(widthM: number): { unit: "km" | "m"; width: string } {
  const metres = Math.round(widthM);
  if (metres < 1000) return { unit: "m", width: String(metres) };
  const km = widthM / 1000;
  return { unit: "km", width: fixed(km, km >= 99.95 ? 0 : km >= 9.995 ? 1 : 2) };
}

/**
 * ชั้นภาพบนสุดละเอียดสุดแล้วแต่ภาพต้องการระดับที่ลึกกว่า (ภาพจะถูกขยายจนเบลอ): ชั้น GIBS, EOX หรือ OSM ที่ maxLevel < needed − 1
 * needed (neededImageryLevel) คิดที่ 1 พิกเซล CSS ต่อ texel แต่ Cesium เลือกระดับภาพที่ราว 2 พิกเซลต่อ texel (maximumScreenSpaceError 2 ของ globe)
 * จึงใช้ระดับต่ำกว่า needed หนึ่งระดับอยู่แล้วแม้แหล่งมีระดับที่ลึกกว่า: เตือนที่ needed − 1 > maxLevel (ไม่งั้นเตือนเร็วไปหนึ่งระดับ ทั้งที่ภาพยังเหมือนเดิม)
 * ion ไม่เตือนเลย (ระดับสูงสุดของ asset ไม่รู้ล่วงหน้า และบางชั้นไม่ประกาศ) ไม่มีชั้น ไม่รู้ระดับ หรือไม่มีระดับที่ต้องใช้ (ภาพยังไม่มีขนาด) = false
 */
export function finestLevelReached(imagery: SensorHudImagery | null, needed: number | null): boolean {
  if (imagery === null || needed === null || imagery.source === "ion" || imagery.maxLevel === null) return false;
  return needed - 1 > imagery.maxLevel;
}

/** บรรทัดความกว้างพื้นที่ของ HUD ไม่เห็นพื้นที่ (ความกว้าง 0) = ไม่มีบรรทัด */
function groundWidthLine(widthM: number): string | null {
  if (!(widthM > 0)) return null;
  const { unit, width } = groundWidthText(widthM);
  return msg(unit === "km" ? "sensorView.hudGroundWidthKm" : "sensorView.hudGroundWidthM", { width });
}

/** บรรทัดแหล่งภาพพื้นโลกของ HUD ชิ้นขาดเกินครึ่ง: GIBS/EOX = ไม่มีภาพเวลานี้ (404) ; OSM และ ion (browser ดึงตรง) = ชิ้นภาพโหลดไม่ได้ */
function imageryLine(imagery: SensorHudImagery | null): string {
  if (imagery === null) return msg("sensorView.hudImageryOffline");
  const image = `${imagery.title} ${imagery.label}`.trim();
  if (!imagery.missing) return msg("sensorView.hudImagery", { image });
  return msg(imagery.source === "osm" || imagery.source === "ion" ? "sensorView.hudImageryFailed" : "sensorView.hudImageryMissing", { image });
}

/** สวิตช์ภาพออนไลน์แหล่งใดเปิดอยู่: วาดใหม่ทุก IMAGERY_POLL_MS (HUD อ่านสถานะชั้นภาพใหม่) */
function useImageryPoll(enabled: boolean): void {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(tick, IMAGERY_POLL_MS);
    return () => clearInterval(id);
  }, [enabled]);
}

/**
 * ล้อเมาส์ไม่กด Shift บนภาพ (รวม pinch ของ trackpad = ctrlKey + ล้อ) = ซูมตามยอดที่สะสม (wheelZoom.ts: 100 px ต่อขั้น ไม่เกินขั้นละ 150 ms
 * และไม่เกิน 2 ขั้นต่อการปัดหนึ่งครั้ง รวม momentum)
 * Shift + ล้อเป็นของ useShiftWheelSteps ไม่ให้หน้าเลื่อน (หรือซูมทั้งหน้า) และไม่ส่งต่อถึง canvas ของ Cesium
 */
function useWheelZoom(host: RefObject<HTMLDivElement | null>, zoom: SensorViewZoom, setZoom: (z: SensorViewZoom) => void): void {
  const latest = useRef({ zoom, setZoom });
  latest.current = { zoom, setZoom };
  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    const wheel = createWheelZoom({ now: () => performance.now(), pageHeight: () => window.innerHeight });
    const onWheel = (e: WheelEvent): void => {
      if (e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      const dir = wheel.step(e);
      if (dir === 0) return;
      const { zoom: z, setZoom: set } = latest.current;
      const next = nextZoom(z, dir);
      if (next !== z) set(next);
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [host]);
}

/** ข้อความบนภาพและวงขอบกรวย (โหมด Sensor) หรือข้อความแทนภาพเมื่อดาวแม่ไม่มีตำแหน่ง */
function Hud({ panelId, params }: { panelId: string; params: SensorViewParams }) {
  const { path, display, zoom } = params;
  const time = useThrottledTime();
  const { format } = useTimeFormatter();
  useSyncExternalStore(sensorViewScenes.subscribe, sensorViewScenes.version);
  const doc = useScenario((s) => s.doc);
  const online = useImagery((s) => Object.values(s.sources).some(Boolean));
  useImageryPoll(online);
  const hud = sensorViewScenes.get(panelId)?.sensorHud() ?? null;
  if (hud === null) {
    return (
      <div className="gfx-message" role="status">
        {msg("sensorView.noPosition", { satellite: nameOf(parentOf(path)) })}
      </div>
    );
  }
  const sensor = doc?.objects.find((o) => o.class === "Sensor" && objectPath(o) === path) as SensorObj | undefined;
  const radius = display === "sensor" ? coneCircleRadius(hud.coneHalfAngle, zoom) : null;
  // ไม่มีชั้นออนไลน์บนจอจริง (สวิตช์ปิดทั้งหมด หรือเปิดแต่ไม่มีชั้นที่แสดง เช่น ion ยังไม่เลือก asset / ion ล้มเหลว / ซ่อนทุกแถว) = แนะนำ Globe Manager
  const hint = hud.imagery === null && display === "camera" && zoom >= HINT_ZOOM;
  const groundWidth = sensorViewGroundWidthM(hud.altKm, hud.fovDeg);
  const groundLine = groundWidthLine(groundWidth);
  const maxLevel = hud.imagery?.maxLevel ?? null;
  const finest = maxLevel !== null && finestLevelReached(hud.imagery, neededImageryLevel(groundWidth, hud.shortSidePx));
  return (
    <>
      {radius !== null && (
        <svg className="sensor-view-cone" viewBox="-1 -1 2 2" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <circle cx="0" cy="0" r={radius} style={sensor === undefined ? undefined : { stroke: sensorColor(sensor, "3d") }} />
        </svg>
      )}
      <div className="sensor-view-hud" data-testid="sensor-view-hud">
        <div>{t("window.sensorView", { sensor: hud.sensor, satellite: hud.satellite })}</div>
        <div>{format(time)}</div>
        <div>{msg("sensorView.hudSubPoint", { lat: fixed(hud.lat, 2), lon: fixed(hud.lon, 2) })}</div>
        <div>{msg("sensorView.hudAltitude", { alt: fixed(hud.altKm, 0) })}</div>
        <div>{msg("sensorView.hudCone", { angle: fixed(hud.coneHalfAngle, 1) })}</div>
        <div>{msg("sensorView.hudFov", { fov: fovText(hud.fovDeg), zoom: zoomText(hud.zoom) })}</div>
        {groundLine !== null && <div>{groundLine}</div>}
        <div>{imageryLine(hud.imagery)}</div>
        {finest && <div className="sensor-view-hint">{msg("sensorView.hudFinestLevel", { level: maxLevel })}</div>}
        {hint && <div className="sensor-view-hint">{msg("sensorView.hintGlobeManager")}</div>}
      </div>
    </>
  );
}

export function SensorView({ panelId, params }: PanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewParams = sensorViewParams(params);
  const { path, up, display, zoom } = viewParams;
  const { view, scene } = useSceneMount({
    panelId,
    host,
    window: "3D",
    load: () => import("../Graphics3D/scene3d"),
    create: (m, el, stopped) => m.mountSensorView(panelId, el, stopped),
    register: registerSensorViewScene,
  });
  useShiftWheelSteps(host);
  useEffect(() => {
    if (view === "ready") scene.current?.viewFromSensor(path, up, display, zoom);
  }, [view, scene, path, up, display, zoom]);

  /** Up, Display และ zoom เก็บใน params ของ panel (ไปกับ workbook) แล้ว effect ด้านบนส่งต่อให้ภาพ */
  const update = (next: Partial<SensorViewParams>): void => {
    useLayout.getState().api?.getPanel(panelId)?.api.updateParameters(next);
  };
  useWheelZoom(host, zoom, (z) => update({ zoom: z }));
  /** ช่อง Width: zoom ที่ให้ความกว้างนั้นที่จุดใต้ดาวตอนนี้ (ความสูงและ Cone Half Angle จาก HUD) ไม่เกินช่วงซูม */
  const setWidth = (widthM: number): WidthResult => {
    const hud = scene.current?.sensorHud() ?? null;
    const next = hud === null ? null : sensorViewZoomForGroundWidth(hud.altKm, hud.coneHalfAngle, widthM, ZOOM_MIN, ZOOM_MAX);
    const range = hud === null ? null : sensorViewGroundWidthRangeM(hud.altKm, hud.coneHalfAngle, ZOOM_MIN, ZOOM_MAX);
    if (next === null || range === null) return { kind: "noPosition" };
    update({ zoom: next });
    // เกินช่วงที่ซูมถึง (กว้างกว่าที่ ×1 เห็น หรือแคบกว่าที่ ×262144 เห็น): ตั้งเป็นปลายช่วงไปแล้ว บอกช่วงที่ตั้งได้
    return widthM > range.maxM || widthM < range.minM ? { kind: "clamped", zoom: next, ...range } : { kind: "ok" };
  };

  return (
    <div className="gfx sensor-view">
      <SensorViewBar panelId={panelId} params={viewParams} onChange={update} onWidth={setWidth} />
      <ResultsBanner />
      <SceneFailedBanner registry={sensorViewScenes} panelId={panelId} window="3D" />
      <div className="gfx-stage">
        <div className="gfx-view" ref={host} data-testid="sensor-view" />
        <SceneMessage view={view} window="3D" />
        {view === "ready" && <Hud panelId={panelId} params={viewParams} />}
      </div>
    </div>
  );
}

/** ลงทะเบียนหน้าต่าง Sensor View (แทนตัวแทนชั่วคราว) ชื่อ ชนิด และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerSensorViewPanel(): void {
  const base = getPanelDef(SENSOR_VIEW_KIND);
  if (base === undefined) throw new Error(`panel kind "${SENSOR_VIEW_KIND}" is not registered`);
  registerPanel(SENSOR_VIEW_KIND, { ...base, component: SensorView });
}
