import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dialogs } from "../../src/chrome/Dialogs";
import type { CatalogEntry } from "../../src/data/catalog";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useMessages } from "../../src/stores/messages";
import { useScenario } from "../../src/stores/scenario";
import { useSelection } from "../../src/stores/selection";
import { SatelliteCatalog, registerSatelliteCatalogPanel } from "../../src/windows/SatelliteCatalog/SatelliteCatalog";
import { resetAll } from "./helpers/chrome";
import { stubFetch, type Handler } from "./helpers/fake-fetch";
import { fakeFlow, type FakeFlow } from "./helpers/files";
import { loadObjects, makeScenarioDoc, makeTree } from "./helpers/objects";

const sat = (prn: string, norad: number, name: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  prn, system: prn[0], svn: `${prn[0]}${norad % 100}`, norad, block: "IIF", celestrak_name: name, omm_epoch: "2026-11-11T00:00:00Z", age_days: 1.26, flags: [], ...over,
});

// the scenario of helpers/objects already holds G01 (40101) and G02 (40102)
const CATALOG: CatalogEntry[] = [
  sat("C01", 44231, "BEIDOU-3 G4"),
  sat("C09", 43581, "BEIDOU-3 M7"),
  sat("E11", 37846, "GALILEO 5 (26)"),
  sat("E14", 40128, "GALILEO 7 (27)"),
  sat("G01", 40101, "GPS BIIF-1  (PRN 01)"),
  sat("G02", 40102, "GPS BIIF-2  (PRN 02)"),
  sat("G22", 40122, "GPS BIIR-2  (PRN 22)", { flags: ["stale", "too_old"], age_days: 3.04 }),
  sat("R05", 36400, "COSMOS 2434 (722)"),
];
const NORAD = Object.fromEntries(CATALOG.map((e) => [e.prn, e.norad]));

const POST_OBJECTS = "POST /api/scenarios/S1/objects";
const CREATED = (...paths: string[]): Handler => ({ status: 201, json: { created: paths, etag: "e2", results_stale: false }, headers: { ETag: '"e2"' } });

let flow: FakeFlow;
let user: ReturnType<typeof userEvent.setup>;

function server(over: Record<string, Handler> = {}) {
  return stubFetch({
    "GET /api/catalog": { json: CATALOG },
    [POST_OBJECTS]: CREATED("*/Satellite/E11", "*/Satellite/E14", "*/Constellation/Mine"),
    "GET /api/scenarios/S1": { json: makeScenarioDoc(), headers: { ETag: '"e2"' } },
    "GET /api/scenarios/S1/objects": { json: makeTree() },
    ...over,
  });
}

const view = (params: Record<string, unknown> = {}) => (
  <>
    <SatelliteCatalog params={params} panelId="satelliteCatalog" />
    <Dialogs />
  </>
);

async function mount() {
  const result = render(view());
  await screen.findByRole("row", { name: /E11/ });
  return result;
}

const rows = () => screen.getAllByRole("row").slice(1); // without the header
const cellsOf = (row: HTMLElement): string[] => Array.from((row as HTMLTableRowElement).cells).map((c) => c.textContent ?? "");
const rowOf = (prn: string): HTMLElement => {
  const hit = rows().find((r) => cellsOf(r)[0] === prn);
  if (hit === undefined) throw new Error(`no row ${prn}; rows: ${rows().map((r) => cellsOf(r)[0]).join(", ")}`);
  return hit;
};
const prns = () => rows().map((r) => cellsOf(r)[0]);
const selected = () => rows().filter((r) => r.getAttribute("aria-selected") === "true").map((r) => cellsOf(r)[0]);
const click = (prn: string, mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) => fireEvent.click(rowOf(prn), mods);
const insertButton = () => screen.getByRole("button", { name: t("dialog.catalog.insert") }) as HTMLButtonElement;
const systemSelect = () => screen.getByLabelText(t("field.system")) as HTMLSelectElement;
const searchBox = () => screen.getByLabelText(t("dialog.catalog.search")) as HTMLInputElement;
const constellationBox = () => screen.getByRole("checkbox", { name: t("dialog.catalog.createConstellation") }) as HTMLInputElement;
const nameBox = () => screen.getByLabelText(t("field.name")) as HTMLInputElement;
const errorOf = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent;
const posts = (f: ReturnType<typeof stubFetch>) => f.calls.filter((c) => c.method === "POST" && c.path === "/api/scenarios/S1/objects");

