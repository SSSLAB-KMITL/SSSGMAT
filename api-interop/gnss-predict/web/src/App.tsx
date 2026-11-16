import { useEffect } from "react";
import { startEventWiring } from "./api/events";
import { registerCoreCommands } from "./chrome/coreCommands";
import { Dialogs } from "./chrome/Dialogs";
import { ChromeBoundary } from "./chrome/ErrorBoundary";
import { registerFileCommands } from "./chrome/fileCommands";
import { HealthBanner } from "./chrome/HealthBanner";
import { MenuBar } from "./chrome/MenuBar";
import { SaveAsDialog } from "./chrome/SaveAsDialog";
import { StatusBar } from "./chrome/StatusBar";
import { Toolbars } from "./chrome/Toolbars";
import { installTestHooks, testModeRequested } from "./cesium/testHooks";
import { startWorkspaceFlow } from "./scenarioFiles";
import { useImagery } from "./stores/imagery";
import { installShortcuts } from "./shortcuts";
import { startClock } from "./time/clock";
import { registerAccessToolPanel } from "./windows/AccessTool/AccessTool";
import { registerAccessCommands } from "./windows/AccessTool/commands";
import { registerDataCommands } from "./windows/dataCommands";
import { registerDailyForecastSettingsPanel } from "./windows/DailyForecastSettings/DailyForecastSettings";
import { registerFetchOrbitDataPanel } from "./windows/FetchOrbitData/FetchOrbitData";
import { registerFilePanels } from "./windows/filePanels";
import { registerGlobeManagerPanel } from "./windows/GlobeManager/GlobeManager";
import { registerGraphPanel } from "./windows/Graph/Graph";
import { registerGraphics2DCommands } from "./windows/Graphics2D/commands2d";
import { registerGraphics2DPanel } from "./windows/Graphics2D/Graphics2D";
import { registerWindowProperties2DPanel } from "./windows/Graphics2D/WindowProperties2D";
import { registerGraphics3DCommands } from "./windows/Graphics3D/commands3d";
import { registerGraphics3DPanel } from "./windows/Graphics3D/Graphics3D";
import { registerWindowProperties3DPanel } from "./windows/Graphics3D/WindowProperties3D";
import { registerInsertObjectsPanel } from "./windows/InsertObjects/InsertObjects";
import { registerMessageViewerPanel } from "./windows/MessageViewer/MessageViewer";
import { registerObjectBrowserPanel } from "./windows/ObjectBrowser/ObjectBrowser";
import { registerObjectBrowserCommands } from "./windows/ObjectBrowser/objectCommands";
import { registerPropertiesBrowserPanel } from "./windows/PropertiesBrowser/PropertiesBrowser";
import { registerReportPanel } from "./windows/Report/Report";
import { registerReportGraphManagerCommands } from "./windows/ReportGraphManager/commands";
import { registerReportGraphManagerPanel } from "./windows/ReportGraphManager/ReportGraphManager";
import { registerStyleEditorPanel } from "./windows/ReportGraphManager/StyleEditor";
import { registerSatelliteCatalogPanel } from "./windows/SatelliteCatalog/SatelliteCatalog";
import { registerSensorViewCommands } from "./windows/SensorView/commands";
import { registerSensorViewPanel } from "./windows/SensorView/SensorView";
import { startSensorViewTracking } from "./windows/SensorView/track";
import { registerTimelineViewPanel } from "./windows/TimelineView/TimelineView";
import { registerValidationCommands } from "./windows/Validation/commands";
import { registerValidationPanel } from "./windows/Validation/Validation";
import { registerViewFromToPanel } from "./windows/ViewFromTo/ViewFromTo";
import { Workspace } from "./Workspace";

