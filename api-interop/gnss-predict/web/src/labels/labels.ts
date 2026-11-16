// ตารางชื่อเดียวของทุกข้อความที่เห็นบนจอ (spec §13): เมนู ปุ่ม หน้าต่าง หน้า Properties ช่อง ตัวเลือก ฯลฯ
// ทุกที่ในแอปเรียก t("<key>") ไม่เขียนข้อความตรงๆ
//
// กติกาของ source
//   stk  = ข้อความนี้พบตรงตัว (ตัวพิมพ์เป็นตัวตัดสิน) เป็นชื่อเต็มในเซลล์ Item หรือ "STK term / behavior" ของหัวข้อที่ `ref` อ้าง
//          ใน docs/2026-11-11-gnss-studio-stk-reference.md (คั่นด้วย , / ; ( ) = * + หรือเครื่องหมายคำพูด ไม่นับคอลัมน์ Verdict/Page
//          ไม่นับเศษของชื่อที่ยาวกว่า) และ reference ใช้คำนี้เรียกสิ่งเดียวกัน (คำสั่ง หน้าต่าง หน้า ช่อง หรือตัวเลือกเดียวกัน แม้จะอยู่คนละเมนู)
//          ชื่อที่ reference เขียนกลางประโยคมีข้อความอ้างตรงตัวใน test (PROSE_EVIDENCE)
//   stkHelp = ข้อความนี้ยืนยันตรงตัวบน help.agi.com ใน docs/2026-11-15-stk-terms-access-reports.md (ข้อความอ้างในเครื่องหมายคำพูดของแถวที่ไม่ใช่ "ไม่พบ")
//          ใช้กับคำของ Report & Graph Manager / Style Properties / หน้าต่างรายงานและกราฟที่ reference §F ไม่มี (test ตรวจกับไฟล์นั้น HELP_EVIDENCE)
//   ours = ที่เหลือทั้งหมด แม้ฟังดูเหมือน STK (เช่น "Save", "Basic - Description") เพราะ reference ไม่ได้ยืนยัน
//          UI "Help → STK UI Reference" แสดงทั้งสองกลุ่ม และ About ติดป้าย "Added by GNSS Studio" ที่รายการ ours
// test (tests/unit/labels.test.ts) ตรวจทุกรายการ stk กับไฟล์ reference (หรือไฟล์ผลตรวจคำของ help.agi.com สำหรับ stkHelp) ห้ามแก้ไฟล์เหล่านั้นให้ test ผ่าน
//
// การตั้งชื่อคีย์: `<กลุ่ม>.<ที่ใช้>.<ชื่อ>` แบบ camelCase กลุ่มที่ใช้: menu anim toolbar window page field option ob
// timeline report (หน้าต่างรายงาน) graph (หน้าต่างกราฟ) access (Access tool) rgm (Report & Graph Manager และหน้าต่างแก้ style) mv status dialog help
// sensorView (ตัวเลือกบนหน้าต่าง Sensor View)
// คีย์เดียวใช้ได้หลายที่เมื่อเป็นสิ่งเดียวกัน เช่น
//   - เมนูย่อย View → Toolbars ใช้ toolbar.* เป็นชื่อแถบ
//   - เมนูคลิกขวาของ Object Browser ใช้ menu.object.* ชุดเดียวกับเมนูที่ตั้งชื่อตามชนิด object
//   - ช่อง Time Step และ X Real Time Multiplier ในหน้า Basic - Time ใช้ anim.timeStep / anim.xRealTimeMultiplier
//   - ช่อง Start / Stop ในหน้า Wizard ใช้ field.analysisStart / field.analysisStop
//   - ชื่อแถบ Message Viewer ที่ไอคอนแถบสถานะใช้ window.messageViewer
//   - ชื่อหน้าต่าง About ใช้ help.about
// ข้อความที่มี {n} หรือ {name} ต้องเรียก t(key, { n: 2 })

import { ENUMS } from "../api/enums.gen";

export type Label = { text: string; source: "stk" | "ours"; ref?: string };
type Section = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

const stk = (text: string, section: Section): Label => ({ text, source: "stk", ref: `STK ref §${section}` });
const ours = (text: string): Label => ({ text, source: "ours" });
/** ยืนยันบน help.agi.com (docs/2026-11-15-stk-terms-access-reports.md) */
const stkHelp = (text: string): Label => ({ text, source: "stk", ref: STK_HELP_REF });
export const STK_HELP_REF = "STK help (2026-11-15)";

