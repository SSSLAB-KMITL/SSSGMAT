import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ENUMS } from "../../src/api/enums.gen";
import { Dialogs } from "../../src/chrome/Dialogs";
import { registerCommand, resetCommands } from "../../src/commands";
import { optionLabel, t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useResults } from "../../src/stores/results";
import { useScenario, type ScenarioDoc } from "../../src/stores/scenario";
import { PropertiesBrowser, registerPropertiesBrowserPanel } from "../../src/windows/PropertiesBrowser/PropertiesBrowser";
import { resetAll } from "./helpers/chrome";
import { deferred, stubFetch, type Call, type Handler, type Reply } from "./helpers/fake-fetch";
import { loadObjects, makeScenarioDoc, makeTree } from "./helpers/objects";

// ---------- what the server holds ----------

const THBK_PAGES = {
  basic: { description: "", long_description: "", position: { type: "Geodetic", lat_deg: 13.729779, lon_deg: 100.781151, alt_m: 6.4 } },
  graphics2d: { show: true, color: "#ff79e6", marker_style: "Triangle", inherit: true },
  graphics3d: { show: true },
  constraints: { elevation_angle_min_deg: 10 },
};
const G01_PAGES = {
  basic: { description: "", long_description: "", norad: 40101 },
  graphics2d: {
    show: true, color: "#ffd23f", line_style: "Solid", line_width: 1, marker_style: "Circle", inherit: true,
    pass: { lead_type: "Time", lead_time_s: 600, trail_type: "Same As Lead", visible_sides: "Both", show_pass_labels: false, show_path_labels: false },
    swath: { type: "Ground Elevation", elevation_deg: 10, options: "No Graphics" },
  },
  graphics3d: { show: true, orbit_system: "Fixed by Window" },
  constraints: {},
};
const GPS_PAGES = {
  basic: { description: "", long_description: "", system: "G", color: "#ffd23f", assigned_objects: ["*/Satellite/G01", "*/Satellite/G02"] },
  graphics2d: {},
  graphics3d: {},
  constraints: {},
};

const SENSOR1_PAGES = {
  basic: {
    description: "", long_description: "", parent: "*/Satellite/G01",
    definition: { type: "Simple Conic", cone_half_angle: 45 },
    pointing: { type: "Fixed", orientation: "Az-El", azimuth: 0, elevation: 90, about_boresight: "Rotate" },
  },
  graphics2d: { show: true, color: "#e8c547", fill: false, fill_translucency: 50 },
  graphics3d: { show: true, color: "#e8c547", show_radial_lines: true, show_boresight_marker: false },
  constraints: {},
};

const API = "/api/scenarios/S1";
const PATCH_OK: Handler = { json: { etag: "e2", results_stale: false }, headers: { ETag: '"e2"' } };

const refresh = vi.fn(async () => undefined);
const closePanel = vi.fn();
let pages: Record<string, unknown>;
let user: ReturnType<typeof userEvent.setup>;

function server(over: Record<string, Handler> = {}) {
  return stubFetch({
    [`GET ${API}/objects/Facility/THBK`]: () => ({ json: pages, headers: { ETag: '"e1"' } }),
    [`GET ${API}/objects/Satellite/G01`]: () => ({ json: pages, headers: { ETag: '"e1"' } }),
    [`GET ${API}/objects/Constellation/GPS`]: () => ({ json: pages, headers: { ETag: '"e1"' } }),
    [`GET ${API}/objects/Sensor/Sensor1`]: () => ({ json: pages, headers: { ETag: '"e1"' } }),
    [`PATCH ${API}/objects/Facility/THBK`]: PATCH_OK,
    [`PATCH ${API}/objects/Satellite/G01`]: PATCH_OK,
    [`PATCH ${API}/objects/Constellation/GPS`]: PATCH_OK,
    [`PATCH ${API}/objects/Sensor/Sensor1`]: PATCH_OK,
    [`GET ${API}`]: () => ({ json: makeScenarioDoc(), headers: { ETag: '"e3"' } }),
    [`GET ${API}/objects`]: () => ({ json: makeTree() }),
    "GET /api/catalog": { json: [] },
    "GET /api/scenarios/S1/results": { json: {} },
    ...over,
  });
}

const sent = (f: ReturnType<typeof stubFetch>, method: string, suffix: string): Call[] => f.calls.filter((c) => c.method === method && c.path === `${API}${suffix}`);
const patches = (f: ReturnType<typeof stubFetch>, obj: string) => sent(f, "PATCH", `/objects/${obj}`);

beforeEach(() => {
  resetAll();
  resetCommands();
  refresh.mockClear();
  closePanel.mockClear();
  loadObjects();
  useResults.setState({ refresh } as never);
  useLayout.setState({ closePanel } as never);
  pages = structuredClone(THBK_PAGES);
  user = userEvent.setup();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** renders the window and waits until its pages have arrived (or failed to) */
async function mount(path: string, name: string) {
  const view = render(
    <>
      <PropertiesBrowser params={{ path, name }} panelId="propertiesBrowser" />
      <Dialogs />
    </>,
  );
  await waitFor(() => expect(screen.queryByText(msg("props.loading"))).toBeNull());
  return view;
}
const mountFacility = () => mount("*/Facility/THBK", "THBK");
const mountSatellite = () => mount("*/Satellite/G01", "G01");
const mountConstellation = () => mount("*/Constellation/GPS", "GPS");
const mountSensor = () => mount("*/Sensor/Sensor1", "Sensor1");
const mountScenario = () => mount("*", "S1");

const tabs = () => screen.getAllByRole("tab").map((el) => el.textContent);
const tab = (name: string) => screen.getByRole("tab", { name });
const openPage = async (name: string) => {
  await user.click(await screen.findByRole("tab", { name }));
};
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const button = (name: string) => screen.getByRole("button", { name });
const errorOf = (el: HTMLElement) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent;
const type = async (label: string, text: string) => {
  const el = input(label);
  await user.clear(el);
  if (text !== "") await user.type(el, text);
};
const optionTexts = (el: HTMLSelectElement) => [...el.options].map((o) => o.textContent);
const optionValues = (el: HTMLSelectElement) => [...el.options].map((o) => o.value);

// ---------- the page list ----------

describe("the page list", () => {
  test("Scenario", async () => {
    server();
    await mountScenario();
    expect(tabs()).toEqual(["Basic - Time", "Basic - Units", "Basic - Description", "Basic - Ionosphere", "2D Graphics - Global Attributes"]);
  });

  test("Facility", async () => {
    server();
    await mountFacility();
    await screen.findByRole("tab", { name: "Constraints - Active" });
    expect(tabs()).toEqual(["Basic - Position", "Basic - Description", "Constraints - Active", "2D Graphics - Attributes"]);
  });

  test("Satellite", async () => {
    pages = structuredClone(G01_PAGES);
    server();
    await mountSatellite();
    await screen.findByRole("tab", { name: "Basic - Orbit" });
    expect(tabs()).toEqual([
      "Basic - Orbit", "Basic - Description", "2D Graphics - Attributes", "2D Graphics - Pass", "2D Graphics - Swath", "3D Graphics - Orbit System",
    ]);
  });

  test("Constellation", async () => {
    pages = structuredClone(GPS_PAGES);
    server();
    await mountConstellation();
    await screen.findByRole("tab", { name: "Basic - Definition" });
    expect(tabs()).toEqual(["Basic - Definition", "Basic - Description"]);
  });

  test("Sensor", async () => {
    pages = structuredClone(SENSOR1_PAGES);
    server();
    await mountSensor();
    await screen.findByRole("tab", { name: "Basic - Definition" });
    expect(tabs()).toEqual(["Basic - Definition", "Basic - Pointing", "Basic - Description", "2D Graphics - Attributes", "3D Graphics - Attributes"]);
    expect(tab("Basic - Definition").getAttribute("aria-selected")).toBe("true");
  });

  test("the first page is selected and the others are one click away", async () => {
    server();
    await mountFacility();
    expect((await screen.findByRole("tab", { name: "Basic - Position" })).getAttribute("aria-selected")).toBe("true");
    await openPage("Constraints - Active");
    expect(tab("Constraints - Active").getAttribute("aria-selected")).toBe("true");
    expect(tab("Basic - Position").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab("Constraints - Active").id);
  });

  test("the arrow keys move between pages", async () => {
    server();
    await mountFacility();
    (await screen.findByRole("tab", { name: "Basic - Position" })).focus();
    await user.keyboard("{ArrowDown}");
    expect(tab("Basic - Description").getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(tab("2D Graphics - Attributes").getAttribute("aria-selected")).toBe("true");
  });

  test("the bottom has OK, Cancel, Apply and Help", async () => {
    server();
    await mountFacility();
    await screen.findByRole("tab", { name: "Basic - Position" });
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([t("dialog.ok"), t("dialog.cancel"), t("dialog.apply"), t("dialog.help")]);
  });
});

// ---------- loading ----------

describe("loading the pages", () => {
  test("asks the server for the pages of the object and shows them", async () => {
    const f = server();
    await mountFacility();
    await waitFor(() => expect(input(t("field.latitude")).value).toBe("13.729779"));
    expect(f.calls.filter((c) => c.method === "GET" && c.path === `${API}/objects/Facility/THBK`)).toHaveLength(1);
    expect(input(t("field.longitude")).value).toBe("100.781151");
    expect(input(t("field.altitude")).value).toBe("6.4");
  });

  test("shows the server's text when the object cannot be read, and Apply stays off", async () => {
    server({ [`GET ${API}/objects/Facility/THBK`]: { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ object */Facility/THBK" } } });
    await mountFacility();
    expect(await screen.findByText(/ไม่พบ object \*\/Facility\/THBK/)).toBeDefined();
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true);
    expect((button(t("dialog.ok")) as HTMLButtonElement).disabled).toBe(true);
  });

  test("Apply is off until something changes", async () => {
    server();
    await mountFacility();
    await openPage("Constraints - Active");
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true);
    await type(t("field.min"), "15");
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(false);
    await type(t("field.min"), "10"); // back to what the server holds
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ---------- Apply ----------

describe("Apply on an object", () => {
  test("THBK minimum elevation 15 sends only that field with If-Match, and a stale result refreshes the results", async () => {
    const f = server({ [`PATCH ${API}/objects/Facility/THBK`]: { json: { etag: "e2", results_stale: true }, headers: { ETag: '"e2"' } } });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    const call = patches(f, "Facility/THBK")[0];
    expect(call.body).toEqual({ constraints: { elevation_angle_min_deg: 15 } });
    expect(call.headers.get("If-Match")).toBe('"e1"');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true)); // the whole Apply is over
    expect(refresh).toHaveBeenCalledTimes(1); // the store refreshes after a stale write; the window does not ask again
  });

  test("a result that is not stale does not refresh the results", async () => {
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    await waitFor(() => expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true)); // finished and clean again
    expect(refresh).not.toHaveBeenCalled();
  });

  test("after Apply the form shows what the server now holds and is clean again", async () => {
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 15 } };
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    await waitFor(() => expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true));
    expect(input(t("field.min")).value).toBe("15");
    expect(screen.getByRole("tabpanel")).toBeDefined();
  });

  test("only the groups that changed are sent: a Description edit sends only basic", async () => {
    const f = server();
    await mountFacility();
    await openPage("Basic - Description");
    await user.type(input(t("field.shortDescription")), "สถานีทดสอบ");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    expect(patches(f, "Facility/THBK")[0].body).toEqual({ basic: { description: "สถานีทดสอบ" } });
  });

  test("OK applies and then closes the window; a failed apply keeps it open", async () => {
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.ok")));
    await waitFor(() => expect(closePanel).toHaveBeenCalledWith("propertiesBrowser"));
    expect(patches(f, "Facility/THBK")).toHaveLength(1);
  });

  test("OK with nothing changed just closes, without a request", async () => {
    const f = server();
    await mountFacility();
    await screen.findByRole("tab", { name: "Basic - Position" });
    await user.click(button(t("dialog.ok")));
    expect(closePanel).toHaveBeenCalledWith("propertiesBrowser");
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
  });

  test("Cancel closes without a request and drops the edits", async () => {
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.cancel")));
    expect(closePanel).toHaveBeenCalledWith("propertiesBrowser");
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
  });

  test("Help opens the STK UI Reference", async () => {
    const run = vi.fn();
    registerCommand("help.stkReference", { label: "help.stkReference", run });
    server();
    await mountFacility();
    await screen.findByRole("tab", { name: "Basic - Position" });
    await user.click(button(t("dialog.help")));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

// ---------- field errors ----------

describe("a server 422", () => {
  const rejected = (field: string, text: string): Handler => ({ status: 422, json: { code: "SCENARIO_INVALID", text, field } });

  test("marks the field invalid and shows the server's own text", async () => {
    server({ [`PATCH ${API}/objects/Facility/THBK`]: rejected("constraints.elevation_angle_min_deg", "ช่อง constraints.elevation_angle_min_deg: ค่าอยู่นอกช่วงที่กำหนด") });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(input(t("field.min")).getAttribute("aria-invalid")).toBe("true"));
    expect(errorOf(input(t("field.min")))).toBe("ช่อง constraints.elevation_angle_min_deg: ค่าอยู่นอกช่วงที่กำหนด");
    expect(input(t("field.min")).className).toContain("field-invalid");
    expect(input(t("field.max")).getAttribute("aria-invalid")).toBeNull();
  });

  test("selects the page that holds the field", async () => {
    pages = structuredClone(G01_PAGES);
    server({ [`PATCH ${API}/objects/Satellite/G01`]: rejected("graphics2d.pass.lead_type", "ช่อง graphics2d.pass.lead_type: ต้องเป็นหนึ่งใน Time") });
    await mountSatellite();
    await openPage("2D Graphics - Pass");
    await user.selectOptions(select(t("field.leadType")), "Percent");
    await openPage("Basic - Description"); // the user is somewhere else when the answer comes
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(tab("2D Graphics - Pass").getAttribute("aria-selected")).toBe("true"));
    expect(select(t("field.leadType")).getAttribute("aria-invalid")).toBe("true");
    expect(errorOf(select(t("field.leadType")))).toContain("graphics2d.pass.lead_type");
  });

  test("the error goes away when the field is edited", async () => {
    server({ [`PATCH ${API}/objects/Facility/THBK`]: rejected("constraints.elevation_angle_min_deg", "ไม่ผ่าน") });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(input(t("field.min")).getAttribute("aria-invalid")).toBe("true"));
    await user.type(input(t("field.min")), "5");
    expect(input(t("field.min")).getAttribute("aria-invalid")).toBeNull();
  });

  test("a field that no page shows is reported under the pages, and the window stays open", async () => {
    server({ [`PATCH ${API}/objects/Facility/THBK`]: rejected("basic.norad", "NORAD แก้ไม่ได้") });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.ok")));
    expect((await screen.findByRole("alert")).textContent).toContain("NORAD แก้ไม่ได้");
    expect(closePanel).not.toHaveBeenCalled();
  });

  test("OK keeps the window open when the server refuses", async () => {
    server({ [`PATCH ${API}/objects/Facility/THBK`]: rejected("constraints.elevation_angle_min_deg", "ไม่ผ่าน") });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.ok")));
    await waitFor(() => expect(input(t("field.min")).getAttribute("aria-invalid")).toBe("true"));
    expect(closePanel).not.toHaveBeenCalled();
  });

  test("another kind of failure goes to the Message Viewer and the edits stay", async () => {
    server({ [`PATCH ${API}/objects/Facility/THBK`]: { status: 500, json: { code: "INTERNAL", text: "เขียนไฟล์ไม่ได้" } } });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(useMessages.getState().items.some((m) => m.code === "INTERNAL")).toBe(true));
    expect(input(t("field.min")).value).toBe("15");
    expect(screen.getByRole("alert").textContent).toContain("เขียนไฟล์ไม่ได้");
  });
});

// ---------- checks before sending ----------

describe("checks before Apply", () => {
  test("a number that is not a number sends nothing, and the field is marked in Thai", async () => {
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "abc");
    await user.click(button(t("dialog.apply")));
    expect(input(t("field.min")).getAttribute("aria-invalid")).toBe("true");
    expect(errorOf(input(t("field.min")))).toBe(msg("props.notNumber"));
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
  });

  test("a number outside the schema bounds is stopped and its page is selected", async () => {
    const f = server();
    await mountFacility();
    await type(t("field.latitude"), "95");
    await openPage("2D Graphics - Attributes");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(tab("Basic - Position").getAttribute("aria-selected")).toBe("true"));
    expect(errorOf(input(t("field.latitude")))).toBe(msg("props.rangeBetween", { min: -90, max: 90 }));
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
  });

  test("OK does not close when the check fails", async () => {
    server();
    await mountFacility();
    await type(t("field.latitude"), "95");
    await user.click(button(t("dialog.ok")));
    expect(closePanel).not.toHaveBeenCalled();
  });
});