beforeEach(() => {
  resetAll();
  flow = fakeFlow();
  loadObjects();
  user = userEvent.setup();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the table", () => {
  test("asks the server for the catalog of the scenario's snapshot and period exactly once", async () => {
    const f = server();
    await mount();
    const calls = f.calls.filter((c) => c.path === "/api/catalog");
    expect(calls).toHaveLength(1);
    expect(Object.fromEntries(calls[0].query)).toEqual({ snapshot: "snap", start: "2026-11-12T00:00:00.000Z", stop: "2026-11-13T00:00:00.000Z" });
  });

  test("has the columns PRN, SVN, NORAD, Block, Name, Age and Status, and one row per satellite", async () => {
    server();
    await mount();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      [t("field.prn"), t("field.svn"), t("field.norad"), t("field.block"), t("field.name"), t("field.age"), t("field.status")],
    );
    expect(prns()).toEqual(["C01", "C09", "E11", "E14", "G01", "G02", "G22", "R05"]);
    expect(cellsOf(rowOf("E11"))).toEqual(["E11", "E46", "37846", "IIF", "GALILEO 5 (26)", "1.3 d", ""]);
  });

  test("the Status cell names the flags (with the Thai explanation as its tooltip) and marks satellites already in the scenario", async () => {
    server();
    await mount();
    const status = (prn: string) => (rowOf(prn) as HTMLTableRowElement).cells[6];
    expect(status("G22").textContent).toBe(`${t("option.flag.stale")}, ${t("option.flag.tooOld")}`);
    expect(status("G22").getAttribute("title")).toContain(msg("flag.too_old"));
    expect(status("G01").textContent).toBe(msg("catalog.inScenario"));
    expect(status("E11").textContent).toBe("");
  });

  test("shows a loading note first, and a Thai error with the server's text when the catalog cannot be read", async () => {
    server({ "GET /api/catalog": { status: 422, json: { code: "ORBIT_SOURCE_UNAVAILABLE", text: "ไม่พบ snapshot", field: null, detail: null } } });
    render(view());
    expect(screen.getByText(msg("catalog.loading"))).toBeDefined();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(msg("catalog.windowFailed", { message: "ไม่พบ snapshot" }));
    expect(screen.queryAllByRole("row")).toEqual([]);
  });

  test("an entry whose SVN, block, name or age is null (or flags hold junk) still shows, can be searched, and does not crash the window", async () => {
    const odd = { ...sat("E11", 37846, "x"), svn: null, block: null, celestrak_name: null, age_days: null, flags: ["stale", null, 7] };
    server({ "GET /api/catalog": { json: [odd, sat("E14", 40128, "GALILEO 7 (27)"), { prn: null, system: "E", norad: 1, flags: [] }, { prn: "E99", system: "E", norad: "5", flags: [] }, null] } });
    await mount();
    expect(prns()).toEqual(["E11", "E14"]); // the two that cannot be told apart (no PRN, NORAD not a number) are left out
    expect(cellsOf(rowOf("E11"))).toEqual(["E11", "", "37846", "", "", "—", t("option.flag.stale")]);
    await user.type(searchBox(), "galileo");
    expect(prns()).toEqual(["E14"]);
    await user.clear(searchBox());
    await user.type(searchBox(), "e11");
    expect(prns()).toEqual(["E11"]);
    click("E11");
    expect(selected()).toEqual(["E11"]);
  });

  test("says so when no scenario is open and asks nothing of the server", () => {
    useScenario.getState().close();
    const f = server();
    render(view());
    expect(screen.getByText(msg("tooltip.noScenario"))).toBeDefined();
    expect(f.calls).toEqual([]);
    expect(insertButton().disabled).toBe(true);
  });

  test("asks again only when the snapshot or the period changes, not for another change of the scenario", async () => {
    const f = server();
    const { rerender } = await mount();
    const doc = useScenario.getState().doc!;
    act(() => useScenario.setState({ doc: { ...doc, description: "edited" } as never }));
    rerender(view());
    expect(f.calls.filter((c) => c.path === "/api/catalog")).toHaveLength(1);
    act(() => useScenario.setState({ doc: { ...doc, orbit_snapshot: "newer" } as never }));
    await waitFor(() => expect(f.calls.filter((c) => c.path === "/api/catalog")).toHaveLength(2));
    expect(f.calls.filter((c) => c.path === "/api/catalog")[1].query.get("snapshot")).toBe("newer");
  });
});