const LABELS = {
  // ---------- เมนูบนสุด (spec §5.1, STK ref §A) ----------
  "menu.file": stk("File", "A"),
  "menu.edit": stk("Edit", "A"),
  "menu.view": stk("View", "A"),
  "menu.insert": stk("Insert", "A"),
  "menu.analysis": stk("Analysis", "A"),
  "menu.utilities": stk("Utilities", "A"),
  "menu.window": stk("Window", "A"),
  "menu.help": stk("Help", "A"),

  "menu.file.new": ours("New..."),
  "menu.file.open": ours("Open..."),
  "menu.file.save": ours("Save"),
  "menu.file.saveAs": ours("Save As..."),
  "menu.file.close": ours("Close"),
  "menu.file.recent": ours("Recent Scenarios"),
  "menu.file.exit": ours("Exit"),

  "menu.edit.cut": stk("Cut", "B"),
  "menu.edit.copy": stk("Copy", "B"),
  "menu.edit.paste": stk("Paste", "B"),
  "menu.edit.delete": stk("Delete", "B"),
  "menu.edit.find": ours("Find..."),

  "menu.view.objectBrowser": stk("Object Browser", "A"),
  "menu.view.timelineView": stk("Timeline View", "A"),
  "menu.view.messageViewer": stk("Message Viewer", "A"),
  "menu.view.new3dWindow": ours("New 3D Graphics Window"),
  "menu.view.new2dWindow": ours("New 2D Graphics Window"),
  // STK help: "the Globe Manager selection on the View menu" (STK ref §H); ไม่ใส่ ... ตามที่ STK เขียน
  "menu.view.globeManager": stk("Globe Manager", "H"),
  "menu.view.toolbars": stk("Toolbars", "A"),
  "menu.view.fullScreen": ours("Full Screen"),

  "menu.insert.new": ours("New..."),
  "menu.insert.facility": ours("Facility..."),
  "menu.insert.satellite": ours("Satellite..."),
  // reference ไม่มีชื่อ "Sensor..." (Insert menu มีแค่ "New..." กับ "Default Object...") จึงเป็น ours เหมือน Satellite...
  "menu.insert.sensor": ours("Sensor..."),
  "menu.insert.constellation": ours("Constellation..."),

  "menu.analysis.access": stk("Access...", "B"),
  "menu.analysis.reportGraphManager": stk("Report & Graph Manager...", "F"),
  "menu.analysis.validation": ours("Validation..."),

  // เมนูที่ตั้งชื่อตามชนิด object ที่เลือก และเมนูคลิกขวาของ Object Browser
  "menu.object.properties": stk("Properties", "B"),
  "menu.object.access": stk("Access...", "B"),
  "menu.object.reportGraphManager": stk("Report & Graph Manager...", "B"),
  "menu.object.zoomTo": stk("Zoom To", "B"),
  "menu.object.rename": stk("Rename", "B"),
  "menu.object.delete": stk("Delete", "B"),
  // STK ไม่มีคำสั่งมองผ่าน sensor (§G "View through a sensor" = NF; ใกล้สุดคือ Obscuration...) จึงเป็น ours
  "menu.object.sensorView": ours("Sensor View"),

  "menu.utilities.fetchOrbitData": ours("Fetch Orbit Data..."),
  "menu.utilities.dailyForecastSettings": ours("Daily Forecast Settings..."),

  "menu.window.windows": stk("Windows...", "A"),
  "menu.window.cascade": stk("Cascade", "A"),
  "menu.window.tileHorizontally": stk("Tile Horizontally", "A"),
  "menu.window.tileVertically": stk("Tile Vertically", "A"),

  "menu.shortcut.save": stk("Ctrl+S", "A"),
  "menu.shortcut.delete": stk("Delete", "A"),
  "menu.shortcut.find": ours("Ctrl+F"),

  // ---------- เมนู Help และหน้าต่าง Help/About (spec §5.1, §11, W21) ----------
  "help.welcome": ours("Welcome..."),
  "help.stkReference": ours("STK UI Reference"),
  "help.about": ours("About GNSS Studio"),
  "help.engineVersion": ours("Engine Version"),
  "help.gmatVersion": ours("GMAT Version"),
  "help.colText": ours("Text"),
  "help.colSource": ours("Source"),
  "help.colRef": ours("STK ref"),
  "help.sourceStk": ours("STK"),
  "help.sourceOurs": ours("Added by GNSS Studio"),

  // ---------- แถบเครื่องมือ (spec §5.2, STK ref §A §E §F) ----------
  "toolbar.default": stk("Default", "A"),
  "toolbar.animation": stk("Animation", "A"),
  "toolbar.graphics3d": stk("3D Graphics", "A"),
  "toolbar.window3dDefaults": stk("3D Window Defaults", "A"),
  "toolbar.window2dDefaults": stk("2D Window Defaults", "A"),

  "toolbar.new": ours("New"),
  "toolbar.open": ours("Open"),
  "toolbar.save": ours("Save"),
  "toolbar.insertObject": stk("Insert Object", "A"),
  "toolbar.properties": stk("Properties", "E"),
  "toolbar.access": ours("Access"),
  "toolbar.reportGraphManager": stk("Report & Graph Manager", "F"),
  "toolbar.homeView": stk("Home View", "E"),
  "toolbar.viewFromTo": stk("View From/To", "E"),
  "toolbar.grabGlobe": stk("Grab Globe", "E"),
  "toolbar.zoomIn": stk("Zoom In", "E"),
  "toolbar.zoomOut": ours("Zoom Out"),

  // ---------- แถบ Animation (spec §6.1, STK ref §D) ----------
  "anim.reset": stk("Reset", "D"),
  "anim.stepBackward": stk("Step Backward", "D"),
  "anim.reverse": stk("Reverse", "D"),
  "anim.pause": stk("Pause", "D"),
  "anim.start": stk("Start", "D"),
  "anim.stepForward": stk("Step Forward", "D"),
  "anim.decreaseStep": stk("Decrease Time Step", "D"),
  "anim.increaseStep": stk("Increase Time Step", "D"),
  "anim.normalMode": stk("Normal Animation Mode", "D"),
  "anim.realTimeMode": stk("Real-Time Animation Mode", "D"),
  "anim.xRealTimeMode": stk("X Real-Time Animation Mode", "D"),
  "anim.currentTime": stk("Current Scenario Time", "D"),
  "anim.timeStep": stk("Time Step", "D"),
  "anim.xRealTimeMultiplier": stk("X Real Time Multiplier", "D"),

  // ---------- หน้าต่าง (spec §4.1, §11) ----------
  "window.objectBrowser": stk("Object Browser", "A"),
  "window.graphics3d": ours("3D Graphics {n} - Earth"),
  "window.graphics2d": ours("2D Graphics {n} - Earth"),
  "window.timelineView": stk("Timeline View", "A"),
  "window.messageViewer": stk("Message Viewer", "A"),
  "window.propertiesBrowser": stk("Properties Browser", "C"),
  "window.propertiesBrowserFor": ours("{name} Properties"),
  "window.insertObjects": stk("Insert STK Objects", "A"),
  // หลัง Insert Default ของ Sensor เลือกดาวแม่ในหน้าต่างนี้ (STK ref §G "Insert")
  "window.selectObject": stk("Select Object", "G"),
  // หน้าต่าง Sensor View ของ sensor หนึ่งตัว {sensor} = ชื่อ sensor, {satellite} = ชื่อดาวแม่ (แบบเดียวกับ window.propertiesBrowserFor)
  "window.sensorView": ours("Sensor View - {sensor} ({satellite})"),
  "window.satelliteCatalog": ours("Search Satellite Catalog"),
  "window.newScenarioWizard": ours("New Scenario Wizard"),
  "window.welcome": ours("Welcome to GNSS Studio"),
  "window.viewFromTo": stk("View From/To", "E"),
  "window.properties3d": stk("3D Graphics Window Properties", "E"),
  "window.properties2d": stk("2D Graphics Window Properties", "E"),
  "window.windows": ours("Windows"),
  "window.fetchOrbitData": ours("Fetch Orbit Data"),
  "window.dailyForecastSettings": ours("Daily Forecast Settings"),
  "window.globeManager": stk("Globe Manager", "H"),
  // ชื่อหน้าต่างรายงาน/กราฟที่เลือกหลาย object (P11): `Multiple Objects: <style>` (data/reports.ts reportTitle)
  "window.multipleObjects": ours("Multiple Objects"),
  // ชื่อชนิดหน้าต่างรายงาน (ชื่อบนแท็บของแต่ละบานมาจาก reportTitle: `THBK-To-G01: Access`) reference ไม่มีคำนี้เดี่ยว ๆ
  "window.report": ours("Report"),
  // ชื่อชนิดหน้าต่างกราฟ (ชื่อบนแท็บมาจาก reportTitle แบบเดียวกับรายงาน) reference ไม่มีคำนี้เดี่ยว ๆ
  "window.graph": ours("Graph"),
  // Report & Graph Manager (spec §5) และหน้าต่างแก้ style (spec §5.1: STK เรียกหน้าต่างนี้ว่า Properties ของ style)
  "window.reportGraphManager": stk("Report & Graph Manager", "F"),
  "window.styleEditor": ours("Style Properties"),
  "window.styleEditorFor": ours("{name} Style Properties"),
  // หน้า Validation (spec §7, เพิ่มเอง): ไม่มีใน STK
  "window.validation": ours("Validation"),

  "window.mode.dockable": stk("Dockable", "A"),
  "window.mode.floating": stk("Floating", "A"),
  "window.mode.integrated": stk("Integrated", "A"),

  // ---------- ปุ่มและกล่องโต้ตอบ ----------
  "dialog.ok": stk("OK", "C"),
  "dialog.cancel": stk("Cancel", "C"),
  "dialog.apply": stk("Apply", "C"),
  "dialog.help": stk("Help", "C"),
  "dialog.reload": ours("Reload"),
  "dialog.retry": ours("Retry"),
  "dialog.confirm": ours("Confirm"),
  "dialog.yes": ours("Yes"),
  "dialog.no": ours("No"),
  "dialog.add": ours("Add..."),
  "dialog.remove": ours("Remove"),
  "dialog.assign": ours("Assign"),
  "dialog.unassign": ours("Unassign"),
  "dialog.assignAll": ours("Assign All"),
  "dialog.unassignAll": ours("Unassign All"),
  "dialog.clear": ours("Clear"),
  "dialog.selectColor": stk("Select color", "B"),
  "dialog.fetchNow": ours("Fetch Now"),
  "dialog.runNow": ours("Run Now"),

  "dialog.windows.window": ours("Window"),
  "dialog.windows.type": ours("Type"),
  "dialog.windows.activate": stk("Activate", "A"),
  "dialog.windows.integrate": stk("Integrate", "A"),
  "dialog.windows.center": stk("Center", "A"),
  "dialog.windows.close": stk("Close", "A"),

  "dialog.welcome.createScenario": stk("Create a Scenario", "A"),
  "dialog.welcome.openScenario": stk("Open a Scenario", "A"),

  "dialog.insert.selectObject": stk("Select An Object To Be Inserted", "B"),
  "dialog.insert.selectMethod": stk("Select A Method", "B"),
  "dialog.insert.defineProperties": stk("Define Properties", "B"),
  "dialog.insert.insertDefault": stk("Insert Default", "B"),
  "dialog.insert.fromSatelliteCatalog": ours("From Satellite Catalog"),
  "dialog.insert.insert": ours("Insert..."),

  "dialog.catalog.searchStandardObjectData": stk("Search Standard Object Data", "B"),
  "dialog.catalog.dataSources": stk("Data Sources", "B"),
  "dialog.catalog.sourceLocal": ours("Local snapshot"),
  "dialog.catalog.sourceOnline": ours("Online CelesTrak"),
  "dialog.catalog.search": ours("Search"),
  "dialog.catalog.createConstellation": stk("Create Constellation from Selected", "B"),
  "dialog.catalog.insert": ours("Insert"),

  // ---------- หน้า Properties (spec §8, STK ref §C) "กลุ่ม - หน้า" ----------
  "page.scenario.basicTime": stk("Basic - Time", "C"),
  "page.scenario.basicUnits": stk("Basic - Units", "C"),
  "page.scenario.basicDescription": ours("Basic - Description"),
  "page.scenario.basicIonosphere": ours("Basic - Ionosphere"),
  "page.scenario.graphics2dGlobalAttributes": stk("2D Graphics - Global Attributes", "C"),

  "page.facility.basicPosition": stk("Basic - Position", "C"),
  "page.facility.basicDescription": ours("Basic - Description"),
  "page.facility.constraintsActive": stk("Constraints - Active", "C"),
  "page.facility.graphics2dAttributes": stk("2D Graphics - Attributes", "C"),

  "page.satellite.basicOrbit": stk("Basic - Orbit", "C"),
  "page.satellite.basicDescription": ours("Basic - Description"),
  "page.satellite.graphics2dAttributes": stk("2D Graphics - Attributes", "C"),
  "page.satellite.graphics2dPass": stk("2D Graphics - Pass", "C"),
  "page.satellite.graphics2dSwath": stk("2D Graphics - Swath", "C"),
  "page.satellite.graphics3dOrbitSystem": stk("3D Graphics - Orbit System", "C"),

  // Sensor (STK ref §G): "Basic - Description" ใช้คีย์ page.*.basicDescription เดิมของ object อื่น (ข้อความเดียวกัน ไม่สร้างซ้ำ)
  "page.sensor.definition": stk("Basic - Definition", "G"),
  "page.sensor.pointing": stk("Basic - Pointing", "G"),
  // §G เขียนแค่ "Attributes" ใต้ "2D Graphics pages" 2D ใช้ชื่อ "กลุ่ม - หน้า" เดียวกับของ Satellite และ Facility (§C "Page naming", อ้างตรงตัวใน PROSE_EVIDENCE ของ test)
  "page.sensor.attributes2d": stk("2D Graphics - Attributes", "C"),
  // "3D Graphics - Attributes" ไม่มีตรงตัวใน reference (§G มี "3D Graphics pages" กับ "Attributes (...)" แยกกัน) จึงเป็น ours
  "page.sensor.attributes3d": ours("3D Graphics - Attributes"),

  "page.constellation.basicDefinition": stk("Basic - Definition", "B"),
  "page.constellation.basicDescription": ours("Basic - Description"),

  // หน้าของหน้าต่าง 3D/2D Graphics Window Properties (spec §9.2, §9.3, STK ref §E)
  "page.window3d.lighting": stk("Lighting", "E"),
  "page.window3d.details": stk("Details", "E"),
  "page.window3d.annotation": stk("Annotation", "E"),
  "page.window2d.projection": stk("Projection", "E"),
  "page.window2d.details": stk("Details", "E"),
  "page.window2d.lighting": stk("Lighting", "E"),

  // ---------- ช่องในหน้า Properties และกล่องโต้ตอบ ----------
  // Scenario: Basic - Time ("Start"/"Stop" ของ Analysis Period ไม่มีใน reference จึงเป็น ours; "Start Time" ของ Animation มี)
  "field.analysisPeriod": stk("Analysis Period", "C"),
  "field.analysisStart": ours("Start"),
  "field.analysisStop": ours("Stop"),
  "field.duration": ours("Duration"),
  "field.animation": stk("Animation", "C"),
  "field.animationStartTime": stk("Start Time", "C"),
  "field.timeUpdateMode": stk("Time Update Mode", "C"),
  "field.animationCycle": stk("Animation Cycle", "C"),
  // Scenario: Basic - Units
  "field.dateFormat": stk("DateFormat", "C"),
  "field.ltzOffset": ours("LTZG Offset"),
  "field.distance": ours("Distance"),
  "field.angle": ours("Angle"),
  // Basic - Description (ทุกชนิด object)
  "field.shortDescription": ours("Short Description"),
  "field.longDescription": ours("Long Description"),
  "field.memberColors": ours("Member Colors"),
  // Basic - Ionosphere
  "field.shellHeight": ours("Shell Height (km)"),
  // 2D Graphics - Global Attributes
  "field.showLabels": stk("Show Labels", "C"),
  // Facility: Basic - Position
  "field.positionType": stk("Position Type", "C"),
  "field.latitude": stk("Latitude", "C"),
  "field.longitude": stk("Longitude", "C"),
  "field.altitude": stk("Altitude", "C"),
  // Facility: Constraints - Active
  "field.selectConstraintsToAdd": stk("Select Constraints to Add", "C"),
  "field.elevationAngle": stk("Elevation Angle", "C"),
  "field.active": ours("Active"),
  "field.min": ours("Min"),
  "field.max": ours("Max"),
  // 2D Graphics - Attributes
  "field.color": stk("Color", "C"),
  "field.markerStyle": stk("Marker Style", "C"),
  "field.lineStyle": stk("Line Style", "C"),
  "field.lineWidth": stk("Line Width", "C"),
  "field.inheritFromScenario": stk("Inherit from Scenario", "C"),
  // Satellite: Basic - Orbit
  "field.propagator": stk("Propagator", "C"),
  "field.tleSource": stk("TLE Source", "C"),
  "field.sscNumber": stk("SSC number", "C"),
  "field.epoch": ours("Epoch"),
  "field.dataAge": ours("Data Age"),
  // Satellite: Basic - Description, tooltip ใน Object Browser และคอลัมน์ของ Search Satellite Catalog
  "field.prn": ours("PRN"),
  "field.svn": ours("SVN"),
  "field.norad": ours("NORAD"),
  "field.block": ours("Block"),
  "field.celestrakName": ours("CelesTrak Name"),
  "field.flags": ours("Flags"),
  "field.name": ours("Name"),
  "field.system": ours("System"),
  "field.status": ours("Status"),
  "field.age": ours("Age"),
  // Satellite: 2D Graphics - Pass
  "field.leadType": stk("Lead Type", "C"),
  "field.trailType": stk("Trail Type", "C"),
  "field.leadTime": ours("Lead Time"),
  "field.leadPercent": ours("Lead Percent"),
  "field.trailTime": ours("Trail Time"),
  "field.trailPercent": ours("Trail Percent"),
  "field.visibleSides": stk("Visible Sides", "C"),
  "field.showPassLabels": stk("Show Pass Labels", "C"),
  "field.showPathLabels": stk("Show Path Labels", "C"),
  // Satellite: 2D Graphics - Swath
  "field.swathType": ours("Swath Type"),
  "field.groundElevation": stk("Ground Elevation", "C"),
  "field.swathOptions": ours("Options"),
  "field.orbitSystem": ours("Orbit System"),
  // Constellation: Basic - Definition
  "field.availableObjects": stk("Available Objects", "B"),
  "field.assignedObjects": stk("Assigned Objects", "B"),
  "field.selectionFilter": ours("Selection Filter"),
  // Sensor (STK ref §G): Basic - Definition / Basic - Pointing / 2D, 3D Graphics - Attributes (Color, Show ใช้คีย์เดิม)
  "field.parentObject": ours("Parent"),
  "field.sensorType": stk("Sensor Type", "G"),
  "field.coneHalfAngle": stk("Cone Half Angle", "G"),
  "field.pointingType": stk("Pointing Type", "G"),
  "field.orientationMethod": stk("Orientation Method", "G"),
  "field.azimuth": stk("Azimuth", "G"),
  "field.elevation": stk("Elevation", "G"),
  "field.aboutBoresight": stk("About Boresight", "G"),
  "field.fill": stk("Fill", "G"),
  "field.translucency": stk("% Translucency", "G"),
  "field.showRadialLines": stk("Show Radial Lines", "G"),
  "field.showBoresightMarker": stk("Show Boresight Marker", "G"),
  // View From/To (spec §9.2)
  "field.mode": ours("Mode"),
  "field.fromPosition": stk("From Position", "E"),
  "field.toPosition": ours("To Position"),
  "field.referenceFrame": ours("Reference Frame"),
  // 3D Graphics Window Properties
  "field.enableLighting": stk("Enable Lighting", "E"),
  "field.ambientLevel": stk("Ambient Level", "E"), // reference: "Sun Lighting Ambient Level" (อ้างตรงตัวใน PROSE_EVIDENCE ของ test)
  "field.sunLevel": stk("Sun Level", "E"),
  "field.nightLightsLevel": stk("Night Lights Level", "E"),
  "field.latLonLines": stk("Lat/Lon Lines", "E"),
  "field.labelDeclutter": stk("Label Declutter", "E"),
  "field.showTime": stk("Show Time", "E"),
  // โมเดล 3 มิติของดาว (ไม่มีใน STK reference: ชื่อของเราเอง)
  "field.satelliteModels": ours("Satellite Models"),
  "field.modelPixelSize": ours("Model Pixel Size"),
  "field.modelDetailThreshold": ours("Model Detail Threshold"), // STK reference ไม่มีคำว่า detail threshold
  // 2D Graphics Window Properties
  "field.projection": stk("Projection", "E"),
  "field.displayCoordinateFrame": stk("Display Coordinate Frame", "E"),
  "field.showOutline": stk("Show Outline", "E"),
  "field.shading": stk("Shading", "E"),
  "field.showIpp": ours("Show IPP"),
  // New Scenario Wizard, Fetch Orbit Data, Daily Forecast Settings
  "field.location": ours("Location"),
  "field.template": ours("Template"),
  "field.orbitData": ours("Orbit Data"),
  "field.latestSnapshot": ours("Latest Snapshot"),
  "field.groups": ours("Groups"),
  "field.nextFetch": ours("Next Fetch Available"),
  "field.lastRun": ours("Last Run"),
  "field.tecCsv": ours("CSV for TEC"),
  // Fetch Orbit Data
  "field.snapshotTime": ours("Snapshot Time"),
  "field.broadcast": ours("Broadcast Ephemeris"),
  "field.satellites": ours("Satellites"),
  "field.lastRequest": ours("Last Request"),
  // Daily Forecast Settings (ช่องตาม server §9.1 และสถานะงานประจำวัน; reference ไม่มีคำเหล่านี้)
  "field.dailyEnabled": ours("Enabled"),
  "field.runAt": ours("Run At (UTC)"),
  "field.retention": ours("Retention"),
  "field.validationRetry": ours("Validation Retry Every"),
  "field.validationGiveUp": ours("Validation Give Up After"),
  "field.cesiumToken": ours("Cesium Ion Token"),
  "field.nextRun": ours("Next Run"),
  "field.forDate": ours("For Date"),
  // Globe Manager (STK ref §H: STK มีช่องติ๊กไม่มีป้ายและคำ Translucency ใช้ "Show" = ob.show และ "% Translucency" = field.translucency ที่มีอยู่)
  "field.onlineImagery": ours("Online imagery (NASA GIBS)"),
  "field.globeLayer": ours("Layer"),
  // สวิตช์ของอีกสามแหล่ง (กลุ่มของ Globe Manager) ตั้งชื่อตามแบบของสวิตช์ GIBS; ช่อง token ใช้ field.cesiumToken เดิม ปุ่มบันทึกใช้ dialog.apply
  "field.onlineImageryEox": ours("Online imagery (Sentinel-2 cloudless)"),
  "field.onlineImageryOsm": ours("Online imagery (OpenStreetMap)"),
  "field.onlineImageryIon": ours("Online imagery (Cesium ion)"),
  "field.ionAsset": ours("Cesium ion asset"),
  "field.ionAssetId": ours("Asset ID"),
  "option.ionAsset.none": ours("None"),
  // หน่วยที่ต่อท้ายช่อง
  "field.unit.deg": ours("deg"),
  "field.unit.m": ours("m"),
  "field.unit.km": ours("km"),
  "field.unit.sec": ours("sec"),
  "field.unit.days": ours("days"),
  "field.unit.hours": ours("hours"),
  "field.unit.offset": ours("±hh:mm"),
  "field.unit.percent": ours("%"),
  "field.unit.px": ours("px"),

  // ---------- คำที่แสดงของตัวเลือก (ค่าที่เก็บกับคำที่แสดงต่างกันได้ ดู optionLabel) ----------
  // Time Update Mode (STK ref §C) ค่าที่เก็บ time_step / real_time / x_real_time
  "option.updateMode.timeStep": stk("Time Step", "C"),
  "option.updateMode.realTime": stk("Real Time", "C"),
  "option.updateMode.xRealTime": stk("X Real-Time", "C"),
  // Animation Cycle (STK ref §C) ค่าที่เก็บ off / stop / loop
  // ชั้นฐานของลูกโลกที่มากับโปรแกรม (Globe Manager): ออฟไลน์ เป็นฐานเสมอ
  "option.globe.naturalEarthII": ours("Natural Earth II"),
  "option.cycle.off": stk("Off", "C"),
  "option.cycle.stop": stk("Stop at Time", "C"),
  "option.cycle.loop": stk("Loop at Time", "C"),
  // DateFormat (STK ref §C)
  "option.dateFormat.utcg": stk("UTCG", "C"),
  "option.dateFormat.ltzg": stk("LTZG", "C"),
  "option.unit.kilometers": ours("Kilometers"),
  "option.unit.degrees": ours("Degrees"),
  "option.positionType.geodetic": stk("Geodetic", "C"),
  "option.propagator.sgp4": stk("SGP4", "C"),
  // Lead Type / Trail Type (STK ref §C)
  "option.pass.time": stk("Time", "C"),
  "option.pass.percent": stk("Percent", "C"),
  "option.pass.quarter": stk("Quarter", "C"),
  "option.pass.half": stk("Half", "C"),
  "option.pass.full": stk("Full", "C"),
  "option.pass.all": stk("All", "C"),
  "option.pass.none": stk("None", "C"),
  "option.pass.onePass": stk("One Pass", "C"),
  "option.pass.currentInterval": stk("Current Interval", "C"),
  "option.pass.sameAsLead": stk("Same As Lead", "C"),
  "option.visibleSides.both": ours("Both"),
  "option.visibleSides.ascending": ours("Ascending"),
  "option.visibleSides.descending": ours("Descending"),
  "option.swathType.groundElevation": stk("Ground Elevation", "C"),
  "option.swath.noGraphics": ours("No Graphics"),
  "option.swath.edgeLimits": stk("Edge Limits", "C"),
  "option.swath.filledLimits": stk("Filled Limits", "C"),
  "option.orbitSystem.fixedByWindow": stk("Fixed by Window", "C"),
  "option.orbitSystem.inertialByWindow": stk("Inertial by Window", "C"),
  "option.markerStyle.point": ours("Point"),
  "option.markerStyle.plus": ours("Plus"),
  "option.markerStyle.star": ours("Star"),
  "option.markerStyle.square": ours("Square"),
  "option.markerStyle.circle": ours("Circle"),
  "option.markerStyle.diamond": ours("Diamond"),
  "option.markerStyle.triangle": ours("Triangle"),
  "option.markerStyle.cross": ours("Cross"),
  "option.lineStyle.solid": ours("Solid"),
  "option.lineStyle.dashed": ours("Dashed"),
  "option.lineStyle.dotted": ours("Dotted"),
  "option.lineStyle.dotDashed": ours("Dot Dashed"),
  "option.lineStyle.longDashed": ours("Long Dashed"),
  "option.lineStyle.dashDotDot": ours("Dash Dot Dot"),
  "option.lineStyle.mediumDashed": ours("Medium Dashed"),
  "option.lineStyle.shortDashed": ours("Short Dashed"),
  // Sensor (STK ref §G) ค่าที่เก็บ = คำที่แสดง (ENUMS.SensorDefinitionType / SensorPointingType / SensorOrientation / SensorAboutBoresight)
  "option.sensorType.simpleConic": stk("Simple Conic", "G"),
  "option.pointingType.fixed": stk("Fixed", "G"),
  "option.orientation.azEl": stk("Az-El", "G"),
  "option.aboutBoresight.rotate": stk("Rotate", "G"),
  // View From/To
  "option.viewMode.fromPositionToPosition": ours("From Position to Position"),
  "option.referenceFrame.fixed": ours("Fixed"),
  "option.referenceFrame.inertial": ours("Inertial"),
  // 2D Graphics Window Properties (STK ref §E)
  "option.projection.equidistantCylindrical": stk("Equidistant Cylindrical", "E"),
  "option.projection.mercator": stk("Mercator", "E"),
  "option.coordFrame.ecf": stk("ECF", "E"),
  "option.coordFrame.eci": stk("ECI", "E"),
  // New Scenario Wizard, Search Satellite Catalog
  "option.template.thbkAll": ours("THBK + All Satellites (4 Systems)"),
  "option.template.empty": ours("Empty"),
  "option.system.all": ours("All Systems"),
  "option.system.gps": ours("GPS"),
  "option.system.glonass": ours("GLONASS"),
  "option.system.galileo": ours("Galileo"),
  "option.system.beidou": ours("BeiDou"),
  // ธงของดาว (ชื่อที่แสดง; คำอธิบายไทยอยู่ใน messages.th.ts เป็น flag.*)
  "option.flag.stale": ours("Stale"),
  "option.flag.tooOld": ours("Too Old"),
  "option.flag.noBroadcast": ours("No Broadcast"),
  "option.flag.unhealthy": ours("Unhealthy"),
  "option.flag.prnChanged": ours("PRN Changed"),
  "option.flag.nameMismatch": ours("Name Mismatch"),

  // ---------- Object Browser (spec §7, STK ref §B) ----------
  "ob.properties": stk("Properties", "B"),
  "ob.graphicsColorSelectors": stk("Graphics Color Selectors", "B"),
  "ob.graphicsOnOffToggles": stk("Graphics On/Off Toggles", "B"),
  "ob.newGroup": stk("New Group", "B"),
  "ob.cut": stk("Cut", "B"),
  "ob.copy": stk("Copy", "B"),
  "ob.paste": stk("Paste", "B"),
  "ob.delete": stk("Delete", "B"),
  "ob.find": stk("Find", "B"),
  "ob.expandAll": ours("Expand All"),
  "ob.collapseAll": ours("Collapse All"),
  "ob.class.scenario": stk("Scenario", "B"),
  "ob.class.facility": stk("Facility", "C"),
  "ob.class.satellite": stk("Satellite", "B"),
  "ob.class.sensor": stk("Sensor", "G"),
  "ob.class.constellation": stk("Constellation", "B"),
  "ob.class.group": ours("Group"),
  "ob.show": ours("Show"),
  // ต่อท้ายชื่อ provider / style ที่ spec ติด "(เพิ่มเอง)" (ข้อมูลจาก engine มี ours: true) เช่น IPP Data (GNSS Studio)
  "ob.oursMark": ours(" (GNSS Studio)"),
  "ob.findWhat": ours("Find what"),
  "ob.findNext": ours("Find Next"),
  "ob.findPrevious": ours("Find Previous"),

  // ---------- หน้าต่าง Sensor View (ours: STK ไม่มีคำสั่งนี้) ----------
  // ตัวเลือก Up ของหน้าต่าง Sensor View: North / Velocity
  "sensorView.up": ours("Up"),
  "sensorView.up.north": ours("North"),
  "sensorView.up.velocity": ours("Velocity"),
  // Display: Camera (เห็นแต่โลก) / Sensor (แบบหน้าต่าง 3D) และกลุ่มปุ่มซูม (imagery spec §5.3) ปุ่มใช้ toolbar.zoomIn / toolbar.zoomOut
  "sensorView.display": ours("Display"),
  "sensorView.display.camera": ours("Camera"),
  "sensorView.display.sensor": ours("Sensor"),
  "sensorView.zoom": ours("Zoom"),
  // ช่องความกว้างพื้นที่ที่จุดใต้ดาวข้างปุ่มซูม ("500 m", "1.5 km") Enter = ซูมให้ได้ความกว้างนั้น
  "sensorView.width": ours("Width"),

  // ---------- Timeline View (spec §10, STK ref §D) ----------
  "timeline.globalTimeBar": stk("Global Time Bar", "D"),
  "timeline.globalTimeScale": stk("Global Time Scale", "D"),
  "timeline.timeDisplay": stk("Time Display", "D"),
  "timeline.viewPort": stk("View Port", "D"),
  "timeline.setAnimationTimeToHere": stk("Set Animation Time to Here", "D"),
  "timeline.setAnimationTimeToIntervalStart": ours("Set Animation Time to Interval Start Time"),
  "timeline.setAnimationTimeToIntervalStop": ours("Set Animation Time to Interval Stop Time"),
  "timeline.center": ours("Center"),
  "timeline.removeFromTimeline": ours("Remove from Timeline"),

  // ---------- หน้าต่างรายงาน (spec §6.1, STK ref §F) ----------
  // §F: "Report windows ... Refresh (F5)", "right-click Show Animation Time Line, Set Animation Time", "Global Statistics (Total Duration)"
  "report.refresh": stk("Refresh", "F"),
  "report.setAnimationTime": stk("Set Animation Time", "F"),
  "report.globalStatistics": stk("Global Statistics", "F"),
  // ไม่พบปุ่ม Setup... และกล่อง Export Setup บน help.agi.com (spec §3.5 ใช้ชื่อเหล่านี้เอง) จึงเป็น ours
  // help.agi.com: "right-click in the body of the report. Select Export > To Excel or CSV Format" (ผลตรวจคำ 2026-11-15) ไฟล์ที่ได้เป็น CSV
  "report.export": stkHelp("Export"),
  "report.toExcelOrCsvFormat": stkHelp("To Excel or CSV Format"),
  "report.setup": ours("Setup..."),
  "report.exportSetup": ours("Export Setup"),
  "report.fieldDelimiter": ours("Field Delimiter"),
  "report.encloseHeaderFields": ours("Enclose Header Fields in Quotes"),
  "report.writeReportTitle": ours("Write Report Title"),
  "report.headers": ours("Headers"),
  // ค่าในตาราง: ส่วนที่ไม่มีแถว และค่าที่ไม่มี (เหมือนไฟล์ .txt ของ engine)
  "report.noData": ours("No Data"),
  "report.notAvailable": ours("N/A"),

  // ---------- หน้าต่างกราฟ (spec §6.2, STK ref §F) ----------
  // §F: "Toggle Animation Timeline button; right-click Show Animation Time Line, Set Animation Time" (Refresh และ Set Animation Time ใช้ report.*)
  "graph.toggleAnimationTimeline": stk("Toggle Animation Timeline", "F"),
  "graph.showAnimationTimeLine": stk("Show Animation Time Line", "F"),
  // ปุ่มแถบเครื่องมือของกราฟ: ยืนยันบน help.agi.com (WorkingWithGraphs.htm, ผลตรวจคำ 2026-11-15)
  "graph.save": stkHelp("Save"),
  "graph.copyToClipboard": stkHelp("Copy to Clipboard"),
  "graph.zoomOut": stkHelp("Zoom Out"),
  "graph.crosshairCursor": stkHelp("Crosshair Cursor"),
  // help.agi.com: "display the Export Dialog by choosing the Export option from a graph's pop-up menu" เมนูชื่อ Export
  "graph.export": stkHelp("Export"),

  // ---------- Access tool (spec §4, STK ref §F) ----------
  // ชื่อหน้าต่างใช้ toolbar.access; ช่อง Show ของกราฟิกใช้ ob.show, Color ใช้ field.color, Start/Stop ใช้ field.analysisStart/Stop
  // ปุ่ม Report & Graph Manager... ใช้ menu.analysis.reportGraphManager (คำสั่งเดียวกัน)
  "access.accessFor": stk("Access For", "F"),
  "access.selectObject": stk("Select Object...", "F"),
  "access.associatedObjects": stk("Associated Objects", "F"),
  "access.compute": stk("Compute", "F"),
  "access.clear": stk("Clear", "F"),
  "access.clearAll": stk("Clear All", "F"),
  "access.remove": stk("Remove", "F"),
  "access.removeAll": stk("Remove All", "F"),
  "access.useObjectTimePeriod": stk("Use Object Time Period", "F"),
  "access.specifyTimePeriod": stk("Specify Time Period", "F"),
  // §F: "Reports: Access..., AER...; Graphs: Access..., AER..." (ชื่อกลุ่มและ Access... อยู่ติด ":" จึงอ้างข้อความใน test)
  "access.reports": stk("Reports", "F"),
  "access.graphs": stk("Graphs", "F"),
  "access.accessDots": stk("Access...", "F"),
  "access.aerDots": stk("AER...", "F"),
  "access.addTimeline": stk("Add Timeline", "F"),
  "access.autoAddToTimeline": stk("Auto Add to Timeline", "F"),
  "access.staticHighlight": stk("Static Highlight", "F"),
  "access.animateHighlight": stk("Animate Highlight", "F"),
  "access.showAnimateLine": stk("Show Animate Line", "F"),
  "access.useObjectColors": stk("Use Object Colors", "F"),
  "access.useCustomColor": stk("Use Custom Color", "F"),
  // reference ไม่มีชื่อกลุ่มและตัวเลือกเหล่านี้ (spec §4 ใช้คำเหล่านี้เอง) จึงเป็น ours
  "access.timePeriod": ours("Time Period"),
  "access.animationGraphics": ours("Animation Graphics"),
  "access.inheritSettings": ours("Inherit Settings from Scenario"),
  "access.selectAll": ours("Select All"),

  // ---------- Report & Graph Manager (spec §5, STK ref §F, help.agi.com) ----------
  // ชื่อชนิด object ใน Object Type: Facility / Satellite ใช้ ob.class.*, Access ยืนยันในรายการ Object Types ของ help.agi.com
  // คำที่ help.agi.com ไม่พบ (All Types, Constellation ในรายการ Object Type, คลิกขวา Generate as .txt/.csv, Copy to My Styles, Delete)
  // เป็นฟีเจอร์ตาม spec แต่เป็น ours
  "rgm.objectType": stk("Object Type", "F"),
  "rgm.allTypes": ours("All Types"),
  "rgm.typeAccess": stkHelp("Access"),
  "rgm.constellation": ours("Constellation"),
  "rgm.objects": ours("Objects"),
  "rgm.styles": ours("Styles"),
  "rgm.installedStyles": stk("Installed Styles", "F"),
  "rgm.myStyles": stk("My Styles", "F"),
  "rgm.scenarioStyles": stk("Scenario Styles", "F"),
  "rgm.showReports": stk("Show Reports", "F"),
  "rgm.showGraphs": stk("Show Graphs", "F"),
  "rgm.generateAs": stk("Generate As", "F"),
  "rgm.reportGraph": stk("Report/Graph", "F"),
  "rgm.dynamicDisplay": stk("Dynamic Display/Strip Chart", "F"),
  "rgm.generate": stk("Generate...", "F"),
  "rgm.new": stkHelp("New..."),
  "rgm.properties": stkHelp("Properties..."),
  "rgm.close": stkHelp("Close"),
  "rgm.propertiesItem": stkHelp("Properties"),
  "rgm.generateTxt": ours("Generate as .txt file..."),
  "rgm.generateCsv": ours("Generate as .csv file..."),
  "rgm.copyToMyStyles": ours("Copy to My Styles"),
  "rgm.delete": ours("Delete"),
  // ป้ายชนิดของ style ในต้นไม้ (Installed มี Access / AER ทั้งรายงานและกราฟชื่อเดียวกัน) และตัวเลือกชนิดของ style ใหม่
  "rgm.kindReport": ours("Report"),
  "rgm.kindGraph": ours("Graph"),
  "rgm.styleType": ours("Style Type"),
  // กล่องเวลาก่อน Generate (Use Object Time Period ใช้ access.useObjectTimePeriod, Start/Stop ใช้ field.analysisStart/Stop)
  "rgm.timeProperties": stkHelp("Time Properties"),
  "rgm.specifyTimeProperties": stkHelp("Specify Time Properties"),
  "rgm.step": ours("Step"),
  "rgm.useDefaultTimePoints": stkHelp("Use default time points"),
  "rgm.useStepSize": stkHelp("Use step size"),
  "rgm.seconds": ours("sec"),
  // หน้าต่างแก้ style: แท็บ Content / Time / Summary / Graph, Data Providers → Report Contents / Graph Contents
  "rgm.content": stkHelp("Content"),
  "rgm.time": stkHelp("Time"),
  "rgm.summary": stkHelp("Summary"),
  "rgm.graph": stkHelp("Graph"),
  "rgm.dataProviders": stkHelp("Data Providers"),
  "rgm.reportContents": stkHelp("Report Contents"),
  "rgm.graphContents": stkHelp("Graph Contents"),
  "rgm.add": ours("Add"),
  // help.agi.com ยืนยัน "Remove" ของ Report/Graph Contents เท่านั้น (Add / Up / Down ไม่พบ)
  "rgm.remove": stkHelp("Remove"),
  "rgm.up": ours("Up"),
  "rgm.down": ours("Down"),
  "rgm.saveTo": ours("Save To"),
  // Summary: help.agi.com ไม่พบ checkbox ชื่อเหล่านี้ในหน้าต่าง Style Properties จึงเป็น ours
  "rgm.statMin": ours("Min"),
  "rgm.statMax": ours("Max"),
  "rgm.statMean": ours("Mean"),
  "rgm.statTotal": ours("Total"),
  "rgm.statStdDeviation": ours("Std Deviation"),
  "rgm.summaryOnly": ours("Summary Only"),
  "rgm.numberOfAccesses": ours("Number of Accesses"),
  "rgm.statElement": ours("Element"),
  // Graph: ชนิดกราฟและแกนยืนยันบน help.agi.com แต่ไม่พบชื่อช่อง "Type"
  "rgm.graphType": ours("Type"),
  "rgm.timeXY": stkHelp("Time XY"),
  "rgm.interval": stkHelp("Interval"),
  "rgm.polar": stkHelp("Polar"),
  "rgm.yAxis1": stkHelp("Y Axis (Y1)"),
  "rgm.yAxis2": stkHelp("Y2 Axis (Y2)"),
  "rgm.axisNone": ours("Not Plotted"),
  "rgm.stack": ours("Stack by System"),

  // ---------- หน้า Validation (spec §7, เพิ่มเอง: ไม่มีใน STK ทุกคำเป็น ours) ----------
  "validation.dailyTable": ours("Daily Results"),
  "validation.satTable": ours("Satellite Results"),
  "validation.satellitesOf": ours("Satellites: {scenario} {day}"),
  "validation.trendTitleEl": ours("P99 |ΔEl| by Day (deg)"),
  "validation.trendTitleAz": ours("P99 |ΔAz| by Day (deg)"),
  "validation.ageTitle": ours("3D Error vs Orbit Data Age"),
  "validation.ageX": ours("Age (days)"),
  "validation.ageY": ours("3D Median (km)"),
  "validation.metric.el": ours("ΔEl"),
  "validation.metric.az": ours("ΔAz"),
  "validation.col.day": ours("Day"),
  "validation.col.scenario": ours("Scenario"),
  "validation.col.truth": ours("Truth"),
  "validation.col.systemStats": ours("{system} {metric} med/P99"),
  "validation.col.failing": ours("Failing"),
  "validation.col.result": ours("Result"),
  "validation.col.prn": ours("PRN"),
  "validation.col.pairs": ours("Pairs"),
  "validation.col.elStats": ours("ΔEl med/P99"),
  "validation.col.azStats": ours("ΔAz med/P99"),
  "validation.col.d3": ours("3D med/max (km)"),
  "validation.col.age": ours("Age"),
  "validation.result.pass": ours("Pass"),
  "validation.result.fail": ours("Fail"),
  "validation.result.pending": ours("Pending"),
  "validation.result.gaveUp": ours("Gave up"),
  "validation.result.insufficientData": ours("Insufficient Data"),
  "validation.result.unverified": ours("Unverified"),
  "validation.filter.system": ours("System"),
  "validation.filter.result": ours("Result"),
  "validation.filter.all": ours("All"),

  // ---------- Message Viewer (spec §11, STK ref §A) ----------
  "mv.tab.all": stk("All Messages", "A"),
  "mv.tab.errors": stk("Errors", "A"),
  "mv.tab.infos": stk("Infos", "A"),
  "mv.tab.warnings": stk("Warnings", "A"),
  "mv.col.time": ours("Time"),
  "mv.col.level": ours("Level"),
  "mv.col.code": ours("Code"),
  "mv.col.object": ours("Object"),
  "mv.col.message": ours("Message"),
  "mv.level.info": ours("Info"),
  "mv.level.warning": ours("Warning"),
  "mv.level.error": ours("Error"),
  "mv.details": stk("Details", "A"),
  "mv.clearTab": stk("Clear this Tab", "A"),
  "mv.clearAll": stk("Clear all Tabs", "A"),

  // ---------- แถบสถานะ (spec §12, STK ref §A) ----------
  "status.activeObject": stk("Active Object", "A"),
  "status.latLon": stk("Lat/Lon", "A"),
  "status.animationTime": stk("Animation Time", "A"),
  "status.timeStep": stk("Time Step", "A"),
  "status.stop": stk("Stop", "A"),
  "status.usableSatellites": ours("Usable Satellites"),
  "status.pdop": stk("PDOP", "F"),
  "status.maxDataAge": ours("Max Data Age"),
  "status.flaggedSatellites": ours("Flagged Satellites"),
  "status.dailyForecast": ours("Daily Forecast"),
  // ชื่อของช่องงานที่กำลังรันตามชนิดงาน (งาน daily ใช้ status.dailyForecast)
  "status.job.fetch": ours("Fetch Orbit Data"),
  "status.job.propagate": ours("Propagate"),
  "status.job.analyze": ours("Analyze"),
  "status.job.validate": ours("Validation"),
  "status.disconnected": ours("Server Disconnected"),
} satisfies Record<string, Label>;