// ---------- 412 ----------

describe("Apply on a stale ETag shows the conflict dialog and Reload refetches", () => {
  const stale: Handler = { status: 412, json: { code: "STALE_ETAG", text: "scenario ถูกแก้จากที่อื่น" } };

  test("a 412 opens one Reload / Cancel box, and Reload fetches the scenario and the pages again", async () => {
    const f = server({ [`PATCH ${API}/objects/Facility/THBK`]: stale });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 20 } }; // what the other tab saved
    await user.click(button(t("dialog.apply")));

    const dialog = await screen.findByRole("dialog", { name: msg("conflict.title") });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(dialog).getByText(msg("conflict.body"))).toBeDefined();
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual([t("dialog.reload"), t("dialog.cancel")]);
    expect(useScenario.getState().conflict).toBe(false); // the window owns this box, the app-level one stays shut

    const pageReads = f.calls.filter((c) => c.method === "GET" && c.path === `${API}/objects/Facility/THBK`).length;
    await user.click(within(dialog).getByRole("button", { name: t("dialog.reload") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.calls.filter((c) => c.method === "GET" && c.path === API)).toHaveLength(1);
    expect(f.calls.filter((c) => c.method === "GET" && c.path === `${API}/objects/Facility/THBK`)).toHaveLength(pageReads + 1);
    expect(input(t("field.min")).value).toBe("20"); // the server's value, not the 15 that was typed
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true);
    expect(useScenario.getState().etag).toBe('"e3"');
  });

  test("Cancel keeps the typed value and the window; Apply asks again without sending", async () => {
    const f = server({ [`PATCH ${API}/objects/Facility/THBK`]: stale });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.apply")));
    const dialog = await screen.findByRole("dialog", { name: msg("conflict.title") });
    await user.click(within(dialog).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(input(t("field.min")).value).toBe("15");
    expect(closePanel).not.toHaveBeenCalled();
    await user.click(button(t("dialog.apply")));
    expect(await screen.findByRole("dialog", { name: msg("conflict.title") })).toBeDefined();
    expect(patches(f, "Facility/THBK")).toHaveLength(1); // the second Apply sent nothing
  });

  test("the box starts on Cancel: a stray Enter keeps the typed value, and the focus goes back to Apply", async () => {
    const f = server({ [`PATCH ${API}/objects/Facility/THBK`]: stale });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.apply")));
    const dialog = await screen.findByRole("dialog", { name: msg("conflict.title") });
    const cancel = within(dialog).getByRole("button", { name: t("dialog.cancel") });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(input(t("field.min")).value).toBe("15");
    expect(f.calls.filter((c) => c.method === "GET" && c.path === API)).toHaveLength(0); // no Reload
    await waitFor(() => expect(document.activeElement).toBe(button(t("dialog.apply"))));
  });

  test("OK on a stale ETag does not close the window", async () => {
    server({ [`PATCH ${API}/objects/Facility/THBK`]: stale });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.ok")));
    await screen.findByRole("dialog", { name: msg("conflict.title") });
    expect(closePanel).not.toHaveBeenCalled();
  });

  test("a 412 is not reported to the Message Viewer", async () => {
    server({ [`PATCH ${API}/objects/Facility/THBK`]: stale });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.apply")));
    await screen.findByRole("dialog", { name: msg("conflict.title") });
    expect(useMessages.getState().items.some((m) => m.code === "STALE_ETAG")).toBe(false);
  });
});

// ---------- someone else changes the scenario while the window is open ----------

describe("a change from another tab", () => {
  const otherTab = (etag: string, doc: ScenarioDoc = makeScenarioDoc()) => act(() => useScenario.setState({ etag, doc }));

  test("a clean form takes the new values silently, with no dialog", async () => {
    server();
    await mountFacility();
    await openPage("Constraints - Active");
    await waitFor(() => expect(input(t("field.min")).value).toBe("10"));
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 20 } };
    otherTab('"e2"');
    await waitFor(() => expect(input(t("field.min")).value).toBe("20"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true);
    // the next Apply compares against the refreshed values
    await type(t("field.min"), "10");
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(false);
  });

  test("a dirty form whose object was changed elsewhere asks before Apply sends anything, and Reload shows the server value", async () => {
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 20 } };
    otherTab('"e2"');
    expect(await screen.findByText(msg("props.conflicted"))).toBeDefined();
    expect(input(t("field.min")).value).toBe("15"); // the edit is not thrown away behind the user's back

    await user.click(button(t("dialog.apply")));
    const dialog = await screen.findByRole("dialog", { name: msg("conflict.title") });
    expect(patches(f, "Facility/THBK")).toHaveLength(0); // nothing sent

    await user.click(within(dialog).getByRole("button", { name: t("dialog.reload") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(input(t("field.min")).value).toBe("20");
    expect(screen.queryByText(msg("props.conflicted"))).toBeNull();
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
  });

  test("Cancel in that box keeps the edit and the window stays conflicted", async () => {
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 20 } };
    otherTab('"e2"');
    await screen.findByText(msg("props.conflicted"));
    await user.click(button(t("dialog.apply")));
    const dialog = await screen.findByRole("dialog", { name: msg("conflict.title") });
    await user.click(within(dialog).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(input(t("field.min")).value).toBe("15");
    expect(screen.getByText(msg("props.conflicted"))).toBeDefined();
    expect(closePanel).not.toHaveBeenCalled();
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
  });

  test("a dirty form whose own object did not change just applies, with the newest ETag and no dialog", async () => {
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    otherTab('"e2"'); // another object changed: this object's pages are the same as before
    await waitFor(() => expect(f.calls.filter((c) => c.method === "GET" && c.path === `${API}/objects/Facility/THBK`)).toHaveLength(2));
    expect(screen.queryByText(msg("props.conflicted"))).toBeNull();
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 15 } }; // what the server holds once the PATCH is in
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    expect(patches(f, "Facility/THBK")[0].headers.get("If-Match")).toBe('"e2"');
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(input(t("field.min")).value).toBe("15");
  });

  test("the conflict note goes away when the other change turns out not to touch this object after all", async () => {
    server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 20 } };
    otherTab('"e2"');
    await screen.findByText(msg("props.conflicted"));
    pages = structuredClone(THBK_PAGES); // the other tab put it back
    otherTab('"e4"');
    await waitFor(() => expect(screen.queryByText(msg("props.conflicted"))).toBeNull());
  });

  test("a conflicted form whose edits are undone by hand takes the server's values instead of staying stale", async () => {
    server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 20 } };
    otherTab('"e2"');
    await screen.findByText(msg("props.conflicted"));
    await type(t("field.min"), "10"); // back to what the form was opened with: nothing of the user's is left to lose
    await waitFor(() => expect(input(t("field.min")).value).toBe("20"));
    expect(screen.queryByText(msg("props.conflicted"))).toBeNull();
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true);
  });

  test("the window's own Apply does not look like someone else's change", async () => {
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 15 } };
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    await waitFor(() => expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.queryByText(msg("props.conflicted"))).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ---------- the Scenario ----------

