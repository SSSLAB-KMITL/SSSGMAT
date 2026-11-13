import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { effectiveColor, type SceneObject } from "../../src/cesium/colors";
import { t } from "../../src/labels/labels";
import { useResults } from "../../src/stores/results";
import type { ObjectTree, ScenarioDoc } from "../../src/stores/scenario";
import { msg } from "../../src/labels/messages.th";
import { useClipboard, copyName } from "../../src/windows/ObjectBrowser/clipboard";
import { expandableKeys, findMatches, flattenTree, groupKey, isEditable, isSensor, type Row } from "../../src/windows/ObjectBrowser/tree";
import { resetAll } from "./helpers/chrome";
import { CATALOG, SENSOR_COLOR, entry, loadObjects, loadSensors, makeScenarioDoc, makeTree, satPath, sensorObj, sensorPath } from "./helpers/objects";

beforeEach(() => {
  resetAll();
  useClipboard.setState(useClipboard.getInitialState(), true);
});

const names = (rows: Row[]) => rows.map((r) => r.name);
const tokensOf = (c: string) => ({ gps: c, glonass: c, galileo: c, beidou: c, other: c, facility: c, access: c });
const byName = (rows: Row[], name: string) => rows.find((r) => r.name === name)!;
const everything = (tree = loadObjects().tree) => new Set(expandableKeys(tree));

