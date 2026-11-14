import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dialogs } from "../../src/chrome/Dialogs";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useImagery } from "../../src/stores/imagery";
import { useJobs, type JobEvent } from "../../src/stores/jobs";
import { useMessages } from "../../src/stores/messages";
import { useSettings } from "../../src/stores/settings";
import { DailyForecastSettings, registerDailyForecastSettingsPanel } from "../../src/windows/DailyForecastSettings/DailyForecastSettings";
import { GlobeManager } from "../../src/windows/GlobeManager/GlobeManager";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";
import { deferred, stubFetch, type Handler } from "./helpers/fake-fetch";
import { fakeFlow, type FakeFlow } from "./helpers/files";

const IMAGERY_OFF = { enabled: false, eox: false, osm: false, ion: false };
// every flag a different mix: the window must hand the whole object back untouched
const IMAGERY_MIXED = { enabled: true, eox: false, osm: true, ion: true };
const SETTINGS = {
  daily: { enabled: true, run_at_utc: "21:00", facility: "THBK", retention_days: 30, validation_retry_hours: 3, validation_give_up_days: 14 },
  cesium_ion_token: "tok-abc",
  online_imagery: IMAGERY_OFF,
};
const HEALTH = {
  engine_version: "1", gmat_found: true, data_dir: "/srv/gnss/data", free_bytes: 1e12, writable: true,
  daily: { state: "ok", last_run_utc: "2026-11-12T21:03:10Z", next_run_utc: "2026-11-13T21:00:00Z", for_date: "2026-11-13" },
};
const PUT = "PUT /api/settings";
const RUN = "POST /api/daily/run";
const DASH = "—";

let flow: FakeFlow;
let user: ReturnType<typeof userEvent.setup>;

function server(over: Record<string, Handler> = {}) {
  return stubFetch({
    "GET /api/settings": { json: SETTINGS },
    "GET /api/health": { json: HEALTH },
    [PUT]: (call) => ({ json: call.body }),
    [RUN]: { status: 202, json: { job: "j-20261112T230000-bbbb" } },
    ...over,
  });
}

function mount() {
  return render(
    <>
      <DailyForecastSettings params={{}} panelId="dailyForecastSettings" />
      <Dialogs />
    </>,
  );
}

async function mounted() {
  const result = mount();
  await waitFor(() => expect(enabled().disabled).toBe(false));
  return result;
}

const enabled = () => screen.getByLabelText(t("field.dailyEnabled")) as HTMLInputElement;
const runAt = () => screen.getByLabelText(t("field.runAt")) as HTMLInputElement;
const facility = () => screen.getByLabelText(t("ob.class.facility")) as HTMLInputElement;
const retention = () => screen.getByLabelText(t("field.retention")) as HTMLInputElement;
const retry = () => screen.getByLabelText(t("field.validationRetry")) as HTMLInputElement;
const giveUp = () => screen.getByLabelText(t("field.validationGiveUp")) as HTMLInputElement;
const token = () => screen.getByLabelText(t("field.cesiumToken")) as HTMLInputElement;
const apply = () => screen.getByRole("button", { name: t("dialog.apply") }) as HTMLButtonElement;
const ok = () => screen.getByRole("button", { name: t("dialog.ok") }) as HTMLButtonElement;
const runNow = () => screen.getByRole("button", { name: t("dialog.runNow") }) as HTMLButtonElement;
const errorOf = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent;
const puts = (f: ReturnType<typeof stubFetch>) => f.calls.filter((c) => `${c.method} ${c.path}` === PUT);
const jobEvent = (over: Partial<JobEvent> = {}): JobEvent => ({ id: "j-d1", kind: "daily", scenario: null, state: "running", progress: { stage: null, fraction: null }, ...over });
const replace = async (input: HTMLInputElement, text: string) => {
  await user.clear(input);
  if (text !== "") await user.type(input, text);
};
const confirmDialog = () => screen.getByRole("dialog");

const MORNING = new Date("2026-11-12T10:00:00Z"); // before every run time these tests use, so Apply does not ask for consent unless a test sets another time