describe("selection", () => {
  test("a click selects one row and a click on another moves the selection", async () => {
    server();
    await mount();
    click("E11");
    expect(selected()).toEqual(["E11"]);
    click("E14");
    expect(selected()).toEqual(["E14"]);
  });

  test("Ctrl-click and Cmd-click add and remove single rows", async () => {
    server();
    await mount();
    click("E11");
    click("E14", { ctrlKey: true });
    click("R05", { metaKey: true });
    expect(selected()).toEqual(["E11", "E14", "R05"]);
    click("E14", { ctrlKey: true });
    expect(selected()).toEqual(["E11", "R05"]);
  });

  test("Shift-click selects the range from the last clicked row, in the order shown", async () => {
    server();
    await mount();
    click("C09");
    click("E14", { shiftKey: true });
    expect(selected()).toEqual(["C09", "E11", "E14"]);
    click("C01", { shiftKey: true }); // the anchor stays at C09
    expect(selected()).toEqual(["C01", "C09"]);
  });

  test("Ctrl+Shift-click adds a range to what is already selected", async () => {
    server();
    await mount();
    click("C01");
    click("E11");
    click("E14", { ctrlKey: true });
    click("R05", { ctrlKey: true, shiftKey: true });
    expect(selected()).toEqual(["E11", "E14", "G22", "R05"]); // E14 to R05, G01 and G02 skipped, E11 kept
  });

  test("satellites already in the scenario show 'มีแล้ว', cannot be selected and are skipped by a range", async () => {
    server();
    await mount();
    for (const prn of ["G01", "G02"]) {
      expect(rowOf(prn).getAttribute("aria-disabled")).toBe("true");
      click(prn);
      click(prn, { ctrlKey: true });
    }
    expect(selected()).toEqual([]);
    click("E14");
    click("G22", { shiftKey: true });
    expect(selected()).toEqual(["E14", "G22"]);
  });

  test("the count of selected satellites is shown and Insert is disabled with none", async () => {
    server();
    await mount();
    expect(insertButton().disabled).toBe(true);
    click("E11");
    click("E14", { ctrlKey: true });
    expect(screen.getByText(msg("catalog.selected", { n: 2 }))).toBeDefined();
    expect(insertButton().disabled).toBe(false);
  });

  test("the keyboard: arrows move, Space toggles, Shift+arrow extends, Ctrl+A selects every selectable row shown", async () => {
    server();
    await mount();
    const first = rows()[0];
    first.focus();
    await user.keyboard(" ");
    expect(selected()).toEqual(["C01"]);
    await user.keyboard("{ArrowDown}{ArrowDown} ");
    expect(selected()).toEqual(["C01", "E11"]);
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(selected()).toContain("E14");
    await user.keyboard("{Control>}a{/Control}");
    expect(selected()).toEqual(["C01", "C09", "E11", "E14", "G22", "R05"]);
  });
});

