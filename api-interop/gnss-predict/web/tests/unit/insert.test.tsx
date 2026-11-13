import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
import { SelectObjectDialog } from "../../src/windows/InsertObjects/SelectObjectDialog";
import { registerDataCommands } from "../../src/windows/dataCommands";
import { resetAll } from "./helpers/chrome";
import { deferred, stubFetch, type Handler } from "./helpers/fake-fetch";
import { fakeFlow, type FakeFlow } from "./helpers/files";
import { loadObjects, loadSensors, makeScenarioDoc, makeTree, satPath, sensorPath } from "./helpers/objects";

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
  test("lists Facility, Satellite, Sensor and Constellation under Select An Object To Be Inserted, Facility chosen first", () => {
    server();
    mount();
    expect(screen.getByRole("group", { name: t("dialog.insert.selectObject") })).toBeDefined();
    const names = screen.getAllByRole("radio").slice(0, 4).map((r) => (r as HTMLInputElement).labels?.[0]?.textContent);
    expect(names).toEqual([t("ob.class.facility"), t("ob.class.satellite"), t("ob.class.sensor"), t("ob.class.constellation")]);
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

describe("Sensor", () => {
  const selectDialog = () => screen.getByRole("dialog", { name: t("window.selectObject") });
  const okIn = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: t("dialog.ok") });
  const parentList = () => within(selectDialog()).getByRole("listbox") as HTMLSelectElement;
  const NEW_SENSOR = CREATED(sensorPath("Sensor1"));

  /** a scenario with no satellite at all */
  const loadWithoutSatellites = () => {
    const doc = makeScenarioDoc();
    doc.objects = doc.objects.filter((o) => o.class !== "Satellite");
    loadObjects({ doc, tree: makeTree({ groups: [], loose: [] }) });
  };

  test("offers Define Properties and Insert Default, with Define Properties chosen, and no catalog method", async () => {
    server();
    mount();
    await user.click(radio(t("ob.class.sensor")));
    const methods = screen.getByRole("group", { name: t("dialog.insert.selectMethod") });
    expect(Array.from(methods.querySelectorAll("label")).map((l) => l.textContent)).toEqual([t("dialog.insert.defineProperties"), t("dialog.insert.insertDefault")]);
    expect(radio(t("dialog.insert.defineProperties")).checked).toBe(true);
  });

  test("params.cls = Sensor preselects it", () => {
    server();
    mount({ cls: "Sensor", seq: 1 });
    expect(radio(t("ob.class.sensor")).checked).toBe(true);
  });

  test("Insert Default for a sensor asks for the parent in Select Object", async () => {
    const f = server({ [POST_OBJECTS]: NEW_SENSOR });
    useSelection.getState().select(satPath("G01"));
    mount({ cls: "Sensor", seq: 1 });
    await user.click(radio(t("dialog.insert.insertDefault")));
    await user.click(insertButton());
    expect(posts(f)).toHaveLength(0); // nothing is sent before the parent is known
    expect(selectDialog()).toBeDefined();
    expect(parentList().value).toBe(satPath("G01")); // the selected satellite is chosen already
    await user.click(okIn(selectDialog()));
    await waitFor(() => expect(useSelection.getState().activePath).toBe(sensorPath("Sensor1")));
    expect(posts(f)).toHaveLength(1);
    expect(posts(f)[0].body).toEqual({ class: "Sensor", method: "Insert Default", parent: satPath("G01") });
    expect(posts(f)[0].headers.get("If-Match")).toBe('"e1"');
    expect(flow.closePanel).toHaveBeenCalledWith("insertObjects");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("another satellite can be picked in Select Object", async () => {
    const f = server({ [POST_OBJECTS]: NEW_SENSOR });
    useSelection.getState().select(satPath("G01"));
    mount({ cls: "Sensor", seq: 1 });
    await user.click(radio(t("dialog.insert.insertDefault")));
    await user.click(insertButton());
    await user.selectOptions(parentList(), "G03");
    await user.click(okIn(selectDialog()));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(posts(f)[0].body).toEqual({ class: "Sensor", method: "Insert Default", parent: satPath("G03") });
  });

  test("Cancel in Select Object inserts nothing", async () => {
    const f = server();
    useSelection.getState().select(satPath("G01"));
    mount({ cls: "Sensor", seq: 1 });
    await user.click(radio(t("dialog.insert.insertDefault")));
    await user.click(insertButton());
    await user.click(within(selectDialog()).getByRole("button", { name: t("dialog.cancel") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts(f)).toHaveLength(0);
    expect(flow.closePanel).not.toHaveBeenCalled();
    expect(useSelection.getState().activePath).toBe(satPath("G01")); // the selection is left alone
    expect(insertButton().disabled).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(insertButton())); // the keyboard is where it was
  });

  test("Cancel in Select Object for Define Properties opens no form", async () => {
    const f = server();
    mount({ cls: "Sensor", seq: 1 });
    await user.click(insertButton());
    await user.click(within(selectDialog()).getByRole("button", { name: t("dialog.cancel") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts(f)).toHaveLength(0);
  });

  test("a refusal of Insert Default goes to the Message Viewer, selects nothing and keeps the window", async () => {
    server({ [POST_OBJECTS]: { status: 422, json: { code: "SCENARIO_INVALID", text: "parent ไม่ใช่ดาว", field: "parent", detail: null } } });
    mount({ cls: "Sensor", seq: 1 });
    await user.click(radio(t("dialog.insert.insertDefault")));
    await user.click(insertButton());
    await user.click(okIn(selectDialog()));
    await waitFor(() => expect(useMessages.getState().items.some((m) => m.code === "SCENARIO_INVALID")).toBe(true));
    expect(useSelection.getState().activePath).toBeNull();
    expect(flow.closePanel).not.toHaveBeenCalled();
    expect(screen.getByText("parent ไม่ใช่ดาว")).toBeDefined();
  });

  describe("Define Properties", () => {
    const openForm = async () => {
      await user.click(insertButton());
      await user.click(okIn(selectDialog()));
      return screen.getByRole("dialog", { name: `${t("ob.class.sensor")}: ${t("dialog.insert.defineProperties")}` });
    };

    test("Define Properties for a sensor sends name, parent and cone half angle", async () => {
      const f = server({ [POST_OBJECTS]: NEW_SENSOR });
      useSelection.getState().select(satPath("G01"));
      mount({ cls: "Sensor", seq: 1 });
      await openForm();
      expect(field(t("field.name")).value).toBe("Sensor1"); // the first free Sensor<n>
      expect(field(t("field.parentObject")).value).toBe(satPath("G01"));
      expect(field(t("field.parentObject")).readOnly).toBe(true);
      expect(field(t("field.coneHalfAngle")).value).toBe("45");
      expect(posts(f)).toHaveLength(0);
      await user.click(okButton());
      await waitFor(() => expect(useSelection.getState().activePath).toBe(sensorPath("Sensor1")));
      expect(posts(f)).toHaveLength(1);
      expect(posts(f)[0].body).toEqual({
        class: "Sensor", method: "Define Properties", name: "Sensor1", parent: satPath("G01"), definition: { cone_half_angle: 45 },
      });
      expect(typeof (posts(f)[0].body as { definition: { cone_half_angle: unknown } }).definition.cone_half_angle).toBe("number");
      expect(flow.closePanel).toHaveBeenCalledWith("insertObjects");
    });

    test("the name, parent and a typed cone half angle are posted", async () => {
      const f = server({ [POST_OBJECTS]: CREATED(sensorPath("Nav")) });
      mount({ cls: "Sensor", seq: 1 });
      await user.click(insertButton());
      await user.selectOptions(parentList(), "G02");
      await user.click(okIn(selectDialog()));
      await user.clear(field(t("field.name")));
      await user.type(field(t("field.name")), "Nav");
      await user.clear(field(t("field.coneHalfAngle")));
      await user.type(field(t("field.coneHalfAngle")), "13.9");
      await user.click(okButton());
      await waitFor(() => expect(useSelection.getState().activePath).toBe(sensorPath("Nav")));
      expect(posts(f)[0].body).toEqual({
        class: "Sensor", method: "Define Properties", name: "Nav", parent: satPath("G02"), definition: { cone_half_angle: 13.9 },
      });
    });

    test("the starting name is the first Sensor<n> that is free, whatever the case", async () => {
      loadSensors({ G01: ["Sensor1", "sensor2"], G02: ["Sensor4"] });
      server();
      mount({ cls: "Sensor", seq: 1 });
      await openForm();
      expect(field(t("field.name")).value).toBe("Sensor3");
    });

    test("a name used by another kind of object counts as taken", async () => {
      const doc = makeScenarioDoc();
      doc.objects.push({ class: "Facility", name: "sensor1", position: { type: "Geodetic", lat_deg: 0, lon_deg: 0, alt_m: 0 } } as never);
      loadObjects({ doc });
      server();
      mount({ cls: "Sensor", seq: 1 });
      await openForm();
      expect(field(t("field.name")).value).toBe("Sensor2");
    });

    test("the cone half angle must be greater than 0 and at most 90, and nothing is posted", async () => {
      const f = server({ [POST_OBJECTS]: NEW_SENSOR });
      mount({ cls: "Sensor", seq: 1 });
      await openForm();
      const message = msg("props.rangeOverUpTo", { min: 0, max: 90 });
      for (const bad of ["0", "-5", "90.5", "91"]) {
        await user.clear(field(t("field.coneHalfAngle")));
        await user.type(field(t("field.coneHalfAngle")), bad);
        await user.click(okButton());
        expect(errorOf(field(t("field.coneHalfAngle"))), bad).toBe(message);
        expect(field(t("field.coneHalfAngle")).getAttribute("aria-invalid")).toBe("true");
      }
      await user.clear(field(t("field.coneHalfAngle")));
      await user.type(field(t("field.coneHalfAngle")), "abc");
      await user.click(okButton());
      expect(errorOf(field(t("field.coneHalfAngle")))).toBe(msg("props.notNumber"));
      expect(posts(f)).toHaveLength(0);
      await user.clear(field(t("field.coneHalfAngle")));
      await user.type(field(t("field.coneHalfAngle")), "90");
      await user.click(okButton());
      await waitFor(() => expect(posts(f)).toHaveLength(1));
      expect(posts(f)[0].body).toMatchObject({ definition: { cone_half_angle: 90 } });
    });

    test("the name follows the object name rule", async () => {
      const f = server();
      mount({ cls: "Sensor", seq: 1 });
      await openForm();
      await user.clear(field(t("field.name")));
      await user.type(field(t("field.name")), "bad name!");
      await user.click(okButton());
      expect(errorOf(field(t("field.name")))).toBe(msg("ob.nameInvalid"));
      expect(posts(f)).toHaveLength(0);
    });

    test("a name already taken (409) shows on the Name field and the form stays", async () => {
      server({ [POST_OBJECTS]: { status: 409, json: { code: "NAME_EXISTS", text: "มี object ชื่อ THBK อยู่แล้ว", field: "name", detail: "THBK" } } });
      mount({ cls: "Sensor", seq: 1 });
      await openForm();
      await user.clear(field(t("field.name")));
      await user.type(field(t("field.name")), "THBK");
      await user.click(okButton());
      await waitFor(() => expect(errorOf(field(t("field.name")))).toBe("มี object ชื่อ THBK อยู่แล้ว"));
      expect(screen.getByRole("dialog")).toBeDefined();
      expect(flow.closePanel).not.toHaveBeenCalled();
    });

    test("a 422 on definition.cone_half_angle lands on the Cone Half Angle field, and one on parent on the Parent field", async () => {
      server({ [POST_OBJECTS]: { status: 422, json: { code: "SCENARIO_INVALID", text: "กรวยผิด", field: "definition.cone_half_angle", detail: null } } });
      mount({ cls: "Sensor", seq: 1 });
      await openForm();
      await user.click(okButton());
      await waitFor(() => expect(errorOf(field(t("field.coneHalfAngle")))).toBe("กรวยผิด"));
      expect(errorOf(field(t("field.name")))).toBeUndefined();
      cleanup();
      vi.unstubAllGlobals();

      server({ [POST_OBJECTS]: { status: 422, json: { code: "SCENARIO_INVALID", text: "ไม่ใช่ดาว", field: "parent", detail: null } } });
      mount({ cls: "Sensor", seq: 2 });
      await openForm();
      await user.click(okButton());
      await waitFor(() => expect(errorOf(field(t("field.parentObject")))).toBe("ไม่ใช่ดาว"));
    });

    test("Cancel closes the form without posting, keeps the window and gives the focus back to Insert...", async () => {
      const f = server();
      mount({ cls: "Sensor", seq: 1 });
      await openForm();
      await user.click(screen.getByRole("button", { name: t("dialog.cancel") }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(posts(f)).toHaveLength(0);
      expect(flow.closePanel).not.toHaveBeenCalled();
      await waitFor(() => expect(document.activeElement).toBe(insertButton()));
    });

    test("the form of another object has no Parent and no Cone Half Angle", async () => {
      server();
      mount();
      await user.click(insertButton());
      expect(screen.queryByLabelText(t("field.parentObject"))).toBeNull();
      expect(screen.queryByLabelText(t("field.coneHalfAngle"))).toBeNull();
    });
  });

  describe("without satellites", () => {
    test("no satellites disables the sensor methods with the Thai reason", async () => {
      loadWithoutSatellites();
      server();
      mount({ cls: "Sensor", seq: 1 });
      expect(screen.getByText(msg("insert.noSatellite"))).toBeDefined();
      expect(radio(t("dialog.insert.defineProperties")).disabled).toBe(true);
      expect(radio(t("dialog.insert.insertDefault")).disabled).toBe(true);
      expect(insertButton().disabled).toBe(true);
      // the other objects are not affected
      await user.click(radio(t("ob.class.facility")));
      expect(screen.queryByText(msg("insert.noSatellite"))).toBeNull();
      expect(radio(t("dialog.insert.defineProperties")).disabled).toBe(false);
      expect(insertButton().disabled).toBe(false);
      await user.click(radio(t("ob.class.sensor")));
      expect(screen.getByText(msg("insert.noSatellite"))).toBeDefined();
    });

    test("a scenario with satellites shows no such note", () => {
      server();
      mount({ cls: "Sensor", seq: 1 });
      expect(screen.queryByText(msg("insert.noSatellite"))).toBeNull();
      expect(radio(t("dialog.insert.insertDefault")).disabled).toBe(false);
      expect(insertButton().disabled).toBe(false);
    });

    test("a satellite added while the window is open lifts the block", () => {
      loadWithoutSatellites();
      server();
      mount({ cls: "Sensor", seq: 1 });
      expect(insertButton().disabled).toBe(true);
      loadObjects();
      return waitFor(() => expect(insertButton().disabled).toBe(false));
    });
  });
});

describe("Select Object", () => {
  const dialog = () => screen.getByRole("dialog", { name: t("window.selectObject") });
  const list = () => within(dialog()).getByRole("listbox") as HTMLSelectElement;
  const listed = () => within(list()).getAllByRole("option").map((o) => o.textContent);
  const ok = () => within(dialog()).getByRole("button", { name: t("dialog.ok") }) as HTMLButtonElement;

  test("is named Select Object and lists the satellites of the scenario, one can be chosen", async () => {
    const onClose = vi.fn();
    render(<SelectObjectDialog onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Select Object" })).toBeDefined();
    expect(listed()).toEqual(["G01", "G02", "G03", "G04", "G05"]); // satellites only: no THBK, no GPS
    expect(list().multiple).toBe(false);
  });

  test("starts on the selected satellite", () => {
    useSelection.getState().select(satPath("G04"));
    render(<SelectObjectDialog onClose={vi.fn()} />);
    expect(list().value).toBe(satPath("G04"));
  });

  test("starts on the parent of the selected sensor", () => {
    loadSensors({ G02: ["Nav1"] });
    useSelection.getState().select(sensorPath("Nav1"));
    render(<SelectObjectDialog onClose={vi.fn()} />);
    expect(list().value).toBe(satPath("G02"));
  });

  test.each([["nothing", null], ["a facility", "*/Facility/THBK"], ["a constellation", "*/Constellation/GPS"], ["a satellite that is gone", "*/Satellite/G99"], ["a sensor that is gone", "*/Sensor/Nope"]])(
    "starts on the first satellite when %s is selected", (_, path) => {
      useSelection.getState().select(path);
      render(<SelectObjectDialog onClose={vi.fn()} />);
      expect(list().value).toBe(satPath("G01"));
    },
  );

  test("OK gives the chosen path back, Cancel gives null", async () => {
    const onClose = vi.fn();
    const { unmount } = render(<SelectObjectDialog onClose={onClose} />);
    await user.selectOptions(list(), "G05");
    await user.click(ok());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(satPath("G05"));
    unmount();

    const onCancel = vi.fn();
    render(<SelectObjectDialog onClose={onCancel} />);
    await user.click(within(dialog()).getByRole("button", { name: t("dialog.cancel") }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith(null);
  });

  test("OK without a change gives the satellite it started on", async () => {
    const onClose = vi.fn();
    useSelection.getState().select(satPath("G02"));
    render(<SelectObjectDialog onClose={onClose} />);
    await user.click(ok());
    expect(onClose).toHaveBeenCalledWith(satPath("G02"));
  });

  test("Esc is Cancel", async () => {
    const onClose = vi.fn();
    render(<SelectObjectDialog onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledWith(null);
  });

  test("Enter in the list is OK", async () => {
    const onClose = vi.fn();
    useSelection.getState().select(satPath("G02"));
    render(<SelectObjectDialog onClose={onClose} />);
    list().focus();
    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledWith(satPath("G02"));
  });

  test("double-clicking a satellite is OK", async () => {
    const onClose = vi.fn();
    render(<SelectObjectDialog onClose={onClose} />);
    await user.dblClick(within(list()).getByRole("option", { name: "G03" }));
    expect(onClose).toHaveBeenCalledWith(satPath("G03"));
  });

  test("a scenario without satellites shows the Thai reason and OK is off", () => {
    const doc = makeScenarioDoc();
    doc.objects = doc.objects.filter((o) => o.class !== "Satellite");
    loadObjects({ doc, tree: makeTree({ groups: [], loose: [] }) });
    render(<SelectObjectDialog onClose={vi.fn()} />);
    expect(screen.getByText(msg("insert.noSatellite"))).toBeDefined();
    expect(ok().disabled).toBe(true);
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

  test("the five insert commands are registered, and disabled with a Thai note while no scenario is open", () => {
    useScenario.getState().close();
    const off = registerDataCommands();
    for (const id of ["insert.new", "insert.facility", "insert.satellite", "insert.sensor", "insert.constellation"] as const) {
      expect(isRegistered(id), id).toBe(true);
      expect(isEnabled(id), id).toBe(false);
      expect(commandTooltip(id), id).toBe(msg("tooltip.noScenario"));
    }
    off();
    expect(isRegistered("insert.new")).toBe(false);
  });

  test("each insert command opens Insert STK Objects with its object (New... with none)", () => {
    const off = registerDataCommands();
    const cases = [["insert.facility", "Facility"], ["insert.satellite", "Satellite"], ["insert.sensor", "Sensor"], ["insert.constellation", "Constellation"], ["insert.new", null]] as const;
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
    expect(seqs.size).toBe(5); // every open carries a new seq so an already open window moves to the object asked for
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