beforeEach(() => {
  resetAll();
  flow = fakeFlow();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MORNING);
  user = userEvent.setup();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the form", () => {
  test("shows every setting of server §9.1 with the stored values", async () => {
    server();
    await mounted();
    expect(enabled().checked).toBe(true);
    expect(runAt().value).toBe("21:00");
    expect(facility().value).toBe("THBK");
    expect(retention().value).toBe("30");
    expect(retry().value).toBe("3");
    expect(giveUp().value).toBe("14");
    expect(token().value).toBe("tok-abc");
  });

  test("the Cesium token is a password field", async () => {
    server();
    await mounted();
    expect(token().type).toBe("password");
    expect(token().autocomplete).toBe("off");
    expect(runAt().type).toBe("text");
  });

  test("the fields wait for the settings: disabled while loading, a Thai error when they cannot be read", async () => {
    server({ "GET /api/settings": { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    mount();
    expect(enabled().disabled).toBe(true);
    expect((await screen.findByRole("alert")).textContent).toBe(msg("daily.loadFailed", { message: "พัง" }));
    expect(enabled().disabled).toBe(true);
    expect(apply().disabled).toBe(true);
  });

  test("units are shown beside the numbers", async () => {
    server();
    await mounted();
    expect(screen.getAllByText(t("field.unit.days"))).toHaveLength(2);
    expect(screen.getByText(t("field.unit.hours"))).toBeDefined();
  });
});

describe("Apply", () => {
  test("nothing to apply until something changes", async () => {
    server();
    await mounted();
    expect(apply().disabled).toBe(true);
    await user.click(enabled());
    expect(apply().disabled).toBe(false);
    await user.click(enabled());
    expect(apply().disabled).toBe(true);
  });

  test("PUTs the whole document with every field of §9.1, the numbers as integers", async () => {
    const f = server();
    await mounted();
    await replace(runAt(), "22:30");
    await replace(retention(), "45");
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(puts(f)[0].body).toEqual({
      daily: { enabled: true, run_at_utc: "22:30", facility: "THBK", retention_days: 45, validation_retry_hours: 3, validation_give_up_days: 14 },
      cesium_ion_token: "tok-abc",
      online_imagery: IMAGERY_OFF,
    });
    const body = puts(f)[0].body as { daily: Record<string, unknown> };
    expect(Object.keys(body.daily).sort()).toEqual(["enabled", "facility", "retention_days", "run_at_utc", "validation_give_up_days", "validation_retry_hours"]);
    expect(typeof body.daily.retention_days).toBe("number");
  });

  test("every field travels, including the ones the user did not touch, the checkbox and the token", async () => {
    const f = server();
    await mounted();
    await user.click(enabled());
    await replace(token(), "new-token");
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(puts(f)[0].body).toEqual({ daily: { ...SETTINGS.daily, enabled: false }, cesium_ion_token: "new-token", online_imagery: IMAGERY_OFF });
  });

  test("keeps online_imagery from the loaded settings on save", async () => {
    const f = server({ "GET /api/settings": { json: { ...SETTINGS, online_imagery: IMAGERY_MIXED } } });
    await mounted();
    await replace(retention(), "45");
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect((puts(f)[0].body as { online_imagery: unknown }).online_imagery).toEqual(IMAGERY_MIXED); // all four flags, as loaded
    expect(useSettings.getState().settings?.online_imagery).toEqual(IMAGERY_MIXED); // the saved copy still has them
  });

  test("never turns online_imagery on by itself: a loaded off stays off", async () => {
    const f = server();
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect((puts(f)[0].body as { online_imagery: unknown }).online_imagery).toEqual(IMAGERY_OFF);
  });

  test("sends the online_imagery the store holds now, so a switch changed elsewhere while this window is open is not undone", async () => {
    const f = server();
    await mounted();
    act(() => useSettings.setState({ settings: { ...SETTINGS, online_imagery: IMAGERY_MIXED } }));
    await replace(retention(), "45");
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect((puts(f)[0].body as { online_imagery: unknown }).online_imagery).toEqual(IMAGERY_MIXED);
  });

  test("an empty token is sent as an empty string (the server needs the field)", async () => {
    const f = server();
    await mounted();
    await replace(token(), "");
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect((puts(f)[0].body as { cesium_ion_token: unknown }).cesium_ion_token).toBe("");
  });

  test("on success the saved values become the form's baseline, the store holds them and Apply is off again", async () => {
    server();
    await mounted();
    await replace(facility(), "THBK2");
    await user.click(apply());
    await waitFor(() => expect(apply().disabled).toBe(true));
    expect(useSettings.getState().settings?.daily.facility).toBe("THBK2");
    expect(facility().value).toBe("THBK2");
    expect(screen.getByRole("status").textContent).toBe(msg("daily.saved"));
  });

  test("the first Apply is not sent twice by a quick second click", async () => {
    const gate = deferred<void>();
    const f = server({ [PUT]: async (call) => { await gate.promise; return { json: call.body }; } });
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    expect(apply().disabled).toBe(true);
    await user.click(apply());
    gate.resolve();
    await waitFor(() => expect(screen.getByRole("status")).toBeDefined());
    expect(puts(f)).toHaveLength(1);
  });
});

describe("what the server refuses", () => {
  test("a 422 on daily.run_at_utc puts the red border and the server's text on that field only; the typed value stays", async () => {
    server({ [PUT]: { status: 422, json: { code: "SCENARIO_INVALID", text: "เวลาไม่ถูกต้อง", field: "daily.run_at_utc", detail: null } } });
    await mounted();
    await replace(runAt(), "22:30");
    await user.click(apply());
    await waitFor(() => expect(errorOf(runAt())).toBe("เวลาไม่ถูกต้อง"));
    expect(runAt().getAttribute("aria-invalid")).toBe("true");
    expect(runAt().classList.contains("field-invalid")).toBe(true);
    expect(runAt().value).toBe("22:30");
    for (const other of [facility(), retention(), retry(), giveUp(), token()]) {
      expect(other.getAttribute("aria-invalid")).toBeNull();
      expect(other.classList.contains("field-invalid")).toBe(false);
    }
    expect(useSettings.getState().settings).toEqual(SETTINGS); // unchanged
    expect(useMessages.getState().items).toEqual([]);
    expect(apply().disabled).toBe(false);
  });

  test.each([
    ["daily.facility", () => facility()],
    ["daily.retention_days", () => retention()],
    ["daily.validation_retry_hours", () => retry()],
    ["daily.validation_give_up_days", () => giveUp()],
    ["cesium_ion_token", () => token()],
  ] as const)("a 422 on %s lands on its own input", async (field, input) => {
    server({ [PUT]: { status: 422, json: { code: "SCENARIO_INVALID", text: `ผิดที่ ${field}`, field, detail: null } } });
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    await waitFor(() => expect(errorOf(input())).toBe(`ผิดที่ ${field}`));
  });

  test("typing in a field clears that field's server error", async () => {
    server({ [PUT]: { status: 422, json: { code: "SCENARIO_INVALID", text: "เวลาไม่ถูกต้อง", field: "daily.run_at_utc", detail: null } } });
    await mounted();
    await replace(runAt(), "22:30");
    await user.click(apply());
    await waitFor(() => expect(errorOf(runAt())).toBe("เวลาไม่ถูกต้อง"));
    await user.type(runAt(), "1");
    expect(runAt().getAttribute("aria-invalid")).toBeNull();
  });

  test("a refusal that names no field of the form shows above the buttons; any other failure also goes to the Message Viewer", async () => {
    server({ [PUT]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    expect((await screen.findByRole("alert")).textContent).toBe(msg("daily.applyFailed", { message: "พัง" }));
    expect(useMessages.getState().items.map((m) => m.code)).toEqual(["INTERNAL"]);
    expect(apply().disabled).toBe(false);
  });
});

describe("the same rules as the server, checked before sending", () => {
  const bad: [string, () => HTMLInputElement, string, string][] = [
    ["run time without a leading zero", runAt, "9:00", msg("daily.timeInvalid")],
    ["hour 24", runAt, "24:00", msg("daily.timeInvalid")],
    ["minute 60", runAt, "21:60", msg("daily.timeInvalid")],
    ["not a time", runAt, "tonight", msg("daily.timeInvalid")],
    ["empty time", runAt, "", msg("daily.timeInvalid")],
    ["facility with a space", facility, "bad name", msg("ob.nameInvalid")],
    ["empty facility", facility, "", msg("ob.nameInvalid")],
    ["facility of 33 characters", facility, "a".repeat(33), msg("ob.nameInvalid")],
    ["retention 0", retention, "0", msg("props.rangeBetween", { min: 1, max: 3650 })],
    ["retention 3651", retention, "3651", msg("props.rangeBetween", { min: 1, max: 3650 })],
    ["retention 1.5", retention, "1.5", msg("form.notInteger")],
    ["retention text", retention, "many", msg("form.notInteger")],
    ["empty retention", retention, "", msg("form.notInteger")],
    ["retry 0", retry, "0", msg("props.rangeBetween", { min: 1, max: 168 })],
    ["retry 169", retry, "169", msg("props.rangeBetween", { min: 1, max: 168 })],
    ["give up 0", giveUp, "0", msg("props.rangeBetween", { min: 1, max: 365 })],
    ["give up 366", giveUp, "366", msg("props.rangeBetween", { min: 1, max: 365 })],
  ];

  test.each(bad)("%s is refused on its own field and nothing is sent", async (_name, input, text, message) => {
    const f = server();
    await mounted();
    await replace(input(), text);
    await user.click(apply());
    expect(errorOf(input())).toBe(message);
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(puts(f)).toHaveLength(0);
  });

  test("several mistakes are all shown at once", async () => {
    const f = server();
    await mounted();
    await replace(runAt(), "x");
    await replace(retention(), "0");
    await replace(giveUp(), "999");
    await user.click(apply());
    expect([runAt(), retention(), giveUp()].every((i) => i.getAttribute("aria-invalid") === "true")).toBe(true);
    expect(puts(f)).toHaveLength(0);
  });

  test.each([
    ["00:00", "A", "1", "1", "1"],
    ["23:59", "A".repeat(32), "3650", "168", "365"],
    ["07:05", "THBK_2-b", " 12 ", "24", "30"],
  ])("the edge values %s / %s / %s / %s / %s are accepted", async (time, name, keep, hours, days) => {
    const f = server();
    await mounted();
    await user.click(enabled()); // off: moving the run time before "now" would otherwise ask for consent (tested below)
    await replace(runAt(), time);
    await replace(facility(), name);
    await replace(retention(), keep);
    await replace(retry(), hours);
    await replace(giveUp(), days);
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect((puts(f)[0].body as { daily: Record<string, unknown> }).daily).toEqual({
      enabled: false, run_at_utc: time, facility: name, retention_days: Number(keep.trim()), validation_retry_hours: Number(hours), validation_give_up_days: Number(days),
    });
  });
});

// Server §9.3-9.4: with the job on, the scheduler (ticking every 60 s) starts the forecast when now >= today's run_at_utc, and the validation of past days
// (MGEX SP3 from CDDIS) at any time of day. So a save that switches the job on always needs the user's consent (validation download, plus the forecast
// download when it is already past run_at_utc), and a save that moves run_at_utc to before now while the job is on needs it for the forecast download
describe("Apply asks for consent when saving may start a download", () => {
  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  const off = (over: Partial<typeof SETTINGS.daily> = {}) => ({ json: { ...SETTINGS, daily: { ...SETTINGS.daily, enabled: false, ...over } } });
  const forecast = (time = "21:00") => msg("daily.confirmForecast", { time });
  const validation = () => msg("daily.confirmValidation");
  const CDDIS = "gdc.cddis.eosdis.nasa.gov";
  const dialogText = () => screen.getByRole("dialog").textContent ?? "";

  test("switching the job on after today's run time asks, in Thai, naming both downloads: the validation (CDDIS) and the forecast (CelesTrak, IGS, CDDIS)", async () => {
    at("2026-11-12T22:00:00Z"); // New York (the suite's TZ) is at 17:00: only a UTC reading says "after 21:00"
    const f = server({ "GET /api/settings": off() });
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    await screen.findByRole("dialog");
    expect(dialogText()).toContain(validation());
    expect(dialogText()).toContain(forecast());
    expect(dialogText()).toContain(msg("daily.confirmSave"));
    for (const host of ["celestrak.org", "files.igs.org", CDDIS]) expect(dialogText(), host).toContain(host);
    expect(dialogText()).toMatch(/60 วินาที/);
    expect(dialogText()).toMatch(/MGEX/);
    expect(puts(f)).toHaveLength(0);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect((puts(f)[0].body as { daily: { enabled: boolean } }).daily.enabled).toBe(true);
  });

  test("switching the job on BEFORE today's run time still asks, and names the validation download (CDDIS) but not a forecast one", async () => {
    at("2026-11-12T20:59:59Z");
    const f = server({ "GET /api/settings": off() });
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    await screen.findByRole("dialog");
    expect(dialogText()).toContain(validation());
    expect(dialogText()).toContain(CDDIS);
    expect(dialogText()).toMatch(/MGEX/);
    expect(dialogText()).not.toContain(forecast());
    expect(dialogText()).not.toContain("celestrak.org");
    expect(puts(f)).toHaveLength(0);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(puts(f)).toHaveLength(1));
  });

  test("before the run time, Cancel sends nothing too", async () => {
    at("2026-11-12T08:00:00Z");
    const f = server({ "GET /api/settings": off() });
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(puts(f)).toHaveLength(0);
    expect(enabled().checked).toBe(true);
    expect(apply().disabled).toBe(false);
    expect(flow.closePanel).not.toHaveBeenCalled();
  });

  test("Cancel sends nothing, keeps the form as it was (still to be applied) and the window open", async () => {
    at("2026-11-12T22:00:00Z");
    const f = server({ "GET /api/settings": off() });
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(puts(f)).toHaveLength(0);
    expect(enabled().checked).toBe(true);
    expect(apply().disabled).toBe(false);
    expect(flow.closePanel).not.toHaveBeenCalled();
    expect(useSettings.getState().settings?.daily.enabled).toBe(false);
  });

  test("OK of the window asks the same, and a Cancel keeps the window open", async () => {
    at("2026-11-12T22:00:00Z");
    const f = server({ "GET /api/settings": off() });
    await mounted();
    await user.click(enabled());
    await user.click(ok());
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(puts(f)).toHaveLength(0);
    expect(flow.closePanel).not.toHaveBeenCalled();
    await user.click(ok());
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(flow.closePanel).toHaveBeenCalledWith("dailyForecastSettings"));
    expect(puts(f)).toHaveLength(1);
  });

  test("at exactly the run time the forecast download is named too (the scheduler starts at or after it)", async () => {
    at("2026-11-12T21:00:00Z");
    const f = server({ "GET /api/settings": off() });
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    await screen.findByRole("dialog");
    expect(dialogText()).toContain(forecast());
    expect(dialogText()).toContain(validation());
    expect(puts(f)).toHaveLength(0);
  });

  test("the day does not matter, only the time of day in UTC (just after midnight is before 21:00: validation only)", async () => {
    at("2026-11-13T00:00:30Z");
    const f = server({ "GET /api/settings": off() });
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    await screen.findByRole("dialog");
    expect(dialogText()).toContain(validation());
    expect(dialogText()).not.toContain(forecast());
    expect(puts(f)).toHaveLength(0);
  });

  test("switching on while moving the run time asks once, with the forecast named only when the NEW time has passed", async () => {
    at("2026-11-12T12:00:00Z");
    const f = server({ "GET /api/settings": off() });
    await mounted();
    await user.click(enabled());
    await replace(runAt(), "11:30");
    await user.click(apply());
    await screen.findByRole("dialog");
    expect(dialogText()).toContain(forecast("11:30"));
    expect(dialogText()).toContain(validation());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await replace(runAt(), "12:30");
    await user.click(apply());
    await screen.findByRole("dialog");
    expect(dialogText()).toContain(validation());
    expect(dialogText()).not.toContain(forecast("12:30"));
    expect(puts(f)).toHaveLength(0);
  });

  test("moving the run time to before now while the job is already on asks, naming the forecast download and the new time", async () => {
    at("2026-11-12T12:00:00Z");
    const f = server(); // enabled, 21:00
    await mounted();
    await replace(runAt(), "11:30");
    await user.click(apply());
    await screen.findByRole("dialog");
    expect(dialogText()).toContain(forecast("11:30"));
    expect(dialogText()).not.toContain(validation()); // the job was already on: only the forecast start is new
    expect(puts(f)).toHaveLength(0);
  });

  test("moving the run time to after now while the job is already on does not ask", async () => {
    at("2026-11-12T12:00:00Z");
    const f = server();
    await mounted();
    await replace(runAt(), "12:01");
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("other edits while the job is on do not ask, even long after the run time", async () => {
    at("2026-11-12T23:00:00Z");
    const f = server();
    await mounted();
    await replace(retention(), "45");
    await replace(facility(), "THBK2");
    await replace(token(), "other");
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("switching the job off does not ask", async () => {
    at("2026-11-12T23:00:00Z");
    const f = server();
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a job that stays off does not ask when its time is moved", async () => {
    at("2026-11-12T23:00:00Z");
    const f = server({ "GET /api/settings": off() });
    await mounted();
    await replace(runAt(), "05:00");
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a form with mistakes is refused first, without asking", async () => {
    at("2026-11-12T22:00:00Z");
    const f = server({ "GET /api/settings": off() });
    await mounted();
    await user.click(enabled());
    await replace(retention(), "0");
    await user.click(apply());
    expect(errorOf(retention())).toBe(msg("props.rangeBetween", { min: 1, max: 3650 }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(puts(f)).toHaveLength(0);
  });

  test("while the question is open the form cannot be sent a second time", async () => {
    at("2026-11-12T22:00:00Z");
    const f = server({ "GET /api/settings": off() });
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: t("dialog.apply"), hidden: true })); // the window sits behind the question
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(puts(f)).toHaveLength(1));
  });
});

describe("OK and Cancel", () => {
  test("OK saves and then closes the window", async () => {
    const f = server();
    await mounted();
    await user.click(enabled());
    await user.click(ok());
    await waitFor(() => expect(flow.closePanel).toHaveBeenCalledWith("dailyForecastSettings"));
    expect(puts(f)).toHaveLength(1);
  });

  test("OK with nothing changed just closes, without a PUT", async () => {
    const f = server();
    await mounted();
    await user.click(ok());
    expect(flow.closePanel).toHaveBeenCalledWith("dailyForecastSettings");
    expect(puts(f)).toHaveLength(0);
  });

  test("OK that the server refuses leaves the window open", async () => {
    server({ [PUT]: { status: 422, json: { code: "SCENARIO_INVALID", text: "ไม่ผ่าน", field: "daily.facility", detail: null } } });
    await mounted();
    await replace(facility(), "OTHER");
    await user.click(ok());
    await waitFor(() => expect(errorOf(facility())).toBe("ไม่ผ่าน"));
    expect(flow.closePanel).not.toHaveBeenCalled();
  });

  test("Cancel closes without saving", async () => {
    const f = server();
    await mounted();
    await user.click(enabled());
    await user.click(screen.getByRole("button", { name: t("dialog.cancel") }));
    expect(flow.closePanel).toHaveBeenCalledWith("dailyForecastSettings");
    expect(puts(f)).toHaveLength(0);
  });
});

describe("the warning", () => {
  test("a Thai warning line shows while the daily job is on, and says that starting after the run time downloads at once", async () => {
    server();
    await mounted();
    const line = screen.getByText(msg("daily.warnEnabled", { time: "21:00" }));
    expect(line).toBeDefined();
    expect(msg("daily.warnEnabled", { time: "21:00" })).toMatch(/21:00/);
    expect(msg("daily.warnEnabled", { time: "21:00" })).toMatch(/ดาวน์โหลดทันที/);
    expect(msg("daily.warnEnabled", { time: "21:00" })).toMatch(/Apply/); // a save can start it too, not only a server start
  });

  test("it follows the checkbox and the run time typed in the form", async () => {
    server();
    await mounted();
    await replace(runAt(), "22:15");
    expect(screen.getByText(msg("daily.warnEnabled", { time: "22:15" }))).toBeDefined();
    await user.click(enabled());
    expect(screen.queryByText(/ดาวน์โหลดทันที/)).toBeNull();
  });

  test("with the job off in the settings there is no warning", async () => {
    server({ "GET /api/settings": { json: { ...SETTINGS, daily: { ...SETTINGS.daily, enabled: false } } } });
    await mounted();
    expect(screen.queryByText(/ดาวน์โหลดทันที/)).toBeNull();
  });

  test("a run time that is not valid yet falls back to the saved one in the warning", async () => {
    server();
    await mounted();
    await replace(runAt(), "2");
    expect(screen.getByText(msg("daily.warnEnabled", { time: "21:00" }))).toBeDefined();
  });
});

describe("status and the CSV", () => {
  test("shows the state, the last and the next run and the day it is for", async () => {
    server();
    await mounted();
    const status = screen.getByRole("region", { name: t("status.dailyForecast") });
    await waitFor(() => expect(within(status).getByText(msg("daily.state.ok"))).toBeDefined());
    expect(within(status).getByText("12 Nov 2026 21:03:10.000 UTCG")).toBeDefined();
    expect(within(status).getByText("13 Nov 2026 21:00:00.000 UTCG")).toBeDefined();
    expect(within(status).getByText("2026-11-13")).toBeDefined();
  });

  test("times follow the open scenario's DateFormat", async () => {
    openScenario(makeDoc({ units: { date_format: "LTZG", ltz_offset: "+07:00" } as never }));
    server();
    await mounted();
    await screen.findByText("13 Nov 2026 04:03:10.000 LTZG+07:00");
  });

  test("shows dashes while nothing has run, and follows the daily event of the stream", async () => {
    server({ "GET /api/health": { json: { ...HEALTH, daily: { state: "idle", last_run_utc: null, next_run_utc: null, for_date: null } } } });
    await mounted();
    const status = screen.getByRole("region", { name: t("status.dailyForecast") });
    await waitFor(() => expect(within(status).getByText(msg("daily.state.idle"))).toBeDefined());
    expect(within(status).getAllByText(DASH)).toHaveLength(3);
    act(() => useJobs.getState().onDailyEvent({ state: "running", last_run_utc: null, next_run_utc: "2026-11-14T21:00:00Z", for_date: "2026-11-14" }));
    expect(within(status).getByText(msg("daily.state.running"))).toBeDefined();
    expect(within(status).getByText("2026-11-14")).toBeDefined();
  });

  test("shows <data_dir>/daily/latest.csv as plain text", async () => {
    server();
    await mounted();
    await screen.findByText("/srv/gnss/data/daily/latest.csv");
    expect(screen.getByText(t("field.tecCsv"))).toBeDefined();
  });

  test.each([
    ["/srv/gnss/data/", "/srv/gnss/data/daily/latest.csv"],
    ["C:\\gnss\\data", "C:\\gnss\\data\\daily\\latest.csv"],
  ])("the path from data_dir %j is %j", async (dir, path) => {
    server({ "GET /api/health": { json: { ...HEALTH, data_dir: dir } } });
    await mounted();
    await screen.findByText(path);
  });

  test("without the health there is a dash instead of a path", async () => {
    server({ "GET /api/health": { status: 500, json: { code: "X", text: "x", field: null, detail: null } } });
    await mounted();
    expect(screen.queryByText(/latest\.csv/)).toBeNull();
  });
});

describe("Run Now", () => {
  test("asks first, in Thai, about the download; Cancel sends nothing", async () => {
    const f = server();
    await mounted();
    await user.click(runNow());
    expect(within(confirmDialog()).getByText(msg("daily.runNowConfirm"))).toBeDefined();
    expect(msg("daily.runNowConfirm")).toMatch(/อินเทอร์เน็ต/);
    for (const host of ["celestrak.org", "files.igs.org", "gdc.cddis.eosdis.nasa.gov"]) expect(msg("daily.runNowConfirm"), host).toContain(host);
    await user.click(within(confirmDialog()).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(f.count(RUN)).toBe(0);
    expect(useJobs.getState().jobs).toEqual({});
  });

  test("OK sends one POST /api/daily/run, feeds the queued job to the job store and says so in Thai", async () => {
    const f = server();
    await mounted();
    await user.click(runNow());
    await user.click(within(confirmDialog()).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(f.count(RUN)).toBe(1));
    const job = "j-20261112T230000-bbbb";
    await waitFor(() => expect(useJobs.getState().jobs[job]).toBeDefined());
    expect(useJobs.getState().jobs[job]).toMatchObject({ id: job, kind: "daily", scenario: null, state: "queued", error: null });
    expect(f.calls.find((c) => c.method === "POST")!.body).toBeUndefined();
    const info = msg("daily.queued", { job });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(info));
    expect(useMessages.getState().items.map((m) => [m.level, m.text])).toEqual([["info", info]]);
  });

  test("a job record the stream already advanced is not put back to queued", async () => {
    const job = "j-20261112T230000-bbbb";
    server({
      [RUN]: () => {
        useJobs.getState().onJobEvent(jobEvent({ id: job, state: "running" }));
        return { status: 202, json: { job } };
      },
    });
    await mounted();
    await user.click(runNow());
    await user.click(within(confirmDialog()).getByRole("button", { name: t("dialog.ok") }));
    await screen.findByText(msg("daily.queued", { job }));
    expect(useJobs.getState().jobs[job].state).toBe("running");
  });

  test("a 409 (a job for that day is already waiting or running) gets a Thai message and no job record", async () => {
    server({ [RUN]: { status: 409, json: { code: "JOB_RUNNING", text: "มี job อยู่", field: null, detail: "j-x" } } });
    await mounted();
    await user.click(runNow());
    await user.click(within(confirmDialog()).getByRole("button", { name: t("dialog.ok") }));
    expect((await screen.findByRole("alert")).textContent).toBe(msg("daily.runConflict"));
    expect(useJobs.getState().jobs).toEqual({});
    expect(runNow().disabled).toBe(false);
  });

  test("any other failure is reported in the Message Viewer and in the window", async () => {
    server({ [RUN]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    await mounted();
    await user.click(runNow());
    await user.click(within(confirmDialog()).getByRole("button", { name: t("dialog.ok") }));
    expect((await screen.findByRole("alert")).textContent).toBe(msg("daily.runFailed", { message: "พัง" }));
    expect(useMessages.getState().items.map((m) => m.code)).toEqual(["INTERNAL"]);
  });

  test("the button is off while the request is on its way, so it cannot send twice", async () => {
    const gate = deferred<void>();
    const f = server({ [RUN]: async () => { await gate.promise; return { status: 202, json: { job: "j-1" } }; } });
    await mounted();
    await user.click(runNow());
    await user.click(within(confirmDialog()).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(runNow().disabled).toBe(true));
    fireEvent.click(runNow());
    gate.resolve();
    await screen.findByText(msg("daily.queued", { job: "j-1" }));
    expect(f.count(RUN)).toBe(1);
  });

  test("the button is off while a daily job is queued or running, and on again when it ends", async () => {
    server();
    await mounted();
    act(() => useJobs.getState().onJobEvent(jobEvent({ state: "queued" })));
    expect(runNow().disabled).toBe(true);
    act(() => useJobs.getState().onJobEvent(jobEvent({ state: "succeeded" })));
    expect(runNow().disabled).toBe(false);
  });

  test("a job of another kind does not turn it off", async () => {
    server();
    await mounted();
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-f", kind: "fetch", state: "running" })));
    expect(runNow().disabled).toBe(false);
  });

  test("it is off, with a Thai reason, while the daily status says running even though no job record is known", async () => {
    const running = { ...HEALTH, daily: { state: "running", last_run_utc: null, next_run_utc: null, for_date: "2026-11-13" } };
    const f = server({ "GET /api/health": { json: running } });
    await mounted();
    await waitFor(() => expect(runNow().disabled).toBe(true));
    expect(useJobs.getState().jobs).toEqual({});
    expect(screen.getByText(msg("daily.runningNow"))).toBeDefined();
    expect(runNow().title).toBe(msg("daily.runningNow"));
    fireEvent.click(runNow());
    expect(f.count(RUN)).toBe(0);
    // the stream says it ended: the button comes back and the reason goes
    act(() => useJobs.getState().onDailyEvent({ state: "ok", last_run_utc: "2026-11-12T10:05:00Z", next_run_utc: null, for_date: "2026-11-13" }));
    expect(runNow().disabled).toBe(false);
    expect(screen.queryByText(msg("daily.runningNow"))).toBeNull();
  });

  test("a queued or running daily job shows the same reason", async () => {
    server();
    await mounted();
    expect(screen.queryByText(msg("daily.runningNow"))).toBeNull();
    act(() => useJobs.getState().onJobEvent(jobEvent({ state: "running" })));
    expect(screen.getByText(msg("daily.runningNow"))).toBeDefined();
  });

  test("says that it runs with the saved settings", async () => {
    server();
    await mounted();
    expect(screen.getByText(msg("daily.runNowHint"))).toBeDefined();
  });

  test("never calls the daily endpoint by being open or by saving", async () => {
    const f = server();
    await mounted();
    await user.click(enabled());
    await user.click(apply());
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(f.count(RUN)).toBe(0);
  });
});

describe("a token saved elsewhere while this window is open (Globe Manager)", () => {
  /** server ที่จำเอกสารล่าสุด: GET ตอบสิ่งที่ PUT ครั้งก่อนบันทึก (ต่างจาก server() ที่ตอบค่าเดิมเสมอ) */
  function statefulServer() {
    let doc: unknown = SETTINGS;
    return server({
      "GET /api/settings": () => ({ json: doc }),
      [PUT]: (call) => {
        doc = call.body;
        return { json: doc };
      },
    });
  }

  /** เปิดทั้งสองหน้าต่างพร้อมกัน (Daily อ่านค่าตั้งแล้วจึงถือ token เดิมไว้ในฟอร์ม) แล้วบันทึก token ใหม่จาก Globe Manager ด้วยหน้าต่างจริง */
  async function saveTokenFromGlobeManager(newToken: string) {
    const daily = await mounted();
    useImagery.setState({ loaded: true, layers: [], sources: { gibs: false, eox: false, osm: false, ion: false } });
    const globe = render(<GlobeManager params={{}} panelId="globeManager" />);
    const field = within(globe.container).getByLabelText(t("field.cesiumToken")) as HTMLInputElement;
    await user.type(field, newToken);
    await user.click(within(globe.container).getByRole("button", { name: t("dialog.apply") }));
    await waitFor(() => expect(useSettings.getState().settings?.cesium_ion_token).toBe(newToken));
    await waitFor(() => expect(field.value).toBe(""));
    return { daily, globe };
  }

  const dailyApply = (container: HTMLElement) => within(container).getByRole("button", { name: t("dialog.apply") }) as HTMLButtonElement;
  const dailyToken = (container: HTMLElement) => within(container).getByLabelText(t("field.cesiumToken")) as HTMLInputElement;

  test("editing another field and pressing Apply sends the token saved in the Globe Manager, not the one the form loaded", async () => {
    const f = statefulServer();
    const { daily } = await saveTokenFromGlobeManager("tok-new");
    expect(puts(f)).toHaveLength(1); // the Globe Manager's own save
    await replace(within(daily.container).getByLabelText(t("field.retention")) as HTMLInputElement, "45");
    await user.click(dailyApply(daily.container));
    await waitFor(() => expect(puts(f)).toHaveLength(2));
    expect((puts(f)[1].body as { cesium_ion_token: unknown }).cesium_ion_token).toBe("tok-new");
    expect(puts(f)[1].body).toEqual({ daily: { ...SETTINGS.daily, retention_days: 45 }, cesium_ion_token: "tok-new", online_imagery: IMAGERY_OFF });
    expect(useSettings.getState().settings?.cesium_ion_token).toBe("tok-new");
  });

  test("the token field follows the store while the user has not edited it, and that is not an edit (Apply stays off)", async () => {
    statefulServer();
    const { daily } = await saveTokenFromGlobeManager("tok-new");
    expect(dailyToken(daily.container).value).toBe("tok-new");
    expect(dailyApply(daily.container).disabled).toBe(true);
  });

  test("a token the user typed in this window is kept and sent when the store's token changes meanwhile", async () => {
    const f = statefulServer();
    const daily = await mounted();
    await replace(dailyToken(daily.container), "typed-here");
    act(() => useSettings.setState({ settings: { ...SETTINGS, cesium_ion_token: "tok-elsewhere" } }));
    expect(dailyToken(daily.container).value).toBe("typed-here");
    await user.click(dailyApply(daily.container));
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect((puts(f)[0].body as { cesium_ion_token: unknown }).cesium_ion_token).toBe("typed-here");
  });

  test("clearing the token in this window still sends the empty string after another window changed it", async () => {
    const f = statefulServer();
    const daily = await mounted();
    act(() => useSettings.setState({ settings: { ...SETTINGS, cesium_ion_token: "tok-elsewhere" } }));
    await replace(dailyToken(daily.container), "");
    await user.click(dailyApply(daily.container));
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect((puts(f)[0].body as { cesium_ion_token: unknown }).cesium_ion_token).toBe("");
  });

  test("a token changed in the store after the other fields were edited reaches the PUT (the other edits stay)", async () => {
    const f = statefulServer();
    const daily = await mounted();
    await replace(within(daily.container).getByLabelText(t("field.retention")) as HTMLInputElement, "45");
    act(() => useSettings.setState({ settings: { ...SETTINGS, cesium_ion_token: "tok-late" } }));
    expect((within(daily.container).getByLabelText(t("field.retention")) as HTMLInputElement).value).toBe("45");
    await user.click(dailyApply(daily.container));
    await waitFor(() => expect(puts(f)).toHaveLength(1));
    expect(puts(f)[0].body).toEqual({ daily: { ...SETTINGS.daily, retention_days: 45 }, cesium_ion_token: "tok-late", online_imagery: IMAGERY_OFF });
  });
});

describe("registration", () => {
  test("registerDailyForecastSettingsPanel swaps the placeholder for the window and keeps the panel's flags", () => {
    registerDailyForecastSettingsPanel();
    const def = getPanelDef("dailyForecastSettings")!;
    expect(def.component).toBe(DailyForecastSettings);
    expect([def.persist, def.scenarioBound, def.type, def.singleton]).toEqual([false, false, "floating", true]);
  });
});
