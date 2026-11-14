// คำสั่งที่งานเมนู/แถบเครื่องมือลงทะเบียน (W3): view.*, window.*, anim.*
// คำสั่งอื่นของ CommandId ลงทะเบียนในงานที่ทำหน้าต่างนั้น (ดูหัวไฟล์ commands.ts)
// registerCoreCommands() เรียกครั้งเดียวตอนแอปเริ่ม คืนฟังก์ชันถอน (ถอนคำสั่งที่ยังเป็นของเรา และเลิกฟัง store)

import { errorText } from "../api/client";
import { COMMAND_LABELS, invalidateCommands, registerCommand, type CommandDef, type CommandId } from "../commands";
import { msg } from "../labels/messages.th";
import { TOOLBAR_NAMES } from "../layout/workbook";
import { useLayout } from "../stores/layout";
import { report } from "../stores/messages";
import { useScenario } from "../stores/scenario";
import { useTime } from "../stores/time";

const layout = () => useLayout.getState();
const clock = () => useTime.getState();

/** เปิด/จัดหน้าต่างได้เมื่อพื้นที่ทำงาน (dockview) mount แล้ว */
const workspaceMounted = (): boolean => layout().api !== null;
const scenarioOpen = (): boolean => useScenario.getState().name !== null;
const noScenarioNote = (): string | undefined => (scenarioOpen() ? undefined : msg("tooltip.noScenario"));

/** W1: Animation Cycle = Stop at Time และเวลาอยู่ที่ปลายช่วงแล้ว เล่นต่อทิศนั้นไม่ได้ */
const atEnd = (): boolean => clock().cycle === "stop" && clock().current.getTime() >= clock().periodStop.getTime();
const atStart = (): boolean => clock().cycle === "stop" && clock().current.getTime() <= clock().periodStart.getTime();

function fullScreen(): void {
  const fail = (e: unknown): void => report("warning", "FULLSCREEN", msg("fullscreen.failed", { message: errorText(e) }));
  try {
    const done = document.fullscreenElement != null ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    Promise.resolve(done).catch(fail); // บาง browser ไม่คืน promise
  } catch (e) {
    fail(e);
  }
}

export function registerCoreCommands(): () => void {
  const disposers: (() => void)[] = [];
  const add = (id: CommandId, def: Omit<CommandDef, "label">): void => {
    disposers.push(registerCommand(id, { label: COMMAND_LABELS[id], ...def }));
  };
  const openWindow = (id: CommandId, kind: "objectBrowser" | "timelineView" | "messageViewer" | "globeManager"): void =>
    add(id, { run: () => void layout().openPanel(kind), enabled: workspaceMounted });

  // ---------- View ----------
  openWindow("view.objectBrowser", "objectBrowser");
  openWindow("view.timelineView", "timelineView");
  openWindow("view.messageViewer", "messageViewer");
  add("view.new3d", { run: () => void layout().newGraphicsWindow("graphics3d"), enabled: workspaceMounted });
  add("view.new2d", { run: () => void layout().newGraphicsWindow("graphics2d"), enabled: workspaceMounted });
  openWindow("view.globeManager", "globeManager");
  for (const name of TOOLBAR_NAMES) {
    add(`view.toolbar.${name}`, {
      run: () => layout().setToolbar(name, !layout().toolbars[name]),
      checked: () => layout().toolbars[name],
    });
  }
  add("view.fullScreen", { run: fullScreen, enabled: () => typeof document.documentElement.requestFullscreen === "function" });

  // ---------- Window ----------
  add("window.windows", { run: () => layout().openWindowsDialog(), enabled: workspaceMounted });
  add("window.cascade", { run: () => layout().cascade(), enabled: workspaceMounted });
  add("window.tileHorizontally", { run: () => layout().tile("horizontal"), enabled: workspaceMounted });
  add("window.tileVertically", { run: () => layout().tile("vertical"), enabled: workspaceMounted });

  // ---------- Animation: ใช้ได้เมื่อมี scenario เปิดอยู่ (เวลามาจาก scenario) ----------
  const anim = (id: CommandId, run: () => void, tooltip: () => string | undefined = noScenarioNote): void =>
    add(id, { run, enabled: scenarioOpen, tooltip });
  anim("anim.reset", () => clock().reset());
  anim("anim.stepBackward", () => clock().stepBackward());
  anim("anim.reverse", () => clock().reverse(), () => noScenarioNote() ?? (atStart() ? msg("anim.reachedStart") : undefined));
  anim("anim.pause", () => clock().pause());
  anim("anim.start", () => clock().start(), () => noScenarioNote() ?? (atEnd() ? msg("anim.reachedEnd") : undefined));
  anim("anim.stepForward", () => clock().stepForward());
  anim("anim.decreaseStep", () => clock().decreaseStep());
  anim("anim.increaseStep", () => clock().increaseStep());
  anim("anim.normal", () => clock().setMode("normal"));
  anim("anim.realtime", () => clock().setMode("realtime"));
  anim("anim.xrealtime", () => clock().setMode("xrealtime"));

  // enabled()/checked() ขึ้นกับ store สองตัวนี้: เมื่อสถานะที่อ่านเปลี่ยน ให้เมนูและแถบเครื่องมือวาดใหม่
  const unsubscribe = [
    useLayout.subscribe((s, prev) => {
      if (s.api !== prev.api || s.toolbars !== prev.toolbars) invalidateCommands();
    }),
    useScenario.subscribe((s, prev) => {
      if ((s.name === null) !== (prev.name === null)) invalidateCommands();
    }),
  ];

  return () => {
    for (const off of unsubscribe) off();
    for (const dispose of disposers) dispose(); // ถอนเฉพาะที่ยังเป็นของเรา: งานอื่นลงทะเบียนทับ id เดียวกันไปแล้วก็ไม่ถูกถอน
  };
}
