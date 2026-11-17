import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dialogs } from "../../src/chrome/Dialogs";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useJobs, type JobEvent } from "../../src/stores/jobs";
import { useMessages } from "../../src/stores/messages";
import { FetchOrbitData, registerFetchOrbitDataPanel } from "../../src/windows/FetchOrbitData/FetchOrbitData";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";
import { deferred, stubFetch, type Handler } from "./helpers/fake-fetch";

const ORBITS = [
  { name: "20261112T0000Z", time_utc: "2026-11-12T00:00:00Z", groups: { G: 31, R: 24, E: 28, C: 45 }, has_brdc: true },
  { name: "20261110T0000Z", time_utc: "2026-11-10T00:00:00Z", groups: { G: 31 }, has_brdc: false },
];
const STATUS = {
  groups: {
    "gps-ops": { last_request_utc: "2026-11-12T10:00:00Z", next_allowed_utc: "2026-11-12T12:00:00Z" },
    "glo-ops": { last_request_utc: "2026-11-12T09:15:30Z", next_allowed_utc: "2026-11-12T11:15:30Z" },
    galileo: { last_request_utc: null, next_allowed_utc: null },
    beidou: { last_request_utc: "2026-11-12T08:00:00Z", next_allowed_utc: "2026-11-12T10:00:00Z" },
  },
};
const NOW = new Date("2026-11-12T11:00:00Z");
const DASH = "—";
const POST_FETCH = "POST /api/orbits/fetch";

let user: ReturnType<typeof userEvent.setup>;

function server(over: Record<string, Handler> = {}) {
  return stubFetch({
    "GET /api/orbits": { json: ORBITS },
    "GET /api/orbits/fetch-status": { json: STATUS },
    [POST_FETCH]: { status: 202, json: { job: "j-20261112T110000-aaaa" } },
    ...over,
  });
}

function mount() {
  return render(
    <>
      <FetchOrbitData params={{}} panelId="fetchOrbitData" />
      <Dialogs />
    </>,
  );
}

async function mounted() {
  const result = mount();
  await screen.findByText("20261112T0000Z");
  return result;
}

const fetchNow = () => screen.getByRole("button", { name: t("dialog.fetchNow") }) as HTMLButtonElement;
const groupRow = (system: string): HTMLTableRowElement => screen.getByRole("row", { name: new RegExp(`^${system}`) }) as HTMLTableRowElement;
const cells = (row: HTMLTableRowElement) => Array.from(row.cells).map((c) => c.textContent);
const count = (f: ReturnType<typeof stubFetch>, route: string) => f.count(route);
const jobEvent = (over: Partial<JobEvent> = {}): JobEvent => ({
  id: "j-20261112T110000-aaaa", kind: "fetch", scenario: null, state: "succeeded", progress: { stage: null, fraction: 1 }, ...over,
});

