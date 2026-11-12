// คำสั่งของแถบ 2D Window Defaults (W3, spec §5.2): Properties, Zoom In, Zoom Out ลงทะเบียนระดับแอปครั้งเดียว ทำงานกับหน้าต่าง 2D ที่ active
// ใช้ได้เมื่อมีหน้าต่าง 2D เปิดอยู่ enabled() อ่านทะเบียนหน้าต่างและ panel ที่ active: ฟังทั้งสองแล้ว invalidateCommands ให้ปุ่มวาดใหม่

import { COMMAND_LABELS, invalidateCommands, registerCommand, type CommandDef, type CommandId } from "../../commands";
import { useLayout } from "../../stores/layout";
import { activeScene2D, subscribeScenes2D } from "./registry2d";

export function registerGraphics2DCommands(): () => void {
  const disposers: (() => void)[] = [];
  const add = (id: CommandId, def: Omit<CommandDef, "label">): void => {
    disposers.push(registerCommand(id, { label: COMMAND_LABELS[id], ...def }));
  };
  const hasScene = (): boolean => activeScene2D() !== undefined;

  add("g2d.properties", {
    run: () => {
      const scene = activeScene2D();
      if (scene !== undefined) useLayout.getState().openPanel("windowProperties2d", { target: scene.panelId });
    },
    enabled: hasScene,
  });
  add("g2d.zoomIn", { run: () => activeScene2D()?.setMouseMode("zoomIn"), enabled: hasScene });
  add("g2d.zoomOut", { run: () => activeScene2D()?.zoomOut(), enabled: hasScene });

  const unsubscribe = [
    subscribeScenes2D(invalidateCommands),
    useLayout.subscribe((s, prev) => {
      if (s.api !== prev.api || s.revision !== prev.revision) invalidateCommands(); // revision: panel ที่ active อาจเปลี่ยน
    }),
  ];

  return () => {
    for (const off of unsubscribe) off();
    for (const dispose of disposers) dispose();
  };
}