describe("Scenario pages", () => {
  const saved = (body: unknown, headers: Record<string, string> = {}): Reply => ({ json: body, headers: { ETag: '"e2"', ...headers } });
  const putBody = (f: ReturnType<typeof stubFetch>) => sent(f, "PUT", "")[0];

  test("Basic - Time shows Start, Stop, the Duration and the animation settings in the scenario's DateFormat", async () => {
    server();
    await mountScenario();
    expect(input(t("field.analysisStart")).value).toBe("12 Nov 2026 00:00:00.000 UTCG");
    expect(input(t("field.analysisStop")).value).toBe("13 Nov 2026 00:00:00.000 UTCG");
    expect(input(t("field.duration")).value).toBe(`86400.000 ${t("field.unit.sec")}`);
    expect(input(t("field.duration")).readOnly).toBe(true);
    expect(input(t("field.animationStartTime")).value).toBe("12 Nov 2026 00:00:00.000 UTCG");
    expect(input(t("anim.timeStep")).value).toBe("60");
    expect(input(t("anim.xRealTimeMultiplier")).value).toBe("60");
    expect(select(t("field.timeUpdateMode")).value).toBe("time_step");
    expect(select(t("field.animationCycle")).value).toBe("loop");
  });

  test("changing Stop sends the whole document with the new analysis_period.stop and reads X-Results-Stale", async () => {
    const doc = useScenario.getState().doc!;
    const f = server({ [`PUT ${API}`]: (call) => saved(call.body, { "X-Results-Stale": "true" }) });
    await mountScenario();
    await type(t("field.analysisStop"), "14 Nov 2026 00:00:00.000 UTCG");
    expect(input(t("field.duration")).value).toBe(`172800.000 ${t("field.unit.sec")}`);
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sent(f, "PUT", "")).toHaveLength(1));
    expect(putBody(f).body).toEqual({ ...doc, analysis_period: { ...doc.analysis_period, stop: "2026-11-14T00:00:00Z" } });
    expect(putBody(f).headers.get("If-Match")).toBe('"e1"');
    expect(sent(f, "PATCH", "")).toHaveLength(0);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true));
    expect(refresh).toHaveBeenCalledTimes(1); // putDoc refreshes after a stale PUT; the window does not ask again
  });

  test("a PUT whose results are not stale does not refresh them", async () => {
    const f = server({ [`PUT ${API}`]: (call) => saved(call.body, { "X-Results-Stale": "false" }) });
    await mountScenario();
    await openPage("Basic - Description");
    await user.type(input(t("field.shortDescription")), "งานทดสอบ");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sent(f, "PUT", "")).toHaveLength(1));
    expect((putBody(f).body as ScenarioDoc).description).toBe("งานทดสอบ");
    await waitFor(() => expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true));
    expect(refresh).not.toHaveBeenCalled();
  });

  test("Time Update Mode shows Time Step / Real Time / X Real-Time but sends the codes", async () => {
    const f = server({ [`PUT ${API}`]: (call) => saved(call.body) });
    await mountScenario();
    expect(optionTexts(select(t("field.timeUpdateMode")))).toEqual(["Time Step", "Real Time", "X Real-Time"]);
    expect(optionValues(select(t("field.timeUpdateMode")))).toEqual(["time_step", "real_time", "x_real_time"]);
    expect(optionTexts(select(t("field.animationCycle")))).toEqual(["Off", "Stop at Time", "Loop at Time"]);
    expect(optionValues(select(t("field.animationCycle")))).toEqual(["off", "stop", "loop"]);
    await user.selectOptions(select(t("field.timeUpdateMode")), "X Real-Time");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sent(f, "PUT", "")).toHaveLength(1));
    expect((putBody(f).body as ScenarioDoc).animation).toMatchObject({ update_mode: "x_real_time", cycle: "loop", time_step_s: 60 });
  });

  test("a Stop that is not after Start, or in the wrong format, sends nothing", async () => {
    const f = server();
    await mountScenario();
    await type(t("field.analysisStop"), "11 Nov 2026 00:00:00.000 UTCG");
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("field.analysisStop")))).toBe(msg("wizard.stopBeforeStart"));
    await type(t("field.analysisStop"), "2026-11-14");
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("field.analysisStop")))).toMatch(/12 Nov 2026|13 Nov 2026/);
    expect(input(t("field.analysisStop")).getAttribute("aria-invalid")).toBe("true");
    expect(sent(f, "PUT", "")).toHaveLength(0);
  });

  test("a LTZG offset the server would take but the UI cannot read is stopped before Apply", async () => {
    const f = server();
    await mountScenario();
    await openPage("Basic - Units");
    await type(t("field.ltzOffset"), "+24:00");
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("field.ltzOffset")))).toBe(msg("props.offsetInvalid"));
    expect(sent(f, "PUT", "")).toHaveLength(0);
  });

  test("a 422 from the engine for the period lands on Stop and selects Basic - Time", async () => {
    server({ [`PUT ${API}`]: { status: 422, json: { code: "SCENARIO_INVALID", text: "ช่วงเวลาวิเคราะห์ยาวเกินไป", field: "analysis_period" } } });
    await mountScenario();
    await type(t("field.analysisStop"), "14 Nov 2026 00:00:00.000 UTCG");
    await openPage("Basic - Ionosphere");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(tab("Basic - Time").getAttribute("aria-selected")).toBe("true"));
    expect(errorOf(input(t("field.analysisStop")))).toBe("ช่วงเวลาวิเคราะห์ยาวเกินไป");
  });

  test("a 412 on PUT opens the Reload / Cancel box, and Reload shows the document the server holds now", async () => {
    const newer = makeScenarioDoc({ description: "จากแท็บอื่น" });
    const f = server({
      [`PUT ${API}`]: { status: 412, json: { code: "STALE_ETAG", text: "scenario ถูกแก้จากที่อื่น" } },
      [`GET ${API}`]: () => ({ json: newer, headers: { ETag: '"e3"' } }),
    });
    await mountScenario();
    await openPage("Basic - Description");
    await user.type(input(t("field.shortDescription")), "ของฉัน");
    await user.click(button(t("dialog.apply")));
    const dialog = await screen.findByRole("dialog", { name: msg("conflict.title") });
    await user.click(within(dialog).getByRole("button", { name: t("dialog.reload") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.calls.filter((c) => c.method === "GET" && c.path === API)).toHaveLength(1);
    expect(input(t("field.shortDescription")).value).toBe("จากแท็บอื่น");
  });

  test("a clean Scenario form follows the document when another tab changes it", async () => {
    server();
    await mountScenario();
    await openPage("Basic - Description");
    const doc = useScenario.getState().doc!;
    act(() => useScenario.setState({ etag: '"e2"', doc: { ...doc, description: "จากแท็บอื่น" } }));
    await waitFor(() => expect(input(t("field.shortDescription")).value).toBe("จากแท็บอื่น"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a dirty Scenario form is not touched by a change elsewhere in the document, and applies on top of it", async () => {
    const f = server({ [`PUT ${API}`]: (call) => saved(call.body) });
    await mountScenario();
    await openPage("Basic - Description");
    await user.type(input(t("field.shortDescription")), "ของฉัน");
    const doc = useScenario.getState().doc!;
    act(() => useScenario.setState({ etag: '"e2"', doc: { ...doc, groups: [{ name: "Mine", members: [] }] } })); // a part the pages do not edit
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sent(f, "PUT", "")).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    const body = putBody(f).body as ScenarioDoc;
    expect(body.description).toBe("ของฉัน");
    expect(body.groups).toEqual([{ name: "Mine", members: [] }]); // the other tab's change is kept
  });

  test("a dirty Scenario form whose section changed elsewhere asks first", async () => {
    const f = server();
    await mountScenario();
    await openPage("Basic - Description");
    await user.type(input(t("field.shortDescription")), "ของฉัน");
    const doc = useScenario.getState().doc!;
    act(() => useScenario.setState({ etag: '"e2"', doc: { ...doc, description: "จากแท็บอื่น" } }));
    expect(await screen.findByText(msg("props.conflicted"))).toBeDefined();
    await user.click(button(t("dialog.apply")));
    expect(await screen.findByRole("dialog", { name: msg("conflict.title") })).toBeDefined();
    expect(sent(f, "PUT", "")).toHaveLength(0);
  });

  test("the window title stays '<name> Properties' for the Scenario and an object", () => {
    registerPropertiesBrowserPanel();
    const def = getPanelDef("propertiesBrowser")!;
    expect(def.title({ path: "*", name: "S1" })).toBe("S1 Properties");
    expect(def.title({ path: "*/Satellite/G01", name: "G01" })).toBe("G01 Properties");
    expect(def.component).toBe(PropertiesBrowser);
    expect(def.persist).toBe(false);
    expect(def.scenarioBound).toBe(true);
    expect(def.type).toBe("floating");
    expect(def.instanceKey?.({ path: "*" })).toBe("*");
  });
});

// ---------- the lists that follow ENUMS ----------

describe("choices follow the server enums", () => {
  test("Lead Type offers ENUMS.LeadType and Trail Type adds Same As Lead", async () => {
    pages = structuredClone(G01_PAGES);
    server();
    await mountSatellite();
    await openPage("2D Graphics - Pass");
    expect(optionValues(select(t("field.leadType")))).toEqual([...ENUMS.LeadType]);
    expect(optionTexts(select(t("field.leadType")))).toEqual(ENUMS.LeadType.map((c) => optionLabel("lead_type", c)));
    expect(optionValues(select(t("field.trailType")))).toEqual([...ENUMS.TrailType]);
    expect(optionTexts(select(t("field.trailType")))).toContain("Same As Lead");
    expect(optionTexts(select(t("field.leadType")))).not.toContain("Same As Lead");
  });
});

// ---------- Facility pages ----------

describe("Facility pages", () => {
  test("Basic - Position shows the Geodetic position, and an edited Latitude is sent as a number inside basic.position", async () => {
    const f = server();
    await mountFacility();
    expect(input(t("field.positionType")).value).toBe("Geodetic");
    expect(input(t("field.positionType")).readOnly).toBe(true);
    await type(t("field.latitude"), "14.5");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    expect(patches(f, "Facility/THBK")[0].body).toEqual({ basic: { position: { lat_deg: 14.5 } } });
  });

  test("edits survive a move to another page and back", async () => {
    server();
    await mountFacility();
    await type(t("field.latitude"), "14.5");
    await openPage("Basic - Description");
    await openPage("Basic - Position");
    expect(input(t("field.latitude")).value).toBe("14.5");
  });

  test("a half-typed number is kept as typed until Apply", async () => {
    server();
    await mountFacility();
    await type(t("field.longitude"), "-");
    expect(input(t("field.longitude")).value).toBe("-");
  });

  test("Basic - Description has a Short and a Long Description, the Long one sent as basic.long_description", async () => {
    const f = server();
    await mountFacility();
    await openPage("Basic - Description");
    expect(input(t("field.longDescription")).tagName).toBe("TEXTAREA");
    await user.type(input(t("field.longDescription")), "บรรทัดหนึ่ง{Enter}บรรทัดสอง");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    expect(patches(f, "Facility/THBK")[0].body).toEqual({ basic: { long_description: "บรรทัดหนึ่ง\nบรรทัดสอง" } });
  });

  test("2D Graphics - Attributes: Colour is a colour input, Marker Style follows ENUMS, Inherit from Scenario is a checkbox", async () => {
    const f = server();
    await mountFacility();
    await openPage("2D Graphics - Attributes");
    expect(input(t("field.color")).type).toBe("color");
    expect(input(t("field.color")).value).toBe("#ff79e6");
    expect(optionValues(select(t("field.markerStyle")))).toEqual(["", ...ENUMS.MarkerStyle]);
    expect(input(t("field.inheritFromScenario")).type).toBe("checkbox");
    expect(input(t("field.inheritFromScenario")).checked).toBe(true);
    expect(screen.queryByLabelText(t("field.lineStyle"))).toBeNull(); // a Facility has no line

    fireEvent.change(input(t("field.color")), { target: { value: "#00ff00" } });
    expect(input(t("field.inheritFromScenario")).checked).toBe(false); // picking a colour unticks it (no separate click needed any more)
    await user.selectOptions(select(t("field.markerStyle")), "Star");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    expect(patches(f, "Facility/THBK")[0].body).toEqual({ graphics2d: { color: "#00ff00", marker_style: "Star", inherit: false } });
  });
});

describe("Constraints - Active", () => {
  const list = () => within(screen.getByRole("listbox", { name: t("field.active") }));

  test("an Elevation Angle that is in use is listed, with its Min and Max", async () => {
    server();
    await mountFacility();
    await openPage("Constraints - Active");
    expect(list().getAllByRole("option").map((o) => o.textContent)).toEqual(["Elevation Angle"]);
    expect(input(t("field.min")).value).toBe("10");
    expect(input(t("field.max")).value).toBe("");
  });

  test("Remove sets Min to 0 and Max to nothing, and the item leaves the list", async () => {
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await user.click(button(t("dialog.remove")));
    expect(list().queryAllByRole("option")).toHaveLength(0);
    expect(screen.queryByLabelText(t("field.min"))).toBeNull();
    expect(screen.getByText(msg("props.noConstraints"))).toBeDefined();
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 0 } };
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    expect(patches(f, "Facility/THBK")[0].body).toEqual({ constraints: { elevation_angle_min_deg: 0 } });
    await waitFor(() => expect(list().queryAllByRole("option")).toHaveLength(0)); // still gone after the pages were read back
  });

  test("Remove on a constraint that has a Max sends the Max as null", async () => {
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 10, elevation_angle_max_deg: 60 } };
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    expect(input(t("field.max")).value).toBe("60");
    await user.click(button(t("dialog.remove")));
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    expect(patches(f, "Facility/THBK")[0].body).toEqual({ constraints: { elevation_angle_min_deg: 0, elevation_angle_max_deg: null } });
  });

  test("a Max that is only a Max still counts as in use, and clearing it sends null", async () => {
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 0, elevation_angle_max_deg: 60 } };
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    expect(list().getAllByRole("option")).toHaveLength(1);
    await type(t("field.max"), "");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    expect(patches(f, "Facility/THBK")[0].body).toEqual({ constraints: { elevation_angle_max_deg: null } });
  });

  test("with Min 0 and no Max the list is empty and Add... offers only Elevation Angle", async () => {
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 0 } };
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    expect(list().queryAllByRole("option")).toHaveLength(0);
    expect((button(t("dialog.remove")) as HTMLButtonElement).disabled).toBe(true);

    await user.click(button(t("dialog.add")));
    const dialog = await screen.findByRole("dialog", { name: t("field.selectConstraintsToAdd") });
    const choices = within(dialog).getByRole("listbox") as unknown as HTMLSelectElement;
    expect([...choices.options].map((o) => o.textContent)).toEqual(["Elevation Angle"]);
    expect((within(dialog).getByRole("button", { name: t("dialog.ok") }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(choices, "Elevation Angle");
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(list().getAllByRole("option").map((o) => o.textContent)).toEqual(["Elevation Angle"]);
    expect(input(t("field.min")).value).toBe("0");
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true); // adding to the list changes nothing on the server
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
  });

  test("Cancel in Select Constraints to Add adds nothing", async () => {
    pages = { ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: 0 } };
    server();
    await mountFacility();
    await openPage("Constraints - Active");
    await user.click(button(t("dialog.add")));
    const dialog = await screen.findByRole("dialog", { name: t("field.selectConstraintsToAdd") });
    await user.click(within(dialog).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(list().queryAllByRole("option")).toHaveLength(0);
  });

  test("Add... when Elevation Angle is already listed has nothing left to offer", async () => {
    server();
    await mountFacility();
    await openPage("Constraints - Active");
    await user.click(button(t("dialog.add")));
    const dialog = await screen.findByRole("dialog", { name: t("field.selectConstraintsToAdd") });
    expect(within(dialog).getByText(msg("props.noAvailable"))).toBeDefined();
    expect((within(dialog).getByRole("button", { name: t("dialog.ok") }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// ---------- Satellite pages ----------

describe("Satellite pages", () => {
  beforeEach(() => {
    pages = structuredClone(G01_PAGES);
  });

  test("Basic - Orbit is read-only: SGP4, the snapshot, the NORAD number, the epoch in the DateFormat and the age of the data", async () => {
    server();
    await mountSatellite();
    expect(input(t("field.propagator")).value).toBe("SGP4");
    expect(input(t("field.tleSource")).value).toBe("snap");
    expect(input(t("field.sscNumber")).value).toBe("40101");
    expect(input(t("field.epoch")).value).toBe("11 Nov 2026 00:00:00.000 UTCG");
    expect(input(t("field.dataAge")).value).toBe(`1.26 ${t("field.unit.days")}`);
    for (const label of ["field.propagator", "field.tleSource", "field.sscNumber", "field.epoch", "field.dataAge"] as const) {
      expect(input(t(label)).readOnly, label).toBe(true);
    }
    expect(screen.getByText(msg("note.readOnly"))).toBeDefined();
  });

  test("Basic - Orbit shows the epoch in LTZG when the scenario uses it", async () => {
    loadObjects({ doc: makeScenarioDoc({ units: { date_format: "LTZG", ltz_offset: "+07:00" } }) });
    server();
    await mountSatellite();
    expect(input(t("field.epoch")).value).toBe("11 Nov 2026 07:00:00.000 LTZG+07:00");
  });

  test("a satellite that the catalog does not know shows dashes and says why", async () => {
    pages.basic = { description: "", long_description: "", norad: 99999 };
    server();
    await mountSatellite();
    expect(input(t("field.epoch")).value).toBe("—");
    expect(input(t("field.sscNumber")).value).toBe("99999");
    expect(screen.getByText(msg("props.noCatalog"))).toBeDefined();
  });

  test("Basic - Description lists PRN, SVN, NORAD, Block and the CelesTrak name, read-only, and says there are no flags", async () => {
    server();
    await mountSatellite();
    await openPage("Basic - Description");
    expect(input(t("field.prn")).value).toBe("G01");
    expect(input(t("field.svn")).value).toBe("G61");
    expect(input(t("field.norad")).value).toBe("40101");
    expect(input(t("field.block")).value).toBe("IIF");
    expect(input(t("field.celestrakName")).value).toBe("GPS BIIF-1  (PRN 1)");
    for (const label of ["field.prn", "field.svn", "field.norad", "field.block", "field.celestrakName"] as const) expect(input(t(label)).readOnly, label).toBe(true);
    expect(screen.getByText(msg("props.noFlags"))).toBeDefined();
    expect(input(t("field.shortDescription")).readOnly).toBe(false);
  });

  test("the flags are listed with their Thai explanations", async () => {
    pages.basic = { description: "", long_description: "", norad: 40104 }; // G04 is flagged stale
    server();
    await mountSatellite();
    await openPage("Basic - Description");
    expect(input(t("field.prn")).value).toBe("G04");
    const flags = within(screen.getByRole("group", { name: t("field.flags") })).getAllByRole("listitem");
    expect(flags.map((li) => li.textContent)).toEqual([`${t("option.flag.stale")}: ${msg("flag.stale")}`]);
  });

  test("Short and Long Description are sent as basic.description and basic.long_description", async () => {
    const f = server();
    await mountSatellite();
    await openPage("Basic - Description");
    await user.type(input(t("field.shortDescription")), "ดาวทดสอบ");
    await user.type(input(t("field.longDescription")), "ยาว");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Satellite/G01")).toHaveLength(1));
    expect(patches(f, "Satellite/G01")[0].body).toEqual({ basic: { description: "ดาวทดสอบ", long_description: "ยาว" } });
  });

  test("2D Graphics - Attributes: Colour, Line Style, Line Width, Marker Style and Inherit from Scenario", async () => {
    const f = server();
    await mountSatellite();
    await openPage("2D Graphics - Attributes");
    expect(input(t("field.color")).type).toBe("color");
    expect(optionValues(select(t("field.lineStyle")))).toEqual(["", ...ENUMS.LineStyle]);
    expect(optionValues(select(t("field.markerStyle")))).toEqual(["", ...ENUMS.MarkerStyle]);
    expect(input(t("field.lineWidth")).value).toBe("1");
    await type(t("field.lineWidth"), "2.5");
    await user.selectOptions(select(t("field.lineStyle")), "Dashed");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Satellite/G01")).toHaveLength(1));
    expect(patches(f, "Satellite/G01")[0].body).toEqual({ graphics2d: { line_style: "Dashed", line_width: 2.5 } });
  });

  test("Line Width must be greater than 0", async () => {
    const f = server();
    await mountSatellite();
    await openPage("2D Graphics - Attributes");
    await type(t("field.lineWidth"), "0");
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("field.lineWidth")))).toBe(msg("props.rangeGreater", { min: 0 }));
    expect(patches(f, "Satellite/G01")).toHaveLength(0);
  });

  test("a colour can be cleared back to the default", async () => {
    const f = server();
    await mountSatellite();
    await openPage("2D Graphics - Attributes");
    await user.click(button(t("dialog.clear")));
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Satellite/G01")).toHaveLength(1));
    expect(patches(f, "Satellite/G01")[0].body).toEqual({ graphics2d: { color: null } });
  });

  describe("2D Graphics - Pass", () => {
    test("Time and Percent show a value input and the other types show none", async () => {
      server();
      await mountSatellite();
      await openPage("2D Graphics - Pass");
      expect(input(t("field.leadTime")).value).toBe("600");
      expect(screen.queryByLabelText(t("field.leadPercent"))).toBeNull();
      await user.selectOptions(select(t("field.leadType")), "Percent");
      expect(screen.queryByLabelText(t("field.leadTime"))).toBeNull();
      expect(input(t("field.leadPercent")).value).toBe("");
      for (const other of ["Quarter", "Half", "Full", "All", "None", "One Pass", "Current Interval"]) {
        await user.selectOptions(select(t("field.leadType")), other);
        expect(screen.queryByLabelText(t("field.leadTime")), other).toBeNull();
        expect(screen.queryByLabelText(t("field.leadPercent")), other).toBeNull();
      }
    });

    test("Trail Type Same As Lead shows no value input; Time and Percent do", async () => {
      server();
      await mountSatellite();
      await openPage("2D Graphics - Pass");
      expect(select(t("field.trailType")).value).toBe("Same As Lead");
      expect(screen.queryByLabelText(t("field.trailTime"))).toBeNull();
      await user.selectOptions(select(t("field.trailType")), "Time");
      expect(input(t("field.trailTime"))).toBeDefined();
      await user.selectOptions(select(t("field.trailType")), "Percent");
      expect(input(t("field.trailPercent"))).toBeDefined();
      expect(screen.queryByLabelText(t("field.trailTime"))).toBeNull();
    });

    test("Visible Sides and the pass/path labels can be set; the page says that v1 draws Both and no pass/path labels yet", async () => {
      const f = server();
      await mountSatellite();
      await openPage("2D Graphics - Pass");
      expect(optionValues(select(t("field.visibleSides")))).toEqual([...ENUMS.VisibleSides]);
      expect(screen.getByText(msg("note.visibleSidesBoth"))).toBeDefined();
      expect(screen.getByText(msg("note.passLabelsStored"))).toBeDefined();
      await user.selectOptions(select(t("field.visibleSides")), "Ascending");
      await user.click(input(t("field.showPassLabels")));
      await user.click(input(t("field.showPathLabels")));
      await user.click(button(t("dialog.apply")));
      await waitFor(() => expect(patches(f, "Satellite/G01")).toHaveLength(1));
      expect(patches(f, "Satellite/G01")[0].body).toEqual({
        graphics2d: { pass: { visible_sides: "Ascending", show_pass_labels: true, show_path_labels: true } },
      });
    });

    test("Percent is sent as lead_percent, and only the pass fields that changed", async () => {
      const f = server();
      await mountSatellite();
      await openPage("2D Graphics - Pass");
      await user.selectOptions(select(t("field.leadType")), "Percent");
      await type(t("field.leadPercent"), "50");
      await user.click(button(t("dialog.apply")));
      await waitFor(() => expect(patches(f, "Satellite/G01")).toHaveLength(1));
      expect(patches(f, "Satellite/G01")[0].body).toEqual({ graphics2d: { pass: { lead_type: "Percent", lead_percent: 50 } } });
    });

    test("a Percent over 100 is stopped", async () => {
      const f = server();
      await mountSatellite();
      await openPage("2D Graphics - Pass");
      await user.selectOptions(select(t("field.leadType")), "Percent");
      await type(t("field.leadPercent"), "101");
      await user.click(button(t("dialog.apply")));
      expect(errorOf(input(t("field.leadPercent")))).toBe(msg("props.rangeBetween", { min: 0, max: 100 }));
      expect(patches(f, "Satellite/G01")).toHaveLength(0);
    });

    test("a wrong value stays visible even after the type is switched away from it", async () => {
      server();
      await mountSatellite();
      await openPage("2D Graphics - Pass");
      await type(t("field.leadTime"), "-5");
      await user.selectOptions(select(t("field.leadType")), "Quarter");
      await user.click(button(t("dialog.apply")));
      expect(errorOf(input(t("field.leadTime")))).toBe(msg("props.rangeAtLeast", { min: 0 }));
    });
  });

  test("2D Graphics - Swath: Swath Type has only Ground Elevation; the elevation and Options are sent", async () => {
    const f = server();
    await mountSatellite();
    await openPage("2D Graphics - Swath");
    expect(optionTexts(select(t("field.swathType")))).toEqual(["Ground Elevation"]);
    expect(input(t("field.groundElevation")).value).toBe("10");
    expect(optionValues(select(t("field.swathOptions")))).toEqual([...ENUMS.SwathOptions]);
    await type(t("field.groundElevation"), "15");
    await user.selectOptions(select(t("field.swathOptions")), "Edge Limits");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Satellite/G01")).toHaveLength(1));
    expect(patches(f, "Satellite/G01")[0].body).toEqual({ graphics2d: { swath: { elevation_deg: 15, options: "Edge Limits" } } });
  });

  test("a swath elevation above 90 is stopped", async () => {
    server();
    await mountSatellite();
    await openPage("2D Graphics - Swath");
    await type(t("field.groundElevation"), "91");
    await user.click(button(t("dialog.apply")));
    expect(input(t("field.groundElevation")).getAttribute("aria-invalid")).toBe("true");
  });

  test("3D Graphics - Orbit System offers Fixed by Window and Inertial by Window", async () => {
    const f = server();
    await mountSatellite();
    await openPage("3D Graphics - Orbit System");
    expect(optionTexts(select(t("field.orbitSystem")))).toEqual(["Fixed by Window", "Inertial by Window"]);
    expect(select(t("field.orbitSystem")).value).toBe("Fixed by Window");
    await user.selectOptions(select(t("field.orbitSystem")), "Inertial by Window");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Satellite/G01")).toHaveLength(1));
    expect(patches(f, "Satellite/G01")[0].body).toEqual({ graphics3d: { orbit_system: "Inertial by Window" } });
  });

  test("a satellite whose pass and swath the server has not stored yet shows the defaults and can be edited", async () => {
    pages = { basic: { description: "", long_description: "", norad: 40101 }, graphics2d: { show: true, color: "#ffd23f" }, graphics3d: { show: true }, constraints: {} };
    const f = server();
    await mountSatellite();
    await openPage("2D Graphics - Pass");
    expect(select(t("field.leadType")).value).toBe("Time");
    await openPage("2D Graphics - Swath");
    expect(input(t("field.groundElevation")).value).toBe("10");
    expect(select(t("field.swathOptions")).value).toBe("No Graphics");
    await user.selectOptions(select(t("field.swathOptions")), "Filled Limits");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Satellite/G01")).toHaveLength(1));
    expect(patches(f, "Satellite/G01")[0].body).toEqual({ graphics2d: { swath: { options: "Filled Limits" } } });
  });
});

// ---------- Constellation pages ----------

describe("Constellation pages", () => {
  beforeEach(() => {
    pages = structuredClone(GPS_PAGES);
  });
  const available = () => select(t("field.availableObjects"));
  const assigned = () => select(t("field.assignedObjects"));
  const names = (el: HTMLSelectElement) => [...el.options].map((o) => o.textContent);
  const arrow = (key: "dialog.assign" | "dialog.unassign" | "dialog.assignAll" | "dialog.unassignAll") => button(t(key));

  test("Available Objects holds the scenario's satellites that are not assigned yet", async () => {
    server();
    await mountConstellation();
    expect(names(assigned())).toEqual(["G01", "G02"]);
    expect(names(available())).toEqual(["G03", "G04", "G05"]);
    expect(available().multiple).toBe(true);
  });

  test("the Selection Filter narrows Available Objects by name, ignoring case", async () => {
    server();
    await mountConstellation();
    await user.type(screen.getByLabelText(t("field.selectionFilter")), "g0");
    expect(names(available())).toEqual(["G03", "G04", "G05"]);
    await user.type(screen.getByLabelText(t("field.selectionFilter")), "4");
    expect(names(available())).toEqual(["G04"]);
    await user.clear(screen.getByLabelText(t("field.selectionFilter")));
    expect(names(available())).toEqual(["G03", "G04", "G05"]);
  });

  test("moving G01 to Assigned sends it in basic.assigned_objects", async () => {
    pages.basic = { ...(pages.basic as object), assigned_objects: [] };
    const f = server();
    await mountConstellation();
    expect(names(available())).toContain("G01");
    await user.selectOptions(available(), "G01");
    await user.click(arrow("dialog.assign"));
    expect(names(assigned())).toEqual(["G01"]);
    expect(names(available())).not.toContain("G01");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Constellation/GPS")).toHaveLength(1));
    expect((patches(f, "Constellation/GPS")[0].body as { basic: { assigned_objects: string[] } }).basic.assigned_objects).toContain("*/Satellite/G01");
    expect(patches(f, "Constellation/GPS")[0].body).toEqual({ basic: { assigned_objects: ["*/Satellite/G01"] } });
  });

  test("the assigned order follows the user's moves", async () => {
    const f = server();
    await mountConstellation();
    await user.selectOptions(available(), "G05");
    await user.click(arrow("dialog.assign"));
    await user.selectOptions(available(), "G03");
    await user.click(arrow("dialog.assign"));
    expect(names(assigned())).toEqual(["G01", "G02", "G05", "G03"]);
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Constellation/GPS")).toHaveLength(1));
    expect(patches(f, "Constellation/GPS")[0].body).toEqual({
      basic: { assigned_objects: ["*/Satellite/G01", "*/Satellite/G02", "*/Satellite/G05", "*/Satellite/G03"] },
    });
  });

  test("several selected objects move together, and ← moves one back", async () => {
    server();
    await mountConstellation();
    await user.selectOptions(available(), ["G03", "G04"]);
    await user.click(arrow("dialog.assign"));
    expect(names(assigned())).toEqual(["G01", "G02", "G03", "G04"]);
    await user.selectOptions(assigned(), "G02");
    await user.click(arrow("dialog.unassign"));
    expect(names(assigned())).toEqual(["G01", "G03", "G04"]);
    expect(names(available())).toEqual(["G02", "G05"]);
  });

  test("⇒ moves all the available objects that the filter shows, ⇐ moves every assigned object back", async () => {
    server();
    await mountConstellation();
    await user.type(screen.getByLabelText(t("field.selectionFilter")), "G0");
    await user.click(arrow("dialog.assignAll"));
    expect(names(assigned())).toEqual(["G01", "G02", "G03", "G04", "G05"]);
    expect(names(available())).toEqual([]);
    await user.click(arrow("dialog.unassignAll"));
    expect(names(assigned())).toEqual([]);
    expect(names(available())).toEqual(["G01", "G02", "G03", "G04", "G05"]);
  });

  test("the arrows are off when there is nothing to move", async () => {
    server();
    await mountConstellation();
    expect((arrow("dialog.assign") as HTMLButtonElement).disabled).toBe(true);
    expect((arrow("dialog.unassign") as HTMLButtonElement).disabled).toBe(true);
    expect((arrow("dialog.assignAll") as HTMLButtonElement).disabled).toBe(false);
    await user.click(arrow("dialog.assignAll"));
    expect((arrow("dialog.assignAll") as HTMLButtonElement).disabled).toBe(true);
  });

  test("a member list the server refuses is reported at the Assigned Objects list", async () => {
    server({ [`PATCH ${API}/objects/Constellation/GPS`]: { status: 422, json: { code: "SCENARIO_INVALID", text: "ไม่พบ object */Satellite/G09 ใน scenario", field: "basic.assigned_objects" } } });
    await mountConstellation();
    await user.selectOptions(available(), "G03");
    await user.click(arrow("dialog.assign"));
    await user.click(button(t("dialog.apply")));
    expect((await screen.findByRole("alert")).textContent).toContain("G09");
    expect(assigned().getAttribute("aria-invalid")).toBe("true");
  });

  test("Basic - Description has the descriptions and the member colour, which can be cleared", async () => {
    const f = server();
    await mountConstellation();
    await openPage("Basic - Description");
    expect(input(t("field.shortDescription")).value).toBe("");
    expect(input(t("field.memberColors")).type).toBe("color");
    expect(input(t("field.memberColors")).value).toBe("#ffd23f");
    fireEvent.change(input(t("field.memberColors")), { target: { value: "#010203" } });
    await user.type(input(t("field.shortDescription")), "GPS");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Constellation/GPS")).toHaveLength(1));
    expect(patches(f, "Constellation/GPS")[0].body).toEqual({ basic: { description: "GPS", color: "#010203" } });
  });

  test("clearing the member colour sends null", async () => {
    const f = server();
    await mountConstellation();
    await openPage("Basic - Description");
    await user.click(button(t("dialog.clear")));
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Constellation/GPS")).toHaveLength(1));
    expect(patches(f, "Constellation/GPS")[0].body).toEqual({ basic: { color: null } });
  });
});

// ---------- more Scenario pages ----------

describe("more Scenario pages", () => {
  const saved = (call: Call): Reply => ({ json: call.body, headers: { ETag: '"e2"' } });
  const putBody = (f: ReturnType<typeof stubFetch>) => sent(f, "PUT", "")[0].body as ScenarioDoc;

  test("Basic - Units: DateFormat offers UTCG and LTZG, Distance and Angle are read-only", async () => {
    const f = server({ [`PUT ${API}`]: saved });
    await mountScenario();
    await openPage("Basic - Units");
    expect(optionValues(select(t("field.dateFormat")))).toEqual(["UTCG", "LTZG"]);
    expect(select(t("field.dateFormat")).value).toBe("UTCG");
    expect(input(t("field.ltzOffset")).value).toBe("+07:00");
    expect(input(t("field.distance")).value).toBe("Kilometers");
    expect(input(t("field.distance")).readOnly).toBe(true);
    expect(input(t("field.angle")).value).toBe("Degrees");
    expect(input(t("field.angle")).readOnly).toBe(true);
    await user.selectOptions(select(t("field.dateFormat")), "LTZG");
    await type(t("field.ltzOffset"), "+09:30");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sent(f, "PUT", "")).toHaveLength(1));
    expect(putBody(f).units).toMatchObject({ date_format: "LTZG", ltz_offset: "+09:30" });
  });

  test("after the DateFormat is applied the times are shown in it", async () => {
    server({ [`PUT ${API}`]: saved });
    await mountScenario();
    await openPage("Basic - Units");
    await user.selectOptions(select(t("field.dateFormat")), "LTZG");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true));
    await openPage("Basic - Time");
    expect(input(t("field.analysisStart")).value).toBe("12 Nov 2026 07:00:00.000 LTZG+07:00");
  });

  test("with LTZG, a typed time is read in the offset and sent as UTC", async () => {
    loadObjects({ doc: makeScenarioDoc({ units: { date_format: "LTZG", ltz_offset: "+07:00" } }) });
    const f = server({ [`PUT ${API}`]: saved });
    await mountScenario();
    expect(input(t("field.analysisStop")).value).toBe("13 Nov 2026 07:00:00.000 LTZG+07:00");
    await type(t("field.analysisStop"), "14 Nov 2026 07:00:00.000 LTZG+07:00");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sent(f, "PUT", "")).toHaveLength(1));
    expect(putBody(f).analysis_period.stop).toBe("2026-11-14T00:00:00Z");
  });

  test("Time Step and X Real Time Multiplier are numbers greater than 0", async () => {
    const f = server();
    await mountScenario();
    await type(t("anim.timeStep"), "0");
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("anim.timeStep")))).toBe(msg("props.rangeGreater", { min: 0 }));
    await type(t("anim.timeStep"), "30");
    await type(t("anim.xRealTimeMultiplier"), "-1");
    await user.click(button(t("dialog.apply")));
    expect(input(t("anim.timeStep")).getAttribute("aria-invalid")).toBeNull();
    expect(input(t("anim.xRealTimeMultiplier")).getAttribute("aria-invalid")).toBe("true");
    expect(sent(f, "PUT", "")).toHaveLength(0);
  });

  test("Basic - Description, Basic - Ionosphere and 2D Graphics - Global Attributes change only their own sections", async () => {
    const f = server({ [`PUT ${API}`]: saved });
    await mountScenario();
    await openPage("Basic - Description");
    await user.type(input(t("field.longDescription")), "รายละเอียดยาว");
    await openPage("Basic - Ionosphere");
    await type(t("field.shellHeight"), "450");
    await openPage("2D Graphics - Global Attributes");
    await user.click(input(t("field.showLabels")));
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sent(f, "PUT", "")).toHaveLength(1));
    const doc = useScenario.getState().doc!;
    expect(putBody(f)).toEqual({ ...doc, long_description: "รายละเอียดยาว", ionosphere: { shell_km: 450 }, graphics2d_global: { show_labels: false } });
  });

  test("an Apply that changes nothing on the server does not send anything (the typed text parses to the same value)", async () => {
    const f = server();
    await mountScenario();
    await type(t("anim.timeStep"), "60.0");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true));
    expect(sent(f, "PUT", "")).toHaveLength(0);
    expect(input(t("anim.timeStep")).value).toBe("60");
  });
});

