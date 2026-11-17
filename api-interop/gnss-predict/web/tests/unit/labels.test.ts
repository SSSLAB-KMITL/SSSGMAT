import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { ENUMS } from "../../src/api/enums.gen";
import { labels, optionLabel, oursLabels, STK_HELP_REF, t, type LabelKey } from "../../src/labels/labels";
import { MSG_KEYS, msg, type MsgKey } from "../../src/labels/messages.th";

const ref = readFileSync(resolve(__dirname, "../../../docs/2026-11-11-gnss-studio-stk-reference.md"), "utf8");
/** ผลตรวจคำของ help.agi.com (Access, Report & Graph Manager, Style Properties, หน้าต่างรายงาน/กราฟ) หลักฐานของ stkHelp */
const helpTerms = readFileSync(resolve(__dirname, "../../../docs/2026-11-15-stk-terms-access-reports.md"), "utf8");
/** ผลตรวจคำของ help.agi.com ชุดที่สอง (เมนูคลิกขวาของ Scenario/object, ปุ่ม Properties ของ 3D/2D Window Defaults) หลักฐานของ stkHelp ด้วย (QA-02) */
const menuTerms = readFileSync(resolve(__dirname, "../../../docs/2026-11-17-stk-terms-context-menus.md"), "utf8");

// ---- ตรวจกับ STK reference (ข้อ 1-4 ตามบรีฟ) ----

test("every stk label appears verbatim in the STK reference", () => {
  const missing = Object.entries(labels).filter(([, l]) => l.source === "stk" && !(l.ref === STK_HELP_REF ? helpTerms + menuTerms : ref).includes(l.text)).map(([k]) => k);
  expect(missing).toEqual([]);
});

test("STK words of the main chrome are stk labels", () => {
  for (const [k, text] of [["menu.file", "File"], ["menu.analysis", "Analysis"], ["menu.utilities", "Utilities"],
      ["anim.start", "Start"], ["anim.reset", "Reset"], ["anim.increaseStep", "Increase Time Step"],
      ["window.objectBrowser", "Object Browser"], ["window.timelineView", "Timeline View"], ["window.messageViewer", "Message Viewer"],
      ["page.scenario.basicTime", "Basic - Time"], ["page.facility.constraintsActive", "Constraints - Active"],
      ["mv.tab.all", "All Messages"], ["mv.clearTab", "Clear this Tab"], ["timeline.setAnimationTimeToHere", "Set Animation Time to Here"]] as const) {
    expect(t(k)).toBe(text); expect(labels[k].source).toBe("stk");
  }
});

test("our additions are marked ours", () => {
  for (const k of ["menu.utilities.fetchOrbitData", "menu.utilities.dailyForecastSettings", "menu.analysis.validation",
                   "page.scenario.basicIonosphere", "window.welcome", "window.satelliteCatalog", "help.stkReference"] as const)
    expect(labels[k].source).toBe("ours");
  expect(t("window.welcome")).toBe("Welcome to GNSS Studio");
});

test("Thai flag explanations exist for every engine flag", () => {
  for (const f of ["stale", "too_old", "no_broadcast", "unhealthy", "prn_changed", "name_mismatch"]) expect(msg(`flag.${f}` as MsgKey)).toMatch(/[\u0E00-\u0E7F]/);
});

// ---- ตรวจเข้มกว่าบรีฟ: กันการอ้าง STK ลอยๆ ----

type RefSection = { heading: string; sources: string[] };

/**
 * แยก reference ตามหัวข้อ "## X. ชื่อ" แล้วเก็บเฉพาะที่ใช้เป็นหลักฐานได้:
 *  - sources = เซลล์ Item (คอลัมน์ 1) และ "STK term / behavior" (คอลัมน์ 3) ของทุกแถวตาราง
 *    คอลัมน์ Verdict (2), Page (4) และข้อความนอกตารางไม่นับ
 *  - heading = ชื่อหลัง "X. " ใช้ได้เฉพาะชื่อหน้าต่าง/ส่วน (เช่น "Properties Browser") ดู hasTerm
 */
