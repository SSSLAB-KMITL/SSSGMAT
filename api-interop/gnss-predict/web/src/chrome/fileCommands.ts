// คำสั่งเมนู File และ Help ของงานที่ 7 (W3): file.new/open/save/saveAs/close/exit, file.recent.1-4, help.welcome/about/stkReference
// registerFileCommands() เรียกครั้งเดียวตอนแอปเริ่ม คืนฟังก์ชันถอน (เหมือน registerCoreCommands ใน coreCommands.ts)
//
// - คำสั่งที่เปิดหน้าต่างใช้ได้เมื่อพื้นที่ทำงาน (dockview) mount แล้ว; Save, Save As, Close ต้องมี scenario ที่เปิดอยู่ด้วย; Exit ใช้ได้เสมอ (กลับ Welcome)
// - file.recent.N ลงทะเบียนเฉพาะช่องที่มีชื่อ (เมนูแสดงรายการ optional เฉพาะที่ลงทะเบียน) ข้อความของรายการคือชื่อ scenario
//   และตามรายการล่าสุดทุกครั้งที่เปิด scenario (recent.subscribe)
// - เปิด/ปิด/บันทึกจริงอยู่ใน scenarioFiles.ts

import { COMMAND_LABELS, invalidateCommands, registerCommand, type CommandDef, type CommandId } from "../commands";
import { msg } from "../labels/messages.th";
import * as recent from "../recent";
import { closeScenario, openScenario, saveScenario } from "../scenarioFiles";
import { useLayout } from "../stores/layout";
import { useScenario } from "../stores/scenario";
import { useSaveAs } from "./SaveAsDialog";

const layout = () => useLayout.getState();
const workspaceMounted = (): boolean => layout().api !== null;
const scenarioOpen = (): boolean => useScenario.getState().name !== null;
const noScenarioNote = (): string | undefined => (scenarioOpen() ? undefined : msg("tooltip.noScenario"));

const RECENT_IDS = ["file.recent.1", "file.recent.2", "file.recent.3", "file.recent.4"] as const satisfies readonly CommandId[];

export function registerFileCommands(): () => void {
  const disposers: (() => void)[] = [];
  const add = (id: CommandId, def: Omit<CommandDef, "label">): (() => void) => {
    const dispose = registerCommand(id, { label: COMMAND_LABELS[id], ...def });
    disposers.push(dispose);
    return dispose;
  };
  const openWindow = (id: CommandId, kind: "newScenarioWizard" | "welcome" | "about" | "stkReference"): void => {
    add(id, { run: () => void layout().openPanel(kind), enabled: workspaceMounted });
  };

  // ---------- File ----------
  openWindow("file.new", "newScenarioWizard");
  openWindow("file.open", "welcome");
  add("file.save", { run: saveScenario, enabled: scenarioOpen, tooltip: noScenarioNote });
  add("file.saveAs", { run: () => useSaveAs.getState().show(), enabled: () => scenarioOpen() && workspaceMounted(), tooltip: noScenarioNote });
  add("file.close", { run: closeScenario, enabled: () => scenarioOpen() && workspaceMounted(), tooltip: noScenarioNote });
  add("file.exit", { run: closeScenario, enabled: workspaceMounted });

  // ---------- File → รายการล่าสุด: ช่องที่ i ลงทะเบียนเมื่อรายการมีชื่อที่ i ----------
  const recentDisposers: (() => void)[] = [];
  const syncRecent = (): void => {
    const count = recent.list().length;
    RECENT_IDS.forEach((id, i) => {
      const has = recentDisposers[i] !== undefined;
      if (i < count && !has) {
        recentDisposers[i] = registerCommand(id, {
          label: COMMAND_LABELS[id],
          text: () => recent.list()[i] ?? "",
          run: () => {
            const name = recent.list()[i];
            if (name !== undefined) void openScenario(name);
          },
          enabled: workspaceMounted,
        });
      } else if (i >= count && has) {
        recentDisposers[i]();
        delete recentDisposers[i];
      }
    });
    invalidateCommands(); // ชื่อในรายการเปลี่ยน (เมนูวาดใหม่)
  };
  syncRecent();
  const offRecent = recent.subscribe(syncRecent);

  // ---------- Help ----------
  openWindow("help.welcome", "welcome");
  openWindow("help.about", "about");
  openWindow("help.stkReference", "stkReference");

  // enabled()/tooltip() ขึ้นกับ store สองตัวนี้: เมื่อสถานะที่อ่านเปลี่ยน ให้เมนูและแถบเครื่องมือวาดใหม่
  const unsubscribe = [
    useLayout.subscribe((s, prev) => {
      if (s.api !== prev.api) invalidateCommands();
    }),
    useScenario.subscribe((s, prev) => {
      if ((s.name === null) !== (prev.name === null)) invalidateCommands();
    }),
  ];

  return () => {
    offRecent();
    for (const off of unsubscribe) off();
    for (const dispose of recentDisposers) dispose?.();
    for (const dispose of disposers) dispose(); // ถอนเฉพาะที่ยังเป็นของเรา: งานอื่นลงทะเบียนทับ id เดียวกันไปแล้วก็ไม่ถูกถอน
  };
}
