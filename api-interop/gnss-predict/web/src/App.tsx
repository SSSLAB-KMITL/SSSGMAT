import { useEffect } from "react";
import { startEventWiring } from "./api/events";
import { registerCoreCommands } from "./chrome/coreCommands";
import { Dialogs } from "./chrome/Dialogs";
import { HealthBanner } from "./chrome/HealthBanner";
import { MenuBar } from "./chrome/MenuBar";
import { StatusBar } from "./chrome/StatusBar";
import { Toolbars } from "./chrome/Toolbars";
import { installShortcuts } from "./shortcuts";
import { startClock } from "./time/clock";
import { Workspace } from "./Workspace";

export function App() {
  // นาฬิกาของแอป, การต่อ SSE เข้ากับ store, คำสั่งของเมนู/แถบเครื่องมือ และคีย์ลัด: เริ่มครั้งเดียวตอน mount หยุดตอน unmount
  useEffect(() => {
    const stopClock = startClock();
    const stopEvents = startEventWiring();
    const unregisterCommands = registerCoreCommands();
    const stopShortcuts = installShortcuts();
    return () => {
      stopShortcuts();
      unregisterCommands();
      stopEvents();
      stopClock();
    };
  }, []);

  // header = แถบเตือนดิสก์ + เมนูบาร์ + แถบเครื่องมือ, footer = แถบสถานะ, กล่องโต้ตอบ (412, job ล้มเหลว, confirm) วางครั้งเดียวที่นี่
  // งานที่ 7 (Welcome) วางเป็นหน้าต่างใน Workspace
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
    </>
  );
}