describe("flattenTree", () => {
  test("lists the root, then Facility, Constellation, folders with their members, then the ungrouped satellites", () => {
    const { tree } = loadObjects();
    const rows = flattenTree(tree, everything(tree));
    expect(names(rows)).toEqual(["S1", "THBK", "GPS", "GPS sats", "G01", "G02", "Mine", "G03", "G04", "G05"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 1, 2, 2, 1, 1, 1, 1]);
    expect(rows.map((r) => r.kind)).toEqual(["object", "object", "object", "group", "object", "object", "group", "object", "object", "object"]);
  });

  test("object rows carry path, class, colour and show; folders carry none of them", () => {
    const { tree } = loadObjects();
    const rows = flattenTree(tree, everything(tree));
    expect(byName(rows, "S1")).toMatchObject({ path: "*", cls: "Scenario" });
    expect(byName(rows, "THBK")).toMatchObject({ path: "*/Facility/THBK", cls: "Facility", color: "#ff79e6", show: true });
    expect(byName(rows, "GPS")).toMatchObject({ path: "*/Constellation/GPS", cls: "Constellation" });
    expect(byName(rows, "G01")).toMatchObject({ path: satPath("G01"), cls: "Satellite", color: "#ffd23f", show: true });
    const folder = byName(rows, "GPS sats");
    expect(folder.kind).toBe("group");
    expect(folder.key).toBe(groupKey("GPS sats"));
    expect(folder.path).toBeUndefined();
    expect(folder.cls).toBeUndefined();
    expect(folder.color).toBeUndefined();
    expect(folder.show).toBeUndefined();
    expect(folder.members).toEqual([satPath("G01"), satPath("G02")]);
  });

  test("a collapsed node hides its children and an empty set shows only the root", () => {
    const { tree } = loadObjects();
    expect(names(flattenTree(tree, new Set()))).toEqual(["S1"]);
    const open = everything(tree);
    open.delete(groupKey("GPS sats"));
    expect(names(flattenTree(tree, open))).toEqual(["S1", "THBK", "GPS", "GPS sats", "Mine", "G03", "G04", "G05"]);
    const folder = byName(flattenTree(tree, open), "GPS sats");
    expect(folder).toMatchObject({ expandable: true, expanded: false });
    expect(byName(flattenTree(tree, open), "Mine").expandable).toBe(false);
  });

  test("every row knows its parent so the keyboard can climb", () => {
    const { tree } = loadObjects();
    const rows = flattenTree(tree, everything(tree));
    expect(byName(rows, "G01").parentKey).toBe(groupKey("GPS sats"));
    expect(byName(rows, "GPS sats").parentKey).toBe("*");
    expect(byName(rows, "S1").parentKey).toBeNull();
  });

  test("hidden and warn follow the flags: no_broadcast hides, stale warns, name_mismatch alone does neither", () => {
    const { tree } = loadObjects();
    const rows = flattenTree(tree, everything(tree));
    expect(byName(rows, "G03")).toMatchObject({ hidden: true, warn: true });
    expect(byName(rows, "G04")).toMatchObject({ hidden: false, warn: true });
    expect(byName(rows, "G05")).toMatchObject({ hidden: false, warn: false });
    expect(byName(rows, "G01")).toMatchObject({ hidden: false, warn: false });
    expect(byName(rows, "THBK")).toMatchObject({ hidden: false, warn: false });
  });

  test("a flagged satellite shown by the scenario filter is not hidden", () => {
    const { tree } = loadObjects({ doc: makeScenarioDoc({ satellite_filter: { show_too_old: false, show_no_broadcast: true } }) });
    expect(byName(flattenTree(tree, everything(tree)), "G03")).toMatchObject({ hidden: false, warn: true });
  });

  test("the satellite tooltip lists PRN, SVN, NORAD, Block, CelesTrak name, the age to one decimal and every flag in Thai", () => {
    loadObjects({ catalog: [entry(1), entry(2), entry(3, ["no_broadcast"]), entry(4, ["stale", "prn_changed"], { age_days: 3.04 }), entry(5)] });
    const tree = makeTree();
    const rows = flattenTree(tree, everything(tree));
    const g04 = byName(rows, "G04").tooltip;
    for (const part of [`${t("field.prn")}: G04`, `${t("field.svn")}: G64`, `${t("field.norad")}: 40104`, `${t("field.block")}: IIF`,
                        `${t("field.celestrakName")}: GPS BIIF-4  (PRN 4)`, `${t("field.dataAge")}: 3.0 d`, msg("flag.stale"), msg("flag.prn_changed")]) {
      expect(g04, part).toContain(part);
    }
    expect(g04).not.toContain(msg("flag.too_old"));
    expect(byName(rows, "G01").tooltip).toContain(`${t("field.dataAge")}: 1.3 d`);
    expect(byName(rows, "G03").tooltip).toContain(msg("flag.no_broadcast"));
  });

  test("a satellite the catalog does not know still has a tooltip with its name and NORAD", () => {
    const { tree } = loadObjects({ catalog: [] });
    const g01 = byName(flattenTree(tree, everything(tree)), "G01");
    expect(g01).toMatchObject({ hidden: false, warn: false });
    expect(g01.tooltip).toContain("G01");
    expect(g01.tooltip).toContain("40101");
  });

  test("Facility, Constellation, folder and the scenario get a simple tooltip", () => {
    const { tree } = loadObjects();
    const rows = flattenTree(tree, everything(tree));
    expect(byName(rows, "THBK").tooltip).toBe(`${t("ob.class.facility")}: THBK`);
    expect(byName(rows, "GPS").tooltip).toBe(`${t("ob.class.constellation")}: GPS`);
    expect(byName(rows, "GPS sats").tooltip).toBe(`${t("ob.class.group")}: GPS sats`);
    expect(byName(rows, "S1").tooltip).toBe(`${t("ob.class.scenario")}: S1`);
  });

  test("a Constellation shows on only when every member satellite shows", () => {
    const tree = makeTree();
    const g02 = (tree.children[2] as { children: { show: boolean }[] }).children[1];
    loadObjects({ tree });
    expect(byName(flattenTree(tree, everything(tree)), "GPS")).toMatchObject({ show: true, members: [satPath("G01"), satPath("G02")] });
    g02.show = false;
    expect(byName(flattenTree(tree, everything(tree)), "GPS").show).toBe(false);
  });

  test("flaggedOnly keeps the root, the flagged satellites and only the folders that still hold one", () => {
    const tree = makeTree({ groups: [{ group: "GPS sats", children: ["G01", "G04"] }, { group: "Mine", children: ["G02"] }], loose: ["G03", "G05"] });
    loadObjects({ tree });
    const rows = flattenTree(tree, everything(tree), { flaggedOnly: true });
    expect(names(rows)).toEqual(["S1", "GPS sats", "G04", "G03"]);
  });

  test("flaggedOnly with nothing flagged leaves just the root", () => {
    const tree = makeTree();
    loadObjects({ tree, catalog: [entry(1), entry(2), entry(3), entry(4), entry(5)] });
    expect(names(flattenTree(tree, everything(tree), { flaggedOnly: true }))).toEqual(["S1"]);
  });

  test("a long list is flattened in one pass", () => {
    const loose = Array.from({ length: 150 }, (_, i) => `S${String(i).padStart(3, "0")}`);
    const tree = makeTree({ groups: [], loose });
    loadObjects({ tree, catalog: [] });
    expect(flattenTree(tree, everything(tree))).toHaveLength(1 + 2 + 150);
  });
});

