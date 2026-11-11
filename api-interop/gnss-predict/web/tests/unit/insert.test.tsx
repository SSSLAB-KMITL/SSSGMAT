import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dialogs } from "../../src/chrome/Dialogs";
import { isEnabled, isRegistered, runCommand, commandTooltip } from "../../src/commands";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useMessages } from "../../src/stores/messages";
import { useScenario } from "../../src/stores/scenario";
import { useSelection } from "../../src/stores/selection";
import { InsertObjects, registerInsertObjectsPanel } from "../../src/windows/InsertObjects/InsertObjects";
import { registerDataCommands } from "../../src/windows/dataCommands";
import { resetAll } from "./helpers/chrome";
import { deferred, stubFetch, type Handler } from "./helpers/fake-fetch";
import { fakeFlow, type FakeFlow } from "./helpers/files";
import { loadObjects, makeScenarioDoc, makeTree } from "./helpers/objects";

const POST_OBJECTS = "POST /api/scenarios/S1/objects";
const CREATED = (path: string): Handler => ({ status: 201, json: { created: [path], etag: "e2", results_stale: false }, headers: { ETag: '"e2"' } });

let flow: FakeFlow;
let user: ReturnType<typeof userEvent.setup>;

function server(over: Record<string, Handler> = {}) {
  return stubFetch({
    [POST_OBJECTS]: CREATED("*/Facility/Facility1"),
    "GET /api/scenarios/S1": { json: makeScenarioDoc(), headers: { ETag: '"e2"' } },
    "GET /api/scenarios/S1/objects": { json: makeTree() },
    ...over,
  });
}

function mount(params: Record<string, unknown> = {}) {
  return render(
    <>
      <InsertObjects params={params} panelId="insertObjects" />
      <Dialogs />
    </>,
  );
}

const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;
const insertButton = () => screen.getByRole("button", { name: t("dialog.insert.insert") }) as HTMLButtonElement;
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const okButton = () => screen.getByRole("button", { name: t("dialog.ok") }) as HTMLButtonElement;
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

describe("the choices", () => {
  test("lists Facility, Satellite and Constellation under Select An Object To Be Inserted, Facility chosen first", () => {
    server();
    mount();
    expect(screen.getByRole("group", { name: t("dialog.insert.selectObject") })).toBeDefined();
    const names = screen.getAllByRole("radio").slice(0, 3).map((r) => (r as HTMLInputElement).labels?.[0]?.textContent);
    expect(names).toEqual([t("ob.class.facility"), t("ob.class.satellite"), t("ob.class.constellation")]);
    expect(radio(t("ob.class.facility")).checked).toBe(true);
  });

  test("Facility offers Define Properties and Insert Default, with Define Properties chosen", () => {
    server();
    mount();
    const group = screen.getByRole("group", { name: t("dialog.insert.selectMethod") });
    expect(group).toBeDefined();
    expect(radio(t("dialog.insert.defineProperties")).checked).toBe(true);
    expect(radio(t("dialog.insert.insertDefault"))).toBeDefined();
    expect(screen.queryByRole("radio", { name: t("dialog.insert.fromSatelliteCatalog") })).toBeNull();
  });

  test("Satellite offers From Satellite Catalog and Define Properties; Constellation only Define Properties", async () => {
    server();
    mount();
    await user.click(radio(t("ob.class.satellite")));
    const satMethods = screen.getByRole("group", { name: t("dialog.insert.selectMethod") });
    expect(Array.from(satMethods.querySelectorAll("label")).map((l) => l.textContent)).toEqual([t("dialog.insert.fromSatelliteCatalog"), t("dialog.insert.defineProperties")]);
    expect(radio(t("dialog.insert.fromSatelliteCatalog")).checked).toBe(true);
    await user.click(radio(t("ob.class.constellation")));
    const conMethods = screen.getByRole("group", { name: t("dialog.insert.selectMethod") });
    expect(Array.from(conMethods.querySelectorAll("label")).map((l) => l.textContent)).toEqual([t("dialog.insert.defineProperties")]);
  });

  test("changing the object resets the method to that object's first one", async () => {
    server();
    mount();
    await user.click(radio(t("dialog.insert.insertDefault")));
    await user.click(radio(t("ob.class.satellite")));
    await user.click(radio(t("ob.class.facility")));
    expect(radio(t("dialog.insert.defineProperties")).checked).toBe(true);
  });

  test("params.cls preselects the object, and a later open with new params moves the choice", async () => {
    server();
    const { rerender } = mount({ cls: "Satellite", seq: 1 });
    expect(radio(t("ob.class.satellite")).checked).toBe(true);
    rerender(
      <>
        <InsertObjects params={{ cls: "Constellation", seq: 2 }} panelId="insertObjects" />
        <Dialogs />
      </>,
    );
    expect(radio(t("ob.class.constellation")).checked).toBe(true);
    // the same object asked for again after the user picked another: the seq makes it count
    await user.click(radio(t("ob.class.facility")));
    rerender(
      <>
        <InsertObjects params={{ cls: "Constellation", seq: 3 }} panelId="insertObjects" />
        <Dialogs />
      </>,
    );
    expect(radio(t("ob.class.constellation")).checked).toBe(true);
  });

  test("an unknown params.cls is ignored", () => {
    server();
    mount({ cls: "Aircraft", seq: 1 });
    expect(radio(t("ob.class.facility")).checked).toBe(true);
  });

  test("without a scenario the window says so and Insert... is disabled", () => {
    useScenario.getState().close();
    server();
    mount();
    expect(screen.getByText(msg("tooltip.noScenario"))).toBeDefined();
    expect(insertButton().disabled).toBe(true);
  });
});

