import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { confirm, Dialogs } from "../../src/chrome/Dialogs";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { useJobs, type Job } from "../../src/stores/jobs";
import { useScenario } from "../../src/stores/scenario";
import { openScenario, resetAll } from "./helpers/chrome";
import { stubFetch } from "./helpers/fake-fetch";

beforeEach(() => {
  resetAll();
  openScenario();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("412 conflict dialog", () => {
  test("is closed while there is no conflict", () => {
    render(<Dialogs />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("opens when useScenario.conflict becomes true, with the Thai text and Reload / Cancel", () => {
    render(<Dialogs />);
    act(() => useScenario.setState({ conflict: true }));
    const dialog = screen.getByRole("dialog", { name: msg("conflict.title") });
    expect(within(dialog).getByText(msg("conflict.body"))).toBeDefined();
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual([t("dialog.reload"), t("dialog.cancel")]);
  });

  test("Reload calls reload()", async () => {
    const user = userEvent.setup();
    const reload = vi.fn(async () => {
      useScenario.setState({ conflict: false }); // the real reload() clears the flag once it has loaded
    });
    useScenario.setState({ conflict: true, reload });
    render(<Dialogs />);
    await user.click(screen.getByRole("button", { name: t("dialog.reload") }));
    expect(reload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("the dialog stays while the reload is loading, and stays open if reload() fails (flag still set)", async () => {
    const user = userEvent.setup();
    const reload = vi.fn(async () => undefined); // a failed reload leaves conflict = true
    useScenario.setState({ conflict: true, reload });
    render(<Dialogs />);
    await user.click(screen.getByRole("button", { name: t("dialog.reload") }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    await waitFor(() => expect((screen.getByRole("button", { name: t("dialog.reload") }) as HTMLButtonElement).disabled).toBe(false)); // can try again
  });

  test("Cancel clears the flag without reloading", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    useScenario.setState({ conflict: true, reload });
    render(<Dialogs />);
    await user.click(screen.getByRole("button", { name: t("dialog.cancel") }));
    expect(useScenario.getState().conflict).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("Escape is Cancel, and a click outside does not dismiss it", async () => {
    const user = userEvent.setup();
    useScenario.setState({ conflict: true });
    render(<Dialogs />);
    fireEvent.pointerDown(document.querySelector(".dlg-overlay")!); // outside the dialog box (body itself is pointer-events: none while modal)
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(useScenario.getState().conflict).toBe(true);
    await user.keyboard("{Escape}");
    expect(useScenario.getState().conflict).toBe(false);
  });

  test("the scenario store has clearConflict()", () => {
    useScenario.setState({ conflict: true });
    useScenario.getState().clearConflict();
    expect(useScenario.getState().conflict).toBe(false);
  });
});

describe("job failed dialog", () => {
  const job = (over: Partial<Job> = {}): Job => ({
    id: "j-20261112T000000-aaaa", kind: "analyze", scenario: "T", state: "running", origin: "user",
    progress: { stage: null, fraction: null }, error: null, ...over,
  });
  const failedJob = (over: Partial<Job> = {}): Job =>
    job({ state: "failed", error: { code: "GMAT_FAILED", text: "GMAT ล้มเหลว", detail: "line 1\nline 2" }, ...over });
  const setJobs = (...jobs: Job[]) => act(() => useJobs.setState({ jobs: Object.fromEntries(jobs.map((j) => [j.id, j])) }));
  /** a job this page sees running and then failing (the only thing that alerts) */
  const failLive = (over: Partial<Job> = {}) => {
    setJobs(job(over));
    setJobs(failedJob(over));
  };
  const eventOf = (j: Job) => ({ id: j.id, kind: j.kind, scenario: j.scenario, state: j.state, progress: j.progress, ...(j.error ? { error: j.error } : {}) });

  test("appears for a user job of the open scenario that the page saw run and then fail, with the server's text", () => {
    render(<Dialogs />);
    failLive();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("GMAT ล้มเหลว");
    expect(dialog.textContent).toContain(msg("job.failed", { message: "GMAT ล้มเหลว" }));
  });

  test("Details reveals error.detail", async () => {
    const user = userEvent.setup();
    render(<Dialogs />);
    failLive();
    expect(screen.queryByText(/line 1/)).toBeNull();
    await user.click(screen.getByRole("button", { name: t("mv.details") }));
    expect(screen.getByText(/line 1/).textContent).toBe("line 1\nline 2");
    await user.click(screen.getByRole("button", { name: t("mv.details") })); // toggles
    expect(screen.queryByText(/line 1/)).toBeNull();
  });

  test("there is no Details button when the job has no detail", () => {
    render(<Dialogs />);
    failLive({ error: { code: "X", text: "ล้มเหลว", detail: null } });
    expect(screen.queryByRole("button", { name: t("mv.details") })).toBeNull();
  });

  test("appears once per job: closing it and a later update of the same job do not bring it back", async () => {
    const user = userEvent.setup();
    render(<Dialogs />);
    failLive();
    await user.click(screen.getByRole("button", { name: t("dialog.ok") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    setJobs(failedJob({ progress: { stage: "x", fraction: 1 } }));
    act(() => useJobs.getState().onJobEvent(eventOf(failedJob())));
    setJobs(job()); // even running again and failing again is the same job id
    setJobs(failedJob());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a second failed job comes after the first is closed", async () => {
    const user = userEvent.setup();
    render(<Dialogs />);
    const a = { id: "a", error: { code: "A", text: "ตัวแรก", detail: null } };
    const b = { id: "b", error: { code: "B", text: "ตัวที่สอง", detail: null } };
    setJobs(job({ id: "a" }), job({ id: "b" }));
    setJobs(failedJob(a), failedJob(b));
    expect(screen.getByRole("dialog").textContent).toContain("ตัวแรก");
    await user.click(screen.getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("ตัวที่สอง"));
    await user.click(screen.getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("does not appear for a job of another scenario, a scheduler job, or a job that did not fail", () => {
    render(<Dialogs />);
    failLive({ id: "a", scenario: "OTHER" });
    failLive({ id: "b", origin: "scheduler" });
    failLive({ id: "c", scenario: null });
    setJobs(job({ id: "d" }), job({ id: "e" }), job({ id: "f" }));
    setJobs(failedJob({ id: "d", state: "succeeded" }), failedJob({ id: "e", state: "cancelled" }), job({ id: "f" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a job that was already failed when the jobs were first loaded is history and never alerts", () => {
    render(<Dialogs />);
    setJobs(failedJob({ finished_utc: new Date(Date.now() + 3_600_000).toISOString() })); // even one dated in the future
    expect(screen.queryByRole("dialog")).toBeNull();
    setJobs(failedJob({ progress: { stage: "again", fraction: 1 } })); // and later refreshes of it
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a job that failed before the page opened is history even if the open scenario is loaded later", () => {
    setJobs(failedJob());
    render(<Dialogs />);
    act(() => useScenario.setState({ name: "OTHER" }));
    act(() => useScenario.setState({ name: "T" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a job first seen failed in a later refresh, never seen queued or running, does not alert", () => {
    render(<Dialogs />);
    setJobs(job({ id: "other" }));
    setJobs(job({ id: "other" }), failedJob({ id: "missed" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a job that was running when the jobs were first loaded alerts when it fails", () => {
    setJobs(job());
    render(<Dialogs />);
    setJobs(failedJob());
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  test("a job seen queued alerts when a refresh later shows it failed (the failure event was missed)", () => {
    render(<Dialogs />);
    setJobs(job({ state: "queued" }));
    setJobs(failedJob());
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  describe("whatever the browser's clock says", () => {
    test.each([+10, -10])("with the clock %i minutes off from the server's, a job failing after page load alerts exactly once", async (minutes) => {
      const user = userEvent.setup();
      const serverNow = new Date().toISOString();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + minutes * 60_000);
      render(<Dialogs />);
      setJobs(job());
      setJobs(failedJob({ finished_utc: serverNow }));
      expect(screen.getByRole("dialog")).toBeDefined();
      await user.click(screen.getByRole("button", { name: t("dialog.ok") }));
      setJobs(failedJob({ finished_utc: serverNow, progress: { stage: "again", fraction: 1 } }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    test.each([+10, -10])("with the clock %i minutes off, an old failure from the first load still does not alert", (minutes) => {
      const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + minutes * 60_000);
      render(<Dialogs />);
      setJobs(failedJob({ finished_utc: old }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  test("a failed job event has no origin: the full record is fetched to find out whose job it was", async () => {
    const api = stubFetch({ "GET /api/jobs": () => ({ json: [failedJob()] }) });
    render(<Dialogs />);
    act(() => useJobs.getState().onJobEvent(eventOf(job())));
    act(() => useJobs.getState().onJobEvent(eventOf(failedJob())));
    expect(useJobs.getState().jobs[job().id].origin).toBeUndefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());
    expect(api.count("GET /api/jobs")).toBe(1);
  });

  test("a failed job event of the scheduler stays silent after the record is fetched", async () => {
    const api = stubFetch({ "GET /api/jobs": () => ({ json: [failedJob({ origin: "scheduler" })] }) });
    render(<Dialogs />);
    act(() => useJobs.getState().onJobEvent(eventOf(job())));
    act(() => useJobs.getState().onJobEvent(eventOf(failedJob())));
    await waitFor(() => expect(api.count("GET /api/jobs")).toBe(1));
    await act(async () => undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a fetch that fails is not counted as asked: the next job change asks again", async () => {
    let calls = 0;
    const api = stubFetch({
      "GET /api/jobs": () => (++calls === 1 ? { status: 500, json: { code: "X", text: "x" } } : { json: [failedJob()] }),
    });
    render(<Dialogs />);
    act(() => useJobs.getState().onJobEvent(eventOf(job())));
    act(() => useJobs.getState().onJobEvent(eventOf(failedJob())));
    await waitFor(() => expect(api.count("GET /api/jobs")).toBe(1));
    await act(async () => undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useJobs.getState().onJobEvent(eventOf(job({ id: "unrelated" })))); // any later change of the job list
    await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());
    expect(api.count("GET /api/jobs")).toBe(2);
  });

  test("a fetch that succeeds without the job is asked only once (no endless refreshing)", async () => {
    const api = stubFetch({ "GET /api/jobs": () => ({ json: [] }) });
    render(<Dialogs />);
    act(() => useJobs.getState().onJobEvent(eventOf(job())));
    act(() => useJobs.getState().onJobEvent(eventOf(failedJob())));
    await waitFor(() => expect(api.count("GET /api/jobs")).toBe(1));
    await act(async () => undefined);
    await act(async () => undefined);
    expect(api.count("GET /api/jobs")).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the queue is cleared when the open scenario changes", async () => {
    render(<Dialogs />);
    setJobs(job({ id: "a" }), job({ id: "b" }));
    setJobs(failedJob({ id: "a" }), failedJob({ id: "b" }));
    expect(screen.getByRole("dialog")).toBeDefined();
    act(() => useScenario.setState({ name: "OTHER" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useScenario.setState({ name: "T" }));
    expect(screen.queryByRole("dialog")).toBeNull(); // not brought back either
  });

  test("the jobs store says whether it could load the list", async () => {
    stubFetch({ "GET /api/jobs": { json: [failedJob()] } });
    await expect(useJobs.getState().fetchAll()).resolves.toBe(true);
    stubFetch({ "GET /api/jobs": { status: 500, json: { code: "X", text: "x" } } });
    await expect(useJobs.getState().fetchAll()).resolves.toBe(false);
    expect(Object.keys(useJobs.getState().jobs)).toEqual([job().id]); // kept what was there
  });
});

describe("confirm()", () => {
  test("resolves true on OK", async () => {
    const user = userEvent.setup();
    render(<Dialogs />);
    let answer: Promise<boolean>;
    act(() => {
      answer = confirm("ลบหรือไม่?");
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("ลบหรือไม่?")).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: t("dialog.ok") }));
    await expect(answer!).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("resolves false on Cancel", async () => {
    const user = userEvent.setup();
    render(<Dialogs />);
    let answer: Promise<boolean>;
    act(() => {
      answer = confirm("x");
    });
    await user.click(await screen.findByRole("button", { name: t("dialog.cancel") }));
    await expect(answer!).resolves.toBe(false);
  });

  test("resolves false on Escape", async () => {
    const user = userEvent.setup();
    render(<Dialogs />);
    let answer: Promise<boolean>;
    act(() => {
      answer = confirm("x");
    });
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await expect(answer!).resolves.toBe(false);
  });

  test("okLabel replaces the label of the OK button", async () => {
    render(<Dialogs />);
    act(() => void confirm("x", { okLabel: "Delete" }));
    expect(await screen.findByRole("button", { name: "Delete" })).toBeDefined();
    expect(screen.queryByRole("button", { name: t("dialog.ok") })).toBeNull();
  });

  test("focus starts on Cancel, so Enter does not delete by accident", async () => {
    render(<Dialogs />);
    act(() => void confirm("x"));
    const cancel = await screen.findByRole("button", { name: t("dialog.cancel") });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });

  test("focus is on Cancel for every queued request, not only the first", async () => {
    const user = userEvent.setup();
    render(<Dialogs />);
    act(() => {
      void confirm("one");
      void confirm("two");
    });
    const cancelOf = () => screen.getByRole("button", { name: t("dialog.cancel") });
    await waitFor(() => expect(document.activeElement).toBe(cancelOf()));
    await user.click(screen.getByRole("button", { name: t("dialog.ok") })); // answer the first
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("two"));
    await waitFor(() => expect(document.activeElement).toBe(cancelOf()));
  });

  test("two requests are asked one after the other", async () => {
    const user = userEvent.setup();
    render(<Dialogs />);
    let first: Promise<boolean>;
    let second: Promise<boolean>;
    act(() => {
      first = confirm("one");
      second = confirm("two");
    });
    expect((await screen.findByRole("dialog")).textContent).toContain("one");
    await user.click(screen.getByRole("button", { name: t("dialog.ok") }));
    await expect(first!).resolves.toBe(true);
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("two"));
    await user.click(screen.getByRole("button", { name: t("dialog.cancel") }));
    await expect(second!).resolves.toBe(false);
  });

  test("with no dialog host mounted it answers no, so nothing is deleted without being asked", async () => {
    await expect(confirm("x")).resolves.toBe(false);
  });

  test("a request still open when the host unmounts is answered no", async () => {
    const view = render(<Dialogs />);
    let answer: Promise<boolean>;
    act(() => {
      answer = confirm("x");
    });
    await screen.findByRole("dialog");
    view.unmount();
    await expect(answer!).resolves.toBe(false);
  });
});
