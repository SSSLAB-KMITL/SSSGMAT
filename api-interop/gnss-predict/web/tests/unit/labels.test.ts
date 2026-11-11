import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { ENUMS } from "../../src/api/enums.gen";
import { labels, optionLabel, oursLabels, t } from "../../src/labels/labels";
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

const sections = new Map<string, string>();
// ส่วนของหัวข้อ = บรรทัดหัวข้อ ("## C. Properties Browser") รวมเนื้อหาจนถึงหัวข้อถัดไป
for (const m of ref.matchAll(/^## ([A-F])\. [^\n]*\n[\s\S]*?(?=^## [A-F]\. |(?![\s\S]))/gm)) sections.set(m[1], m[0]);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** พบเป็นคำเต็ม ไม่ใช่เศษกลางคำอื่น (กัน "Save" ที่โผล่ใน GetStart_SaveLoadTable.htm) */
const hasTerm = (haystack: string, text: string) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(text)}(?![A-Za-z0-9])`).test(haystack);

describe("stk labels are real STK terms", () => {
  test("the reference has sections A to F", () => expect([...sections.keys()]).toEqual(["A", "B", "C", "D", "E", "F"]));

  test("each stk label cites a section that contains it as a whole term", () => {
    const bad: string[] = [];
    for (const [k, l] of Object.entries(labels)) {
      if (l.source !== "stk") continue;
      const m = /^STK ref §([A-F])$/.exec(l.ref ?? "");
      if (!m) { bad.push(`${k}: ref ${JSON.stringify(l.ref)}`); continue; }
      if (!hasTerm(sections.get(m[1])!, l.text)) bad.push(`${k}: "${l.text}" not in §${m[1]}`);
    }
    expect(bad).toEqual([]);
  });

  test("ours labels carry no STK reference", () => {
    expect(Object.entries(labels).filter(([, l]) => l.source === "ours" && l.ref !== undefined).map(([k]) => k)).toEqual([]);
  });

  // คำเหล่านี้ไม่มีใน reference ในบทบาทนั้น (บางคำโผล่ในที่อื่น เช่น "Save" ใน "Auto Save" หรือชื่อไฟล์ แต่ reference ไม่ได้เรียกคำสั่งบันทึกว่า Save)
  test("names the reference does not document (placeholders, ellipsis variants, generic words) stay ours", () => {
    for (const text of ["Welcome to GNSS Studio", "3D Graphics {n} - Earth", "Basic - Ionosphere", "Basic - Description", "Fetch Orbit Data...",
                        "Daily Forecast Settings...", "Validation...", "STK UI Reference", "Search Satellite Catalog", "New Scenario Wizard",
                        "Save", "Save As...", "Open...", "Exit", "Full Screen", "Expand All", "Collapse All", "Zoom Out",
                        "Set Animation Time to Interval Start Time", "Set Animation Time to Interval Stop Time"])
      for (const [k, l] of Object.entries(labels)) if (l.text === text) expect([k, l.source]).toEqual([k, "ours"]);
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