describe("filters", () => {
  test("System E shows only the E rows; All Systems brings the rest back; one request in total", async () => {
    const f = server();
    await mount();
    await user.selectOptions(systemSelect(), "E");
    expect(prns()).toEqual(["E11", "E14"]);
    await user.selectOptions(systemSelect(), "");
    expect(prns()).toHaveLength(8);
    expect(f.calls.filter((c) => c.path === "/api/catalog")).toHaveLength(1);
  });

  test("the System list offers GNSS systems, Imaging and Imported satellites", async () => {
    server();
    await mount();
    expect(Array.from(systemSelect().options).map((o) => [o.value, o.text])).toEqual([
      ["", t("option.system.all")], ["G", t("option.system.gps")], ["R", t("option.system.glonass")], ["E", t("option.system.galileo")], ["C", t("option.system.beidou")],
      ["X", t("option.system.imaging")], ["U", t("option.system.custom")],
    ]);
  });

  test("searching 'beidou-3 g4' finds C01 by its CelesTrak name, whatever the case", async () => {
    server();
    await mount();
    await user.type(searchBox(), "beidou-3 g4");
    expect(prns()).toEqual(["C01"]);
    await user.clear(searchBox());
    await user.type(searchBox(), "GALILEO");
    expect(prns()).toEqual(["E11", "E14"]);
  });

  test("the search also finds a PRN, a NORAD number and an SVN, and combines with System", async () => {
    server();
    await mount();
    await user.type(searchBox(), "g22");
    expect(prns()).toEqual(["G22"]);
    await user.clear(searchBox());
    await user.type(searchBox(), "36400");
    expect(prns()).toEqual(["R05"]);
    await user.clear(searchBox());
    await user.type(searchBox(), "galileo");
    await user.selectOptions(systemSelect(), "C");
    expect(prns()).toEqual([]);
    expect(screen.getByText(msg("catalog.noMatch"))).toBeDefined();
  });

  test("a row that a filter hides is dropped from the selection, so Insert never sends what is not shown", async () => {
    const f = server();
    await mount();
    click("E11");
    click("C01", { ctrlKey: true });
    await user.selectOptions(systemSelect(), "E");
    expect(selected()).toEqual(["E11"]);
    await user.selectOptions(systemSelect(), "");
    expect(selected()).toEqual(["E11"]);
    await user.click(insertButton());
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect((posts(f)[0].body as { norads: number[] }).norads).toEqual([NORAD.E11]);
  });
});