export type LabelKey = keyof typeof LABELS;
export const labels: Record<LabelKey, Label> = LABELS;

/** แทน {name} ด้วยค่าใน params; ช่องที่ไม่มีค่าปล่อยไว้ตามเดิมเพื่อให้เห็นว่าลืมส่ง (ใช้ร่วมกับ msg ใน messages.th.ts) */
export function fillPlaceholders(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

export function t(key: LabelKey, params?: Record<string, string | number>): string {
  return fillPlaceholders(labels[key].text, params);
}

/** รายการที่เพิ่มเอง (ใช้แสดงป้าย "Added by GNSS Studio" และตารางใน Help → STK UI Reference) */
export function oursLabels(): { key: LabelKey; text: string }[] {
  return (Object.keys(labels) as LabelKey[]).filter((key) => labels[key].source === "ours").map((key) => ({ key, text: labels[key].text }));
}

// ---------- ค่าที่เก็บ → คำที่แสดง ----------
// ตารางผูกกับ ENUMS ที่สร้างจาก OpenAPI: ถ้า server เพิ่มหรือลบค่า typecheck จะแจ้งที่นี่
// ชื่อกลุ่มตัวเลือก (field ของ optionLabel) = snake_case ของ property ที่เก็บค่านั้นใน schema (ดู tools/enum-sources.mjs):
//   update_mode = Animation.update_mode, cycle = Animation.cycle, date_format = Units.date_format,
//   lead_type / trail_type / visible_sides = PassSettings.*, marker_style / line_style = Graphics2DSat.*, orbit_system = Graphics3DSat.orbit_system
//   ข้อยกเว้นคือ property ชื่อกำกวมเมื่อแยกจาก model จึงเติมคำนำหน้า: swath_options = SwathSettings.options,
//   sensor_type = SensorDefinition.type, pointing_type = SensorPointing.type (orientation / about_boresight = SensorPointing.* ตามชื่อ property)
type Code<K extends keyof typeof ENUMS> = (typeof ENUMS)[K][number];

const PASS_KEYS = {
  Time: "option.pass.time", Percent: "option.pass.percent", Quarter: "option.pass.quarter", Half: "option.pass.half", Full: "option.pass.full",
  All: "option.pass.all", None: "option.pass.none", "One Pass": "option.pass.onePass", "Current Interval": "option.pass.currentInterval",
} as const satisfies Record<Code<"LeadType">, LabelKey>;

const OPTION_KEYS = {
  update_mode: {
    time_step: "option.updateMode.timeStep", real_time: "option.updateMode.realTime", x_real_time: "option.updateMode.xRealTime",
  } satisfies Record<Code<"UpdateMode">, LabelKey>,
  cycle: { off: "option.cycle.off", stop: "option.cycle.stop", loop: "option.cycle.loop" } satisfies Record<Code<"Cycle">, LabelKey>,
  date_format: { UTCG: "option.dateFormat.utcg", LTZG: "option.dateFormat.ltzg" } satisfies Record<Code<"DateFormat">, LabelKey>,
  lead_type: PASS_KEYS,
  trail_type: { ...PASS_KEYS, "Same As Lead": "option.pass.sameAsLead" } satisfies Record<Code<"TrailType">, LabelKey>,
  marker_style: {
    Point: "option.markerStyle.point", Plus: "option.markerStyle.plus", Star: "option.markerStyle.star", Square: "option.markerStyle.square",
    Circle: "option.markerStyle.circle", Diamond: "option.markerStyle.diamond", Triangle: "option.markerStyle.triangle", Cross: "option.markerStyle.cross",
  } satisfies Record<Code<"MarkerStyle">, LabelKey>,
  line_style: {
    Solid: "option.lineStyle.solid", Dashed: "option.lineStyle.dashed", Dotted: "option.lineStyle.dotted", "Dot Dashed": "option.lineStyle.dotDashed",
    "Long Dashed": "option.lineStyle.longDashed", "Dash Dot Dot": "option.lineStyle.dashDotDot", "Medium Dashed": "option.lineStyle.mediumDashed",
    "Short Dashed": "option.lineStyle.shortDashed",
  } satisfies Record<Code<"LineStyle">, LabelKey>,
  visible_sides: {
    Both: "option.visibleSides.both", Ascending: "option.visibleSides.ascending", Descending: "option.visibleSides.descending",
  } satisfies Record<Code<"VisibleSides">, LabelKey>,
  swath_options: {
    "No Graphics": "option.swath.noGraphics", "Edge Limits": "option.swath.edgeLimits", "Filled Limits": "option.swath.filledLimits",
  } satisfies Record<Code<"SwathOptions">, LabelKey>,
  orbit_system: {
    "Fixed by Window": "option.orbitSystem.fixedByWindow", "Inertial by Window": "option.orbitSystem.inertialByWindow",
  } satisfies Record<Code<"OrbitSystem">, LabelKey>,
  sensor_type: { "Simple Conic": "option.sensorType.simpleConic" } satisfies Record<Code<"SensorDefinitionType">, LabelKey>,
  pointing_type: { Fixed: "option.pointingType.fixed" } satisfies Record<Code<"SensorPointingType">, LabelKey>,
  orientation: { "Az-El": "option.orientation.azEl" } satisfies Record<Code<"SensorOrientation">, LabelKey>,
  about_boresight: { Rotate: "option.aboutBoresight.rotate" } satisfies Record<Code<"SensorAboutBoresight">, LabelKey>,
};

/** กลุ่มตัวเลือกที่มีคำที่แสดง (ชื่อกลุ่มตามคอมเมนต์เหนือ OPTION_KEYS ไม่ใช่ path ของ API); สามตัวแรก (ค่าที่เก็บเป็นโค้ด) คือที่ต้องแปลง ที่เหลือค่าที่เก็บก็คือคำที่แสดงอยู่แล้ว */
export type OptionField = keyof typeof OPTION_KEYS;

/** คำที่แสดงของค่าที่เก็บ เช่น optionLabel("cycle", "stop") = "Stop at Time"; ค่าที่ไม่รู้จักแสดงตามที่ได้มา */
export function optionLabel(field: OptionField, code: string): string {
  const keys: Record<string, LabelKey> = OPTION_KEYS[field];
  return Object.hasOwn(keys, code) ? labels[keys[code]].text : code;
}