// ---------- odds and ends ----------

describe("odds and ends", () => {
  test("a path that is no object of this app is said so instead of crashing", () => {
    server();
    render(<PropertiesBrowser params={{ path: "*/Spaceship/X", name: "X" }} panelId="propertiesBrowser" />);
    expect(screen.getByRole("alert").textContent).toBe(msg("props.unknownObject", { path: "*/Spaceship/X" }));
  });

  test("an object that was deleted while the window is open says so, and Apply is off", async () => {
    server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    server({ [`GET ${API}/objects/Facility/THBK`]: { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ object */Facility/THBK" } } });
    act(() => useScenario.setState({ etag: '"e2"' }));
    expect(await screen.findByText(/ไม่พบ object \*\/Facility\/THBK/)).toBeDefined();
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true);
  });

  test("while the request is in flight the page is locked and the buttons are off", async () => {
    let release: (r: Reply) => void = () => undefined;
    const gate = new Promise<Reply>((resolve) => (release = resolve));
    server({ [`PATCH ${API}/objects/Facility/THBK`]: () => gate });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(input(t("field.min")).matches(":disabled")).toBe(true));
    expect((button(t("dialog.ok")) as HTMLButtonElement).disabled).toBe(true);
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true);
    release(PATCH_OK as Reply);
    await waitFor(() => expect(input(t("field.min")).matches(":disabled")).toBe(false));
  });

  test("each window works on its own object: two windows, two sets of edits", async () => {
    pages = structuredClone(THBK_PAGES);
    const f = server();
    render(
      <>
        <div data-testid="a"><PropertiesBrowser params={{ path: "*/Facility/THBK", name: "THBK" }} panelId="a" /></div>
        <div data-testid="b"><PropertiesBrowser params={{ path: "*/Facility/THBK", name: "THBK" }} panelId="b" /></div>
      </>,
    );
    await waitFor(() => expect(screen.queryAllByText(msg("props.loading"))).toHaveLength(0));
    expect(f.calls.filter((c) => c.method === "GET" && c.path === `${API}/objects/Facility/THBK`)).toHaveLength(2);
  });

  test("the window is registered over the placeholder and keeps the title and placement that layout/panels.ts gave it", () => {
    registerPropertiesBrowserPanel();
    registerPropertiesBrowserPanel(); // registering twice is harmless
    expect(getPanelDef("propertiesBrowser")?.component).toBe(PropertiesBrowser);
  });
});