describe("Insert", () => {
  test("E11 and E14 with Create Constellation from Selected 'Mine' go out as one POST with these exact fields", async () => {
    const f = server();
    await mount();
    click("E11");
    click("E14", { ctrlKey: true });
    await user.click(constellationBox());
    await user.type(nameBox(), "Mine");
    await user.click(insertButton());
    await waitFor(() => expect(useSelection.getState().activePath).toBe("*/Satellite/E11"));
    expect(posts(f)).toHaveLength(1);
    expect(posts(f)[0].body).toEqual({ class: "Satellite", method: "From Satellite Catalog", norads: [NORAD.E11, NORAD.E14], create_constellation: "Mine" });
    expect(posts(f)[0].headers.get("If-Match")).toBe('"e1"');
    expect(flow.closePanel).toHaveBeenCalledWith("satelliteCatalog");
  });

  test("without the checkbox there is no create_constellation field, and NORADs follow the table order", async () => {
    const f = server({ [POST_OBJECTS]: CREATED("*/Satellite/E11", "*/Satellite/R05") });
    await mount();
    click("R05");
    click("E11", { ctrlKey: true });
    await user.click(insertButton());
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(posts(f)[0].body).toEqual({ class: "Satellite", method: "From Satellite Catalog", norads: [NORAD.E11, NORAD.R05] });
  });

  test("the name field is off until the checkbox is on, and a ticked box needs a name that follows the object name rule", async () => {
    const f = server();
    await mount();
    expect(nameBox().disabled).toBe(true);
    click("E11");
    await user.click(constellationBox());
    expect(nameBox().disabled).toBe(false);
    await user.click(insertButton());
    expect(errorOf(nameBox())).toBe(msg("ob.nameInvalid"));
    await user.type(nameBox(), "no good");
    await user.click(insertButton());
    expect(errorOf(nameBox())).toBe(msg("ob.nameInvalid"));
    expect(posts(f)).toHaveLength(0);
    await user.clear(nameBox());
    await user.type(nameBox(), "Good_1");
    await user.click(insertButton());
    await waitFor(() => expect(posts(f)).toHaveLength(1));
  });

  test("a name that matches an object in the scenario is refused before sending (names do not differ by case)", async () => {
    const f = server();
    await mount();
    click("E11");
    await user.click(constellationBox());
    await user.type(nameBox(), "gps"); // the scenario holds a Constellation called GPS
    await user.click(insertButton());
    expect(errorOf(nameBox())).toBe(msg("catalog.nameTaken", { name: "GPS" }));
    expect(posts(f)).toHaveLength(0);
  });

  test("a second click while the POST is on its way sends nothing more", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = server({ [POST_OBJECTS]: async () => { await gate; return CREATED("*/Satellite/E11") as never; } });
    await mount();
    click("E11");
    await user.click(insertButton());
    expect(insertButton().disabled).toBe(true);
    await user.click(insertButton());
    release();
    await waitFor(() => expect(flow.closePanel).toHaveBeenCalled());
    expect(posts(f)).toHaveLength(1);
  });

  test("a 409 on create_constellation lands on the name field, the window stays and the Message Viewer is quiet", async () => {
    server({ [POST_OBJECTS]: { status: 409, json: { code: "NAME_EXISTS", text: "มี object ชื่อ Mine อยู่แล้ว", field: "create_constellation", detail: "Mine" } } });
    await mount();
    click("E11");
    await user.click(constellationBox());
    await user.type(nameBox(), "Mine");
    await user.click(insertButton());
    await waitFor(() => expect(errorOf(nameBox())).toBe("มี object ชื่อ Mine อยู่แล้ว"));
    expect(useMessages.getState().items).toEqual([]);
    expect(flow.closePanel).not.toHaveBeenCalled();
    expect(insertButton().disabled).toBe(false);
  });

  test("a 422 on norads (an unknown NORAD) and a 409 on a PRN name show as a message above the buttons, with the selection kept", async () => {
    server({ [POST_OBJECTS]: { status: 422, json: { code: "SCENARIO_INVALID", text: "NORAD 37846 ไม่มีใน catalog", field: "norads", detail: null } } });
    await mount();
    click("E11");
    await user.click(insertButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("NORAD 37846 ไม่มีใน catalog");
    expect(selected()).toEqual(["E11"]);
    expect(useMessages.getState().items).toEqual([]);
    expect(flow.closePanel).not.toHaveBeenCalled();
  });

  test("any other failure goes to the Message Viewer", async () => {
    server({ [POST_OBJECTS]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    await mount();
    click("E11");
    await user.click(insertButton());
    await waitFor(() => expect(useMessages.getState().items.map((m) => m.code)).toEqual(["INTERNAL"]));
    expect(useSelection.getState().activePath).toBeNull();
  });

  test("Cancel closes the window and sends nothing", async () => {
    const f = server();
    await mount();
    click("E11");
    await user.click(screen.getByRole("button", { name: t("dialog.cancel") }));
    expect(flow.closePanel).toHaveBeenCalledWith("satelliteCatalog");
    expect(posts(f)).toHaveLength(0);
  });
});

// ข2 Task 7: ดาวถ่ายภาพ (X) ใน catalog เดียวกัน ตัวกรอง Imaging ชื่อจาก display_name และ Add Primary Sensor (Ruling m)
describe("imaging satellites", () => {
  const TERRA = { ...sat("X04", 25994, "TERRA", { svn: "", block: "EOS AM-1" }), category: "imaging", display_name: "Terra" } as CatalogEntry;
  const AQUA = { ...sat("X05", 27424, "AQUA", { svn: "", block: "EOS PM-1" }), category: "imaging", display_name: "Aqua" } as CatalogEntry;
  const WITH_X = [...CATALOG.map((e) => ({ ...e, category: "gnss", display_name: e.celestrak_name }) as CatalogEntry), TERRA, AQUA];
  const imagingServer = (over: Record<string, Handler> = {}) =>
    server({ "GET /api/catalog": { json: WITH_X }, [POST_OBJECTS]: CREATED("*/Satellite/X04", "*/Sensor/MODIS"), ...over });
  const primaryBox = () => screen.getByRole("checkbox", { name: t("dialog.catalog.addPrimarySensor") }) as HTMLInputElement;

  test("the System select has an option Imaging (value X); choosing it shows only the X rows, X04 named Terra", async () => {
    imagingServer();
    await mount();
    const option = Array.from(systemSelect().options).find((o) => o.value === "X");
    expect(option?.text).toBe(t("option.system.imaging"));
    expect(Array.from(systemSelect().options).map((o) => o.value)).toEqual(["", "G", "R", "E", "C", "X", "U"]);
    await user.selectOptions(systemSelect(), "X");
    expect(prns()).toEqual(["X04", "X05"]);
    expect(cellsOf(rowOf("X04"))[4]).toBe("Terra");
    expect(cellsOf(rowOf("X04"))).toEqual(["X04", "", "25994", "EOS AM-1", "Terra", "1.3 d", ""]);
  });

  // ข2 final I1: snapshot ของ scenario ถูกตั้งตอนสร้าง Fetch ใหม่ไม่เติมดาวถ่ายภาพให้ scenario เดิม: บอกทางแทน "ไม่พบดาว"
  test("Imaging on a snapshot without imaging rows shows a Thai hint naming the snapshot in place of the no-match note", async () => {
    server(); // CATALOG มีแต่ GNSS (snapshot "snap" ก่อน ข2)
    await mount();
    await user.selectOptions(systemSelect(), "X");
    expect(prns()).toEqual([]);
    expect(screen.getByText(msg("catalog.noImaging", { snapshot: "snap" }))).toBeDefined();
    expect(screen.queryByText(msg("catalog.noMatch"))).toBeNull();
    // ระบบอื่นที่ไม่มีแถว: ข้อความเดิม
    await user.selectOptions(systemSelect(), "C");
    await user.type(searchBox(), "zzz");
    expect(screen.getByText(msg("catalog.noMatch"))).toBeDefined();
    expect(screen.queryByText(msg("catalog.noImaging", { snapshot: "snap" }))).toBeNull();
  });

  test("Imaging with imaging rows that a search hides keeps the plain no-match note", async () => {
    imagingServer();
    await mount();
    await user.selectOptions(systemSelect(), "X");
    await user.type(searchBox(), "zzz");
    expect(prns()).toEqual([]);
    expect(screen.getByText(msg("catalog.noMatch"))).toBeDefined();
    expect(screen.queryByText(msg("catalog.noImaging", { snapshot: "snap" }))).toBeNull();
  });

  test("a GNSS row keeps its CelesTrak name, and a row without display_name (an older server) falls back to it", async () => {
    server(); // CATALOG ไม่มี category / display_name
    await mount();
    expect(cellsOf(rowOf("E11"))[4]).toBe("GALILEO 5 (26)");
  });

  test("the search finds an imaging satellite by the name shown", async () => {
    imagingServer();
    await mount();
    await user.type(searchBox(), "terra");
    expect(prns()).toEqual(["X04"]);
  });

  test("Add Primary Sensor is checked by default", async () => {
    imagingServer();
    await mount();
    expect(primaryBox().checked).toBe(true);
  });

  test("Insert of X04 posts primary_sensors: true", async () => {
    const f = imagingServer();
    await mount();
    click("X04");
    await user.click(insertButton());
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(posts(f)[0].body).toEqual({ class: "Satellite", method: "From Satellite Catalog", norads: [25994], primary_sensors: true });
  });

  test("Insert of a GNSS row only posts no primary_sensors key, even with the box ticked", async () => {
    const f = imagingServer({ [POST_OBJECTS]: CREATED("*/Satellite/G22") });
    await mount();
    click("G22");
    expect(primaryBox().checked).toBe(true);
    await user.click(insertButton());
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(posts(f)[0].body).toEqual({ class: "Satellite", method: "From Satellite Catalog", norads: [NORAD.G22] });
  });

  test("unticking Add Primary Sensor gives no primary_sensors key", async () => {
    const f = imagingServer();
    await mount();
    click("X04");
    await user.click(primaryBox());
    expect(primaryBox().checked).toBe(false);
    await user.click(insertButton());
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(posts(f)[0].body).toEqual({ class: "Satellite", method: "From Satellite Catalog", norads: [25994] });
    expect(Object.hasOwn(posts(f)[0].body as object, "primary_sensors")).toBe(false);
  });

  test("a 409 NAME_EXISTS on primary_sensors shows above Insert with a Thai hint to untick Add Primary Sensor; the window stays (M5)", async () => {
    const text = "มี object ชื่อ \"MODIS_X04\" อยู่แล้ว";
    imagingServer({ [POST_OBJECTS]: { status: 409, json: { code: "NAME_EXISTS", text, field: "primary_sensors", detail: "MODIS_X04" } } });
    await mount();
    click("X04");
    await user.click(insertButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(msg("catalog.primaryClash", { message: text }));
    expect(alert.textContent).toContain(t("dialog.catalog.addPrimarySensor"));
    expect(alert.textContent).toContain(text);
    expect(selected()).toEqual(["X04"]);
    expect(flow.closePanel).not.toHaveBeenCalled();
    expect(useMessages.getState().items).toEqual([]);
  });

  test("a mixed GNSS + imaging selection sends primary_sensors: true", async () => {
    const f = imagingServer();
    await mount();
    click("E11");
    click("X05", { ctrlKey: true });
    await user.click(insertButton());
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(posts(f)[0].body).toEqual({ class: "Satellite", method: "From Satellite Catalog", norads: [NORAD.E11, 27424], primary_sensors: true });
  });
});

describe("Data Sources", () => {
  test("Local snapshot is chosen first and Online CelesTrak is the other choice", async () => {
    server();
    await mount();
    expect(screen.getByRole("group", { name: t("dialog.catalog.dataSources") })).toBeDefined();
    expect((screen.getByRole("radio", { name: t("dialog.catalog.sourceLocal") }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: t("dialog.catalog.sourceOnline") }) as HTMLInputElement).checked).toBe(false);
  });

  test("choosing Online CelesTrak opens Fetch Orbit Data, goes back to Local snapshot, and never calls /api/orbits/fetch", async () => {
    const f = server();
    await mount();
    await user.click(screen.getByRole("radio", { name: t("dialog.catalog.sourceOnline") }));
    expect(flow.openPanel).toHaveBeenCalledWith("fetchOrbitData");
    expect((screen.getByRole("radio", { name: t("dialog.catalog.sourceLocal") }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: t("dialog.catalog.sourceOnline") }) as HTMLInputElement).checked).toBe(false);
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/catalog"]);
    expect(f.calls.some((c) => c.path.includes("/orbits/fetch"))).toBe(false);
  });

  test("the table stays as it was after choosing Online CelesTrak", async () => {
    server();
    await mount();
    click("E11");
    await user.click(screen.getByRole("radio", { name: t("dialog.catalog.sourceOnline") }));
    expect(prns()).toHaveLength(8);
    expect(selected()).toEqual(["E11"]);
  });
});

describe("registration", () => {
  test("registerSatelliteCatalogPanel swaps the placeholder for the window and keeps the panel's flags", () => {
    registerSatelliteCatalogPanel();
    const def = getPanelDef("satelliteCatalog")!;
    expect(def.component).toBe(SatelliteCatalog);
    expect([def.persist, def.scenarioBound, def.type, def.singleton]).toEqual([false, true, "floating", true]);
  });
});