describe("sensors", () => {
  // G01 is inside a folder (depth 2), G04 is not (depth 1)
  const SENSORS = { G01: ["Sensor1", "Sensor2"], G04: ["Nav1"] };

  test("sensor rows nest under their satellite", () => {
    const { tree } = loadSensors(SENSORS);
    const rows = flattenTree(tree, everything(tree));
    expect(names(rows)).toEqual(["S1", "THBK", "GPS", "GPS sats", "G01", "Sensor1", "Sensor2", "G02", "Mine", "G03", "G04", "Nav1", "G05"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 1, 2, 3, 3, 2, 1, 1, 1, 2, 1]);
    expect(byName(rows, "Sensor1")).toMatchObject({ key: sensorPath("Sensor1"), kind: "object", path: sensorPath("Sensor1"), cls: "Sensor", parentKey: satPath("G01"), show: true });
    expect(byName(rows, "Sensor2").parentKey).toBe(satPath("G01"));
    expect(byName(rows, "Nav1")).toMatchObject({ depth: 2, parentKey: satPath("G04") });
    expect(rows.filter(isSensor).map((r) => r.name)).toEqual(["Sensor1", "Sensor2", "Nav1"]);
    expect(isSensor(byName(rows, "G01"))).toBe(false);
  });

  test("a sensor row is editable like the other objects and has no catalog flags of its own", () => {
    const { tree } = loadSensors(SENSORS);
    const sensor = byName(flattenTree(tree, everything(tree)), "Sensor1");
    expect(isEditable(sensor)).toBe(true);
    expect(sensor).toMatchObject({ hidden: false, warn: false });
    expect(sensor.prn).toBeUndefined();
  });

  test("a satellite that has sensors can be opened and closed; one without cannot", () => {
    const { tree } = loadSensors(SENSORS);
    const rows = flattenTree(tree, everything(tree));
    expect(byName(rows, "G01")).toMatchObject({ expandable: true, expanded: true });
    expect(byName(rows, "G04")).toMatchObject({ expandable: true, expanded: true });
    expect(byName(rows, "Sensor1").expandable).toBe(false);
  });

  test("satellite without sensors is not expandable", () => {
    const { tree } = loadSensors(SENSORS);
    const rows = flattenTree(tree, everything(tree));
    for (const name of ["G02", "G03", "G05"]) expect(byName(rows, name), name).toMatchObject({ expandable: false, expanded: false });
    expect(flattenTree(loadObjects().tree, new Set(["*"])).some((r) => r.expandable && r.cls === "Satellite")).toBe(false);
  });

  test("collapsing a satellite hides its sensors", () => {
    const { tree } = loadSensors(SENSORS);
    const open = everything(tree);
    open.delete(satPath("G01"));
    const rows = flattenTree(tree, open);
    expect(names(rows)).toEqual(["S1", "THBK", "GPS", "GPS sats", "G01", "G02", "Mine", "G03", "G04", "Nav1", "G05"]);
    expect(byName(rows, "G01")).toMatchObject({ expandable: true, expanded: false });
    expect(byName(rows, "Nav1").depth).toBe(2); // G04 is still open
  });

  test("collapsing the folder or the root hides the sensors of its satellites too", () => {
    const { tree } = loadSensors(SENSORS);
    const open = everything(tree);
    open.delete(groupKey("GPS sats"));
    expect(names(flattenTree(tree, open))).not.toContain("Sensor1");
    expect(names(flattenTree(tree, new Set(["*"])))).toEqual(["S1", "THBK", "GPS", "GPS sats", "Mine", "G03", "G04", "G05"]);
    expect(names(flattenTree(tree, new Set()))).toEqual(["S1"]);
  });

  test("expandableKeys lists the satellites that have sensors, in the order they appear", () => {
    const { tree } = loadSensors(SENSORS);
    expect(expandableKeys(tree)).toEqual(["*", groupKey("GPS sats"), satPath("G01"), satPath("G04")]);
    expect(expandableKeys(loadSensors({}).tree)).toEqual(["*", groupKey("GPS sats")]);
  });

  test("a satellite with an empty children list is not expandable", () => {
    const tree = makeTree();
    (tree.children[tree.children.length - 1] as { children?: unknown[] }).children = [];
    loadObjects({ tree });
    expect(expandableKeys(tree)).toEqual(["*", groupKey("GPS sats")]);
    expect(byName(flattenTree(tree, everything(tree)), "G05").expandable).toBe(false);
  });

  test("flaggedOnly keeps the sensors of the flagged satellites it keeps and drops the others", () => {
    const { tree } = loadSensors({ G01: ["Sensor1"], G04: ["Nav1"] });
    expect(names(flattenTree(tree, everything(tree), { flaggedOnly: true }))).toEqual(["S1", "G03", "G04", "Nav1"]);
  });

  test("findMatches finds a sensor by its name", () => {
    const { tree } = loadSensors(SENSORS);
    expect(findMatches(flattenTree(tree, everything(tree)), "NAV").map((r) => r.path)).toEqual([sensorPath("Nav1")]);
  });

  test("the tooltip of a sensor names the class and the sensor", () => {
    const { tree } = loadSensors(SENSORS);
    expect(byName(flattenTree(tree, everything(tree)), "Sensor1").tooltip).toBe(`${t("ob.class.sensor")}: Sensor1`);
  });

  test("the colour box is graphics2d.color of the sensor, #e8c547 when it has none, and never the satellite's colour", () => {
    const doc = makeScenarioDoc({}, SENSORS);
    (doc.objects.find((o) => o.name === "Sensor1") as { graphics2d: { color: string } }).graphics2d.color = "#123456";
    delete (doc.objects.find((o) => o.name === "Nav1") as { graphics2d?: { color?: string } }).graphics2d!.color;
    const tree = makeTree({ sensors: SENSORS });
    for (const n of tree.children) if ("path" in n && n.children !== undefined) for (const s of n.children) s.color = "#cccccc"; // stale colour in the tree
    loadObjects({ tree, doc });
    const rows = flattenTree(tree, everything(tree));
    expect(byName(rows, "Sensor1").color).toBe("#123456");
    expect(byName(rows, "Sensor2").color).toBe(SENSOR_COLOR);
    expect(byName(rows, "Nav1").color).toBe(SENSOR_COLOR);
    expect(byName(rows, "G01").color).not.toBe("#123456");
  });

  test("effectiveColor of a sensor is its own colour too (the 3D and 2D windows draw with it)", () => {
    const doc = makeScenarioDoc({}, { G01: ["Sensor1"] });
    const sensor = doc.objects.find((o) => o.name === "Sensor1") as SceneObject;
    expect(effectiveColor(sensor, doc, { tokens: tokensOf("#fff") })).toBe(SENSOR_COLOR);
    (sensor as unknown as { graphics2d: { color: string } }).graphics2d.color = "#ABCDEF";
    expect(effectiveColor(sensor, doc, { tokens: tokensOf("#fff") })).toBe("#abcdef");
    expect(effectiveColor(sensorObj("X", "G01", { color: "" }) as unknown as SceneObject, doc, { tokens: tokensOf("#fff") })).toBe(SENSOR_COLOR);
  });
});

