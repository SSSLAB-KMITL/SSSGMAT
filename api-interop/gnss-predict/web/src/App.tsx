import { useEffect } from "react";
import { startEventWiring } from "./api/events";
import { registerCoreCommands } from "./chrome/coreCommands";
import { Dialogs } from "./chrome/Dialogs";
import { registerFileCommands } from "./chrome/fileCommands";
import { HealthBanner } from "./chrome/HealthBanner";
import { MenuBar } from "./chrome/MenuBar";
import { SaveAsDialog } from "./chrome/SaveAsDialog";
import { StatusBar } from "./chrome/StatusBar";
import { Toolbars } from "./chrome/Toolbars";
import { startWorkspaceFlow } from "./scenarioFiles";
import { installShortcuts } from "./shortcuts";
import { startClock } from "./time/clock";
import { registerFilePanels } from "./windows/filePanels";
import { Workspace } from "./Workspace";

export function App() {
  // นาฬิกาของแอป, การต่อ SSE เข้ากับ store, คำสั่งของเมนู/แถบเครื่องมือ, หน้าต่างของไฟล์ scenario (Welcome, Wizard, About, STK UI Reference),
  // คีย์ลัด และการเริ่มหน้าเว็บ (?sc= หรือ Welcome): เริ่มครั้งเดียวตอน mount หยุดตอน unmount
  useEffect(() => {
    const stopClock = startClock();
    const stopEvents = startEventWiring();
    const unregisterCommands = registerCoreCommands();
    const unregisterFileCommands = registerFileCommands();
    registerFilePanels();
    const stopShortcuts = installShortcuts();
    const stopFlow = startWorkspaceFlow();
    return () => {
      stopFlow();
      stopShortcuts();
      unregisterFileCommands();
      unregisterCommands();
      stopEvents();
      stopClock();
    };
  }, []);

  // header = แถบเตือนดิสก์ + เมนูบาร์ + แถบเครื่องมือ, footer = แถบสถานะ, กล่องโต้ตอบ (412, job ล้มเหลว, confirm, Save As) วางครั้งเดียวที่นี่
  // Welcome เป็นหน้าต่างใน Workspace (เปิดโดย startWorkspaceFlow)
  return (
    <>
      <Workspace
        header={
          <>
            <HealthBanner />
            <MenuBar />
            <Toolbars />
          </>
        }
        footer={<StatusBar />}
      />
      <Dialogs />
      <SaveAsDialog />
    </>
  );
}