// ---------- fix round 1 ----------

const pagesWithMin = (min: number, over: Record<string, unknown> = {}) => ({ ...structuredClone(THBK_PAGES), constraints: { elevation_angle_min_deg: min }, ...over });
const fromOtherTab = (etag: string) => act(() => useScenario.setState({ etag, doc: makeScenarioDoc() }));
const pageReads = (f: ReturnType<typeof stubFetch>, obj: string) => f.calls.filter((c) => c.method === "GET" && c.path === `${API}/objects/${obj}`).length;
const reloadButton = () => screen.getByRole("button", { name: t("dialog.reload") }) as HTMLButtonElement;
const reloadFinished = () => waitFor(() => expect(reloadButton().disabled).toBe(false));

describe("a Reload that did not bring fresh data", () => {
  const unreadable: Reply = { status: 500, json: { code: "INTERNAL", text: "อ่าน scenario ไม่ได้" } };

  test("object window, scenario unreadable: the box stays, the edit stays, nothing is sent; a retry then works", async () => {
    let scenarioReads = 0;
    const f = server({ [`GET ${API}`]: () => (++scenarioReads === 1 ? unreadable : { json: makeScenarioDoc(), headers: { ETag: '"e3"' } }) });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    pages = pagesWithMin(20);
    fromOtherTab('"e2"');
    await screen.findByText(msg("props.conflicted"));
    await user.click(button(t("dialog.apply")));
    await screen.findByRole("dialog", { name: msg("conflict.title") });
    const reads = pageReads(f, "Facility/THBK");

    await user.click(reloadButton());
    await waitFor(() => expect(useMessages.getState().items.some((m) => m.code === "INTERNAL")).toBe(true));
    await reloadFinished();
    expect(screen.getByRole("dialog", { name: msg("conflict.title") })).toBeDefined(); // the box is still there to try again
    expect(input(t("field.min")).value).toBe("15"); // the edit is not thrown away
    expect(screen.getByText(msg("props.conflicted"))).toBeDefined();
    expect(pageReads(f, "Facility/THBK")).toBe(reads); // nothing was adopted from a half-done reload
    expect(patches(f, "Facility/THBK")).toHaveLength(0);

    await user.click(reloadButton());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(input(t("field.min")).value).toBe("20");
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
  });

  test("object window, the scenario came but the pages did not: the box stays and the edit stays", async () => {
    let reads = 0;
    const f = server({
      [`PATCH ${API}/objects/Facility/THBK`]: { status: 412, json: { code: "STALE_ETAG", text: "scenario ถูกแก้จากที่อื่น" } },
      [`GET ${API}/objects/Facility/THBK`]: () => (++reads === 2 ? unreadable : { json: pages, headers: { ETag: '"e1"' } }),
    });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    await user.click(button(t("dialog.apply")));
    await screen.findByRole("dialog", { name: msg("conflict.title") });
    pages = pagesWithMin(20);
    await user.click(reloadButton());
    await waitFor(() => expect(reads).toBe(2));
    await reloadFinished();
    expect(screen.getByRole("dialog", { name: msg("conflict.title") })).toBeDefined();
    expect(input(t("field.min")).value).toBe("15");
    expect(patches(f, "Facility/THBK")).toHaveLength(1); // only the original PATCH that got the 412
    await user.click(reloadButton());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(input(t("field.min")).value).toBe("20");
  });

  test("Scenario window, scenario unreadable: the box stays, the edit stays, no second PUT; a retry shows the newer document", async () => {
    let scenarioReads = 0;
    const newer = makeScenarioDoc({ description: "จากแท็บอื่น" });
    const f = server({
      [`PUT ${API}`]: { status: 412, json: { code: "STALE_ETAG", text: "scenario ถูกแก้จากที่อื่น" } },
      [`GET ${API}`]: () => (++scenarioReads === 1 ? unreadable : { json: newer, headers: { ETag: '"e3"' } }),
    });
    await mountScenario();
    await openPage("Basic - Description");
    await user.type(input(t("field.shortDescription")), "ของฉัน");
    await user.click(button(t("dialog.apply")));
    await screen.findByRole("dialog", { name: msg("conflict.title") });

    await user.click(reloadButton());
    await waitFor(() => expect(useMessages.getState().items.some((m) => m.code === "INTERNAL")).toBe(true));
    await reloadFinished();
    expect(screen.getByRole("dialog", { name: msg("conflict.title") })).toBeDefined();
    expect(input(t("field.shortDescription")).value).toBe("ของฉัน"); // not replaced by the old document
    expect(sent(f, "PUT", "")).toHaveLength(1);

    await user.click(reloadButton());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(input(t("field.shortDescription")).value).toBe("จากแท็บอื่น");
    expect(sent(f, "PUT", "")).toHaveLength(1);
  });
});