describe("expandableKeys", () => {
  test("is the root and every folder that has members", () => {
    const { tree } = loadObjects();
    expect(expandableKeys(tree)).toEqual(["*", groupKey("GPS sats")]);
  });
});

describe("findMatches", () => {
  const rows = () => {
    const { tree } = loadObjects();
    return flattenTree(tree, everything(tree));
  };

  test("matches the name, case-insensitively, as a substring", () => {
    expect(findMatches(rows(), "g0").map((r) => r.name)).toEqual(["G01", "G02", "G03", "G04", "G05"]);
    expect(findMatches(rows(), "SATS").map((r) => r.name)).toEqual(["GPS sats"]);
    expect(findMatches(rows(), "thb").map((r) => r.name)).toEqual(["THBK"]);
  });

  test("matches the PRN of a renamed satellite", () => {
    const tree = makeTree({ groups: [], loose: ["Alpha"] });
    const doc = makeScenarioDoc();
    (doc.objects as { class: string; name: string; norad?: number }[]).push({ class: "Satellite", name: "Alpha", norad: 40101 });
    loadObjects({ tree, doc });
    const all = flattenTree(tree, everything(tree));
    expect(findMatches(all, "g01").map((r) => r.name)).toEqual(["Alpha"]);
    expect(findMatches(all, "alp").map((r) => r.name)).toEqual(["Alpha"]);
  });

  test("an empty or blank query matches nothing", () => {
    expect(findMatches(rows(), "")).toEqual([]);
    expect(findMatches(rows(), "  ")).toEqual([]);
  });
});

