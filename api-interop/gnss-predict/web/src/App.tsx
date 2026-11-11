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
import { registerDataCommands } from "./windows/dataCommands";
import { registerDailyForecastSettingsPanel } from "./windows/DailyForecastSettings/DailyForecastSettings";
import { registerFetchOrbitDataPanel } from "./windows/FetchOrbitData/FetchOrbitData";
import { registerFilePanels } from "./windows/filePanels";
import { registerInsertObjectsPanel } from "./windows/InsertObjects/InsertObjects";
import { registerObjectBrowserPanel } from "./windows/ObjectBrowser/ObjectBrowser";
import { registerObjectBrowserCommands } from "./windows/ObjectBrowser/objectCommands";
import { registerPropertiesBrowserPanel } from "./windows/PropertiesBrowser/PropertiesBrowser";
import { registerSatelliteCatalogPanel } from "./windows/SatelliteCatalog/SatelliteCatalog";
import { Workspace } from "./Workspace";

export function App() {
  // นาฬิกาของแอป, การต่อ SSE เข้ากับ store, คำสั่งของเมนู/แถบเครื่องมือ, หน้าต่างของไฟล์ scenario (Welcome, Wizard, About, STK UI Reference), Object Browser
  // (คำสั่ง edit.* object.* ob.* ของมันลงทะเบียนระดับแอป ไม่ผูกกับการเปิดหน้าต่าง), Properties Browser (object.properties เปิดมัน),
  // Insert STK Objects / Search Satellite Catalog / Fetch Orbit Data / Daily Forecast Settings (คำสั่ง insert.* และ utilities.* ลงทะเบียนระดับแอปเช่นกัน),
  // คีย์ลัด และการเริ่มหน้าเว็บ (?sc= หรือ Welcome): เริ่มครั้งเดียวตอน mount หยุดตอน unmount
  useEffect(() => {
    const stopClock = startClock();
    const stopEvents = startEventWiring();
    const unregisterCommands = registerCoreCommands();
    const unregisterFileCommands = registerFileCommands();
    const unregisterObjectCommands = registerObjectBrowserCommands();
    const unregisterDataCommands = registerDataCommands();
    registerFilePanels();
    registerObjectBrowserPanel();
    registerPropertiesBrowserPanel();
    registerInsertObjectsPanel();
    registerSatelliteCatalogPanel();
    registerFetchOrbitDataPanel();
    registerDailyForecastSettingsPanel();
    const stopShortcuts = installShortcuts();
    const stopFlow = startWorkspaceFlow();
    return () => {
      stopFlow();
      stopShortcuts();
      unregisterDataCommands();
      unregisterObjectCommands();
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