describe("Apply and a check of the server that is still on its way", () => {
  /** the Nth read of the pages (1 = the first load) waits for the test */
  function gatedPages(n: number) {
    const gate = deferred<Reply>();
    let reads = 0;
    const handler = (): Reply | Promise<Reply> => (++reads === n ? gate.promise : { json: pages, headers: { ETag: '"e1"' } });
    return { gate, handler, reads: () => reads };
  }

  test("an external change followed by Apply before the check returns: the check decides, and a changed object gives the dialog and no PATCH", async () => {
    const g = gatedPages(2);
    const f = server({ [`GET ${API}/objects/Facility/THBK`]: g.handler });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    fromOtherTab('"e2"');
    await waitFor(() => expect(g.reads()).toBe(2)); // the check is out
    await user.click(button(t("dialog.apply")));
    expect(patches(f, "Facility/THBK")).toHaveLength(0); // waiting for the check, not sending
    expect(screen.queryByRole("dialog")).toBeNull();

    g.gate.resolve({ json: pagesWithMin(20), headers: { ETag: '"e2"' } });
    expect(await screen.findByRole("dialog", { name: msg("conflict.title") })).toBeDefined();
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
  });

  test("when the check finds the object unchanged, the waiting Apply goes ahead with the newest ETag", async () => {
    const g = gatedPages(2);
    const f = server({ [`GET ${API}/objects/Facility/THBK`]: g.handler });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    fromOtherTab('"e2"');
    await waitFor(() => expect(g.reads()).toBe(2));
    await user.click(button(t("dialog.apply")));
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
    g.gate.resolve({ json: pages, headers: { ETag: '"e2"' } });
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    expect(patches(f, "Facility/THBK")[0].headers.get("If-Match")).toBe('"e2"');
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("OK waits for the check too, and does not close the window when the object changed", async () => {
    const g = gatedPages(2);
    const f = server({ [`GET ${API}/objects/Facility/THBK`]: g.handler });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    fromOtherTab('"e2"');
    await waitFor(() => expect(g.reads()).toBe(2));
    await user.click(button(t("dialog.ok")));
    g.gate.resolve({ json: pagesWithMin(20), headers: { ETag: '"e2"' } });
    await screen.findByRole("dialog", { name: msg("conflict.title") });
    expect(closePanel).not.toHaveBeenCalled();
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
  });

  test("a burst of changes: an older check that answers late does not override the newest one", async () => {
    let reads = 0;
    const older = deferred<Reply>();
    const newest = deferred<Reply>();
    const f = server({
      [`GET ${API}/objects/Facility/THBK`]: () => {
        reads++;
        return reads === 2 ? older.promise : reads === 3 ? newest.promise : { json: pages, headers: { ETag: '"e1"' } };
      },
    });
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "15");
    fromOtherTab('"e2"');
    await waitFor(() => expect(reads).toBe(2));
    fromOtherTab('"e3"');
    await waitFor(() => expect(reads).toBe(3));
    const signals = f.fn.mock.calls.filter(([url]) => String(url).endsWith("/objects/Facility/THBK")).map(([, init]) => (init as RequestInit).signal);
    expect(signals.map((signal) => signal?.aborted)).toEqual([false, true, false]); // the older check was cancelled when the newer one started
    newest.resolve({ json: pages, headers: { ETag: '"e3"' } }); // the newest says: unchanged
    older.resolve({ json: pagesWithMin(20), headers: { ETag: '"e2"' } }); // the older said: changed, but it is out of date
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(msg("props.conflicted"))).toBeNull();
    expect(input(t("field.min")).value).toBe("15");
  });
});