describe("Facility: Insert Default", () => {
  test("inserts at once with the exact body and If-Match, selects the new object and closes the window", async () => {
    const f = server();
    mount();
    await user.click(radio(t("dialog.insert.insertDefault")));
    await user.click(insertButton());
    await waitFor(() => expect(useSelection.getState().activePath).toBe("*/Facility/Facility1"));
    expect(posts(f)).toHaveLength(1);
    expect(posts(f)[0].body).toEqual({ class: "Facility", method: "Insert Default" });
    expect(posts(f)[0].headers.get("If-Match")).toBe('"e1"');
    expect(flow.closePanel).toHaveBeenCalledWith("insertObjects");
    expect(screen.queryByRole("dialog")).toBeNull(); // no form for Insert Default
  });

  test("a second click while the first is on its way sends nothing more", async () => {
    const gate = deferred<void>();
    const f = server({ [POST_OBJECTS]: async () => { await gate.promise; return CREATED("*/Facility/Facility1") as never; } });
    mount();
    await user.click(radio(t("dialog.insert.insertDefault")));
    await user.click(insertButton());
    expect(insertButton().disabled).toBe(true);
    await user.click(insertButton());
    gate.resolve();
    await waitFor(() => expect(flow.closePanel).toHaveBeenCalled());
    expect(posts(f)).toHaveLength(1);
  });

  test("a server failure goes to the Message Viewer, selects nothing and keeps the window", async () => {
    server({ [POST_OBJECTS]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    mount();
    await user.click(radio(t("dialog.insert.insertDefault")));
    await user.click(insertButton());
    await waitFor(() => expect(useMessages.getState().items.some((m) => m.code === "INTERNAL")).toBe(true));
    expect(useSelection.getState().activePath).toBeNull();
    expect(flow.closePanel).not.toHaveBeenCalled();
    expect(insertButton().disabled).toBe(false);
  });

  test("a 412 leaves the Message Viewer alone; the conflict box of the store takes over", async () => {
    server({ [POST_OBJECTS]: { status: 412, json: { code: "PRECONDITION_FAILED", text: "เก่า", field: null, detail: null } } });
    mount();
    await user.click(radio(t("dialog.insert.insertDefault")));
    await user.click(insertButton());
    await waitFor(() => expect(useScenario.getState().conflict).toBe(true));
    expect(useMessages.getState().items).toEqual([]);
  });
});

describe("Facility: Define Properties", () => {
  const open = async () => {
    await user.click(insertButton());
    return screen.getByRole("dialog");
  };

  test("Insert... opens a form with Name, Latitude, Longitude and Altitude and posts nothing yet", async () => {
    const f = server();
    mount();
    await open();
    for (const label of [t("field.name"), t("field.latitude"), t("field.longitude"), t("field.altitude")]) expect(field(label).value).toBe("");
    expect(posts(f)).toHaveLength(0);
  });

  test("a good form posts the body with numbers, selects the new object and closes both", async () => {
    const f = server({ [POST_OBJECTS]: CREATED("*/Facility/BKK") });
    mount();
    await open();
    await user.type(field(t("field.name")), "BKK");
    await user.type(field(t("field.latitude")), "13.7563");
    await user.type(field(t("field.longitude")), "100.5018");
    await user.type(field(t("field.altitude")), "-5");
    await user.click(okButton());
    await waitFor(() => expect(useSelection.getState().activePath).toBe("*/Facility/BKK"));
    expect(posts(f)[0].body).toEqual({
      class: "Facility", method: "Define Properties", name: "BKK", position: { lat_deg: 13.7563, lon_deg: 100.5018, alt_m: -5 },
    });
    expect(flow.closePanel).toHaveBeenCalledWith("insertObjects");
  });

  test("the schema's bounds: latitude within ±90, longitude within ±180, a number is required, nothing is posted", async () => {
    const f = server();
    mount();
    await open();
    await user.type(field(t("field.name")), "BKK");
    await user.type(field(t("field.latitude")), "90.5");
    await user.type(field(t("field.longitude")), "-181");
    await user.type(field(t("field.altitude")), "high");
    await user.click(okButton());
    expect(errorOf(field(t("field.latitude")))).toBe(msg("props.rangeBetween", { min: -90, max: 90 }));
    expect(errorOf(field(t("field.longitude")))).toBe(msg("props.rangeBetween", { min: -180, max: 180 }));
    expect(errorOf(field(t("field.altitude")))).toBe(msg("props.notNumber"));
    expect(field(t("field.latitude")).getAttribute("aria-invalid")).toBe("true");
    expect(posts(f)).toHaveLength(0);
  });

  test("the edge values 90 and -180 are accepted, and an empty field is not a number", async () => {
    const f = server();
    mount();
    await open();
    await user.type(field(t("field.name")), "Pole");
    await user.type(field(t("field.latitude")), "90");
    await user.type(field(t("field.longitude")), "-180");
    await user.click(okButton());
    expect(errorOf(field(t("field.latitude")))).toBeUndefined();
    expect(errorOf(field(t("field.longitude")))).toBeUndefined();
    expect(errorOf(field(t("field.altitude")))).toBe(msg("props.notNumber"));
    expect(posts(f)).toHaveLength(0);
  });

  test("the name follows the object name rule", async () => {
    server();
    mount();
    await open();
    await user.type(field(t("field.name")), "bad name!");
    await user.click(okButton());
    expect(errorOf(field(t("field.name")))).toBe(msg("ob.nameInvalid"));
  });

  test("a name already taken (409) is shown on the Name field with the server's text; the form stays", async () => {
    server({ [POST_OBJECTS]: { status: 409, json: { code: "NAME_EXISTS", text: "มี object ชื่อ THBK อยู่แล้ว", field: "name", detail: "THBK" } } });
    mount();
    await open();
    await user.type(field(t("field.name")), "THBK");
    await user.type(field(t("field.latitude")), "13");
    await user.type(field(t("field.longitude")), "100");
    await user.type(field(t("field.altitude")), "0");
    await user.click(okButton());
    await waitFor(() => expect(errorOf(field(t("field.name")))).toBe("มี object ชื่อ THBK อยู่แล้ว"));
    expect(useMessages.getState().items).toEqual([]);
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(flow.closePanel).not.toHaveBeenCalled();
  });

  test("a 422 on position.lat_deg lands on the Latitude field", async () => {
    server({ [POST_OBJECTS]: { status: 422, json: { code: "SCENARIO_INVALID", text: "lat เกินช่วง", field: "position.lat_deg", detail: null } } });
    mount();
    await open();
    await user.type(field(t("field.name")), "BKK");
    await user.type(field(t("field.latitude")), "10");
    await user.type(field(t("field.longitude")), "10");
    await user.type(field(t("field.altitude")), "0");
    await user.click(okButton());
    await waitFor(() => expect(errorOf(field(t("field.latitude")))).toBe("lat เกินช่วง"));
    expect(errorOf(field(t("field.longitude")))).toBeUndefined();
  });

  test("Cancel closes the form without posting and keeps the window", async () => {
    const f = server();
    mount();
    await open();
    await user.click(screen.getByRole("button", { name: t("dialog.cancel") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts(f)).toHaveLength(0);
    expect(flow.closePanel).not.toHaveBeenCalled();
  });
});

describe("Satellite", () => {
  test("Define Properties asks for a name and a NORAD number and posts the NORAD as an integer", async () => {
    const f = server({ [POST_OBJECTS]: CREATED("*/Satellite/X1") });
    mount();
    await user.click(radio(t("ob.class.satellite")));
    await user.click(radio(t("dialog.insert.defineProperties")));
    await user.click(insertButton());
    await user.type(field(t("field.name")), "X1");
    await user.type(field(t("field.norad")), "40128");
    await user.click(okButton());
    await waitFor(() => expect(useSelection.getState().activePath).toBe("*/Satellite/X1"));
    expect(posts(f)[0].body).toEqual({ class: "Satellite", method: "Define Properties", name: "X1", norad: 40128 });
    expect(typeof (posts(f)[0].body as { norad: unknown }).norad).toBe("number");
  });

  test.each(["0", "-5", "12.5", "abc", "", "1e3", "4 0"])("NORAD %j is refused before anything is sent", async (text) => {
    const f = server();
    mount();
    await user.click(radio(t("ob.class.satellite")));
    await user.click(radio(t("dialog.insert.defineProperties")));
    await user.click(insertButton());
    await user.type(field(t("field.name")), "X1");
    if (text !== "") await user.type(field(t("field.norad")), text);
    await user.click(okButton());
    expect(errorOf(field(t("field.norad")))).toBe(msg("insert.noradInvalid"));
    expect(posts(f)).toHaveLength(0);
  });

  test("a NORAD the server does not know (422 on norad) shows on the NORAD field", async () => {
    server({ [POST_OBJECTS]: { status: 422, json: { code: "SCENARIO_INVALID", text: "ไม่มีค่านี้", field: "norad", detail: null } } });
    mount();
    await user.click(radio(t("ob.class.satellite")));
    await user.click(radio(t("dialog.insert.defineProperties")));
    await user.click(insertButton());
    await user.type(field(t("field.name")), "X1");
    await user.type(field(t("field.norad")), "5");
    await user.click(okButton());
    await waitFor(() => expect(errorOf(field(t("field.norad")))).toBe("ไม่มีค่านี้"));
  });

  test("From Satellite Catalog opens Search Satellite Catalog, closes this window and posts nothing", async () => {
    const f = server();
    mount();
    await user.click(radio(t("ob.class.satellite")));
    await user.click(insertButton());
    expect(flow.openPanel).toHaveBeenCalledWith("satelliteCatalog");
    expect(flow.closePanel).toHaveBeenCalledWith("insertObjects");
    expect(f.calls).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Constellation", () => {
  test("Define Properties asks for a name only and posts it", async () => {
    const f = server({ [POST_OBJECTS]: CREATED("*/Constellation/Mine") });
    mount();
    await user.click(radio(t("ob.class.constellation")));
    await user.click(insertButton());
    expect(screen.queryByLabelText(t("field.latitude"))).toBeNull();
    expect(screen.queryByLabelText(t("field.norad"))).toBeNull();
    await user.type(field(t("field.name")), "Mine");
    await user.click(okButton());
    await waitFor(() => expect(useSelection.getState().activePath).toBe("*/Constellation/Mine"));
    expect(posts(f)[0].body).toEqual({ class: "Constellation", method: "Define Properties", name: "Mine" });
    expect(flow.closePanel).toHaveBeenCalledWith("insertObjects");
  });
});

describe("registration and commands", () => {
  test("registerInsertObjectsPanel swaps the placeholder for the window and keeps the panel's flags", () => {
    const before = getPanelDef("insertObjects")!;
    registerInsertObjectsPanel();
    const after = getPanelDef("insertObjects")!;
    expect(after.component).toBe(InsertObjects);
    expect(after.component).not.toBe(before.component);
    expect([after.persist, after.scenarioBound, after.type, after.singleton]).toEqual([false, true, "floating", true]);
    registerInsertObjectsPanel();
    expect(getPanelDef("insertObjects")!.component).toBe(InsertObjects);
  });

  test("the four insert commands are registered, and disabled with a Thai note while no scenario is open", () => {
    useScenario.getState().close();
    const off = registerDataCommands();
    for (const id of ["insert.new", "insert.facility", "insert.satellite", "insert.constellation"] as const) {
      expect(isRegistered(id), id).toBe(true);
      expect(isEnabled(id), id).toBe(false);
      expect(commandTooltip(id), id).toBe(msg("tooltip.noScenario"));
    }
    off();
    expect(isRegistered("insert.new")).toBe(false);
  });

  test("each insert command opens Insert STK Objects with its object (New... with none)", () => {
    const off = registerDataCommands();
    const cases = [["insert.facility", "Facility"], ["insert.satellite", "Satellite"], ["insert.constellation", "Constellation"], ["insert.new", null]] as const;
    const seqs = new Set<unknown>();
    for (const [id, cls] of cases) {
      flow.openPanel.mockClear();
      expect(isEnabled(id), id).toBe(true);
      runCommand(id);
      expect(flow.openPanel).toHaveBeenCalledTimes(1);
      const [kind, params] = flow.openPanel.mock.calls[0] as unknown as [string, { cls: string | null; seq: number }];
      expect(kind).toBe("insertObjects");
      expect(params.cls).toBe(cls);
      seqs.add(params.seq);
    }
    expect(seqs.size).toBe(4); // every open carries a new seq so an already open window moves to the object asked for
    off();
  });

  test("opening a scenario enables the commands without anyone calling invalidate", () => {
    useScenario.getState().close();
    const off = registerDataCommands();
    expect(isEnabled("insert.new")).toBe(false);
    loadObjects();
    expect(isEnabled("insert.new")).toBe(true);
    off();
  });

  test("utilities.fetchOrbitData and utilities.dailyForecastSettings open their windows, with or without a scenario", () => {
    useScenario.getState().close();
    const off = registerDataCommands();
    for (const [id, kind] of [["utilities.fetchOrbitData", "fetchOrbitData"], ["utilities.dailyForecastSettings", "dailyForecastSettings"]] as const) {
      flow.openPanel.mockClear();
      expect(isEnabled(id), id).toBe(true);
      runCommand(id);
      expect(flow.openPanel).toHaveBeenCalledWith(kind);
    }
    off();
    expect(isRegistered("utilities.fetchOrbitData")).toBe(false);
  });
});
