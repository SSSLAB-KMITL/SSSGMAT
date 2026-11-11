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
  const failed = (over: Partial<Job> = {}): Job => ({
    id: "j-20261112T000000-aaaa", kind: "analyze", scenario: "T", state: "failed", origin: "user",
    progress: { stage: null, fraction: null },
    error: { code: "GMAT_FAILED", text: "GMAT ล้มเหลว", detail: "line 1\nline 2" },
    ...over,
  });
  const setJobs = (...jobs: Job[]) => act(() => useJobs.setState({ jobs: Object.fromEntries(jobs.map((j) => [j.id, j])) }));

  test("appears for a failed user job of the open scenario, with the server's text", () => {
    render(<Dialogs />);
    setJobs(failed());
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("GMAT ล้มเหลว");
    expect(dialog.textContent).toContain(msg("job.failed", { message: "GMAT ล้มเหลว" }));
  });

  test("Details reveals error.detail", async () => {
    const user = userEvent.setup();
    render(<Dialogs />);
    setJobs(failed());
    expect(screen.queryByText(/line 1/)).toBeNull();
    await user.click(screen.getByRole("button", { name: t("mv.details") }));
    expect(screen.getByText(/line 1/).textContent).toBe("line 1\nline 2");
    await user.click(screen.getByRole("button", { name: t("mv.details") })); // toggles
    expect(screen.queryByText(/line 1/)).toBeNull();
  });

  test("there is no Details button when the job has no detail", () => {
    render(<Dialogs />);
    setJobs(failed({ error: { code: "X", text: "ล้มเหลว", detail: null } }));
    expect(screen.queryByRole("button", { name: t("mv.details") })).toBeNull();
  });

  test("appears once per job: closing it and a later update of the same job do not bring it back", async () => {
    const user = userEvent.setup();
    render(<Dialogs />);
    setJobs(failed());
    await user.click(screen.getByRole("button", { name: t("dialog.ok") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    setJobs(failed({ progress: { stage: "x", fraction: 1 } }));
    act(() => useJobs.getState().onJobEvent({ id: failed().id, kind: "analyze", scenario: "T", state: "failed", progress: { stage: null, fraction: null } }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a second failed job comes after the first is closed", async () => {
    const user = userEvent.setup();
    render(<Dialogs />);
    setJobs(failed({ id: "a", error: { code: "A", text: "ตัวแรก", detail: null } }), failed({ id: "b", error: { code: "B", text: "ตัวที่สอง", detail: null } }));
    expect(screen.getByRole("dialog").textContent).toContain("ตัวแรก");
    await user.click(screen.getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("ตัวที่สอง"));
    await user.click(screen.getByRole("button", { name: t("dialog.ok") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("does not appear for a job of another scenario, a scheduler job, or a job that did not fail", () => {
    render(<Dialogs />);
    setJobs(
      failed({ id: "a", scenario: "OTHER" }), failed({ id: "b", origin: "scheduler" }), failed({ id: "c", scenario: null }),
      failed({ id: "d", state: "succeeded" }), failed({ id: "e", state: "cancelled" }), failed({ id: "f", state: "running" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("does not appear for a job that failed before this page opened", () => {
    render(<Dialogs />);
    setJobs(failed({ finished_utc: "2020-01-01T00:00:00.000Z" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("appears for a job that failed after this page opened, even if it arrives in a refresh", () => {
    render(<Dialogs />);
    setJobs(failed({ finished_utc: new Date(Date.now() + 1000).toISOString() }));
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  test("a failed job event has no origin: the full record is fetched to find out whose job it was", async () => {
    const calls = stubFetch({ "GET /api/jobs": { json: [failed({ finished_utc: new Date(Date.now() + 1000).toISOString() })] } });
    render(<Dialogs />);
    act(() => useJobs.getState().onJobEvent({ id: failed().id, kind: "analyze", scenario: "T", state: "failed", progress: { stage: null, fraction: null }, error: failed().error }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());
    expect(calls.count("GET /api/jobs")).toBe(1);
  });

  test("a failed job event of the scheduler stays silent after the record is fetched", async () => {
    const calls = stubFetch({ "GET /api/jobs": { json: [failed({ origin: "scheduler" })] } });
    render(<Dialogs />);
    act(() => useJobs.getState().onJobEvent({ id: failed().id, kind: "analyze", scenario: "T", state: "failed", progress: { stage: null, fraction: null } }));
    await waitFor(() => expect(calls.count("GET /api/jobs")).toBe(1));
    await act(async () => undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
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
