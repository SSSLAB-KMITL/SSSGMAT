import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "../../src/api/client";
import { StatusBar } from "../../src/chrome/StatusBar";
import * as commands from "../../src/commands";
import { registerCommand } from "../../src/commands";
import type { CatalogEntry } from "../../src/data/catalog";
import type { DopRow, EphemManifest } from "../../src/data/files";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { useJobs, type Job } from "../../src/stores/jobs";
import { useLayout } from "../../src/stores/layout";
import { report, useMessages } from "../../src/stores/messages";
import { useResults } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { useSelection } from "../../src/stores/selection";
import { useSettings } from "../../src/stores/settings";
import { useTime } from "../../src/stores/time";
import { Workspace } from "../../src/Workspace";
import { makeDoc, openScenario, resetWithCoreCommands } from "./helpers/chrome";

let disposeCore: () => void;
beforeEach(() => {
  disposeCore = resetWithCoreCommands();
  openScenario();
  useSettings.setState({ connected: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  disposeCore();
});

/** ช่องของแถบสถานะตามชื่อ (data-field) */
const field = (name: string) => document.querySelector<HTMLElement>(`[data-field="${name}"]`);
const fieldText = (name: string) => field(name)?.textContent ?? null;

describe("fields", () => {
  test("Active Object shows the path of the selected object", () => {
    render(<StatusBar />);
    expect(fieldText("activeObject")).toBe("");
    act(() => useSelection.getState().select("*/Satellite/G01"));
    expect(fieldText("activeObject")).toBe("*/Satellite/G01");
    expect(field("activeObject")?.getAttribute("aria-label")).toBe(t("status.activeObject"));
  });

  test("Lat/Lon follows the mouse on the 2D map and is blank outside it", () => {
    render(<StatusBar />);
    expect(fieldText("latLon")).toBe("");
    act(() => useSelection.getState().setCursor([13.7563, 100.5018]));
    expect(fieldText("latLon")).toBe("13.76°, 100.50°");
    act(() => useSelection.getState().setCursor([-33.8688, -70.5]));
    expect(fieldText("latLon")).toBe("-33.87°, -70.50°");
    act(() => useSelection.getState().setCursor(null));
    expect(fieldText("latLon")).toBe("");
  });

  test("moving the mouse over the map re-renders only the Lat/Lon field, not the whole bar", () => {
    render(<StatusBar />);
    const isEnabled = vi.spyOn(commands, "isEnabled"); // the message and flagged buttons ask this each time they render
    isEnabled.mockClear();
    act(() => useSelection.getState().setCursor([13.7563, 100.5018]));
    expect(fieldText("latLon")).toBe("13.76°, 100.50°");
    expect(isEnabled).not.toHaveBeenCalled();
    isEnabled.mockRestore();
  });

  test("Animation Time is in the scenario's DateFormat (UTCG)", () => {
    render(<StatusBar />);
    expect(fieldText("animationTime")).toBe("12 Nov 2026 00:00:00.000 UTCG");
  });

  test("Animation Time is in LTZG with its offset when the scenario uses LTZG", () => {
    openScenario(makeDoc({ units: { date_format: "LTZG", ltz_offset: "+07:00" } }));
    render(<StatusBar />);
    expect(fieldText("animationTime")).toContain("LTZG+07:00");
    expect(fieldText("animationTime")).toBe("12 Nov 2026 07:00:00.000 LTZG+07:00");
  });

  test("Animation Time follows the clock, and Time Step follows the step buttons", () => {
    render(<StatusBar />);
    expect(fieldText("timeStep")).toBe("60.00 sec");
    act(() => useTime.getState().setCurrent(new Date(Date.UTC(2026, 10, 12, 1, 2, 3))));
    expect(fieldText("animationTime")).toBe("12 Nov 2026 01:02:03.000 UTCG");
    act(() => useTime.getState().increaseStep());
    expect(fieldText("timeStep")).toBe("180.00 sec");
  });

  test("the fields are named by labels.ts", () => {
    render(<StatusBar />);
    expect(field("animationTime")?.getAttribute("aria-label")).toBe(t("status.animationTime"));
    expect(field("timeStep")?.getAttribute("aria-label")).toBe(t("status.timeStep"));
    expect(field("latLon")?.getAttribute("aria-label")).toBe(t("status.latLon"));
    expect(field("maxDataAge")?.getAttribute("aria-label")).toBe(t("status.maxDataAge"));
  });
});

describe("connection", () => {
  test("is red with the Thai text when the server is not connected", () => {
    useSettings.setState({ connected: false });
    render(<StatusBar />);
    const box = field("connection")!;
    expect(box.textContent).toBe(msg("server.disconnected"));
    expect(box.className).toContain("status-disconnected");
  });

  test("shows nothing red once connected", () => {
    render(<StatusBar />);
    expect(field("connection")).toBeNull();
    expect(screen.queryByText(msg("server.disconnected"))).toBeNull();
  });

  test("reacts when the connection drops", () => {
    render(<StatusBar />);
    act(() => useSettings.setState({ connected: false }));
    expect(fieldText("connection")).toBe(msg("server.disconnected"));
  });
});

describe("usable satellites and PDOP (W10)", () => {
  const dop = (iso: string, pdop: number | null, n: number): DopRow => ({
    time_utc: iso, t: Date.parse(iso), n_visible: n, gdop: null, pdop, hdop: null, vdop: null, edop: null, ndop: null, tdop: null,
  });

  test("shows PDOP and the number of usable satellites at the animation time", () => {
    useResults.setState({ dop: [dop("2026-11-12T00:00:00Z", 0.85, 41), dop("2026-11-12T00:00:30Z", 1.2, 38)] });
    render(<StatusBar />);
    expect(fieldText("pdop")).toBe("PDOP 0.85 (41)");
    expect(field("pdop")?.getAttribute("aria-label")).toBe(t("status.usableSatellites"));
    act(() => useTime.getState().setCurrent(new Date("2026-11-12T00:00:45Z")));
    expect(fieldText("pdop")).toBe("PDOP 1.20 (38)");
  });

  test("shows a dash when there is no DOP at that time", () => {
    useResults.setState({ dop: [dop("2026-11-12T00:00:00Z", 0.85, 41), dop("2026-11-12T00:00:30Z", 1.2, 38)] });
    render(<StatusBar />);
    act(() => useTime.getState().setCurrent(new Date("2026-11-11T00:00:00Z"))); // before the first row
    expect(fieldText("pdop")).toBe("—");
  });

  test("shows a dash when the row has no PDOP (fewer than four satellites)", () => {
    useResults.setState({ dop: [dop("2026-11-12T00:00:00Z", null, 3)] });
    render(<StatusBar />);
    expect(fieldText("pdop")).toBe("—");
  });

  test("shows a dash when there are no results at all", () => {
    render(<StatusBar />);
    expect(fieldText("pdop")).toBe("—");
  });
});

describe("max data age", () => {
  const sat = (norad: number, age: number | null, propagated: boolean) => ({
    prn: `G${norad}`, system: "GPS", svn: "", norad, block: "", celestrak_name: "", omm_epoch: "", age_days: age, flags: [], propagated,
  });
  const manifest = (satellites: ReturnType<typeof sat>[]) => ({ satellites }) as unknown as EphemManifest;

  test("is the largest age_days of the satellites that were propagated", () => {
    useResults.setState({ manifest: manifest([sat(1, 0.5, true), sat(2, 2.46, true), sat(3, 9, false)]) });
    render(<StatusBar />);
    expect(fieldText("maxDataAge")).toBe("2.5 d");
  });

  test("is a dash with no manifest, no propagated satellite, or no age", () => {
    render(<StatusBar />);
    expect(fieldText("maxDataAge")).toBe("—");
    act(() => useResults.setState({ manifest: manifest([sat(3, 9, false), sat(4, null, true)]) }));
    expect(fieldText("maxDataAge")).toBe("—");
  });
});

describe("flagged satellites", () => {
  const entry = (norad: number, flags: string[]): CatalogEntry => ({
    prn: `G${norad}`, system: "GPS", svn: "", norad, block: "", celestrak_name: "", omm_epoch: "", age_days: 1, flags,
  });
  const sat = (name: string, norad: number) => ({ class: "Satellite" as const, name, norad });

  function openWithSatellites() {
    const doc = makeDoc({
      objects: [sat("G01", 1), sat("G02", 2), sat("G03", 3), sat("G04", 4), { class: "Facility", name: "THBK", lat: 13, lon: 100, alt_m: 0 } as never],
    });
    useScenario.setState({
      name: doc.name, doc,
      catalog: new Map([[1, entry(1, ["stale"])], [2, entry(2, ["name_mismatch"])], [3, entry(3, [])], [4, entry(4, ["too_old", "unhealthy"])]]),
    });
  }

  test("counts the scenario's satellites with a warning flag (a name mismatch alone is not one)", () => {
    openWithSatellites();
    render(<StatusBar />);
    expect(fieldText("flagged")).toContain("2");
    expect(field("flagged")?.getAttribute("aria-label")).toBe(t("status.flaggedSatellites"));
  });

  test("counts a renamed copy by NORAD, and ignores satellites missing from the catalog", () => {
    const doc = makeDoc({ objects: [sat("GPS01", 1), sat("G01_1", 1), sat("X", 99)] });
    useScenario.setState({ name: doc.name, doc, catalog: new Map([[1, entry(1, ["stale"])]]) });
    render(<StatusBar />);
    expect(fieldText("flagged")).toContain("2");
  });

  test("clicking it runs ob.showFlagged", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    openWithSatellites();
    render(<StatusBar />);
    act(() => registerCommand("ob.showFlagged", { label: "status.flaggedSatellites", run }));
    await user.click(within(field("flagged")!).getByRole("button"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("is aria-disabled until ob.showFlagged is registered", () => {
    openWithSatellites();
    render(<StatusBar />);
    expect(within(field("flagged")!).getByRole("button").getAttribute("aria-disabled")).toBe("true");
  });

  test("shows zero when nothing is flagged", () => {
    render(<StatusBar />);
    expect(fieldText("flagged")).toContain("0");
  });
});

describe("message icon", () => {
  const button = () => within(field("messages")!).getByRole("button", { name: new RegExp(t("window.messageViewer")) });

  test("counts unread errors and warnings but not infos", () => {
    render(<StatusBar />);
    expect(field("messages")?.textContent).toContain("0");
    act(() => {
      report("error", "E1", "e");
      report("warning", "W1", "w");
      report("info", "I1", "i");
    });
    expect(field("messages")?.textContent).toContain("2");
    expect(button().getAttribute("aria-label")).toContain("2");
  });

  test("clicking it opens the Message Viewer and marks what was there as read", async () => {
    const user = userEvent.setup();
    render(<Workspace footer={<StatusBar />} />);
    await waitFor(() => expect(useLayout.getState().api).not.toBeNull());
    const openPanel = vi.fn(() => "messageViewer");
    act(() => useLayout.setState({ openPanel }));
    act(() => report("error", "E1", "e"));
    expect(field("messages")?.textContent).toContain("1");
    await user.click(button());
    expect(openPanel).toHaveBeenCalledWith("messageViewer");
    expect(field("messages")?.textContent).toContain("0");
    act(() => report("warning", "W2", "w2"));
    expect(field("messages")?.textContent).toContain("1");
  });

  test("messages that arrive while the Message Viewer is showing count as read", async () => {
    render(<Workspace footer={<StatusBar />} />);
    await waitFor(() => expect(useLayout.getState().api).not.toBeNull());
    act(() => report("error", "E1", "hidden tab"));
    expect(field("messages")?.textContent).toContain("1"); // Timeline View is the visible tab at first
    act(() => useLayout.getState().api!.getPanel("messageViewer")!.api.setActive());
    await waitFor(() => expect(field("messages")?.textContent).toContain("0"));
    act(() => report("warning", "W1", "seen at once"));
    await waitFor(() => expect(field("messages")?.textContent).toContain("0"));
  });

  test("messages cleared with Clear all Tabs are no longer counted", () => {
    render(<StatusBar />);
    act(() => report("error", "E1", "e"));
    expect(field("messages")?.textContent).toContain("1");
    act(() => useMessages.getState().clearAll());
    expect(field("messages")?.textContent).toContain("0");
  });
});

describe("daily job", () => {
  const job = (over: Partial<Job>): Job => ({
    id: "j-20261112T000000-aaaa", kind: "analyze", scenario: "T", state: "running", progress: { stage: "propagate", fraction: 0.42 }, error: null, ...over,
  });

  test("shows the state of the daily forecast in Thai", () => {
    render(<StatusBar />);
    expect(fieldText("daily")).toContain(t("status.dailyForecast"));
    act(() => useJobs.getState().onDailyEvent({ state: "ok", last_run_utc: null, next_run_utc: null, for_date: null }));
    expect(fieldText("daily")).toContain(msg("daily.state.ok"));
    act(() => useJobs.getState().onDailyEvent({ state: "failed", last_run_utc: null, next_run_utc: null, for_date: null }));
    expect(fieldText("daily")).toContain(msg("daily.state.failed"));
    act(() => useJobs.getState().onDailyEvent({ state: "running", last_run_utc: null, next_run_utc: null, for_date: null }));
    expect(fieldText("daily")).toContain(msg("daily.state.running"));
    act(() => useJobs.getState().onDailyEvent({ state: "idle", last_run_utc: null, next_run_utc: null, for_date: null }));
    expect(fieldText("daily")).toContain(msg("daily.state.idle"));
  });

  test("shows no progress bar when no job is running", () => {
    render(<StatusBar />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("button", { name: t("status.stop") })).toBeNull();
  });

  test("shows the stage and percent of the open scenario's running job", () => {
    useJobs.setState({ jobs: { a: job({ id: "a" }) } });
    render(<StatusBar />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(field("job")?.textContent).toContain("propagate");
    expect(field("job")?.textContent).toContain("42%");
  });

  test("shows the daily job when no job of the open scenario runs", () => {
    useJobs.setState({ jobs: { d: job({ id: "d", kind: "daily", scenario: null, progress: { stage: "fetch", fraction: 0.1 } }) } });
    render(<StatusBar />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("10");
    expect(field("job")?.textContent).toContain("fetch");
  });

  test("a job of another scenario is not shown", () => {
    useJobs.setState({ jobs: { x: job({ id: "x", scenario: "OTHER" }) } });
    render(<StatusBar />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  test("a job without a fraction shows an indeterminate bar", () => {
    useJobs.setState({ jobs: { a: job({ id: "a", progress: { stage: "queued", fraction: null } }) } });
    render(<StatusBar />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
    expect(field("job")?.textContent).toContain("queued");
    expect(field("job")?.textContent).not.toContain("%");
  });

  test("Stop cancels that job", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn(() => Promise.resolve());
    useJobs.setState({ jobs: { a: job({ id: "a" }) }, cancel });
    render(<StatusBar />);
    await user.click(screen.getByRole("button", { name: t("status.stop") }));
    expect(cancel).toHaveBeenCalledWith("a");
  });

  test("a failed cancel is reported in the Message Viewer", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn(() => Promise.reject(new ApiError({ status: 409, code: "JOB_DONE", text: "งานจบแล้ว" })));
    useJobs.setState({ jobs: { a: job({ id: "a" }) }, cancel });
    render(<StatusBar />);
    await user.click(screen.getByRole("button", { name: t("status.stop") }));
    await vi.waitFor(() => expect(useMessages.getState().items.map((m) => m.code)).toContain("JOB_DONE"));
  });
});
