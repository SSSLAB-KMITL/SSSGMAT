// คำสั่งของหน้าต่าง 3D (W3, spec §5.2): แถบ 3D Graphics (Home View, View From/To), แถบ 3D Window Defaults (Properties, Grab Globe, Zoom In)
// และ Zoom To ของเมนู object / คลิกขวา ลงทะเบียนระดับแอปครั้งเดียว ทำงานกับหน้าต่าง 3D ที่ active (registry.activeScene)
// - ใช้ได้เมื่อมีหน้าต่าง 3D เปิดอยู่; View From/To ต้องมี scenario (เลือก object ของ scenario); Zoom To ต้องเลือก Facility, Satellite หรือ Sensor อยู่
//   (Sensor ซูมไปที่ดาวแม่ของมัน)
// - Show Orbits (task 13c): รายการติ๊กถูกที่สลับ props.showOrbits ของหน้าต่าง 3D ที่ active (useLayout.windowProps ค่าอื่นของหน้าต่างคงเดิม)
//   ปุ่มบนแถบ 3D Window Defaults, เมนูคลิกขวาของหน้าต่าง และช่องใน 3D Graphics Window Properties เขียนตัวเลือกเดียวกันนี้
// - enabled() อ่านทะเบียนหน้าต่าง, selection, scenario และ panel ที่ active: ฟังทั้งหมดแล้ว invalidateCommands ให้เมนูและปุ่มวาดใหม่
//   (checked() ของ Show Orbits อ่าน windowProps: ฟังด้วย)

import { COMMAND_LABELS, invalidateCommands, registerCommand, type CommandDef, type CommandId } from "../../commands";
import { useLayout } from "../../stores/layout";
import { parentOf, useScenario } from "../../stores/scenario";
import { useSelection } from "../../stores/selection";
import { props3d } from "./props";
import { activeScene, subscribeScenes } from "./registry";

/** path ของ Facility, Satellite หรือ Sensor ("*\/Satellite/G01") */
export const isZoomable = (path: string | null): path is string => path !== null && /^\*\/(Facility|Satellite|Sensor)\/[^/]+$/.test(path);

/** path ที่หน้าต่าง 3D ซูมไปหา: Facility และ Satellite = ตัวมันเอง, Sensor = ดาวที่ติดอยู่ (หาไม่เจอ = null) */
function zoomTarget(path: string | null): string | null {
  if (!isZoomable(path)) return null;
  return path.startsWith("*/Sensor/") ? parentOf(path) : path;
}

export function registerGraphics3DCommands(): () => void {
  const disposers: (() => void)[] = [];
  const add = (id: CommandId, def: Omit<CommandDef, "label">): void => {
    disposers.push(registerCommand(id, { label: COMMAND_LABELS[id], ...def }));
  };
  const hasScene = (): boolean => activeScene() !== undefined;
  const openFor = (kind: "windowProperties3d" | "viewFromTo"): void => {
    const scene = activeScene();
    if (scene !== undefined) useLayout.getState().openPanel(kind, { target: scene.panelId });
  };

  add("g3d.homeView", { run: () => activeScene()?.homeView(), enabled: hasScene });
  add("g3d.viewFromTo", { run: () => openFor("viewFromTo"), enabled: () => hasScene() && useScenario.getState().name !== null });
  add("g3d.properties", { run: () => openFor("windowProperties3d"), enabled: hasScene });
  add("g3d.grabGlobe", { run: () => activeScene()?.setMouseMode("grab"), enabled: hasScene });
  add("g3d.zoomIn", { run: () => activeScene()?.setMouseMode("zoomIn"), enabled: hasScene });
  add("g3d.showOrbits", {
    run: () => {
      const scene = activeScene();
      if (scene === undefined) return;
      const stored = useLayout.getState().windowProps[scene.panelId] ?? {};
      useLayout.getState().setWindowProps(scene.panelId, { ...stored, showOrbits: !props3d(stored).showOrbits });
    },
    enabled: hasScene,
    checked: () => {
      const scene = activeScene();
      return scene !== undefined && props3d(useLayout.getState().windowProps[scene.panelId]).showOrbits;
    },
  });
  add("object.zoomTo", {
    run: () => {
      const target = zoomTarget(useSelection.getState().activePath);
      if (target !== null) activeScene()?.zoomTo(target);
    },
    enabled: () => hasScene() && zoomTarget(useSelection.getState().activePath) !== null,
  });

  const unsubscribe = [
    subscribeScenes(invalidateCommands),
    useSelection.subscribe((s, prev) => {
      if (s.activePath !== prev.activePath) invalidateCommands();
    }),
    useScenario.subscribe((s, prev) => {
      // doc: Zoom To ของ Sensor หาดาวแม่จาก doc
      if ((s.name === null) !== (prev.name === null) || s.doc !== prev.doc) invalidateCommands();
    }),
    useLayout.subscribe((s, prev) => {
      // revision: panel ที่ active อาจเปลี่ยน; windowProps: Show Orbits ที่ติ๊กอยู่
      if (s.api !== prev.api || s.revision !== prev.revision || s.windowProps !== prev.windowProps) invalidateCommands();
    }),
  ];

  return () => {
    for (const off of unsubscribe) off();
    for (const dispose of disposers) dispose();
  };
}