describe("copyName", () => {
  test("is <name>_1, and the first free number when that is taken (case-insensitive)", () => {
    expect(copyName("G01", ["G01"])).toBe("G01_1");
    expect(copyName("G01", ["G01", "g01_1"])).toBe("G01_2");
    expect(copyName("G01", ["G01", "G01_1", "G01_2", "G01_4"])).toBe("G01_3");
  });

  test("a name taken by another class counts, because names are unique across classes", () => {
    expect(copyName("THBK", new Set(["THBK", "thbk_1"]))).toBe("THBK_2");
  });

  test("never goes past the 32 characters the server accepts", () => {
    const long = "A".repeat(32);
    const copy = copyName(long, [long]);
    expect(copy).toBe(`${"A".repeat(30)}_1`);
    expect(copy).toHaveLength(32);
    expect(copyName(long, [long, copy])).toBe(`${"A".repeat(30)}_2`);
  });
});

describe("clipboard", () => {
  test("holds the mode and the paths, and clears", () => {
    expect(useClipboard.getState().content).toBeNull();
    useClipboard.getState().set("copy", [satPath("G01")]);
    expect(useClipboard.getState().content).toEqual({ mode: "copy", paths: [satPath("G01")] });
    useClipboard.getState().set("cut", [satPath("G02")]);
    expect(useClipboard.getState().content).toEqual({ mode: "cut", paths: [satPath("G02")] });
    useClipboard.getState().clear();
    expect(useClipboard.getState().content).toBeNull();
  });
});

test("the fixture catalog is what these tests assume", () => {
  expect(CATALOG.map((e) => e.prn)).toEqual(["G01", "G02", "G03", "G04", "G05"]);
});