beforeEach(() => {
  resetAll();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  user = userEvent.setup();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("what it shows", () => {
  test("the newest snapshot: its name, its time in UTCG when no scenario is open, and whether it carries broadcast data", async () => {
    server();
    await mounted();
    const latest = screen.getByRole("region", { name: t("field.latestSnapshot") });
    expect(within(latest).getByText("20261112T0000Z")).toBeDefined();
    expect(within(latest).getByText("12 Nov 2026 00:00:00.000 UTCG")).toBeDefined();
    expect(within(latest).getByText(msg("fetch.yes"))).toBeDefined();
    expect(screen.queryByText("20261110T0000Z")).toBeNull(); // only the newest
  });

  test("the snapshot time follows the open scenario's DateFormat", async () => {
    openScenario(makeDoc({ units: { date_format: "LTZG", ltz_offset: "+07:00" } as never }));
    server();
    await mounted();
    expect(screen.getByText("12 Nov 2026 07:00:00.000 LTZG+07:00")).toBeDefined();
  });

  test("a snapshot without broadcast data says so", async () => {
    server({ "GET /api/orbits": { json: [ORBITS[1]] } });
    mount();
    await screen.findByText("20261110T0000Z");
    expect(screen.getByText(msg("fetch.no"))).toBeDefined();
  });

  test("one row per system with the satellite count, the last request and the next time a fetch is allowed", async () => {
    server();
    await mounted();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      [t("field.system"), t("field.satellites"), t("field.lastRequest"), t("field.nextFetch")],
    );
    expect(cells(groupRow(t("option.system.gps")))).toEqual([t("option.system.gps"), "31", "12 Nov 2026 10:00:00.000 UTCG", "12 Nov 2026 12:00:00.000 UTCG"]);
    expect(cells(groupRow(t("option.system.glonass")))).toEqual([t("option.system.glonass"), "24", "12 Nov 2026 09:15:30.000 UTCG", "12 Nov 2026 11:15:30.000 UTCG"]);
    expect(cells(groupRow(t("option.system.galileo")))).toEqual([t("option.system.galileo"), "28", DASH, DASH]);
    // a time already in the past: fetching is possible now
    expect(cells(groupRow(t("option.system.beidou")))).toEqual([t("option.system.beidou"), "45", "12 Nov 2026 08:00:00.000 UTCG", msg("fetch.availableNow")]);
  });

  test("a system the snapshot lacks has a dash for its count", async () => {
    server({ "GET /api/orbits": { json: [ORBITS[1]] } });
    mount();
    await screen.findByText("20261110T0000Z");
    expect(cells(groupRow(t("option.system.galileo")))[1]).toBe(DASH);
    expect(cells(groupRow(t("option.system.gps")))[1]).toBe("31");
  });

  test("tells in Thai that the server enforces the CelesTrak limits", async () => {
    server();
    await mounted();
    expect(screen.getByText(msg("fetch.limitNote"))).toBeDefined();
    expect(msg("fetch.limitNote")).toMatch(/server/);
    expect(msg("fetch.limitNote")).toMatch(/CelesTrak/);
  });

  test("when every system must wait, the earliest time is stated", async () => {
    const waiting = {
      groups: {
        "gps-ops": { last_request_utc: "2026-11-12T10:00:00Z", next_allowed_utc: "2026-11-12T12:00:00Z" },
        "glo-ops": { last_request_utc: "2026-11-12T09:15:30Z", next_allowed_utc: "2026-11-12T11:15:30Z" },
        galileo: { last_request_utc: "2026-11-12T10:45:00Z", next_allowed_utc: "2026-11-12T12:45:00Z" },
        beidou: { last_request_utc: "2026-11-12T09:30:00Z", next_allowed_utc: "2026-11-12T11:30:00Z" },
      },
    };
    server({ "GET /api/orbits/fetch-status": { json: waiting } });
    await mounted();
    await waitFor(() => expect(screen.getByText(msg("fetch.nextAvailable", { time: "12 Nov 2026 11:15:30.000 UTCG" }))).toBeDefined());
  });

  test("no 'next time' sentence while some system can be fetched now", async () => {
    server();
    await mounted();
    expect(screen.queryByText(/ดึงจาก CelesTrak ได้อีกครั้งเวลา/)).toBeNull();
  });

  test("no snapshot yet: says so, still offers Fetch Now, and the table is dashes", async () => {
    server({ "GET /api/orbits": { json: [] } });
    mount();
    await screen.findByText(msg("fetch.noSnapshot"));
    expect(fetchNow().disabled).toBe(false);
    expect(cells(groupRow(t("option.system.gps")))[1]).toBe(DASH);
  });

  test("a failure to read the snapshots is reported in Thai, and the status table still shows", async () => {
    server({ "GET /api/orbits": { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    mount();
    expect((await screen.findByRole("alert")).textContent).toBe(msg("fetch.loadFailed", { message: "พัง" }));
    await waitFor(() => expect(cells(groupRow(t("option.system.gps")))[2]).toBe("12 Nov 2026 10:00:00.000 UTCG"));
  });

  test("a failure to read the status is reported in Thai, and the snapshot still shows", async () => {
    server({ "GET /api/orbits/fetch-status": { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    await mounted();
    expect((await screen.findByRole("alert")).textContent).toBe(msg("fetch.statusFailed", { message: "พัง" }));
    expect(cells(groupRow(t("option.system.gps")))[2]).toBe(DASH);
  });

  test("never talks to the fetch endpoint just by being open", async () => {
    const f = server();
    await mounted();
    expect(f.calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual(["GET /api/orbits", "GET /api/orbits/fetch-status"]);
  });
});

describe("Fetch Now", () => {
  test("asks first, in Thai, saying it downloads from CelesTrak; Cancel sends nothing", async () => {
    const f = server();
    await mounted();
    await user.click(fetchNow());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(msg("fetch.confirm"))).toBeDefined();
    expect(msg("fetch.confirm")).toMatch(/CelesTrak/);
    await user.click(within(dialog).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(count(f, POST_FETCH)).toBe(0);
    expect(useJobs.getState().jobs).toEqual({});
    expect(fetchNow().disabled).toBe(false);
  });

  const HOSTS = ["celestrak.org", "files.igs.org", "gdc.cddis.eosdis.nasa.gov"];
  const WAITING = {
    groups: Object.fromEntries(["gps-ops", "glo-ops", "galileo", "beidou"].map((g) => [g, { last_request_utc: "2026-11-12T10:30:00Z", next_allowed_utc: "2026-11-12T12:30:00Z" }])),
  };

  test("the confirmation names every host a fetch can contact: CelesTrak, IGS and CDDIS", async () => {
    server();
    await mounted();
    await user.click(fetchNow());
    const text = within(screen.getByRole("dialog")).getByText(msg("fetch.confirm")).textContent ?? "";
    for (const host of HOSTS) expect(text, host).toContain(host);
  });

  test("with every CelesTrak group still rate-limited the confirmation still says IGS and CDDIS may be contacted", async () => {
    server({ "GET /api/orbits/fetch-status": { json: WAITING } });
    await mounted();
    await screen.findByText(msg("fetch.nextAvailable", { time: "12 Nov 2026 12:30:00.000 UTCG" })); // every group must wait
    await user.click(fetchNow());
    const text = within(screen.getByRole("dialog")).getByText(msg("fetch.confirm")).textContent ?? "";
    for (const host of HOSTS) expect(text, host).toContain(host);
    expect(text).toMatch(/ยังอาจ/);
  });

  test("a window with no snapshot also names every host in its hint", async () => {
    server({ "GET /api/orbits": { json: [] } });
    mount();
    const hint = await screen.findByText(msg("fetch.noSnapshot"));
    for (const host of HOSTS) expect(hint.textContent, host).toContain(host);
  });

  test("Escape in the confirmation also sends nothing", async () => {
    const f = server();
    await mounted();
    await user.click(fetchNow());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(count(f, POST_FETCH)).toBe(0);
  });

  test("OK sends one POST /api/orbits/fetch, feeds the queued job to the job store and tells the user in Thai", async () => {
    const f = server();
    await mounted();
    await user.click(fetchNow());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(count(f, POST_FETCH)).toBe(1));
    const job = "j-20261112T110000-aaaa";
    await waitFor(() => expect(useJobs.getState().jobs[job]).toBeDefined());
    expect(useJobs.getState().jobs[job]).toMatchObject({ id: job, kind: "fetch", scenario: null, state: "queued", progress: { stage: null, fraction: null }, error: null });
    const info = msg("fetch.queued", { job });
    expect(screen.getByRole("status").textContent).toBe(info);
    expect(useMessages.getState().items.map((m) => [m.level, m.text])).toEqual([["info", info]]);
    expect(f.calls.find((c) => c.method === "POST")!.body).toBeUndefined();
  });

  test("a job record the stream already advanced is not put back to queued", async () => {
    const job = "j-20261112T110000-aaaa";
    server({
      [POST_FETCH]: () => {
        useJobs.getState().onJobEvent(jobEvent({ id: job, state: "running" })); // the SSE running event beat the response
        return { status: 202, json: { job } };
      },
    });
    await mounted();
    await user.click(fetchNow());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(screen.getByRole("status")).toBeDefined());
    expect(useJobs.getState().jobs[job].state).toBe("running");
  });

  test("the button is off while the request is on its way, so a quick second click cannot send twice", async () => {
    const gate = deferred<void>();
    const f = server({ [POST_FETCH]: async () => { await gate.promise; return { status: 202, json: { job: "j-1" } }; } });
    await mounted();
    await user.click(fetchNow());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(fetchNow().disabled).toBe(true));
    await user.click(fetchNow());
    gate.resolve();
    await screen.findByRole("status");
    expect(count(f, POST_FETCH)).toBe(1);
  });

  test("it is off while a fetch job is queued or running, with a note, and on again when the job ends", async () => {
    server();
    await mounted();
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-other", state: "running" })));
    expect(fetchNow().disabled).toBe(true);
    expect(screen.getByText(msg("fetch.running"))).toBeDefined();
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-other", state: "failed" })));
    expect(fetchNow().disabled).toBe(false);
    expect(screen.queryByText(msg("fetch.running"))).toBeNull();
  });

  test("a job of another kind does not turn it off", async () => {
    server();
    await mounted();
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-p", kind: "propagate", scenario: "E2E", state: "running" })));
    expect(fetchNow().disabled).toBe(false);
  });

  test("a failed request is reported in the Message Viewer and in the window, and the button comes back", async () => {
    server({ [POST_FETCH]: { status: 500, json: { code: "INTERNAL", text: "พัง", field: null, detail: null } } });
    await mounted();
    await user.click(fetchNow());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    expect((await screen.findByRole("alert")).textContent).toBe(msg("fetch.failed", { message: "พัง" }));
    expect(useMessages.getState().items.map((m) => m.code)).toEqual(["INTERNAL"]);
    expect(useJobs.getState().jobs).toEqual({});
    expect(fetchNow().disabled).toBe(false);
  });
});

describe("after the job", () => {
  async function started() {
    const f = server();
    await mounted();
    await user.click(fetchNow());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
    await screen.findByRole("status");
    return f;
  }

  test("when the fetch job succeeds the snapshot list and the status are read again", async () => {
    const f = await started();
    expect(count(f, "GET /api/orbits")).toBe(1);
    f.routes["GET /api/orbits"] = { json: [{ name: "20261112T1100Z", time_utc: "2026-11-12T11:00:00Z", groups: { G: 32 }, has_brdc: true }, ...ORBITS] };
    act(() => useJobs.getState().onJobEvent(jobEvent({ state: "running" })));
    expect(count(f, "GET /api/orbits")).toBe(1);
    act(() => useJobs.getState().onJobEvent(jobEvent({ state: "succeeded" })));
    await screen.findByText("20261112T1100Z");
    expect(count(f, "GET /api/orbits")).toBe(2);
    expect(count(f, "GET /api/orbits/fetch-status")).toBe(2);
  });

  test("a failed or cancelled job reads nothing again", async () => {
    const f = await started();
    act(() => useJobs.getState().onJobEvent(jobEvent({ state: "running" })));
    act(() => useJobs.getState().onJobEvent(jobEvent({ state: "failed" })));
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-2", state: "queued" })));
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-2", state: "cancelled" })));
    await act(async () => undefined);
    expect(count(f, "GET /api/orbits")).toBe(1);
  });

  test("another kind of job succeeding reads nothing again", async () => {
    const f = await started();
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-p", kind: "propagate", scenario: "E2E", state: "running" })));
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-p", kind: "propagate", scenario: "E2E", state: "succeeded" })));
    await act(async () => undefined);
    expect(count(f, "GET /api/orbits")).toBe(1);
  });

  test("a fetch job that shows up already finished (history from a reconnect) reads nothing again", async () => {
    const f = server();
    await mounted();
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-old", state: "succeeded" })));
    await act(async () => undefined);
    expect(count(f, "GET /api/orbits")).toBe(1);
  });

  test("a fetch started elsewhere (another tab, queued then succeeded over the stream) also refreshes the window", async () => {
    const f = server();
    await mounted();
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-tab", state: "queued" })));
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-tab", state: "succeeded" })));
    await waitFor(() => expect(count(f, "GET /api/orbits")).toBe(2));
  });

  test("the daily job's own fetch also changes the snapshot list, so its success refreshes too", async () => {
    const f = server();
    await mounted();
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-daily", kind: "daily", state: "running" })));
    act(() => useJobs.getState().onJobEvent(jobEvent({ id: "j-daily", kind: "daily", state: "succeeded" })));
    await waitFor(() => expect(count(f, "GET /api/orbits")).toBe(2));
  });

  test("after the window is closed a finishing job reads nothing", async () => {
    const f = server();
    const { unmount } = await mounted();
    act(() => useJobs.getState().onJobEvent(jobEvent({ state: "running" })));
    unmount();
    act(() => useJobs.getState().onJobEvent(jobEvent({ state: "succeeded" })));
    await act(async () => undefined);
    expect(count(f, "GET /api/orbits")).toBe(1);
  });
});

// ข2 amendment (ab): ช่อง Imaging satellites (ปิดเป็นค่าตั้งต้น) ติ๊ก = systems มี X ต่อท้าย ไม่ติ๊ก = คำขอเดิมทุกไบต์ (ไม่มี body)
describe("Imaging satellites", () => {
  const imagingBox = () => screen.getByRole("checkbox", { name: t("dialog.fetch.imagingSatellites") }) as HTMLInputElement;
  const confirmOk = async () => {
    await user.click(fetchNow());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dialog.ok") }));
  };

  test("is off by default, with a Thai hint naming the CelesTrak groups weather, science and visual", async () => {
    server();
    await mounted();
    expect(imagingBox().checked).toBe(false);
    expect(screen.getByText(msg("fetch.imagingHint"))).toBeDefined();
  });

  test("the hint describes the checkbox (aria-describedby) (M7)", async () => {
    server();
    await mounted();
    const id = imagingBox().getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe(msg("fetch.imagingHint"));
  });

  test("unticked sends the old request unchanged (no body: the server's default GREC)", async () => {
    const f = server();
    await mounted();
    await confirmOk();
    await waitFor(() => expect(count(f, POST_FETCH)).toBe(1));
    expect(f.calls.find((c) => c.method === "POST")!.body).toBeUndefined();
  });

  test("ticked sends systems GRECX (the four GNSS systems with X appended)", async () => {
    const f = server();
    await mounted();
    await user.click(imagingBox());
    expect(imagingBox().checked).toBe(true);
    await confirmOk();
    await waitFor(() => expect(count(f, POST_FETCH)).toBe(1));
    expect(f.calls.find((c) => c.method === "POST")!.body).toEqual({ systems: "GRECX" });
  });

  test("Cancel with it ticked still sends nothing", async () => {
    const f = server();
    await mounted();
    await user.click(imagingBox());
    await user.click(fetchNow());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("dialog.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(count(f, POST_FETCH)).toBe(0);
  });
});

describe("registration", () => {
  test("registerFetchOrbitDataPanel swaps the placeholder for the window and keeps the panel's flags", () => {
    registerFetchOrbitDataPanel();
    const def = getPanelDef("fetchOrbitData")!;
    expect(def.component).toBe(FetchOrbitData);
    expect([def.persist, def.scenarioBound, def.type, def.singleton]).toEqual([false, false, "floating", true]);
  });
});
