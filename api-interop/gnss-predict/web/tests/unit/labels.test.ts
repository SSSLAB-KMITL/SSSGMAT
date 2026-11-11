import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { ENUMS } from "../../src/api/enums.gen";
import { labels, optionLabel, oursLabels, t, type LabelKey } from "../../src/labels/labels";
import { MSG_KEYS, msg, type MsgKey } from "../../src/labels/messages.th";

const ref = readFileSync(resolve(__dirname, "../../../docs/2026-11-11-gnss-studio-stk-reference.md"), "utf8");

// ---- ตรวจกับ STK reference (ข้อ 1-4 ตามบรีฟ) ----

test("every stk label appears verbatim in the STK reference", () => {
  const missing = Object.entries(labels).filter(([, l]) => l.source === "stk" && !ref.includes(l.text)).map(([k]) => k);
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
    const h = /^## ([A-F])\. (.+)$/.exec(line);
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

  test("the real reference parses into sections A to F, every row with 4 cells", () => {
    expect([...sections.keys()]).toEqual(["A", "B", "C", "D", "E", "F"]);
    for (const [k, sec] of sections) expect(sec.sources.length, k).toBeGreaterThan(0);
    expect(sections.get("C")!.heading).toBe("Properties Browser");
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
};

describe("stk labels are real STK terms", () => {
  test("each stk label cites a section whose Item or STK term cell contains it between delimiters, or quotes the reference (PROSE_EVIDENCE)", () => {
    const bad: string[] = [];
    for (const [k, l] of Object.entries(labels)) {
      if (l.source !== "stk") continue;
      const m = /^STK ref §([A-F])$/.exec(l.ref ?? "");
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
      const hits = Object.entries(labels).filter(([, l]) => l.text === text);
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

// ---- ครบทุกชื่อใน spec §4-§13 ----

const textsUnder = (...prefixes: string[]) =>
  new Set(Object.entries(labels).filter(([k]) => prefixes.some((p) => k.startsWith(p))).map(([, l]) => l.text));

const COVERAGE: [area: string, prefixes: string[], texts: string[]][] = [
  ["§5.1 top menus", ["menu."], ["File", "Edit", "View", "Insert", "Analysis", "Utilities", "Window", "Help"]],
  ["§5.1 File", ["menu.file."], ["New...", "Open...", "Save", "Save As...", "Close", "Exit"]],
  ["§5.1 Edit", ["menu.edit."], ["Cut", "Copy", "Paste", "Delete", "Find..."]],
  ["§5.1 View", ["menu.view."], ["Object Browser", "Timeline View", "Message Viewer", "New 3D Graphics Window", "New 2D Graphics Window", "Toolbars", "Full Screen"]],
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
                                           "Windows", "Fetch Orbit Data", "Daily Forecast Settings", "Dockable", "Floating", "Integrated"]],
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
  ["§11 Message Viewer", ["mv."], ["All Messages", "Errors", "Infos", "Warnings", "Time", "Level", "Code", "Object", "Message", "Details", "Clear this Tab", "Clear all Tabs"]],
  ["§11 About / Help table", ["help."], ["Engine Version", "GMAT Version", "Text", "Source", "STK ref"]],
  ["§12 status bar", ["status."], ["Active Object", "Lat/Lon", "Animation Time", "Time Step", "Stop", "Usable Satellites", "PDOP", "Max Data Age",
                                    "Flagged Satellites", "Daily Forecast", "Server Disconnected"]],
];

describe("every name in spec §4-§13 has a key", () => {
  for (const [area, prefixes, texts] of COVERAGE)
    test(area, () => {
      const have = textsUnder(...prefixes);
      expect(texts.filter((x) => !have.has(x))).toEqual([]);
    });
});

// ---- รูปทรงของตาราง ----

test("keys use the agreed namespaces", () => {
  const re = /^(menu|anim|toolbar|window|page|field|option|ob|timeline|mv|status|dialog|help)\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/;
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
        ["visible_sides", "VisibleSides"], ["swath_options", "SwathOptions"], ["orbit_system", "OrbitSystem"]] as const)
      for (const code of ENUMS[enumName]) expect(optionTexts.has(optionLabel(field, code)), `${field}:${code}`).toBe(true);
  });

  test("an unknown code is shown as it is", () => {
    expect(optionLabel("cycle", "bounce")).toBe("bounce");
    expect(optionLabel("update_mode", "")).toBe("");
  });
});

// ---- ข้อความไทย ----

describe("Thai messages", () => {
  const THAI = /[\u0E00-\u0E7F]/;

  test("the stale and missing results banners are exactly the agreed text", () => {
    expect(msg("banner.stale")).toBe("ผลลัพธ์ไม่ตรงกับ scenario ปัจจุบัน — กด Apply เพื่อคำนวณใหม่");
    expect(msg("banner.missing")).toBe("ยังไม่มีผลลัพธ์ — กด Apply เพื่อคำนวณ");
  });

  test("the subtask 4 tooltip", () => expect(msg("tooltip.subtask4")).toBe("อยู่ในงานย่อยที่ 4"));

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
    const keys: MsgKey[] = ["confirm.delete", "conflict.title", "conflict.body", "server.disconnected", "server.reconnecting", "server.reconnected",
      "webgl.unsupported", "disk.low", "disk.notWritable", "fetch.confirm", "fetch.nextAvailable", "daily.runNowConfirm", "workbook.tooLarge",
      "about.disclaimer", "note.readOnly", "note.visibleSidesBoth", "time.invalid", "job.failed"];
    for (const k of keys) expect(msg(k, { name: "G01", seconds: 4, free_mb: 120, time: "x", example: "e", message: "m" }), k).toMatch(THAI);
  });

  test("every message contains Thai text", () => {
    // เข้าถึงทุกคีย์ผ่าน type: คีย์ที่ลืมใส่ภาษาไทยจะหลุดตรงนี้
    for (const k of MSG_KEYS) expect(msg(k), k).toMatch(THAI);
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