export function App() {
  // นาฬิกาของแอป, การต่อ SSE เข้ากับ store, คำสั่งของเมนู/แถบเครื่องมือ, หน้าต่างของไฟล์ scenario (Welcome, Wizard, About, STK UI Reference), Object Browser
  // (คำสั่ง edit.* object.* ob.* ของมันลงทะเบียนระดับแอป ไม่ผูกกับการเปิดหน้าต่าง), Properties Browser (object.properties เปิดมัน),
  // Insert STK Objects / Search Satellite Catalog / Fetch Orbit Data / Daily Forecast Settings (คำสั่ง insert.* และ utilities.* ลงทะเบียนระดับแอปเช่นกัน),
  // Globe Manager (คำสั่ง view.globeManager อยู่ใน coreCommands: เปิดหน้าต่างนี้),
  // หน้าต่าง 3D + View From/To + 3D Graphics Window Properties (คำสั่ง g3d.* และ object.zoomTo ระดับแอป ทำกับหน้าต่าง 3D ที่ active),
  // หน้าต่าง 2D + 2D Graphics Window Properties (คำสั่ง g2d.* ระดับแอป ทำกับหน้าต่าง 2D ที่ active), Timeline View และ Message Viewer,
  // Sensor View (คำสั่ง object.sensorView ระดับแอป และการตามต้นไม้ของ scenario: ปิด/ตั้งชื่อหน้าต่างใหม่เมื่อ sensor หรือดาวแม่ถูกลบหรือเปลี่ยนชื่อ),
  // หน้าต่างรายงานและหน้าต่างกราฟ (เปิดด้วย openReport ของ windows/Report/Report.tsx: style ชนิด graph ไปหน้าต่างกราฟ),
  // Access tool (คำสั่ง analysis.access / object.access ระดับแอป: เปิดหน้าต่างนี้),
  // Report & Graph Manager และหน้าต่างแก้ style (คำสั่ง analysis.reportGraphManager / object.reportGraphManager ระดับแอป),
  // หน้า Validation (คำสั่ง analysis.validation ระดับแอป: เปิดหน้าต่างนี้ได้โดยไม่ต้องมี scenario),
  // คีย์ลัด และการเริ่มหน้าเว็บ (?sc= หรือ Welcome): เริ่มครั้งเดียวตอน mount หยุดตอน unmount
  // `?test` ใน URL = ติดตั้ง window.__gnssStudioTest (W19) ครั้งเดียว
  useEffect(() => {
    const stopClock = startClock();
    const stopEvents = startEventWiring();
    const unregisterCommands = registerCoreCommands();
    const unregisterFileCommands = registerFileCommands();
    const unregisterObjectCommands = registerObjectBrowserCommands();
    const unregisterDataCommands = registerDataCommands();
    const unregisterGraphics3DCommands = registerGraphics3DCommands();
    const unregisterGraphics2DCommands = registerGraphics2DCommands();
    const unregisterSensorViewCommands = registerSensorViewCommands();
    const unregisterAccessCommands = registerAccessCommands();
    const unregisterReportGraphManagerCommands = registerReportGraphManagerCommands();
    const unregisterValidationCommands = registerValidationCommands();
    registerFilePanels();
    registerObjectBrowserPanel();
    registerTimelineViewPanel();
    registerMessageViewerPanel();
    registerPropertiesBrowserPanel();
    registerInsertObjectsPanel();
    registerSatelliteCatalogPanel();
    registerFetchOrbitDataPanel();
    registerDailyForecastSettingsPanel();
    registerGlobeManagerPanel();
    registerGraphics3DPanel();
    registerViewFromToPanel();
    registerWindowProperties3DPanel();
    registerGraphics2DPanel();
    registerWindowProperties2DPanel();
    registerSensorViewPanel();
    registerReportPanel();
    registerGraphPanel();
    registerAccessToolPanel();
    registerReportGraphManagerPanel();
    registerStyleEditorPanel();
    registerValidationPanel();
    const stopSensorViewTracking = startSensorViewTracking();
    if (testModeRequested()) installTestHooks();
    const stopShortcuts = installShortcuts();
    const stopFlow = startWorkspaceFlow();
    // สวิตช์และรายการภาพพื้นโลกออนไลน์ (GIBS) ไม่ผูก scenario: อ่านครั้งเดียว ล้มเหลว = ปิดไว้พร้อมคำเตือนไทย (stores/imagery.ts)
    void useImagery.getState().load();
    return () => {
      stopFlow();
      stopShortcuts();
      stopSensorViewTracking();
      unregisterValidationCommands();
      unregisterReportGraphManagerCommands();
      unregisterAccessCommands();
      unregisterSensorViewCommands();
      unregisterGraphics2DCommands();
      unregisterGraphics3DCommands();
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
  // ทั้งสามส่วนอยู่ใน ChromeBoundary ของตัวเอง (หน้าต่างแต่ละบานมี PanelBoundary ใน Workspace): ส่วนที่โยนตอนวาดไม่ทำให้หน้าต่างทั้งหมดหาย
  return (
    <>
      <Workspace
        header={
          <ChromeBoundary part="header">
            <HealthBanner />
            <MenuBar />
            <Toolbars />
          </ChromeBoundary>
        }
        footer={
          <ChromeBoundary part="footer">
            <StatusBar />
          </ChromeBoundary>
        }
      />
      <ChromeBoundary part="dialogs">
        <Dialogs />
        <SaveAsDialog />
      </ChromeBoundary>
    </>
  );
}