describe("a row the user added to the Active list", () => {
  const list = () => within(screen.getByRole("listbox", { name: t("field.active") }));
  const addElevation = async () => {
    await user.click(button(t("dialog.add")));
    const dialog = await screen.findByRole("dialog", { name: t("field.selectConstraintsToAdd") });
    await user.selectOptions(within(dialog).getByRole("listbox") as unknown as HTMLSelectElement, "Elevation Angle");
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  };

  test("stays after the form silently takes new values from the server", async () => {
    pages = pagesWithMin(0);
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await addElevation();
    expect(list().getAllByRole("option")).toHaveLength(1);
    pages = pagesWithMin(0, { basic: { description: "จากแท็บอื่น", long_description: "", position: THBK_PAGES.basic.position } });
    fromOtherTab('"e2"');
    await waitFor(() => expect(pageReads(f, "Facility/THBK")).toBe(2));
    await openPage("Basic - Description");
    await waitFor(() => expect(input(t("field.shortDescription")).value).toBe("จากแท็บอื่น")); // it did refresh
    await openPage("Constraints - Active");
    expect(list().getAllByRole("option").map((o) => o.textContent)).toEqual(["Elevation Angle"]);
  });

  test("stays after an Apply of something else", async () => {
    pages = pagesWithMin(0);
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await addElevation();
    await openPage("Basic - Description");
    await user.type(input(t("field.shortDescription")), "x");
    pages = pagesWithMin(0, { basic: { description: "x", long_description: "", position: THBK_PAGES.basic.position } });
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    await waitFor(() => expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true));
    await openPage("Constraints - Active");
    expect(list().getAllByRole("option")).toHaveLength(1);
  });

  test("goes away with Reload, which drops everything the user did", async () => {
    pages = pagesWithMin(0);
    server({ [`PATCH ${API}/objects/Facility/THBK`]: { status: 412, json: { code: "STALE_ETAG", text: "x" } } });
    await mountFacility();
    await openPage("Constraints - Active");
    await addElevation();
    await type(t("field.min"), "5");
    await user.click(button(t("dialog.apply")));
    const dialog = await screen.findByRole("dialog", { name: msg("conflict.title") });
    pages = pagesWithMin(0);
    await user.click(within(dialog).getByRole("button", { name: t("dialog.reload") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(list().queryAllByRole("option")).toHaveLength(0);
  });
});

describe("colour and choice controls", () => {
  // e2e (properties.spec) found it: a colour picked while Inherit from Scenario stayed ticked was saved but never drawn
  // (an inheriting satellite takes its Constellation's colour), the same as the Object Browser colour box, picking one means "use this colour"
  test.each([
    ["a Satellite", mountSatellite, "Satellite/G01"],
    ["a Facility", mountFacility, "Facility/THBK"],
  ] as const)("picking a colour unticks Inherit from Scenario so the colour takes effect (%s)", async (_name, mountObject, target) => {
    const f = server();
    await mountObject();
    await openPage("2D Graphics - Attributes");
    expect(input(t("field.inheritFromScenario")).checked).toBe(true);
    fireEvent.change(input(t("field.color")), { target: { value: "#00ff00" } });
    expect(input(t("field.inheritFromScenario")).checked).toBe(false);
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, target)).toHaveLength(1));
    expect(patches(f, target)[0].body).toEqual({ graphics2d: { color: "#00ff00", inherit: false } });
  });

  test("Inherit from Scenario can be ticked again after a colour was picked", async () => {
    const f = server();
    await mountSatellite();
    await openPage("2D Graphics - Attributes");
    fireEvent.change(input(t("field.color")), { target: { value: "#00ff00" } });
    await user.click(input(t("field.inheritFromScenario")));
    expect(input(t("field.inheritFromScenario")).checked).toBe(true);
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Satellite/G01")).toHaveLength(1));
    expect(patches(f, "Satellite/G01")[0].body).toEqual({ graphics2d: { color: "#00ff00" } });
  });

  test("picking black when there is no colour yet registers", async () => {
    pages = structuredClone(G01_PAGES);
    (pages.graphics2d as Record<string, unknown>).color = null;
    const f = server({});
    await mountSatellite();
    await openPage("2D Graphics - Attributes");
    expect((button(t("dialog.clear")) as HTMLButtonElement).disabled).toBe(true); // nothing to clear
    fireEvent.change(input(t("field.color")), { target: { value: "#000000" } });
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(false);
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Satellite/G01")).toHaveLength(1));
    expect(patches(f, "Satellite/G01")[0].body).toEqual({ graphics2d: { color: "#000000", inherit: false } }); // black registered, and it takes effect
  });

  test("a nullable choice keeps its blank option after a value is picked, and blank sends null", async () => {
    pages = structuredClone(G01_PAGES);
    const f = server();
    await mountSatellite();
    await openPage("2D Graphics - Attributes");
    expect(select(t("field.markerStyle")).value).toBe("Circle");
    expect(optionValues(select(t("field.markerStyle")))[0]).toBe("");
    await user.selectOptions(select(t("field.markerStyle")), "");
    expect(select(t("field.markerStyle")).value).toBe("");
    expect(optionValues(select(t("field.markerStyle")))[0]).toBe(""); // still there, so it can be picked again
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Satellite/G01")).toHaveLength(1));
    expect(patches(f, "Satellite/G01")[0].body).toEqual({ graphics2d: { marker_style: null } });
  });

  test("a choice that is not nullable has no blank option", async () => {
    pages = structuredClone(G01_PAGES);
    server();
    await mountSatellite();
    await openPage("2D Graphics - Pass");
    expect(optionValues(select(t("field.leadType")))).toEqual([...ENUMS.LeadType]);
  });

  test("Max below Min is stopped with a Thai message on Max; Max equal to Min is fine", async () => {
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.max"), "5"); // Min is 10
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("field.max")))).toBe(msg("props.maxBelowMin"));
    expect(input(t("field.max")).getAttribute("aria-invalid")).toBe("true");
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
    await type(t("field.max"), "10");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(patches(f, "Facility/THBK")).toHaveLength(1));
    expect(patches(f, "Facility/THBK")[0].body).toEqual({ constraints: { elevation_angle_max_deg: 10 } });
  });

  test("raising Min above an existing Max is stopped too", async () => {
    pages = pagesWithMin(10, { constraints: { elevation_angle_min_deg: 10, elevation_angle_max_deg: 60 } });
    const f = server();
    await mountFacility();
    await openPage("Constraints - Active");
    await type(t("field.min"), "70");
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("field.max")))).toBe(msg("props.maxBelowMin"));
    expect(patches(f, "Facility/THBK")).toHaveLength(0);
  });
});

// ---------- Sensor ----------