describe("colour box: the colour the 3D, 2D and Timeline windows draw, not the colour stored in the tree", () => {
  const GPS = "#ffd23f";
  const GLONASS = "#ff6b6b";
  const OTHER = "#c8c8c8";
  const FACILITY = "#ff79e6";

  /** S1 plus extra objects; the tree node of each extra satellite carries the server's fallback grey */
  function withObjects(extra: object[], loose: string[] = []): { tree: ObjectTree; doc: ScenarioDoc } {
    const doc = makeScenarioDoc();
    (doc.objects as unknown[]).push(...extra);
    const tree = makeTree({ loose: ["G03", "G04", "G05", ...loose] });
    for (const node of tree.children) if ("path" in node && loose.includes(node.name)) node.color = "#cccccc";
    return loadObjects({ doc, tree });
  }
  const objectNamed = (doc: ScenarioDoc, name: string) => doc.objects.find((o) => o.name === name) as SceneObject;
  const colorOf = (tree: ObjectTree, name: string) => byName(flattenTree(tree, everything(tree)), name).color;

  test("an inheriting copy in no coloured Constellation shows its system colour, as effectiveColor gives it (not the stored #cccccc)", () => {
    const { tree, doc } = withObjects([{ class: "Satellite", name: "G01_1", norad: 40101, graphics2d: { inherit: true, color: "#cccccc" } }], ["G01_1"]);
    useResults.setState({ prnByNorad: new Map([[40101, "G01"]]) });
    const prnByNorad = useResults.getState().prnByNorad;
    expect(colorOf(tree, "G01_1")).toBe(effectiveColor(objectNamed(doc, "G01_1"), doc, { prnByNorad }));
    expect(colorOf(tree, "G01_1")).toBe(GPS);
  });

  test("before there are results, the PRN in the snapshot catalog gives the system", () => {
    const { tree } = withObjects([{ class: "Satellite", name: "G01_1", norad: 40101, graphics2d: { inherit: true, color: "#cccccc" } }], ["G01_1"]);
    expect(colorOf(tree, "G01_1")).toBe(GPS);
  });

  test("the PRN of the results wins over the catalog, as in the windows that draw it", () => {
    const { tree, doc } = withObjects([{ class: "Satellite", name: "X1", norad: 40101 }], ["X1"]);
    useResults.setState({ prnByNorad: new Map([[40101, "R07"]]) });
    expect(colorOf(tree, "X1")).toBe(GLONASS);
    expect(colorOf(tree, "X1")).toBe(effectiveColor(objectNamed(doc, "X1"), doc, { prnByNorad: useResults.getState().prnByNorad }));
  });

  test("a satellite of unknown system shows --color-other", () => {
    const { tree } = withObjects([{ class: "Satellite", name: "X9", norad: 99999 }], ["X9"]);
    expect(colorOf(tree, "X9")).toBe(OTHER);
  });

  test("a member of a Constellation with a colour shows that colour; inherit false shows its own", () => {
    const { tree } = withObjects(
      [
        { class: "Constellation", name: "Mine", color: "#123456", assigned_objects: ["*/Satellite/G01_1"] },
        { class: "Satellite", name: "G01_1", norad: 40101 },
        { class: "Satellite", name: "G01_2", norad: 40101, graphics2d: { inherit: false, color: "#abcdef" } },
      ],
      ["G01_1", "G01_2"],
    );
    expect(colorOf(tree, "G01_1")).toBe("#123456");
    expect(colorOf(tree, "G01_2")).toBe("#abcdef");
  });

  test("a Constellation shows its own colour, or the colour of its system when it has none", () => {
    const { tree } = withObjects([{ class: "Constellation", name: "GLO", system: "R", assigned_objects: [] }]);
    tree.children.splice(2, 0, { path: "*/Constellation/GLO", class: "Constellation", name: "GLO", color: "#cccccc", show: true });
    expect(colorOf(tree, "GLO")).toBe(GLONASS);
    expect(colorOf(tree, "GPS")).toBe(GPS); // system G, no colour of its own
  });

  test("the Object Browser gets the colour without importing Cesium (only the Cesium-free colors.ts)", () => {
    for (const file of ["src/windows/ObjectBrowser/tree.ts", "src/windows/ObjectBrowser/actions.ts", "src/windows/ObjectBrowser/ObjectBrowser.tsx"]) {
      const source = readFileSync(resolve(__dirname, "../..", file), "utf8");
      expect(source, file).not.toMatch(/from\s+["']cesium["']/);
      expect(source, file).not.toMatch(/from\s+["'](\.\.?\/)+(cesium\/)?(graphics|czml|viewer|scene3d|scene2d|passes|overlay2d|swath)["']/);
    }
  });

  test("a Facility that inherits shows the Facility colour it is drawn with, even with a colour stored", () => {
    const doc = makeScenarioDoc();
    const thbk = doc.objects.find((o) => o.name === "THBK") as { graphics2d?: unknown };
    thbk.graphics2d = { inherit: true, color: "#abcdef" };
    const tree = makeTree();
    (tree.children[0] as { color: string }).color = "#abcdef"; // what the server puts in the tree
    loadObjects({ doc, tree });
    expect(colorOf(tree, "THBK")).toBe(FACILITY);
  });
});
