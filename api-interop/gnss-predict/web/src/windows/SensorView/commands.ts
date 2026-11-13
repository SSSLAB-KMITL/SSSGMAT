// คำสั่ง Sensor View (เพิ่มเอง, sensor spec §5.1, §5.4) ของเมนู Satellite / Sensor และเมนูคลิกขวา ลงทะเบียนระดับแอปครั้งเดียว (App.tsx)
//
// - ใช้ได้เมื่อมี scenario, พื้นที่ทำงาน mount แล้ว และ object ที่เลือกเป็น Satellite หรือ Sensor ที่มีอยู่ใน doc
// - Sensor = เปิด (หรือเรียกขึ้นมา) หน้าต่างของมัน; Satellite = หน้าต่างของ sensor ตัวแรกของดาวในต้นไม้
//   ดาวยังไม่มี sensor = สร้างด้วย Define Properties ชื่อ Sensor<n> ตัวแรกที่ว่าง Cone Half Angle = ρ + 0.5° จากตำแหน่งดาว ณ เวลาปัจจุบัน
//   ในหน้าต่าง 3D ตัวแรก ไม่มีก็จาก Sensor View บานใดที่เปิดอยู่ (ภาพของมันมีดาวทุกดวง) ไม่มีทั้งสองหรือดาวยังไม่มีตำแหน่ง = 45°
//   แล้วเลือก sensor ใหม่ แจ้งใน Message Viewer และเปิดหน้าต่าง
// - เปิดได้ไม่เกิน SENSOR_VIEW_LIMIT บาน: บานใหม่เกินนั้นไม่เปิด (และไม่สร้าง sensor) พร้อมข้อความไทย บานที่เปิดอยู่แล้วเรียกขึ้นมาได้เสมอ
// - enabled() อ่าน selection, doc และพื้นที่ทำงาน: ฟังทั้งสามแล้ว invalidateCommands ให้เมนูวาดใหม่

import { firstFreeName } from "../../api/names";
import { attempt } from "../../api/writes";
import { objectPath } from "../../cesium/colors";
import { defaultConeHalfAngleDeg, type Vec3 } from "../../cesium/sensorGeometry";
import { COMMAND_LABELS, invalidateCommands, registerCommand } from "../../commands";
import { msg } from "../../labels/messages.th";
import { useLayout } from "../../stores/layout";
import { report } from "../../stores/messages";
import { useScenario, type TreeNode, type TreeObject } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";
import { firstScene } from "../Graphics3D/registry";
import { insertObjects } from "../InsertObjects/insert";
import { SENSOR_VIEW_KIND, SENSOR_VIEW_LIMIT, sensorViewPanels, sensorViewParams, sensorViewScenes } from "./registry";

const SATELLITE = /^\*\/Satellite\/[^/]+$/;
const SENSOR = /^\*\/Sensor\/[^/]+$/;

const nameOf = (path: string): string => path.split("/").at(-1) ?? "";

/** path ของ object ที่มีอยู่ใน doc ของ scenario ที่เปิดอยู่ */
const exists = (path: string): boolean => useScenario.getState().doc?.objects.some((o) => objectPath(o) === path) === true;

/** object ที่เลือกเป็น Satellite หรือ Sensor ที่มีอยู่ (path ของมัน) ไม่งั้น null */
function target(): string | null {
  const path = useSelection.getState().activePath;
  return path !== null && (SATELLITE.test(path) || SENSOR.test(path)) && exists(path) ? path : null;
}

/** โหนดของดาวในต้นไม้ (ดาวอยู่ในโฟลเดอร์กลุ่มได้) */
function treeNode(nodes: readonly TreeNode[], path: string): TreeObject | undefined {
  for (const node of nodes) {
    if ("group" in node) {
      const found = treeNode(node.children, path);
      if (found !== undefined) return found;
    } else if (node.path === path) {
      return node;
    }
  }
  return undefined;
}

/** sensor ตัวแรกของดาวในต้นไม้ ไม่มี = null */
function firstSensorOf(satellitePath: string): string | null {
  const tree = useScenario.getState().tree;
  const node = tree === null ? undefined : treeNode(tree.children, satellitePath);
  return node?.children?.find((c) => c.class === "Sensor")?.path ?? null;
}