describe("Sensor pages", () => {
  const sensorPatches = (f: ReturnType<typeof stubFetch>) => patches(f, "Sensor/Sensor1");
  const check = (label: string) => input(label).checked;
  const rejected = (field: string, text: string): Handler => ({ status: 422, json: { code: "SCENARIO_INVALID", text, field } });

  beforeEach(() => {
    pages = structuredClone(SENSOR1_PAGES);
  });

  test("sensor pages render the STK fields", async () => {
    const f = server();
    await mountSensor();
    await screen.findByRole("tab", { name: "Basic - Definition" });
    expect(f.calls.filter((c) => c.method === "GET" && c.path === `${API}/objects/Sensor/Sensor1`)).toHaveLength(1);

    // Basic - Definition: Sensor Type (Simple Conic, read only), Cone Half Angle (deg)
    expect(input(t("field.sensorType")).value).toBe("Simple Conic");
    expect(input(t("field.sensorType")).readOnly).toBe(true);
    expect(input(t("field.coneHalfAngle")).value).toBe("45");
    expect(input(t("field.coneHalfAngle")).readOnly).toBe(false);
    expect(screen.getByText(t("field.unit.deg"))).toBeDefined();

    // Basic - Pointing: Pointing Type, Orientation Method (read only), Azimuth, Elevation (deg), About Boresight (read only)
    await openPage("Basic - Pointing");
    expect(input(t("field.pointingType")).value).toBe("Fixed");
    expect(input(t("field.pointingType")).readOnly).toBe(true);
    expect(input(t("field.orientationMethod")).value).toBe("Az-El");
    expect(input(t("field.orientationMethod")).readOnly).toBe(true);
    expect(input(t("field.azimuth")).value).toBe("0");
    expect(input(t("field.elevation")).value).toBe("90");
    expect(input(t("field.aboutBoresight")).value).toBe("Rotate");
    expect(input(t("field.aboutBoresight")).readOnly).toBe(true);

    // Basic - Description: Short Description, Long Description, the parent satellite (read only)
    await openPage("Basic - Description");
    expect(input(t("field.shortDescription")).value).toBe("");
    expect(screen.getByLabelText(t("field.longDescription"))).toBeDefined();
    expect(input(t("field.parentObject")).value).toBe("*/Satellite/G01");

    // 2D Graphics - Attributes: Show, Color, Fill, % Translucency
    await openPage("2D Graphics - Attributes");
    expect(check(t("ob.show"))).toBe(true);
    expect(input(t("field.color")).value).toBe("#e8c547");
    expect(check(t("field.fill"))).toBe(false);
    expect(input(t("field.translucency")).value).toBe("50");

    // 3D Graphics - Attributes: Show, Color, Show Radial Lines, Show Boresight Marker
    await openPage("3D Graphics - Attributes");
    expect(check(t("ob.show"))).toBe(true);
    expect(input(t("field.color")).value).toBe("#e8c547");
    expect(check(t("field.showRadialLines"))).toBe(true);
    expect(check(t("field.showBoresightMarker"))).toBe(false);
    expect(sensorPatches(f)).toHaveLength(0);
  });

  test("Apply is off until something changes", async () => {
    server();
    await mountSensor();
    await screen.findByRole("tab", { name: "Basic - Definition" });
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true);
    await type(t("field.coneHalfAngle"), "30");
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(false);
    await type(t("field.coneHalfAngle"), "45");
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true);
  });

  test("apply sends the edited cone half angle", async () => {
    const f = server();
    await mountSensor();
    await type(t("field.coneHalfAngle"), "13.9");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sensorPatches(f)).toHaveLength(1));
    expect(sensorPatches(f)[0].body).toEqual({ basic: { definition: { cone_half_angle: 13.9 } } });
    expect(sensorPatches(f)[0].headers.get("If-Match")).toBe('"e1"');
  });

  test("cone half angle 91 is rejected in red with a Thai message", async () => {
    const f = server();
    await mountSensor();
    await type(t("field.coneHalfAngle"), "91");
    await user.click(button(t("dialog.apply")));
    const cone = input(t("field.coneHalfAngle"));
    expect(cone.getAttribute("aria-invalid")).toBe("true");
    expect(cone.className).toContain("field-invalid");
    expect(errorOf(cone)).toBe(msg("props.rangeOverUpTo", { min: 0, max: 90 }));
    expect(errorOf(cone)).toMatch(/[\u0E00-\u0E7F]/);
    expect(sensorPatches(f)).toHaveLength(0);
    await type(t("field.coneHalfAngle"), "0");
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("field.coneHalfAngle")))).toBe(msg("props.rangeOverUpTo", { min: 0, max: 90 }));
    await type(t("field.coneHalfAngle"), "90");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sensorPatches(f)).toHaveLength(1));
    expect(sensorPatches(f)[0].body).toEqual({ basic: { definition: { cone_half_angle: 90 } } });
  });

  test("an error on another page selects that page", async () => {
    const f = server();
    await mountSensor();
    await type(t("field.coneHalfAngle"), "100");
    await openPage("3D Graphics - Attributes");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(tab("Basic - Definition").getAttribute("aria-selected")).toBe("true"));
    expect(errorOf(input(t("field.coneHalfAngle")))).toBe(msg("props.rangeOverUpTo", { min: 0, max: 90 }));
    expect(sensorPatches(f)).toHaveLength(0);
  });

  test("a server 422 on the cone half angle lands on the field of its page", async () => {
    server({ [`PATCH ${API}/objects/Sensor/Sensor1`]: rejected("basic.definition.cone_half_angle", "ช่อง basic.definition.cone_half_angle: ต้องมากกว่า 0") });
    await mountSensor();
    await type(t("field.coneHalfAngle"), "30");
    await openPage("2D Graphics - Attributes");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(tab("Basic - Definition").getAttribute("aria-selected")).toBe("true"));
    expect(input(t("field.coneHalfAngle")).getAttribute("aria-invalid")).toBe("true");
    expect(errorOf(input(t("field.coneHalfAngle")))).toBe("ช่อง basic.definition.cone_half_angle: ต้องมากกว่า 0");
  });

  test("pointing: azimuth below 360 and elevation within 90 are checked, and the edited pointing is sent", async () => {
    const f = server();
    await mountSensor();
    await openPage("Basic - Pointing");
    await type(t("field.azimuth"), "360");
    await type(t("field.elevation"), "91");
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("field.azimuth")))).toBe(msg("props.rangeUnder", { min: 0, max: 360 }));
    expect(errorOf(input(t("field.elevation")))).toBe(msg("props.rangeBetween", { min: -90, max: 90 }));
    expect(sensorPatches(f)).toHaveLength(0);
    await type(t("field.azimuth"), "359.5");
    await type(t("field.elevation"), "-90");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sensorPatches(f)).toHaveLength(1));
    expect(sensorPatches(f)[0].body).toEqual({ basic: { pointing: { azimuth: 359.5, elevation: -90 } } });
  });

  test("parent is read only", async () => {
    const f = server();
    await mountSensor();
    await openPage("Basic - Description");
    const parent = input(t("field.parentObject"));
    expect(parent.readOnly).toBe(true);
    expect(parent.value).toBe("*/Satellite/G01");
    await user.type(parent, "X");
    expect(parent.value).toBe("*/Satellite/G01");
    expect((button(t("dialog.apply")) as HTMLButtonElement).disabled).toBe(true);
    // an edit of the description does not send the parent back
    await user.type(input(t("field.shortDescription")), "ตัวรับสัญญาณ");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sensorPatches(f)).toHaveLength(1));
    expect(sensorPatches(f)[0].body).toEqual({ basic: { description: "ตัวรับสัญญาณ" } });
  });

  test("2D Graphics: Show, Fill and % Translucency are sent, and the translucency must be a whole number from 0 to 100", async () => {
    const f = server();
    await mountSensor();
    await openPage("2D Graphics - Attributes");
    await user.click(input(t("field.fill")));
    await type(t("field.translucency"), "50.5");
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("field.translucency")))).toBe(msg("form.notInteger"));
    await type(t("field.translucency"), "101");
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("field.translucency")))).toBe(msg("props.rangeBetween", { min: 0, max: 100 }));
    expect(sensorPatches(f)).toHaveLength(0);
    await type(t("field.translucency"), "80");
    await user.click(input(t("ob.show")));
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sensorPatches(f)).toHaveLength(1));
    expect(sensorPatches(f)[0].body).toEqual({ graphics2d: { show: false, fill: true, fill_translucency: 80 } });
  });

  test("3D Graphics: Show Radial Lines and Show Boresight Marker are sent", async () => {
    const f = server();
    await mountSensor();
    await openPage("3D Graphics - Attributes");
    await user.click(input(t("field.showRadialLines")));
    await user.click(input(t("field.showBoresightMarker")));
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sensorPatches(f)).toHaveLength(1));
    expect(sensorPatches(f)[0].body).toEqual({ graphics3d: { show_radial_lines: false, show_boresight_marker: true } });
  });

  test("each graphics page has its own colour, and a colour has no Clear button", async () => {
    const f = server();
    await mountSensor();
    await openPage("2D Graphics - Attributes");
    expect(screen.queryByRole("button", { name: t("dialog.clear") })).toBeNull();
    fireEvent.change(input(t("field.color")), { target: { value: "#112233" } });
    await openPage("3D Graphics - Attributes");
    expect(screen.queryByRole("button", { name: t("dialog.clear") })).toBeNull();
    expect(input(t("field.color")).value).toBe("#e8c547"); // the 3D colour is its own
    fireEvent.change(input(t("field.color")), { target: { value: "#445566" } });
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sensorPatches(f)).toHaveLength(1));
    expect(sensorPatches(f)[0].body).toEqual({ graphics2d: { color: "#112233" }, graphics3d: { color: "#445566" } });
  });

  test("a Sensor stored without its optional fields shows the schema defaults", async () => {
    pages = { basic: { parent: "*/Satellite/G01", definition: {}, pointing: {} }, graphics2d: {}, graphics3d: {}, constraints: {} };
    server();
    await mountSensor();
    expect(input(t("field.coneHalfAngle")).value).toBe("45");
    await openPage("Basic - Pointing");
    expect(input(t("field.azimuth")).value).toBe("0");
    expect(input(t("field.elevation")).value).toBe("90");
    await openPage("2D Graphics - Attributes");
    expect(input(t("field.translucency")).value).toBe("50");
    expect(input(t("field.color")).value).toBe("#e8c547");
  });

  // ข2 (Ruling g, h, v): Rectangular มี Vertical / Horizontal Half Angle แทน Cone Half Angle และไม่ส่ง cone_half_angle
  const RECT_PAGES = () => {
    const p = structuredClone(SENSOR1_PAGES);
    p.basic.definition = { type: "Rectangular", vertical_half_angle: 55, horizontal_half_angle: 0.41 } as never;
    return p;
  };

  test("a Rectangular sensor's Definition page: Sensor Type Rectangular (read only), Vertical and Horizontal Half Angle editable, no Cone Half Angle", async () => {
    pages = RECT_PAGES();
    server();
    await mountSensor();
    await screen.findByRole("tab", { name: "Basic - Definition" });
    expect(input(t("field.sensorType")).value).toBe("Rectangular");
    expect(input(t("field.sensorType")).readOnly).toBe(true);
    expect(input(t("field.verticalHalfAngle")).value).toBe("55");
    expect(input(t("field.verticalHalfAngle")).readOnly).toBe(false);
    expect(input(t("field.horizontalHalfAngle")).value).toBe("0.41");
    expect(input(t("field.horizontalHalfAngle")).readOnly).toBe(false);
    expect(screen.queryByLabelText(t("field.coneHalfAngle"))).toBeNull();
    expect(screen.getAllByText(t("field.unit.deg"))).toHaveLength(2);
  });

  test("Apply of a Rectangular sensor sends only the edited half angles, never cone_half_angle", async () => {
    pages = RECT_PAGES();
    const f = server();
    await mountSensor();
    await type(t("field.verticalHalfAngle"), "56.28");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sensorPatches(f)).toHaveLength(1));
    expect(sensorPatches(f)[0].body).toEqual({ basic: { definition: { vertical_half_angle: 56.28 } } });
    await type(t("field.verticalHalfAngle"), "50");
    await type(t("field.horizontalHalfAngle"), "0.42");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sensorPatches(f)).toHaveLength(2));
    const body = sensorPatches(f)[1].body as { basic: { definition: Record<string, unknown> } };
    expect(body).toEqual({ basic: { definition: { vertical_half_angle: 50, horizontal_half_angle: 0.42 } } });
    expect(Object.keys(body.basic.definition).sort()).toEqual(["horizontal_half_angle", "vertical_half_angle"]);
  });

  test("Rectangular half angles must be above 0 and at most 89, and cannot be left empty", async () => {
    pages = RECT_PAGES();
    const f = server();
    await mountSensor();
    for (const [label, text] of [[t("field.verticalHalfAngle"), "89.5"], [t("field.horizontalHalfAngle"), "0"]] as const) {
      await type(label, text);
      await user.click(button(t("dialog.apply")));
      expect(input(label).getAttribute("aria-invalid")).toBe("true");
      expect(errorOf(input(label))).toBe(msg("props.rangeOverUpTo", { min: 0, max: 89 }));
    }
    await type(t("field.verticalHalfAngle"), "");
    await user.click(button(t("dialog.apply")));
    expect(errorOf(input(t("field.verticalHalfAngle")))).toBe(msg("props.notNumber"));
    expect(sensorPatches(f)).toHaveLength(0);
    await type(t("field.verticalHalfAngle"), "89");
    await type(t("field.horizontalHalfAngle"), "89");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sensorPatches(f)).toHaveLength(1));
    expect(sensorPatches(f)[0].body).toEqual({ basic: { definition: { vertical_half_angle: 89, horizontal_half_angle: 89 } } });
  });

  test("a server 422 on the whole Rectangular definition lands on the Vertical Half Angle field", async () => {
    pages = RECT_PAGES();
    server({ [`PATCH ${API}/objects/Sensor/Sensor1`]: rejected("basic.definition", "Rectangular ต้องมี vertical_half_angle และ horizontal_half_angle") });
    await mountSensor();
    await type(t("field.horizontalHalfAngle"), "1");
    await openPage("3D Graphics - Attributes");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(tab("Basic - Definition").getAttribute("aria-selected")).toBe("true"));
    expect(errorOf(input(t("field.verticalHalfAngle")))).toBe("Rectangular ต้องมี vertical_half_angle และ horizontal_half_angle");
  });

  test("a Simple Conic sensor's Apply body has no vertical or horizontal half angle keys", async () => {
    const f = server();
    await mountSensor();
    expect(screen.queryByLabelText(t("field.verticalHalfAngle"))).toBeNull();
    expect(screen.queryByLabelText(t("field.horizontalHalfAngle"))).toBeNull();
    await type(t("field.coneHalfAngle"), "20");
    await user.click(button(t("dialog.apply")));
    await waitFor(() => expect(sensorPatches(f)).toHaveLength(1));
    const definition = (sensorPatches(f)[0].body as { basic: { definition: Record<string, unknown> } }).basic.definition;
    expect(Object.keys(definition)).toEqual(["cone_half_angle"]);
  });

  test("a sensor path opens the pages instead of the unknown object error", async () => {
    server();
    await mountSensor();
    expect(screen.queryByText(msg("props.unknownObject", { path: "*/Sensor/Sensor1" }))).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });
});