function parseSections(doc: string): Map<string, RefSection> {
  const out = new Map<string, RefSection>();
  let cur: RefSection | undefined;
  for (const line of doc.split("\n")) {
    const h = /^## ([A-H])\. (.+)$/.exec(line);
    if (h) { cur = { heading: h[2].trim(), sources: [] }; out.set(h[1], cur); continue; }
    if (!cur || !line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 4) throw new Error(`table row must have 4 cells: ${line}`);
    if (cells.every((c) => /^-+$/.test(c)) || (cells[0] === "Item" && cells[1] === "Verdict")) continue;
    cur.sources.push(cells[0], cells[2]);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** ตัวคั่นที่ยอมรับรอบคำ: , / ; ( ) = * + และเครื่องหมายคำพูด (เว้นวรรคข้างตัวคั่นได้) ไม่ใช่แค่อักขระใดๆ ที่ไม่ใช่ตัวอักษรหรือตัวเลข */
const DELIMS = `,/;()=*+"'\u201C\u201D`;
/** ต้นหรือท้ายเซลล์ หรือตัวคั่นอยู่ติดคำ (ผ่านช่องว่างได้) ทั้งสองข้าง: "Start" ใน "Interval Start/Stop Time" ไม่ผ่านเพราะซ้ายเป็นคำ "Interval" */
const termRegExp = (text: string) =>
  new RegExp(`(?<=(?:^|[${DELIMS}])\\s*)${escapeRe(text)}(?=\\s*(?:$|[${DELIMS}]))`);

/** หัวข้อ "## X. ชื่อ" นับเฉพาะเมื่อ allowHeading (ป้ายชื่อหน้าต่าง) และตรงทั้งบรรทัด ไม่ใช่เป็นส่วนของข้อความ */
function hasTerm(section: RefSection, text: string, allowHeading = false): boolean {
  if (allowHeading && section.heading === text) return true;
  const re = termRegExp(text);
  return section.sources.some((cell) => re.test(cell));
}

const sections = parseSections(ref);

describe("the reference matcher", () => {
  const demo = parseSections([
    "## A. Demo window", "",
    "| Item | Verdict | STK term / behavior | Page |", "|---|---|---|---|",
    "| Alpha tool | Zulu | Reset, Step Forward, Interval Start/Stop Time, Time Step table, Mode (Open / Close) | pages/Hotel.htm |",
    "| Beta | OK | Kilo = Real Time; \"Quoted Name\", **Pause** | pages/Beta.htm |",
  ].join("\n")).get("A")!;

  test("accepts a term that is a whole Item cell or sits between delimiters", () => {
    for (const x of ["Alpha tool", "Beta", "Reset", "Step Forward", "Open", "Close", "Real Time", "Quoted Name", "Pause"])
      expect(hasTerm(demo, x), x).toBe(true);
  });

  test("rejects a term that appears only in a Verdict or a Page cell", () => {
    for (const x of ["Zulu", "OK", "pages/Hotel.htm", "Hotel.htm", "Hotel", "Beta.htm", "pages/Beta.htm"]) expect(hasTerm(demo, x), x).toBe(false);
  });

  test("rejects a term that is only a substring of a longer term", () => {
    // "Start" อยู่ใน "Interval Start/Stop Time"; "Step"/"Time Step" ใน "Time Step table"; "Real" ใน "Real Time"
    for (const x of ["Start", "Stop", "Step", "Time Step", "Time", "Real", "Tool", "Alph", "Interval", "Mod"]) expect(hasTerm(demo, x), x).toBe(false);
  });

  test("**Start** is accepted, and without it \"Start\" is not found in \"Interval Start/Stop Time\"", () => {
    const withBold = parseSections("## A. D\n| Item | Verdict | STK term / behavior | Page |\n|---|---|---|---|\n| X | OK | Reset, **Start**, Step Forward, Interval Start/Stop Time | p.htm |").get("A")!;
    const withoutBold = parseSections("## A. D\n| Item | Verdict | STK term / behavior | Page |\n|---|---|---|---|\n| X | OK | Reset, Step Forward, Interval Start/Stop Time | p.htm |").get("A")!;
    expect(hasTerm(withBold, "Start")).toBe(true);
    expect(hasTerm(withoutBold, "Start")).toBe(false);
  });

  test("a heading counts only as the whole heading and only when allowed", () => {
    const withHeading = parseSections("## C. Properties Browser\n| Item | Verdict | STK term / behavior | Page |\n|---|---|---|---|\n| X | OK | Apply | p.htm |").get("C")!;
    expect(hasTerm(withHeading, "Properties Browser")).toBe(false);
    expect(hasTerm(withHeading, "Properties Browser", true)).toBe(true);
    expect(hasTerm(withHeading, "Properties", true)).toBe(false);
    expect(hasTerm(withHeading, "Browser", true)).toBe(false);
  });

  test("the real reference parses into sections A to H, every row with 4 cells", () => {
    expect([...sections.keys()]).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    for (const [k, sec] of sections) expect(sec.sources.length, k).toBeGreaterThan(0);
    expect(sections.get("C")!.heading).toBe("Properties Browser");
    expect(sections.get("G")!.heading).toMatch(/^Sensor\b/);
    // แถวของ §G ต้องไม่ถูกนับรวมใน §F เงียบ ๆ
    expect(sections.get("F")!.sources.some((c) => c.includes("Simple Conic"))).toBe(false);
    expect(sections.get("G")!.sources.some((c) => c.includes("Simple Conic"))).toBe(true);
  });
});

/**
 * stk label ที่ตัวคั่นข้างบนยืนยันไม่ได้ เพราะ reference เขียนชื่อนั้นกลางประโยค ("Object Browser on the left"),
 * ต่อท้ายชื่อชนิด object ("Satellite Basic - Orbit"), ตามด้วยรายการค่า ("DateFormat UTCG, LCLG") หรือคั่นด้วย : . → ซึ่งไม่อยู่ในตัวคั่น
 * ทุกรายการอ้างข้อความจาก reference ตรงตัว (ต้องอยู่ในเซลล์ Item หรือ "STK term / behavior" ของหัวข้อที่อ้าง ยาวไม่เกิน 60 ตัวอักษร
 * และมีข้อความของ label อยู่ในนั้น) test ตรวจทั้งหมดนี้ และตรวจว่าแต่ละรายการยังจำเป็น (ถ้าตัวคั่นยืนยันได้เองให้ลบรายการ)
 * ห้ามใส่รายการเพื่อให้คำที่เป็นแค่ส่วนหนึ่งของชื่อที่ยาวกว่า (เช่น "Start" ใน "Interval Start/Stop Time") ผ่าน
 */
const PROSE_EVIDENCE: Partial<Record<LabelKey, string>> = {
  "menu.help": "Window, Help.",
  "menu.view.objectBrowser": "Object Browser on the left",
  "menu.view.timelineView": "Timeline View at the bottom",
  "toolbar.window3dDefaults": "carry 2D Window Defaults / 3D Window Defaults.",
  "toolbar.window2dDefaults": "carry 2D Window Defaults / 3D Window Defaults.",
  "anim.currentTime": "fields Current Scenario Time, Time Step",
  "window.objectBrowser": "Object Browser on the left",
  "window.timelineView": "Timeline View at the bottom",
  "window.insertObjects": "Insert STK Objects opens after a new scenario",
  "dialog.selectColor": "\u2192 Select color;",
  "dialog.welcome.createScenario": ": Create a Scenario / Open a Scenario;",
  "dialog.insert.defineProperties": "\"Select A Method\": Define Properties, Insert Default",
  "dialog.catalog.searchStandardObjectData": "(\u2192 Search Standard Object Data;",
  "dialog.catalog.dataSources": "; Data Sources Online/Local;",
  // หน้า Properties: Item ของ reference เขียน "<ชนิด object> <ชื่อหน้า>" (หน้าของ Facility ใช้ชื่อเดียวกับของ Satellite ตามกติกา "Group - Page" ของ §C)
  "page.scenario.basicTime": "Scenario Basic - Time",
  "page.scenario.graphics2dGlobalAttributes": "Scenario 2D Graphics - Global Attributes",
  "page.facility.graphics2dAttributes": "Satellite 2D Graphics - Attributes",
  "page.satellite.basicOrbit": "Satellite Basic - Orbit",
  "page.satellite.graphics2dAttributes": "Satellite 2D Graphics - Attributes",
  "page.satellite.graphics2dPass": "Satellite 2D Graphics - Pass",
  "page.satellite.graphics2dSwath": "Satellite 2D Graphics - Swath",
  "page.satellite.graphics3dOrbitSystem": "Satellite 3D Graphics - Orbit System",
  "field.analysisPeriod": "holds the Analysis Period and the Animation section",
  "field.animation": "the Animation section: Start Time",
  "field.animationStartTime": "Animation section: Start Time;",
  "field.animationCycle": "Animation Cycle Off / Stop at Time",
  "field.dateFormat": "DateFormat UTCG, LCLG",
  "field.positionType": "(Position Type Geodetic",
  "field.elevationAngle": "(add Elevation Angle from",
  "field.propagator": "Propagator SGP4;",
  "field.availableObjects": "(Available Objects \u2192 Assigned Objects)",
  "field.assignedObjects": "(Available Objects \u2192 Assigned Objects)",
  "option.cycle.off": "Animation Cycle Off / Stop at Time",
  "option.dateFormat.utcg": "DateFormat UTCG, LCLG",
  "option.positionType.geodetic": "Position Type Geodetic",
  "option.propagator.sgp4": "Propagator SGP4;",
  "ob.class.scenario": "Scenario is the root",
  "ob.class.facility": "Facility groups",
  "ob.class.satellite": "Satellite extras:",
  // spec §9.2 แสดง "Ambient Level"; reference เขียน "Sun Lighting Ambient Level" (ยืนยันไม่ได้ด้วยตัวคั่นเพราะเป็นส่วนท้ายของชื่อที่ยาวกว่า) จึงอ้างข้อความตรงตัว
  "field.ambientLevel": "Sun Lighting Ambient Level",
  "mv.tab.all": "Tabs All Messages / Errors",
  "status.stop": "progress bar with Stop",
  // Sensor (STK ref §G): reference เขียนชื่อเหล่านี้กลางประโยคหรือต่อท้ายคำอื่น ตัวคั่นยืนยันเดี่ยวๆ ไม่ได้
  "ob.class.sensor": "Sensor object",
  "field.azimuth": "Az-El fields Azimuth, Elevation",
  "option.aboutBoresight.rotate": "About Boresight (Rotate default)",
  // หน้า 2D Graphics ของ Sensor ใช้ชื่อ "กลุ่ม - หน้า" เดียวกับของ Satellite และ Facility (§C "Page naming"); §G เขียนแค่ "Attributes" ใต้ "2D Graphics pages"
  "page.sensor.attributes2d": "Satellite 2D Graphics - Attributes",
  // กราฟ (STK ref §F แถว Graph time cursor): ชื่อปุ่มและเมนูอยู่กลางประโยค ตามด้วย/นำด้วยคำอื่น
  "graph.toggleAnimationTimeline": "Toggle Animation Timeline button",
  "graph.showAnimationTimeLine": "right-click Show Animation Time Line",
  // Access tool (STK ref §F แถว Access reports/graphs): ชื่อกลุ่มกับปุ่มแรกคั่นด้วย ":" ซึ่งไม่ใช่ตัวคั่น
  "access.reports": "Reports: Access..., AER...; Graphs: Access..., AER...",
  "access.graphs": "Reports: Access..., AER...; Graphs: Access..., AER...",
  "access.accessDots": "Reports: Access..., AER...; Graphs: Access..., AER...",
  // Report & Graph Manager (STK ref §F แถว Report & Graph Manager): ชื่ออยู่ติด ":" หรือ "or" ซึ่งไม่ใช่ตัวคั่น
  "rgm.installedStyles": "Styles: Installed Styles / My Styles / Scenario Styles",
  "rgm.generateAs": "Generate As: Report/Graph or Dynamic Display/Strip Chart",
  "rgm.reportGraph": "Generate As: Report/Graph or Dynamic Display/Strip Chart",
  "rgm.dynamicDisplay": "Generate As: Report/Graph or Dynamic Display/Strip Chart",
};

describe("stk labels are real STK terms", () => {
  test("each stk label cites a section whose Item or STK term cell contains it between delimiters, or quotes the reference (PROSE_EVIDENCE)", () => {
    const bad: string[] = [];
    for (const [k, l] of Object.entries(labels)) {
      if (l.source !== "stk" || l.ref === STK_HELP_REF) continue; // stkHelp ตรวจกับผลตรวจคำของ help.agi.com ข้างล่าง
      const m = /^STK ref §([A-H])$/.exec(l.ref ?? "");
      if (!m) { bad.push(`${k}: ref ${JSON.stringify(l.ref)}`); continue; }
      const sec = sections.get(m[1])!;
      // ชื่อหัวข้อนับได้เฉพาะป้ายชื่อหน้าต่าง (window.*) เช่น "Properties Browser" ที่ reference เขียนไว้ที่หัวข้อ C เท่านั้น
      const strict = hasTerm(sec, l.text, k.startsWith("window."));
      const quote = PROSE_EVIDENCE[k as LabelKey];
      if (strict) { if (quote !== undefined) bad.push(`${k}: PROSE_EVIDENCE not needed, the delimiter rule confirms it`); continue; }
      if (quote === undefined) bad.push(`${k}: "${l.text}" not in §${m[1]}`);
      else if (!sec.sources.some((c) => c.includes(quote))) bad.push(`${k}: quote ${JSON.stringify(quote)} not in an Item/STK term cell of §${m[1]}`);
      else if (!quote.includes(l.text)) bad.push(`${k}: quote ${JSON.stringify(quote)} does not contain "${l.text}"`);
      else if (quote.length > 60) bad.push(`${k}: quote longer than 60 characters`);
    }
    for (const k of Object.keys(PROSE_EVIDENCE)) if (labels[k as LabelKey]?.source !== "stk") bad.push(`${k}: PROSE_EVIDENCE entry for a label that is not stk`);
    expect(bad).toEqual([]);
  });

  test("terms the reference writes only inside a longer phrase are not claimed as stk", () => {
    expect(hasTerm(sections.get("F")!, "Access")).toBe(false);                   // มีแต่ "Access tool buttons", "Access For", ...
    expect(hasTerm(sections.get("B")!, "Group")).toBe(false);                    // มีแต่ "New Group", "Groups"
    expect(hasTerm(sections.get("A")!, "Windows")).toBe(false);                  // มีแต่ "Windows..."
    for (const k of ["toolbar.access", "ob.class.group", "window.windows"] as const) expect(labels[k].source, k).toBe("ours");
  });

  test("Ambient Level is stk only through a quoted snippet of the longer reference term", () => {
    // spec §9.2 แสดง "Ambient Level" แต่ใน reference มีแค่ "Sun Lighting Ambient Level" ตัวคั่นยืนยัน "Ambient Level" เดี่ยวๆ ไม่ได้
    expect(hasTerm(sections.get("E")!, "Ambient Level")).toBe(false);
    expect(hasTerm(sections.get("E")!, "Sun Lighting Ambient Level")).toBe(true);
    expect(PROSE_EVIDENCE["field.ambientLevel"]).toBe("Sun Lighting Ambient Level");
    expect(labels["field.ambientLevel"]).toEqual({ text: "Ambient Level", source: "stk", ref: "STK ref §E" });
  });

  test("ours labels carry no STK reference", () => {
    expect(Object.entries(labels).filter(([, l]) => l.source === "ours" && l.ref !== undefined).map(([k]) => k)).toEqual([]);
  });

  // คำเหล่านี้ไม่มีใน reference ในบทบาทนั้น (บางคำโผล่ในที่อื่น เช่น "Save" ใน "Auto Save" หรือชื่อไฟล์ แต่ reference ไม่ได้เรียกคำสั่งบันทึกว่า Save)
  test("names the reference does not document (placeholders, ellipsis variants, generic words) stay ours", () => {
    for (const text of ["Welcome to GNSS Studio", "3D Graphics {n} - Earth", "Basic - Ionosphere", "Basic - Description", "Fetch Orbit Data...",
                        "Daily Forecast Settings...", "Validation...", "STK UI Reference", "Search Satellite Catalog", "New Scenario Wizard",
                        "Save", "Save As...", "Open...", "Exit", "Full Screen", "Expand All", "Collapse All", "Zoom Out",
                        "Set Animation Time to Interval Start Time", "Set Animation Time to Interval Stop Time",
                        "Access", "Group", "Windows"]) {
      // ป้ายที่ยืนยันบน help.agi.com (stkHelp) ตรวจแยกข้างบน ไม่ใช่การอ้าง reference นี้
      const hits = Object.entries(labels).filter(([, l]) => l.text === text && l.ref !== STK_HELP_REF);
      expect(hits.length, `a label with text "${text}" must exist`).toBeGreaterThan(0);
      for (const [k, l] of hits) expect([k, l.source]).toEqual([k, "ours"]);
    }
  });

  test("matching is case-sensitive: the reference says \"SSC number\", so \"SSC Number\" would not be stk", () => {
    expect(t("field.sscNumber")).toBe("SSC number");
    expect(labels["field.sscNumber"].source).toBe("stk");
    expect(Object.values(labels).some((l) => l.text === "SSC Number")).toBe(false);
  });
});

// ---- คำที่ยืนยันบน help.agi.com (docs/2026-11-15-stk-terms-access-reports.md) ----

/**
 * ข้อความอ้างในเครื่องหมายคำพูดจากคอลัมน์ "ข้อความที่อ้างตรงตัว (quote)" ของทุกแถวตาราง เฉพาะส่วนก่อน **ไม่พบ** ของเซลล์
 * (แถวที่ขึ้นต้นด้วย **ไม่พบ** จึงไม่ให้หลักฐานเลย และ "Type" ในแถว Graph Type ที่อยู่หลัง **ไม่พบ** ไม่นับ)
 */
function helpQuotes(doc: string): string[] {
  const out: string[] = [];
  for (const line of doc.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cell = line.split("|")[2]?.trim() ?? "";
    const found = cell.split("**ไม่พบ**")[0];
    for (const m of found.matchAll(/"([^"]+)"/g)) out.push(m[1]);
  }
  return out;
}
/**
 * คำในเครื่องหมาย `...` ของไฟล์ผลตรวจชุดที่สอง (2026-11-17) เฉพาะในหัวข้อที่ชื่อมี "ยืนยันตรงตัว" (จนถึงหัวข้อถัดไป)
 * หัวข้อ "อนุมาน" ไม่ให้หลักฐาน; ข้อความที่มี "->" (ทางไปในเมนู เช่น View -> Toolbars) ไม่ใช่ชื่อเดียว ไม่นับ
 */
function verifiedTerms(doc: string): string[] {
  const out: string[] = [];
  let verified = false;
  for (const line of doc.split("\n")) {
    if (line.startsWith("#")) {
      verified = line.includes("ยืนยันตรงตัว");
      continue;
    }
    if (!verified) continue;
    for (const m of line.matchAll(/`([^`]+)`/g)) if (!m[1].includes("->")) out.push(m[1]);
  }
  return out;
}
const MENU_QUOTES = verifiedTerms(menuTerms);
const HELP_QUOTES = [...helpQuotes(helpTerms), ...MENU_QUOTES];

/**
 * stkHelp ที่ไม่ตรงกับข้อความอ้างทั้งก้อน: อ้างส่วนหนึ่งของข้อความอ้างตรงตัว (ยาวไม่เกิน 60 ตัวอักษร และมีข้อความของ label อยู่ในนั้น)
 */
const HELP_EVIDENCE: Partial<Record<LabelKey, string>> = {
  "report.export": "Select Export > To Excel or CSV Format",
  "report.toExcelOrCsvFormat": "Select Export > To Excel or CSV Format",
  "graph.export": "choosing the Export option",
  "rgm.propertiesItem": "and select Properties",
  "rgm.typeAccess": "Access, AdvCAT",
  "graph.save": "Save: Allows you to save the graph",
  "graph.copyToClipboard": "Copy to Clipboard: Creates a copy of the graph",
  "graph.zoomOut": "Zoom Out: Zooms out of the graph by one step",
  "graph.crosshairCursor": "Crosshair Cursor: Displays crosshairs across",
  "access.accessFor": "the right of the Access for: field",
};

describe("stk labels verified on help.agi.com", () => {
  test("the quote column parses and skips not-found rows", () => {
    expect(HELP_QUOTES).toContain("New...");
    expect(HELP_QUOTES).toContain("Time XY");
    expect(HELP_QUOTES).not.toContain("Type");                       // อยู่หลัง **ไม่พบ** ในแถว Graph Type
    expect(HELP_QUOTES).not.toContain("Generate as .txt file...");   // แถวไม่พบ
  });

  test("the second help check (2026-11-17) counts only its verified sections", () => {
    for (const term of ["Properties", "Report & Graph Manager...", "Insert...", "Save", "Save As...", "Close Scenario", "Set as Default Scenario", "3D Window Defaults", "2D Window Defaults"]) {
      expect(MENU_QUOTES, term).toContain(term);
    }
    expect(MENU_QUOTES).not.toContain("Duplicate 3D Graphics Window"); // อยู่ในหัวข้อ 2.2 อนุมาน เท่านั้น
    expect(MENU_QUOTES).not.toContain("View -> Toolbars");
  });

  // QA-02: ชื่อใหม่ของเมนู Scenario ยืนยันในผลตรวจชุดที่สองเท่านั้น (reference 11-11 ไม่แตะ)
  test("Insert... and Close Scenario of the Scenario menu are stkHelp, verified in the 2026-11-17 check", () => {
    for (const [k, text] of [["menu.scenario.insert", "Insert..."], ["menu.scenario.closeScenario", "Close Scenario"]] as const) {
      expect(labels[k], k).toEqual({ text, source: "stk", ref: STK_HELP_REF });
      expect(MENU_QUOTES, k).toContain(text);
    }
  });

  test("each stkHelp label equals a quoted help text, or quotes a part of one (HELP_EVIDENCE)", () => {
    const bad: string[] = [];
    for (const [k, l] of Object.entries(labels)) {
      if (l.ref !== STK_HELP_REF) continue;
      if (l.source !== "stk") { bad.push(`${k}: ${STK_HELP_REF} on an ours label`); continue; }
      const whole = HELP_QUOTES.includes(l.text);
      const quote = HELP_EVIDENCE[k as LabelKey];
      // หลักฐานที่ชี้ข้อความอ้างของชุด 2026-11-15 คงไว้ได้ แม้คำเดียวกันจะมีทั้งก้อนในชุด 2026-11-17 (คนละที่ เช่น Save ของเมนู Scenario ไม่ใช่ Save ของกราฟ)
      if (whole && (quote === undefined || !MENU_QUOTES.includes(l.text) || helpQuotes(helpTerms).includes(l.text))) {
        if (quote !== undefined) bad.push(`${k}: HELP_EVIDENCE not needed`);
        continue;
      }
      if (quote === undefined) bad.push(`${k}: "${l.text}" is not a quoted help text`);
      else if (!HELP_QUOTES.some((q) => q.includes(quote))) bad.push(`${k}: ${JSON.stringify(quote)} is not part of a quoted help text`);
      else if (!quote.includes(l.text)) bad.push(`${k}: ${JSON.stringify(quote)} does not contain "${l.text}"`);
      else if (quote.length > 60) bad.push(`${k}: quote longer than 60 characters`);
    }
    for (const k of Object.keys(HELP_EVIDENCE)) if (labels[k as LabelKey]?.ref !== STK_HELP_REF) bad.push(`${k}: HELP_EVIDENCE entry for a label that is not stkHelp`);
    expect(bad).toEqual([]);
  });

  // Ruling (T13): ฟีเจอร์ที่ spec สั่งแต่ help.agi.com ไม่พบ คงไว้ แต่ป้ายเป็น ours
  test("features the help does not show stay, labelled ours", () => {
    for (const [k, text] of [["rgm.allTypes", "All Types"], ["rgm.constellation", "Constellation"], ["rgm.generateTxt", "Generate as .txt file..."], ["rgm.generateCsv", "Generate as .csv file..."],
        ["rgm.copyToMyStyles", "Copy to My Styles"], ["rgm.delete", "Delete"]] as const) {
      expect(labels[k], k).toEqual({ text, source: "ours" });
    }
  });

  test("the report export menu and the graph Export use the verified help words", () => {
    expect(t("report.export")).toBe("Export");
    expect(t("report.toExcelOrCsvFormat")).toBe("To Excel or CSV Format");
    expect(t("graph.export")).toBe("Export");
    expect(Object.values(labels).some((l) => l.text === "To CSV Format..." || l.text === "Export Dialog...")).toBe(false);
  });
});

// ---- Sensor (STK ref §G, ตรวจ 2026-11-13) ----

describe("sensor labels", () => {
  /** ป้าย stk ที่ติด §G: ข้อความต้องอยู่ตรงตัวในเซลล์ Item หรือ "STK term / behavior" ของ §G */
  const G_LABELS: [LabelKey, string][] = [
    ["ob.class.sensor", "Sensor"],
    ["window.selectObject", "Select Object"],
    ["page.sensor.definition", "Basic - Definition"],
    ["page.sensor.pointing", "Basic - Pointing"],
    ["field.sensorType", "Sensor Type"],
    ["field.coneHalfAngle", "Cone Half Angle"],
    ["field.pointingType", "Pointing Type"],
    ["field.orientationMethod", "Orientation Method"],
    ["field.azimuth", "Azimuth"],
    ["field.elevation", "Elevation"],
    ["field.aboutBoresight", "About Boresight"],
    ["field.fill", "Fill"],
    ["field.translucency", "% Translucency"],
    ["field.showRadialLines", "Show Radial Lines"],
    ["field.showBoresightMarker", "Show Boresight Marker"],
    ["option.sensorType.simpleConic", "Simple Conic"],
    ["option.sensorType.rectangular", "Rectangular"],
    ["option.pointingType.fixed", "Fixed"],
    ["option.orientation.azEl", "Az-El"],
    ["option.aboutBoresight.rotate", "Rotate"],
  ];

  test("sensor labels exist verbatim in STK ref §G", () => {
    const g = sections.get("G")!;
    for (const [k, text] of G_LABELS) {
      expect(labels[k], k).toEqual({ text, source: "stk", ref: "STK ref §G" });
      expect(g.sources.some((c) => c.includes(text)), `${k}: "${text}" not in an Item/STK term cell of §G`).toBe(true);
    }
  });

  test("the sensor menu and pages the reference does not spell out in full are tagged like their nearest existing key", () => {
    // "Sensor..." ไม่มีใน reference (มีแค่ Insert menu "New..." กับ "Default Object...") จึงเป็น ours เหมือน menu.insert.satellite
    expect(labels["menu.insert.sensor"]).toEqual({ text: "Sensor...", source: "ours" });
    expect(labels["menu.insert.satellite"].source).toBe("ours");
    // §G เขียนแค่ "Attributes" ใต้ "2D Graphics pages" / "3D Graphics pages": 2D ใช้ชื่อเดียวกับหน้า 2D Graphics - Attributes ของ Satellite (§C)
    expect(labels["page.sensor.attributes2d"]).toEqual({ text: "2D Graphics - Attributes", source: "stk", ref: "STK ref §C" });
    expect(labels["page.sensor.attributes2d"]).toEqual(labels["page.satellite.graphics2dAttributes"]);
    // "3D Graphics - Attributes" ไม่มีตรงตัวใน reference ส่วนไหนเลย (ทดสอบข้อแรกของไฟล์นี้จะจับถ้าเป็น stk)
    expect(ref.includes("3D Graphics - Attributes")).toBe(false);
    expect(labels["page.sensor.attributes3d"]).toEqual({ text: "3D Graphics - Attributes", source: "ours" });
  });

  test("our sensor additions are ours, with the agreed texts and no STK reference", () => {
    for (const [k, text] of [["menu.object.sensorView", "Sensor View"], ["window.sensorView", "Sensor View - {sensor} ({satellite})"],
        ["field.parentObject", "Parent"], ["sensorView.up", "Up"], ["sensorView.up.north", "North"], ["sensorView.up.velocity", "Velocity"]] as const)
      expect(labels[k], k).toEqual({ text, source: "ours" });
    // reference บอกชัดว่าไม่มีคำสั่ง "Sensor View" ใน STK (ใกล้สุดคือ Obscuration...) จึงต้องไม่อ้างเป็น stk
    expect(sections.get("G")!.sources.some((c) => c.includes("No \"Sensor View\""))).toBe(true);
  });

  test("window.sensorView fills the sensor and the satellite like window.propertiesBrowserFor", () => {
    expect(t("window.sensorView", { sensor: "Sensor1", satellite: "G01" })).toBe("Sensor View - Sensor1 (G01)");
    expect(t("window.propertiesBrowserFor", { name: "G01" })).toBe("G01 Properties");
    expect(t("window.sensorView")).toBe("Sensor View - {sensor} ({satellite})");
  });

  test("texts the sensor tasks reuse are not duplicated under new keys", () => {
    for (const text of ["Color", "Show", "Basic - Description"]) {
      const sensorKeys = Object.entries(labels).filter(([k, l]) => l.text === text && /sensor/i.test(k)).map(([k]) => k);
      expect(sensorKeys, text).toEqual([]);
    }
  });
});

// ---- Globe Manager (STK ref §H, ตรวจ 2026-11-14) ----

describe("Globe Manager labels", () => {
  test("the window and the View menu entry are the STK term, found in an Item or STK term cell of §H", () => {
    const h = sections.get("H")!;
    for (const k of ["menu.view.globeManager", "window.globeManager"] as const) {
      expect(labels[k], k).toEqual({ text: "Globe Manager", source: "stk", ref: "STK ref §H" });
      expect(hasTerm(h, "Globe Manager", k.startsWith("window.")), k).toBe(true);
    }
    expect(sections.get("H")!.heading).toMatch(/^Globe Manager\b/);
  });

  test("the group switches, the ion asset and the token field are ours (STK has none), and the token field reuses the Daily window's label", () => {
    for (const k of ["field.onlineImageryEox", "field.onlineImageryOsm", "field.onlineImageryIon", "field.ionAsset", "field.ionAssetId", "option.ionAsset.none"] as const) {
      expect(labels[k].source, k).toBe("ours");
    }
    expect(labels["field.onlineImageryEox"].text).toBe("Online imagery (Sentinel-2 cloudless)");
    expect(labels["field.onlineImageryOsm"].text).toBe("Online imagery (OpenStreetMap)");
    expect(labels["field.onlineImageryIon"].text).toBe("Online imagery (Cesium ion)");
    expect(labels["field.cesiumToken"].text).toBe("Cesium Ion Token");
    expect(Object.entries(labels).filter(([, l]) => l.text === "Cesium Ion Token").map(([k]) => k)).toEqual(["field.cesiumToken"]);
  });

  test("names the STK help does not use for these controls stay ours (STK shows an unlabeled check box and the word Translucency)", () => {
    for (const k of ["field.onlineImagery", "field.globeLayer", "option.globe.naturalEarthII"] as const) expect(labels[k].source, k).toBe("ours");
    expect(labels["field.onlineImagery"].text).toBe("Online imagery (NASA GIBS)");
    expect(labels["option.globe.naturalEarthII"].text).toBe("Natural Earth II");
    // "Show" และ "% Translucency" ใช้คีย์ที่มีอยู่แล้ว ไม่สร้างคีย์ซ้ำ
    expect(Object.entries(labels).filter(([, l]) => l.text === "Show").map(([k]) => k)).toEqual(["ob.show"]);
    expect(Object.entries(labels).filter(([, l]) => l.text === "% Translucency").map(([k]) => k)).toEqual(["field.translucency"]);
  });

  test("§H records its sources (STK help pages) and claims no menu item the help does not show", () => {
    const section = ref.slice(ref.indexOf("## H. Globe Manager"));
    expect(section).toContain("https://help.agi.com/stk/Content/");
    expect(section).toContain("globeMgr/gmOverview.html");
    expect(section).toMatch(/View menu/);
  });
});

// ---- ครบทุกชื่อใน spec §4-§13 ----

const textsUnder = (...prefixes: string[]) =>
  new Set(Object.entries(labels).filter(([k]) => prefixes.some((p) => k.startsWith(p))).map(([, l]) => l.text));

const COVERAGE: [area: string, prefixes: string[], texts: string[]][] = [
  ["§5.1 top menus", ["menu."], ["File", "Edit", "View", "Insert", "Analysis", "Utilities", "Window", "Help"]],
  ["§5.1 File", ["menu.file."], ["New...", "Open...", "Save", "Save As...", "Close", "Exit"]],
  ["§5.1 Edit", ["menu.edit."], ["Cut", "Copy", "Paste", "Delete", "Find..."]],
  ["§5.1 View", ["menu.view."], ["Object Browser", "Timeline View", "Message Viewer", "New 3D Graphics Window", "New 2D Graphics Window", "Globe Manager", "Toolbars", "Full Screen"]],
  ["§5.1 Insert", ["menu.insert."], ["New...", "Facility...", "Satellite...", "Constellation..."]],
  ["§5.1 Analysis", ["menu.analysis."], ["Access...", "Report & Graph Manager...", "Validation..."]],
  ["§5.1 object menu", ["menu.object."], ["Properties", "Access...", "Report & Graph Manager...", "Zoom To", "Rename", "Delete"]],
  ["§5.1 Utilities", ["menu.utilities."], ["Fetch Orbit Data...", "Daily Forecast Settings..."]],
  ["§5.1 Window", ["menu.window."], ["Windows...", "Cascade", "Tile Horizontally", "Tile Vertically"]],
  ["§5.1 Help", ["help."], ["Welcome...", "STK UI Reference", "About GNSS Studio"]],
  ["§5.1 shortcuts", ["menu.shortcut."], ["Ctrl+S", "Delete", "Ctrl+F"]],
  ["§5.2 toolbar names", ["toolbar."], ["Default", "Animation", "3D Graphics", "3D Window Defaults", "2D Window Defaults"]],
  ["§5.2 toolbar buttons", ["toolbar."], ["New", "Open", "Save", "Insert Object", "Properties", "Access", "Report & Graph Manager",
                                         "Home View", "View From/To", "Grab Globe", "Zoom In", "Zoom Out"]],
  ["§5.2/§6.1 animation toolbar", ["anim."], ["Reset", "Step Backward", "Reverse", "Pause", "Start", "Step Forward", "Decrease Time Step", "Increase Time Step",
                                             "Normal Animation Mode", "Real-Time Animation Mode", "X Real-Time Animation Mode",
                                             "Current Scenario Time", "Time Step", "X Real Time Multiplier"]],
  ["§4.1/§11 window titles", ["window."], ["Object Browser", "3D Graphics {n} - Earth", "2D Graphics {n} - Earth", "Timeline View", "Message Viewer",
                                           "Properties Browser", "Insert STK Objects", "Search Satellite Catalog", "New Scenario Wizard",
                                           "Welcome to GNSS Studio", "View From/To", "3D Graphics Window Properties", "2D Graphics Window Properties",
                                           "Windows", "Fetch Orbit Data", "Daily Forecast Settings", "Globe Manager", "Dockable", "Floating", "Integrated"]],
  ["§4.1 Windows dialog", ["dialog.windows."], ["Window", "Type", "Activate", "Integrate", "Center", "Close"]],
  ["§8 Properties buttons", ["dialog."], ["OK", "Cancel", "Apply", "Help", "Reload"]],
  ["§8 pages", ["page."], ["Basic - Time", "Basic - Units", "Basic - Description", "Basic - Ionosphere", "2D Graphics - Global Attributes",
                           "Basic - Position", "Constraints - Active", "2D Graphics - Attributes",
                           "Basic - Orbit", "2D Graphics - Pass", "2D Graphics - Swath", "3D Graphics - Orbit System", "Basic - Definition"]],
  ["§8 Scenario fields", ["field."], ["Analysis Period", "Start", "Stop", "Duration", "Animation", "Start Time", "Time Update Mode", "Animation Cycle",
                                       "DateFormat", "Short Description", "Long Description", "Shell Height (km)", "Show Labels"]],
  ["§8 Facility fields", ["field.", "option."], ["Position Type", "Geodetic", "Latitude", "Longitude", "Altitude", "Select Constraints to Add", "Elevation Angle",
                                                  "Min", "Max", "Color", "Marker Style", "Inherit from Scenario"]],
  ["§8 Satellite fields", ["field.", "option."], ["Propagator", "SGP4", "TLE Source", "SSC number", "Epoch", "Data Age", "PRN", "SVN", "NORAD", "Block",
                                                   "CelesTrak Name", "Flags", "Line Style", "Line Width", "Lead Type", "Trail Type", "Visible Sides",
                                                   "Show Pass Labels", "Show Path Labels", "Swath Type", "Ground Elevation", "Fixed by Window", "Inertial by Window"]],
  ["§8 Constellation fields", ["field."], ["Available Objects", "Assigned Objects", "Selection Filter"]],
  ["§8/§6.1 option words", ["option."], ["Time Step", "Real Time", "X Real-Time", "Off", "Stop at Time", "Loop at Time", "UTCG", "LTZG",
                                          "Time", "Percent", "Quarter", "Half", "Full", "All", "None", "One Pass", "Current Interval", "Same As Lead",
                                          "No Graphics", "Edge Limits", "Filled Limits", "Kilometers", "Degrees"]],
  ["§9 window properties", ["field.", "option.", "page."], ["Enable Lighting", "Ambient Level", "Sun Level", "Night Lights Level", "Lat/Lon Lines", "Label Declutter",
                                                             "Show Time", "Lighting", "Details", "Annotation", "Projection", "Display Coordinate Frame",
                                                             "Equidistant Cylindrical", "Mercator", "ECF", "ECI", "Show Outline", "Shading", "Show IPP"]],
  ["§9.2 View From/To", ["field.", "option."], ["Mode", "From Position to Position", "From Position", "To Position", "Reference Frame", "Fixed", "Inertial"]],
  ["§7 Object Browser", ["ob."], ["Properties", "Graphics Color Selectors", "Graphics On/Off Toggles", "New Group", "Cut", "Copy", "Paste", "Delete", "Find",
                                  "Expand All", "Collapse All", "Scenario", "Facility", "Satellite", "Constellation", "Group"]],
  ["§10 Timeline", ["timeline."], ["Global Time Bar", "Global Time Scale", "Time Display", "View Port", "Set Animation Time to Here",
                                    "Set Animation Time to Interval Start Time", "Set Animation Time to Interval Stop Time", "Center", "Remove from Timeline"]],
  ["§11 Welcome / Insert / Catalog", ["dialog."], ["Create a Scenario", "Open a Scenario", "Select An Object To Be Inserted", "Select A Method", "Define Properties",
                                                    "Insert Default", "From Satellite Catalog", "Search Standard Object Data", "Data Sources", "Local snapshot",
                                                    "Online CelesTrak", "Create Constellation from Selected", "Fetch Now", "Run Now", "Select color"]],
  ["§11 Catalog / New Scenario / Fetch / Daily fields", ["field.", "option."], ["Name", "Location", "Template", "System", "Status", "Orbit Data",
                                                                                  "Latest Snapshot", "Groups", "Next Fetch Available", "Last Run", "CSV for TEC",
                                                                                  "GPS", "GLONASS", "Galileo", "BeiDou"]],
  ["§4 Access tool", ["access.", "ob.", "field.", "toolbar.", "menu.analysis."], ["Access", "Access For", "Select Object...", "Associated Objects",
                                                                              "Compute", "Clear", "Clear All", "Remove", "Remove All", "Time Period",
                                                                              "Use Object Time Period", "Specify Time Period", "Start", "Stop", "Reports",
                                                                              "Graphs", "Access...", "AER...", "Report & Graph Manager...", "Add Timeline",
                                                                              "Auto Add to Timeline", "Animation Graphics", "Show", "Static Highlight",
                                                                              "Animate Highlight", "Show Animate Line", "Use Object Colors", "Use Custom Color",
                                                                              "Color", "Inherit Settings from Scenario", "Select All"]],
  ["§5 Report & Graph Manager", ["rgm.", "ob.", "access.", "field.", "window.", "dialog."], ["Report & Graph Manager", "Object Type", "All Types", "Access",
                                                                     "Facility", "Satellite", "Constellation", "Installed Styles", "My Styles",
                                                                     "Scenario Styles", "Show Reports", "Show Graphs", "Generate As", "Report/Graph",
                                                                     "Dynamic Display/Strip Chart", "Generate...", "New...", "Properties...", "Close",
                                                                     "Generate as .txt file...", "Generate as .csv file...", "Properties",
                                                                     "Copy to My Styles", "Delete", "Use Object Time Period", "Specify Time Properties",
                                                                     "Start", "Stop", "Step", "Use default time points", "Use step size"]],
  ["§5.1 style editor", ["rgm.", "field.", "dialog."], ["Content", "Time", "Summary", "Graph", "Data Providers", "Report Contents", "Graph Contents",
                                                         "Add", "Remove", "Up", "Down", "Min", "Max", "Mean", "Total", "Std Deviation", "Summary Only",
                                                         "Type", "Time XY", "Interval", "Polar", "Y Axis (Y1)", "Y2 Axis (Y2)", "My Styles", "Scenario Styles", "OK"]],
  ["§6.1 report window", ["report."], ["Refresh", "Export", "To Excel or CSV Format", "Setup...", "Set Animation Time", "Global Statistics",
                                       "Field Delimiter", "Enclose Header Fields in Quotes", "Write Report Title", "Headers"]],
  ["§6.2 graph window", ["graph.", "report."], ["Save", "Copy to Clipboard", "Zoom Out", "Refresh", "Toggle Animation Timeline", "Crosshair Cursor",
                                              "Show Animation Time Line", "Set Animation Time", "Export"]],
  ["§11 Message Viewer", ["mv."], ["All Messages", "Errors", "Infos", "Warnings", "Time", "Level", "Code", "Object", "Message", "Details", "Clear this Tab", "Clear all Tabs"]],
  ["§11 About / Help table", ["help."], ["Engine Version", "GMAT Version", "Text", "Source", "STK ref"]],
  ["§12 status bar", ["status."], ["Active Object", "Lat/Lon", "Animation Time", "Time Step", "Stop", "Usable Satellites", "PDOP", "Max Data Age",
                                    "Flagged Satellites", "Daily Forecast", "Server Disconnected"]],
  ["§7 Validation page", ["validation.", "window."], ["Validation", "Day", "Scenario", "Truth", "PRN", "Pairs", "Age", "Result", "Pass", "Fail", "Pending", "Gave up",
                                                      "ΔEl", "ΔAz", "ΔEl med/P99", "ΔAz med/P99", "3D med/max (km)"]],
];

describe("every name in spec §4-§13 has a key", () => {
  for (const [area, prefixes, texts] of COVERAGE)
    test(area, () => {
      const have = textsUnder(...prefixes);
      expect(texts.filter((x) => !have.has(x))).toEqual([]);
    });
});

// หน้า Validation (spec §7) เพิ่มเอง: ไม่มีใน STK (reference และ help ไม่มี Pending, Gave up, Truth ฯลฯ) ทุกคำเป็น ours ไม่อ้าง reference
test("every label of the Validation page is ours", () => {
  const mine = Object.entries(labels).filter(([k]) => k.startsWith("validation.") || k === "window.validation");
  expect(mine.length).toBeGreaterThan(30);
  expect(mine.filter(([, l]) => l.source !== "ours").map(([k]) => k)).toEqual([]);
  expect(labels["window.validation"]).toEqual({ text: "Validation", source: "ours" });
  expect(labels["validation.result.pending"].text).toBe("Pending");
  expect(labels["validation.result.gaveUp"].text).toBe("Gave up");
});

// ---- รูปทรงของตาราง ----

test("keys use the agreed namespaces", () => {
  const re = /^(menu|anim|toolbar|window|page|field|option|ob|timeline|report|graph|access|rgm|mv|status|dialog|help|sensorView|validation)\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/;
  expect(Object.keys(labels).filter((k) => !re.test(k))).toEqual([]);
});

test("no label is empty and no key is duplicated by case", () => {
  expect(Object.entries(labels).filter(([, l]) => l.text.trim() === "").map(([k]) => k)).toEqual([]);
  const lower = Object.keys(labels).map((k) => k.toLowerCase());
  expect(new Set(lower).size).toBe(lower.length);
});

test("t fills {name} placeholders and leaves unknown ones visible", () => {
  expect(t("window.graphics3d", { n: 2 })).toBe("3D Graphics 2 - Earth");
  expect(t("window.graphics2d", { n: "1" })).toBe("2D Graphics 1 - Earth");
  expect(t("window.graphics3d")).toBe("3D Graphics {n} - Earth");
  expect(t("window.graphics3d", { other: 1 })).toBe("3D Graphics {n} - Earth");
  expect(t("menu.file", { n: 1 })).toBe("File");
});

test("oursLabels lists exactly the ours entries", () => {
  const list = oursLabels();
  expect(list.map((o) => o.key).sort()).toEqual(Object.entries(labels).filter(([, l]) => l.source === "ours").map(([k]) => k).sort());
  for (const o of list) expect(o.text).toBe(labels[o.key].text);
  expect(list.length).toBeGreaterThan(0);
  expect(list.some((o) => o.key === "help.stkReference")).toBe(true);
  expect(list.some((o) => o.key === "menu.file")).toBe(false);
});

// ---- ตัวเลือก: ค่าที่เก็บ กับคำที่แสดง ----

describe("optionLabel", () => {
  test("Time Update Mode shows the STK words for the stored codes", () => {
    expect(optionLabel("update_mode", "time_step")).toBe("Time Step");
    expect(optionLabel("update_mode", "real_time")).toBe("Real Time");
    expect(optionLabel("update_mode", "x_real_time")).toBe("X Real-Time");
  });

  test("Animation Cycle shows the STK words for the stored codes", () => {
    expect(optionLabel("cycle", "off")).toBe("Off");
    expect(optionLabel("cycle", "stop")).toBe("Stop at Time");
    expect(optionLabel("cycle", "loop")).toBe("Loop at Time");
  });

  test("DateFormat shows UTCG and LTZG", () => {
    expect(optionLabel("date_format", "UTCG")).toBe("UTCG");
    expect(optionLabel("date_format", "LTZG")).toBe("LTZG");
  });

  test("these display words are stk labels", () => {
    for (const [field, enumName] of [["update_mode", "UpdateMode"], ["cycle", "Cycle"], ["date_format", "DateFormat"]] as const)
      for (const code of ENUMS[enumName]) {
        const hit = Object.values(labels).find((l) => l.text === optionLabel(field, code) && l.source === "stk");
        expect(hit, `${field}:${code}`).toBeDefined();
      }
  });

  test("every generated enum value maps to a label in option.*, not to its raw code", () => {
    const optionTexts = textsUnder("option.");
    for (const [field, enumName] of [["update_mode", "UpdateMode"], ["cycle", "Cycle"], ["date_format", "DateFormat"],
        ["lead_type", "LeadType"], ["trail_type", "TrailType"], ["marker_style", "MarkerStyle"], ["line_style", "LineStyle"],
        ["visible_sides", "VisibleSides"], ["swath_options", "SwathOptions"], ["orbit_system", "OrbitSystem"],
        ["sensor_type", "SensorDefinitionType"], ["pointing_type", "SensorPointingType"], ["orientation", "SensorOrientation"],
        ["about_boresight", "SensorAboutBoresight"]] as const)
      for (const code of ENUMS[enumName]) expect(optionTexts.has(optionLabel(field, code)), `${field}:${code}`).toBe(true);
  });

  test("the sensor option values are stk labels of §G, shown as the stored value", () => {
    for (const [field, enumName] of [["sensor_type", "SensorDefinitionType"], ["pointing_type", "SensorPointingType"],
        ["orientation", "SensorOrientation"], ["about_boresight", "SensorAboutBoresight"]] as const)
      for (const code of ENUMS[enumName]) {
        expect(optionLabel(field, code), `${field}:${code}`).toBe(code);
        const hit = Object.values(labels).find((l) => l.text === code && l.source === "stk" && l.ref === "STK ref §G");
        expect(hit, `${field}:${code}`).toBeDefined();
      }
  });

  test("an unknown code is shown as it is", () => {
    expect(optionLabel("cycle", "bounce")).toBe("bounce");
    expect(optionLabel("update_mode", "")).toBe("");
  });
});

// ---- ข้อความไทย ----

describe("Thai messages", () => {
  const THAI = /[\u0E00-\u0E7F]/;
  /** ข้อความที่ตกลงไว้ว่าเป็นศัพท์ STK ล้วนๆ ตามด้วยค่า ("Cone Half Angle {angle}°" ในแผ่นข้อมูลของ Sensor View) ไม่มีภาษาไทยโดยตั้งใจ */
  const NO_THAI = new Set<MsgKey>(["sensorView.hudCone"]);

  test("the stale and missing results banners are exactly the agreed text", () => {
    expect(msg("banner.stale")).toBe("ผลลัพธ์ไม่ตรงกับ scenario ปัจจุบัน — กด Apply เพื่อคำนวณใหม่");
    expect(msg("banner.missing")).toBe("ยังไม่มีผลลัพธ์ — กด Apply เพื่อคำนวณ");
  });

  test("the sub-project 4 placeholder tooltip is gone: every command it covered is built", () => {
    expect(MSG_KEYS.filter((k) => k.startsWith("tooltip.") && k !== "tooltip.noScenario")).toEqual([]);
    expect(MSG_KEYS.filter((k) => msg(k).includes("งานย่อยที่ 4"))).toEqual([]);
  });

  test("each engine flag has its own explanation, with the thresholds from the engine", () => {
    const texts = ["stale", "too_old", "no_broadcast", "unhealthy", "prn_changed", "name_mismatch"].map((f) => msg(`flag.${f}` as MsgKey));
    expect(new Set(texts).size).toBe(6);
    expect(msg("flag.stale")).toMatch(/2 วัน/); expect(msg("flag.stale")).toMatch(/7 วัน/);
    expect(msg("flag.too_old")).toMatch(/7 วัน/); expect(msg("flag.too_old")).toMatch(/ซ่อน/);
    expect(msg("flag.no_broadcast")).toMatch(/broadcast/); expect(msg("flag.no_broadcast")).toMatch(/ซ่อน/);
    expect(msg("flag.unhealthy")).toMatch(/unhealthy|ไม่ปกติ/);
    expect(msg("flag.prn_changed")).toMatch(/IGS/);
    expect(msg("flag.name_mismatch")).toMatch(/CelesTrak/); expect(msg("flag.name_mismatch")).toMatch(/IGS/);
  });

  test("flag texts that exclude a satellite from DOP are exactly the engine's DOP_EXCLUDED_FLAGS", () => {
    const py = readFileSync(resolve(__dirname, "../../../gnss_predict/catalog.py"), "utf8");
    const set = /^DOP_EXCLUDED_FLAGS = frozenset\(\{([^}]*)\}\)/m.exec(py);
    expect(set, "DOP_EXCLUDED_FLAGS not found in gnss_predict/catalog.py").not.toBeNull();
    const excluded = [...set![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(excluded).toEqual(["no_broadcast", "too_old", "unhealthy"]);
    const saying = ["stale", "too_old", "no_broadcast", "unhealthy", "prn_changed", "name_mismatch"].filter((f) => /DOP/.test(msg(`flag.${f}` as MsgKey))).sort();
    expect(saying).toEqual(excluded);
  });

  test("too_old and no_broadcast say the scenario's satellite_filter hides them by default, without promising a UI control", () => {
    for (const f of ["too_old", "no_broadcast"] as const) {
      expect(msg(`flag.${f}`), f).toMatch(/satellite_filter/);
      expect(msg(`flag.${f}`), f).toMatch(/scenario\.json/);
      expect(msg(`flag.${f}`), f).not.toMatch(/เปิดแสดงได้|จากตัวกรอง/);
    }
  });

  test("the messages later tasks need exist and are Thai", () => {
    const keys: MsgKey[] = ["confirm.delete", "confirm.deleteWithSensors", "conflict.title", "conflict.body", "server.disconnected", "server.reconnecting", "server.reconnected",
      "webgl.unsupported", "disk.low", "disk.notWritable", "fetch.confirm", "fetch.nextAvailable", "daily.runNowConfirm", "workbook.tooLarge",
      "about.disclaimer", "note.readOnly", "note.visibleSidesBoth", "time.invalid", "job.failed"];
    for (const k of keys) expect(msg(k, { name: "G01", seconds: 4, free_mb: 120, time: "x", example: "e", message: "m" }), k).toMatch(THAI);
  });

  test("the sensor messages are exactly the agreed text", () => {
    const vars = { satellite: "G01", sensor: "Sensor1", angle: 45, lat: "13.7", lon: "100.5", alt: "20200" };
    const expected: [MsgKey, string][] = [
      ["sensorView.noPosition", "ดาว G01 ยังไม่มีตำแหน่ง ณ เวลานี้ (ยังไม่มีผลการคำนวณวงโคจร หรือเวลาอยู่นอกช่วงวิเคราะห์)"],
      ["sensorView.limit", "เปิด Sensor View พร้อมกันได้ไม่เกิน 4 หน้าต่าง ปิดบานใดบานหนึ่งก่อน"],
      ["sensorView.closedMissing", "ปิด Sensor View ของ Sensor1 เพราะไม่มี sensor นี้ใน scenario แล้ว"],
      ["sensorView.created", "สร้าง Sensor1 บน G01 (Cone Half Angle 45°)"],
      ["insert.noSatellite", "ต้องมีดาวใน scenario ก่อนจึงเพิ่ม Sensor ได้"],
      ["ob.sensorCopyUnsupported", "ยังคัดลอก Sensor ไม่ได้ในรุ่นนี้"],
      ["sensorView.hudSubPoint", "จุดใต้ดาว 13.7, 100.5"],
      ["sensorView.hudAltitude", "ความสูง 20200 km"],
      ["sensorView.hudCone", "Cone Half Angle 45°"],
    ];
    for (const [k, text] of expected) { expect(msg(k, vars), k).toBe(text); if (!NO_THAI.has(k)) expect(msg(k, vars), k).toMatch(THAI); }
    // ไม่ส่งค่า = ช่อง {var} ยังเห็นอยู่
    expect(msg("sensorView.noPosition")).toContain("{satellite}");
    expect(msg("sensorView.created")).toMatch(/\{sensor\}.*\{satellite\}.*\{angle\}/);
  });

  test("every message contains Thai text", () => {
    // เข้าถึงทุกคีย์ผ่าน type: คีย์ที่ลืมใส่ภาษาไทยจะหลุดตรงนี้
    for (const k of MSG_KEYS) if (!NO_THAI.has(k)) expect(msg(k), k).toMatch(THAI);
  });

  test("the Thai exemption list holds only messages that really have no Thai", () => {
    for (const k of NO_THAI) expect(msg(k), k).not.toMatch(THAI);
  });

  test("msg substitutes {var} and leaves unknown ones visible", () => {
    expect(msg("confirm.delete", { name: "G01" })).toContain("G01");
    expect(msg("confirm.delete", { name: "G01" })).not.toContain("{name}");
    expect(msg("disk.low", { free_mb: 120 })).toContain("120");
    expect(msg("server.reconnecting", { seconds: 8 })).toContain("8");
    expect(msg("confirm.delete")).toContain("{name}");
  });

  test("the delete confirmation says it cannot be undone, the 412 dialog names Reload and Cancel", () => {
    expect(msg("confirm.delete", { name: "G01" })).toMatch(/ย้อนกลับ/);
    expect(msg("confirm.deleteWithSensors", { name: "G01", count: 2 })).toMatch(/ย้อนกลับ/);
    expect(msg("confirm.deleteWithSensors", { name: "G01", count: 2 })).toContain("2 ตัว");
    expect(msg("conflict.body")).toMatch(/Reload/); expect(msg("conflict.body")).toMatch(/Cancel/);
  });

  test("the workbook limit is 1 MB and the CelesTrak confirmation names the site", () => {
    expect(msg("workbook.tooLarge")).toMatch(/1 MB/);
    expect(msg("fetch.confirm")).toMatch(/CelesTrak/);
    expect(msg("daily.runNowConfirm")).toMatch(/อินเทอร์เน็ต/);
  });
});

describe("consent texts name every host that a download contacts", () => {
  // the engine's own list (config.py): CelesTrak OMM (https), IGS satellite metadata (https), CDDIS broadcast ephemeris (ftps via curl);
  // fetch_snapshot contacts exactly these, and so do the daily job and the scheduler (validation reads SP3 from CDDIS)
  const config = readFileSync(resolve(__dirname, "../../../gnss_predict/config.py"), "utf8");
  const hostOf = (name: string): string => {
    const m = new RegExp(`^${name} = "[a-z]+://([^/"]+)/`, "m").exec(config);
    expect(m, `${name} not found in gnss_predict/config.py`).not.toBeNull();
    return m![1];
  };
  const HOSTS = [hostOf("CELESTRAK_GP_URL"), hostOf("IGS_META_URL"), hostOf("CDDIS_BRDC_URL")];

  test("the engine's hosts are the three the texts are written for", () => {
    expect(HOSTS).toEqual(["celestrak.org", "files.igs.org", "gdc.cddis.eosdis.nasa.gov"]);
  });

  test.each(["fetch.confirm", "daily.runNowConfirm", "daily.confirmForecast", "daily.warnEnabled", "fetch.noSnapshot", "fetch.queued"] as const)(
    "%s lists CelesTrak, IGS and CDDIS with their hosts",
    (key) => {
      const text = msg(key, { time: "21:00", job: "j-1" });
      for (const host of HOSTS) expect(text, host).toContain(host);
    },
  );

  test("the online imagery confirmation names the GIBS host the server really contacts, what is sent, the cache and its cap", () => {
    const imagery = readFileSync(resolve(__dirname, "../../../server/gnss_studio_server/imagery.py"), "utf8");
    const m = /^GIBS_URL = "https:\/\/([^/"]+)\//m.exec(imagery);
    expect(m, "GIBS_URL not found in server/gnss_studio_server/imagery.py").not.toBeNull();
    expect(m![1]).toBe("gibs.earthdata.nasa.gov");
    const text = msg("globe.consent");
    expect(text).toContain(m![1]);
    expect(text).toMatch(/[\u0E00-\u0E7F]/);
    expect(text).toMatch(/ชื่อชั้นภาพ.*เวลา.*พิกัด/);
    expect(text).toContain("data/imagery");
    expect(text).toContain("2 GB");
    expect(text).toMatch(/ปิดได้ทุกเมื่อ/);
    // บอกตามจริงว่า NASA เห็นอะไรอีก: หมายเลข IP ของเครื่อง และ User-Agent ที่ server ส่งจริง (ไม่ใช่ "มีเพียง ... เท่านั้น")
    const ua = /^USER_AGENT = "([^"]+)"/m.exec(imagery);
    expect(ua, "USER_AGENT not found in server/gnss_studio_server/imagery.py").not.toBeNull();
    expect(text).toContain(`User-Agent ${ua![1]}`);
    expect(text).toMatch(/IP/);
    expect(text).toMatch(/NASA/);
    expect(text).not.toMatch(/เท่านั้น/);
    // ไม่ใช่ข้อความของการดาวน์โหลดข้อมูลวงโคจร: ไม่อ้างแหล่งอื่นที่ไม่ได้ติดต่อ
    for (const host of HOSTS) expect(text, host).not.toContain(host);
  });

  describe("the other online imagery sources (spec ภาพละเอียด §4.3)", () => {
    const imagery = readFileSync(resolve(__dirname, "../../../server/gnss_studio_server/imagery.py"), "utf8");
    const imageryStore = readFileSync(resolve(__dirname, "../../src/stores/imagery.ts"), "utf8");
    const cesiumIon = readFileSync(resolve(__dirname, "../../node_modules/@cesium/engine/Source/Core/Ion.js"), "utf8");
    const hostIn = (source: string, name: string, what: string): string => {
      const m = new RegExp(`^(?:export )?(?:const )?${name} = "https://([^/"]+)/`, "m").exec(source);
      expect(m, `${name} not found in ${what}`).not.toBeNull();
      return m![1];
    };
    const EOX_HOST = hostIn(imagery, "EOX_URL", "server/gnss_studio_server/imagery.py");
    const GIBS_HOST = hostIn(imagery, "GIBS_URL", "server/gnss_studio_server/imagery.py");
    const OSM_HOST = hostIn(imageryStore, "OSM_URL", "src/stores/imagery.ts");
    const ION_HOST = "api.cesium.com";
    const ua = /^USER_AGENT = "([^"]+)"/m.exec(imagery)![1];
    const eox = msg("globe.consentEox");
    const osm = msg("globe.consentOsm");
    const ion = msg("globe.consentIon");
    const THAI = /[\u0E00-\u0E7F]/;

    test("the hosts are the ones the code really contacts", () => {
      expect([EOX_HOST, OSM_HOST]).toEqual(["tiles.maps.eox.at", "tile.openstreetmap.org"]);
      expect(cesiumIon).toContain(`https://${ION_HOST}/`);
    });

    test("Sentinel-2 cloudless: names the EOX host, says it goes through the local server, what is sent, the cache and its cap", () => {
      expect(eox).toMatch(THAI);
      expect(eox).toContain(EOX_HOST);
      expect(eox).toMatch(/(?<!ไม่)ผ่าน server ในเครื่องนี้/);
      expect(eox).toMatch(/ชื่อชั้นภาพ.*พิกัด/);
      expect(eox).toContain(`User-Agent ${ua}`);
      expect(eox).toMatch(/IP/);
      expect(eox).toMatch(/EOX/);
      expect(eox).toContain("data/imagery");
      expect(eox).toContain("2 GB");
      expect(eox).toMatch(/ไม่เชิงพาณิชย์/);
      expect(eox).toMatch(/ปิดได้ทุกเมื่อ/);
      expect(eox).not.toMatch(/เท่านั้น/);
    });

    test("OpenStreetMap: names the OSM host, says the browser connects directly and sends IP, its User-Agent and Referer, tiles are cached by the browser, and the OSM usage rules", () => {
      expect(osm).toMatch(THAI);
      expect(osm).toContain(OSM_HOST);
      expect(osm).toMatch(/browser.*โดยตรง/);
      expect(osm).toMatch(/ไม่ผ่าน server/);
      expect(osm).toMatch(/IP/);
      expect(osm).toMatch(/User-Agent ของ browser/);
      expect(osm).toMatch(/Referer/);
      expect(osm).toMatch(/แคชของ browser/);
      expect(osm).toMatch(/เฉพาะชิ้นภาพที่กำลังแสดง/);
      expect(osm).toMatch(/ออฟไลน์/);
      expect(osm).toMatch(/จำนวนมาก/);
      expect(osm).toContain("© OpenStreetMap contributors");
      expect(osm).toMatch(/ปิดได้ทุกเมื่อ/);
      // ไม่ใช่ข้อความของแหล่งที่ผ่าน server: ไม่อ้างที่เก็บของ server หรือ User-Agent ของ server
      expect(osm).not.toContain("data/imagery");
      expect(osm).not.toContain(ua);
    });

    test("Cesium ion: names api.cesium.com and the hosts it redirects to, says the browser connects directly and sends the token, IP, User-Agent and Referer, other layers hide, non-commercial terms", () => {
      expect(ion).toMatch(THAI);
      expect(ion).toContain(ION_HOST);
      expect(ion).toMatch(/โฮสต์ภาพที่ Cesium ion ส่งต่อ/);
      expect(ion).toMatch(/browser.*โดยตรง/);
      expect(ion).toMatch(/ไม่ผ่าน server/);
      expect(ion).toMatch(/token/);
      expect(ion).toMatch(/ส่ง.*token|token.*ส่ง/);
      expect(ion).toMatch(/IP/);
      expect(ion).toMatch(/User-Agent ของ browser/);
      expect(ion).toMatch(/Referer/);
      expect(ion).toMatch(/Bing/);
      expect(ion).toMatch(/Google/);
      expect(ion).toMatch(/ซ้อน/);
      expect(ion).toMatch(/ซ่อน/);
      expect(ion).toMatch(/Natural Earth II/);
      expect(ion).toMatch(/Community/);
      expect(ion).toMatch(/ไม่เชิงพาณิชย์/);
      expect(ion).toMatch(/ปิดได้ทุกเมื่อ/);
      expect(ion).not.toContain("data/imagery");
      expect(ion).not.toContain(ua);
    });

    test("each of the four confirmations names only its own host", () => {
      const hosts = { gibs: GIBS_HOST, eox: EOX_HOST, osm: OSM_HOST, ion: ION_HOST };
      const texts = { gibs: msg("globe.consent"), eox, osm, ion };
      for (const [source, text] of Object.entries(texts)) {
        expect(text, source).toContain(hosts[source as keyof typeof hosts]);
        for (const [other, host] of Object.entries(hosts)) if (other !== source) expect(text, `${source} must not name ${other}'s host`).not.toContain(host);
      }
      // บอกตรง ๆ ว่าแหล่งไหนผ่าน server ในเครื่อง และแหล่งไหน browser ดึงเอง
      const viaServer = /(?<!ไม่)ผ่าน server ในเครื่องนี้/;   // "ไม่ผ่าน server ในเครื่องนี้" (browser ดึงตรง) ต้องไม่นับ
      expect(texts.gibs).toMatch(viaServer);
      expect(texts.eox).toMatch(viaServer);
      expect(texts.osm).not.toMatch(viaServer);
      expect(texts.ion).not.toMatch(viaServer);
    });

    test("none of the messages contains a token-looking value, and the token text is only ever a description of the field", () => {
      for (const k of MSG_KEYS.filter((key) => key.startsWith("globe."))) expect(msg(k), k).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    });
  });

  test("the Fetch Now confirmation says the other hosts may still be contacted when CelesTrak is rate-limited", () => {
    expect(msg("fetch.confirm")).toMatch(/จำกัดความถี่/);
    expect(msg("fetch.confirm")).toMatch(/ยังอาจ/);
  });

  test("the note about the next CelesTrak time does not suggest that waiting avoids every download", () => {
    const text = msg("fetch.nextAvailable", { time: "x" });
    expect(text).toMatch(/IGS/);
    expect(text).toMatch(/CDDIS/);
  });

  test("the daily warning says a save can start the job as well as a server start", () => {
    const text = msg("daily.warnEnabled", { time: "21:00" });
    expect(text).toMatch(/Apply/);
    expect(text).toMatch(/เริ่ม server/);
    expect(text).toMatch(/ดาวน์โหลดทันที/);
    expect(text).toMatch(/MGEX/);
  });

  test("the Apply confirmation says when the forecast may start and that it downloads", () => {
    const text = msg("daily.confirmForecast", { time: "21:00" });
    expect(text).toMatch(/21:00/);
    expect(text).toMatch(/60 วินาที/);
    expect(text).toMatch(/อินเทอร์เน็ต/);
  });

  test("the validation part names the CDDIS host and MGEX (the validation reads SP3 from CDDIS), and is asked whenever the job is switched on", () => {
    const text = msg("daily.confirmValidation");
    expect(text).toContain(HOSTS[2]);
    expect(text).toMatch(/MGEX/);
    expect(text).toMatch(/60 วินาที/);
    expect(text).toMatch(/อินเทอร์เน็ต/);
    expect(msg("daily.confirmSave")).toMatch(/\?$/);
  });
});