/**
 * ตำแหน่ง Earth-fixed ของดาวชื่อ name ณ เวลาปัจจุบันจากภาพที่เปิดอยู่: หน้าต่าง 3D ตัวแรก แล้ว Sensor View ตามลำดับที่เปิด
 * (ภาพใดไม่มีตำแหน่งของดาวนี้ก็ถามภาพถัดไป) ไม่มีภาพใดมี = null
 */
function satellitePosition(name: string): Vec3 | null {
  for (const scene of [firstScene(), ...sensorViewScenes.all()]) {
    const p = scene?.entityPositionEcef(name) ?? null;
    if (p !== null) return { x: p[0], y: p[1], z: p[2] };
  }
  return null;
}

/** เปิดหน้าต่างใหม่ไม่ได้เพราะครบ SENSOR_VIEW_LIMIT บานแล้ว (path ที่เปิดอยู่แล้วไม่นับ: เรียกขึ้นมาได้) */
function atLimit(path: string | null): boolean {
  const open = sensorViewPanels();
  return open.length >= SENSOR_VIEW_LIMIT && !open.some((p) => sensorViewParams(p.params).path === path);
}

function reportLimit(): void {
  report("warning", "SENSOR_VIEW_LIMIT", msg("sensorView.limit"));
}

/**
 * เปิด Sensor View ของ sensor ที่ path (เปิดอยู่แล้ว = เรียกหน้าต่างเดิมขึ้นมา ค่า Up คงเดิม) คืน id ของหน้าต่าง
 * พื้นที่ทำงานยังไม่ mount หรือบานที่ 5 (ข้อความไทยใน Message Viewer) = null
 */
export function openSensorView(path: string): string | null {
  const layout = useLayout.getState();
  if (layout.api === null) return null;
  const open = sensorViewPanels(layout.api).some((p) => sensorViewParams(p.params).path === path);
  if (atLimit(path)) {
    reportLimit();
    return null;
  }
  return layout.openPanel(SENSOR_VIEW_KIND, open ? { path } : { path, up: "north" });
}

/** ดาวยังไม่มี sensor: สร้าง Sensor<n> ด้วย Cone Half Angle ตั้งต้นจากตำแหน่งดาว แล้วเปิดหน้าต่างของมัน */
async function createAndOpen(satellitePath: string): Promise<void> {
  if (atLimit(null)) {
    reportLimit(); // ไม่สร้าง sensor ที่เปิดดูไม่ได้
    return;
  }
  const { name: scenario, doc } = useScenario.getState();
  if (doc === null) return;
  const satellite = nameOf(satellitePath);
  const name = firstFreeName("Sensor", doc.objects.map((o) => o.name));
  const angle = defaultConeHalfAngleDeg(satellitePosition(satellite));
  const created = await attempt(
    () => insertObjects({ class: "Sensor", method: "Define Properties", name, parent: satellitePath, definition: { type: "Simple Conic", cone_half_angle: angle } }),
    satellitePath,
  );
  if (!created.ok || useScenario.getState().name !== scenario) return; // สลับ scenario ระหว่างรอ: sensor อยู่ใน scenario เดิม ไม่เปิดที่นี่
  const path = created.value[0] ?? `*/Sensor/${name}`;
  report("info", "SENSOR_CREATED", msg("sensorView.created", { sensor: nameOf(path), satellite, angle: angle.toFixed(1) }), path);
  openSensorView(path);
}

async function run(): Promise<void> {
  const path = target();
  if (path === null) return;
  if (SENSOR.test(path)) {
    openSensorView(path);
    return;
  }
  const first = firstSensorOf(path);
  if (first !== null) openSensorView(first);
  else await createAndOpen(path);
}

export function registerSensorViewCommands(): () => void {
  const dispose = registerCommand("object.sensorView", {
    label: COMMAND_LABELS["object.sensorView"],
    run,
    enabled: () => useScenario.getState().name !== null && useLayout.getState().api !== null && target() !== null,
  });
  const unsubscribe = [
    useSelection.subscribe((s, prev) => {
      if (s.activePath !== prev.activePath) invalidateCommands();
    }),
    useScenario.subscribe((s, prev) => {
      if (s.name !== prev.name || s.doc !== prev.doc) invalidateCommands();
    }),
    useLayout.subscribe((s, prev) => {
      if (s.api !== prev.api) invalidateCommands();
    }),
  ];
  return () => {
    for (const off of unsubscribe) off();
    dispose();
  };
}
