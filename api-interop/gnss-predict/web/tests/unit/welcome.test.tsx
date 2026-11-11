import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import * as recent from "../../src/recent";
import { Welcome } from "../../src/windows/Welcome/Welcome";
import { useScenario } from "../../src/stores/scenario";
import { resetAll } from "./helpers/chrome";
import { fakeFlow, setUrl } from "./helpers/files";
import { deferred, stubFetch } from "./helpers/fake-fetch";

const SCENARIOS = [
  { name: "E2E", start: "2026-11-12T00:00:00Z", stop: "2026-11-13T00:00:00Z", modified_utc: "2026-11-11T05:00:00Z", daily: false },
  { name: "THBK", start: "2026-11-12T00:00:00Z", stop: "2026-11-13T12:30:15Z", modified_utc: "2026-11-11T06:00:00Z", daily: true },
  { name: "Other", start: null, stop: null, modified_utc: "2026-11-11T07:00:00Z", daily: false },
];

const mount = () => render(<Welcome params={{}} panelId="welcome" />);
const recentRegion = () => screen.getByRole("region", { name: t("menu.file.recent") });
const allRegion = () => screen.getByRole("region", { name: t("dialog.welcome.openScenario") });

beforeEach(() => {
  resetAll();
  localStorage.clear();
  setUrl("");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the list of scenarios", () => {
  test("shows each scenario with its analysis period in UTCG, and marks the daily ones", async () => {
    stubFetch({ "GET /api/scenarios": { json: SCENARIOS } });
    mount();
    const table = await within(await screen.findByRole("region", { name: t("dialog.welcome.openScenario") })).findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      t("field.name"), t("field.analysisStart"), t("field.analysisStop"), t("status.dailyForecast"),
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual(["E2E", "THBK", "Other"]);
    const thbk = within(rows[1]).getAllByRole("cell");
    expect(thbk[1].textContent).toBe("12 Nov 2026 00:00:00.000 UTCG");
    expect(thbk[2].textContent).toBe("13 Nov 2026 12:30:15.000 UTCG");
    expect(within(rows[1]).getByRole("img", { name: t("status.dailyForecast") })).toBeDefined();
    expect(within(rows[0]).queryByRole("img", { name: t("status.dailyForecast") })).toBeNull();
    // a scenario whose period the server could not read still lists, with dashes
    expect(within(rows[2]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Other", "—", "—", ""]);
  });

  test("a scenario with no daily job has no daily mark in the list", async () => {
    stubFetch({ "GET /api/scenarios": { json: SCENARIOS.slice(0, 1) } });
    mount();
    await screen.findByRole("button", { name: "E2E" });
    expect(screen.queryByRole("img", { name: t("status.dailyForecast") })).toBeNull();
  });

  test("says so when there is no scenario yet", async () => {
    stubFetch({ "GET /api/scenarios": { json: [] } });
    mount();
    expect(await screen.findByText(msg("welcome.empty"))).toBeDefined();
  });

  test("says so, with the server's text, when the list cannot be read", async () => {
    stubFetch({ "GET /api/scenarios": { status: 500, json: { code: "BOOM", text: "อ่านโฟลเดอร์ไม่ได้" } } });
    mount();
    expect(await screen.findByText(msg("welcome.listFailed", { message: "อ่านโฟลเดอร์ไม่ได้" }))).toBeDefined();
    expect(screen.getByRole("button", { name: t("dialog.welcome.createScenario") })).toBeDefined(); // the rest still works
  });

  test("shows a loading note until the list arrives", async () => {
    const gate = deferred<{ json: unknown }>();
    stubFetch({ "GET /api/scenarios": () => gate.promise });
    mount();
    expect(screen.getByText(msg("welcome.loading"))).toBeDefined();
    gate.resolve({ json: SCENARIOS });
    await screen.findByRole("button", { name: "E2E" });
    expect(screen.queryByText(msg("welcome.loading"))).toBeNull();
  });
});

describe("recent scenarios", () => {
  test("come before the full list, newest first", async () => {
    recent.push("E2E");
    recent.push("THBK");
    stubFetch({ "GET /api/scenarios": { json: SCENARIOS } });
    mount();
    await screen.findByRole("table");
    expect(within(recentRegion()).getAllByRole("button").map((b) => b.textContent)).toEqual(["THBK", "E2E"]);
    expect(recentRegion().compareDocumentPosition(allRegion()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("show even before the full list has arrived", () => {
    recent.push("E2E");
    stubFetch({ "GET /api/scenarios": () => new Promise(() => undefined) });
    mount();
    expect(within(recentRegion()).getByRole("button", { name: "E2E" })).toBeDefined();
  });

  test("have no section of their own when nothing was opened yet", async () => {
    stubFetch({ "GET /api/scenarios": { json: SCENARIOS } });
    mount();
    await screen.findByRole("table");
    expect(screen.queryByRole("region", { name: t("menu.file.recent") })).toBeNull();
  });
});

describe("opening", () => {
  test("clicking a name in the full list loads that scenario, then restores its layout", async () => {
    const user = userEvent.setup();
    const flow = fakeFlow();
    stubFetch({ "GET /api/scenarios": { json: SCENARIOS } });
    mount();
    await user.click(await within(await screen.findByRole("table")).findByRole("button", { name: "THBK" }));
    await waitFor(() => expect(flow.calls).toEqual(["load:THBK", "restore:THBK"]));
    expect(flow.load).toHaveBeenCalledWith("THBK");
    expect(window.location.search).toBe("?sc=THBK");
    expect(recent.list()).toEqual(["THBK"]);
  });

  test("clicking a recent name loads that scenario too", async () => {
    const user = userEvent.setup();
    const flow = fakeFlow();
    recent.push("E2E");
    stubFetch({ "GET /api/scenarios": { json: SCENARIOS } });
    mount();
    await user.click(within(recentRegion()).getByRole("button", { name: "E2E" }));
    await waitFor(() => expect(flow.load).toHaveBeenCalledWith("E2E"));
    await waitFor(() => expect(flow.restoreFor).toHaveBeenCalledWith("E2E"));
  });

  test("a recent name whose scenario is gone (404 NOT_FOUND) disappears from the recent list, and the list of scenarios is left as it is", async () => {
    const user = userEvent.setup();
    fakeFlow();
    useScenario.setState({ load: useScenario.getInitialState().load }); // the real load tells why it failed
    const gone = { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ scenario Gone" } };
    stubFetch({
      "GET /api/scenarios": { json: SCENARIOS },
      "GET /api/scenarios/Gone": gone,
      "GET /api/scenarios/Gone/objects": gone,
    });
    recent.push("E2E");
    recent.push("Gone");
    mount();
    await screen.findByRole("table");
    expect(within(recentRegion()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Gone", "E2E"]);
    await user.click(within(recentRegion()).getByRole("button", { name: "Gone" }));
    await waitFor(() => expect(within(recentRegion()).getAllByRole("button").map((b) => b.textContent)).toEqual(["E2E"]));
    expect(recent.list()).toEqual(["E2E"]);
    expect(within(allRegion()).getAllByRole("row")).toHaveLength(SCENARIOS.length + 1);
  });

  test("when that was the only recent name the whole recent section goes", async () => {
    const user = userEvent.setup();
    fakeFlow();
    useScenario.setState({ load: useScenario.getInitialState().load });
    const gone = { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ scenario Gone" } };
    stubFetch({ "GET /api/scenarios": { json: SCENARIOS }, "GET /api/scenarios/Gone": gone, "GET /api/scenarios/Gone/objects": gone });
    recent.push("Gone");
    mount();
    await screen.findByRole("table");
    await user.click(within(recentRegion()).getByRole("button", { name: "Gone" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: t("menu.file.recent") })).toBeNull());
  });

  test("a scenario that cannot be opened changes nothing: no layout, no URL, no recent entry", async () => {
    const user = userEvent.setup();
    const flow = fakeFlow(false);
    stubFetch({ "GET /api/scenarios": { json: SCENARIOS } });
    mount();
    await user.click(await screen.findByRole("button", { name: "E2E" }));
    await waitFor(() => expect(flow.load).toHaveBeenCalled());
    expect(flow.restoreFor).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
    expect(recent.list()).toEqual([]);
    // and the buttons work again
    await waitFor(() => expect((screen.getByRole("button", { name: "E2E" }) as HTMLButtonElement).disabled).toBe(false));
  });

  test("the names are disabled while one is being opened", async () => {
    const user = userEvent.setup();
    const gate = deferred<boolean>();
    const flow = fakeFlow();
    flow.load.mockImplementation(() => gate.promise);
    stubFetch({ "GET /api/scenarios": { json: SCENARIOS } });
    mount();
    await user.click(await screen.findByRole("button", { name: "E2E" }));
    expect((screen.getByRole("button", { name: "THBK" }) as HTMLButtonElement).disabled).toBe(true);
    gate.resolve(false);
    await waitFor(() => expect((screen.getByRole("button", { name: "THBK" }) as HTMLButtonElement).disabled).toBe(false));
  });

  test("Create a Scenario opens the New Scenario Wizard", async () => {
    const user = userEvent.setup();
    const flow = fakeFlow();
    stubFetch({ "GET /api/scenarios": { json: [] } });
    mount();
    await user.click(screen.getByRole("button", { name: t("dialog.welcome.createScenario") }));
    expect(flow.openPanel).toHaveBeenCalledWith("newScenarioWizard");
  });
});
