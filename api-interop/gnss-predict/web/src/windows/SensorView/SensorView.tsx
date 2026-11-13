// หน้าต่าง Sensor View - <sensor> (<ดาว>) (เพิ่มเอง, sensor spec §5.4) ส่วน React: แถบ Up (North / Velocity), แถบแจ้งผลลัพธ์,
// ข้อความแทนภาพ และข้อความบนภาพ ส่วน Cesium อยู่ใน Graphics3D/scene3d.ts (mountSensorView: scene เดียวกับหน้าต่าง 3D, dynamic import)
//
// - params ของ panel = { path, up } (registry.ts) เปลี่ยน path (Rename) หรือ up = handle.viewFromSensor ใหม่ ค่า Up เก็บใน params (P8)
// - ข้อความบนภาพ (P4): handle.sensorHud() อ่านใหม่ทุกครั้งที่เวลา (useThrottledTime) หรือ doc เปลี่ยน และเมื่อภาพแจ้ง (ทะเบียน Sensor View)
//   ชื่อ sensor และดาว, เวลารูปแบบเดียวกับแถบ Animation, จุดใต้ดาว (ทศนิยม 2 ตำแหน่ง), ความสูง km (ทศนิยม 0), Cone Half Angle (ทศนิยม 1)
//   และวงขอบกรวย (SVG ที่ viewBox [−1, 1] พอดีด้านสั้นของภาพ: รัศมี = tan α / tan(fs/2) เท่าของครึ่งด้านสั้น)
// - ดาวแม่ไม่มีตำแหน่ง (sensorHud() = null: ไม่มีผลหรือนอกช่วงเวลา) = ภาพว่างพร้อมข้อความไทย (ไม่ใช่ error)
// - Shift + ล้อเมาส์ = Step Forward / Backward แบบหน้าต่าง 3D; ลาก หมุน ซูมด้วยเมาส์ถูกปิดใน scene (กล้องล็อก)

import { useEffect, useRef, useSyncExternalStore } from "react";
import { objectPath } from "../../cesium/colors";
import { sensorColor, type SensorObj } from "../../cesium/sensorDraw";
import { sensorViewShortFovDeg } from "../../cesium/sensorGeometry";
import { useThrottledTime, useTimeFormatter } from "../../chrome/hooks";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { parentOf, useScenario } from "../../stores/scenario";
import { ResultsBanner, SceneFailedBanner, SceneMessage, useSceneMount, useShiftWheelSteps } from "../graphics/GraphicsFrame";
import { registerSensorViewScene, sensorViewParams, sensorViewScenes, SENSOR_VIEW_KIND, type SensorViewUp } from "./registry";

const RAD = Math.PI / 180;
const UPS: readonly SensorViewUp[] = ["north", "velocity"];

/**
 * รัศมีของวงขอบกรวยบนภาพ เทียบกับครึ่งด้านสั้นของภาพ: tan α / tan(fs/2) (fs = fov ด้านสั้น) กรวยพอดีด้านสั้นที่ขยาย 5% = 1/1.05 โดยประมาณ
 * fov ถูกจำกัดที่ 120° (α > 57°) วงจึงเกินด้านสั้นได้ α ≥ 90° ไม่มีวง (null)
 */
export function coneCircleRadius(halfAngleDeg: number): number | null {
  if (!(halfAngleDeg > 0 && halfAngleDeg < 90)) return null;
  return Math.tan(halfAngleDeg * RAD) / Math.tan((sensorViewShortFovDeg(halfAngleDeg) * RAD) / 2);
}

/** ทศนิยม digits ตำแหน่ง ไม่มี "-0.00" (ค่าลบที่ปัดแล้วเป็นศูนย์) */
function fixed(value: number, digits: number): string {
  const s = value.toFixed(digits);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

const nameOf = (path: string | null): string => (path === null ? "?" : (path.split("/").at(-1) ?? "?"));

/** แถบของหน้าต่าง: ด้านบนของภาพ North (ตั้งต้น) หรือ Velocity */
function UpBar({ up, onChange }: { up: SensorViewUp; onChange(up: SensorViewUp): void }) {
  return (
    <div className="gfx-toolbars">
      <div className="toolbar sensor-view-up" role="group" aria-label={t("sensorView.up")}>
        <span className="sensor-view-up-label" aria-hidden="true">{t("sensorView.up")}</span>
        {UPS.map((value) => (
          <button key={value} type="button" className="tool-btn sensor-view-up-btn" aria-pressed={up === value} onClick={() => onChange(value)}>
            {t(`sensorView.up.${value}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** ข้อความบนภาพและวงขอบกรวย หรือข้อความแทนภาพเมื่อดาวแม่ไม่มีตำแหน่ง */
function Hud({ panelId, path }: { panelId: string; path: string }) {
  const time = useThrottledTime();
  const { format } = useTimeFormatter();
  useSyncExternalStore(sensorViewScenes.subscribe, sensorViewScenes.version);
  const doc = useScenario((s) => s.doc);
  const hud = sensorViewScenes.get(panelId)?.sensorHud() ?? null;
  if (hud === null) {
    return (
      <div className="gfx-message" role="status">
        {msg("sensorView.noPosition", { satellite: nameOf(parentOf(path)) })}
      </div>
    );
  }
  const sensor = doc?.objects.find((o) => o.class === "Sensor" && objectPath(o) === path) as SensorObj | undefined;
  const radius = coneCircleRadius(hud.coneHalfAngle);
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
      </div>
    </>
  );
}

export function SensorView({ panelId, params }: PanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const { path, up } = sensorViewParams(params);
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
    if (view === "ready") scene.current?.viewFromSensor(path, up);
  }, [view, scene, path, up]);

  const setUp = (next: SensorViewUp): void => {
    useLayout.getState().api?.getPanel(panelId)?.api.updateParameters({ up: next });
  };

  return (
    <div className="gfx sensor-view">
      <UpBar up={up} onChange={setUp} />
      <ResultsBanner />
      <SceneFailedBanner registry={sensorViewScenes} panelId={panelId} window="3D" />
      <div className="gfx-stage">
        <div className="gfx-view" ref={host} data-testid="sensor-view" />
        <SceneMessage view={view} window="3D" />
        {view === "ready" && <Hud panelId={panelId} path={path} />}
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
