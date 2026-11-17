import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SaveAsDialog, useSaveAs } from "../../src/chrome/SaveAsDialog";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import * as recent from "../../src/recent";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { openScenario, resetAll } from "./helpers/chrome";
import { deferred, stubFetch, type Handler, type Reply } from "./helpers/fake-fetch";
import { fakeFlow, setUrl, type FakeFlow } from "./helpers/files";

let flow: FakeFlow;
let saveWorkbook: ReturnType<typeof vi.fn>;

const COPIED: Reply = { status: 201, json: { name: "COPY1" }, headers: { ETag: '"e2"' } };
const dialog = () => screen.queryByRole("dialog");
const name = () => screen.getByLabelText(t("field.name")) as HTMLInputElement;
const ok = () => screen.getByRole("button", { name: t("dialog.ok") });
const errorOf = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby") ?? "")?.textContent;

function server(over: Record<string, Handler> = {}) {
  return stubFetch({
    "POST /api/scenarios/T/copy": () => {
      flow.calls.push("copy");
      return COPIED;
    },
    ...over,
  });
}

function openDialog() {
  render(<SaveAsDialog />);
  act(() => useSaveAs.getState().show());
}

beforeEach(() => {
  resetAll();
  localStorage.clear();
  setUrl("?test");
  flow = fakeFlow();
  openScenario();
  saveWorkbook = vi.fn(async () => {
    flow.calls.push("saveWorkbook");
  });
  useLayout.setState({ saveWorkbook } as never);
  useSaveAs.setState({ open: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("opening", () => {
  test("is closed until Save As is asked for", () => {
    render(<SaveAsDialog />);
    expect(dialog()).toBeNull();
    act(() => useSaveAs.getState().show());
    expect(dialog()).not.toBeNull();
    expect(screen.getByText(t("menu.file.saveAs"))).toBeDefined();
  });

  test("starts with an empty Name field that has the focus", () => {
    openDialog();
    expect(name().value).toBe("");
    expect(document.activeElement).toBe(name());
  });

  test("forgets what was typed once closed", async () => {
    const user = userEvent.setup();
    openDialog();
    await user.type(name(), "half");
    await user.click(screen.getByRole("button", { name: t("dialog.cancel") }));
    expect(dialog()).toBeNull();
    act(() => useSaveAs.getState().show());
    expect(name().value).toBe("");
  });
});

describe("OK", () => {
  test("saves the workbook first, then copies, then opens the copy", async () => {
    const user = userEvent.setup();
    const f = server();
    openDialog();
    await user.type(name(), "COPY1");
    await user.click(ok());
    await waitFor(() => expect(dialog()).toBeNull());
    expect(flow.calls).toEqual(["saveWorkbook", "copy", "load:COPY1", "restore:COPY1"]);
    const copy = f.calls.find((c) => c.path === "/api/scenarios/T/copy");
    expect(copy?.method).toBe("POST");
    expect(copy?.body).toEqual({ new_name: "COPY1" });
    expect(window.location.search).toBe("?test&sc=COPY1");
    expect(recent.list()).toEqual(["COPY1"]);
  });

  test("Enter in the Name field does the same", async () => {
    const user = userEvent.setup();
    server();
    openDialog();
    await user.type(name(), "COPY1{Enter}");
    await waitFor(() => expect(flow.calls).toContain("restore:COPY1"));
  });

  test("closes when the copy was made even if it cannot be opened (it exists now; the failure is in the Message Viewer)", async () => {
    const user = userEvent.setup();
    flow = fakeFlow(false);
    server({ "POST /api/scenarios/T/copy": COPIED });
    openDialog();
    await user.type(name(), "COPY1");
    await user.click(ok());
    await waitFor(() => expect(dialog()).toBeNull());
    expect(flow.restoreFor).not.toHaveBeenCalled();
  });

  test.each(["", "bad name", "a/b", "x".repeat(33)])("rejects the name %j before doing anything", async (typed) => {
    const user = userEvent.setup();
    const f = server();
    openDialog();
    if (typed !== "") await user.type(name(), typed);
    await user.click(ok());
    expect(errorOf(name())).toBe(msg("scenario.nameInvalid"));
    expect(name().getAttribute("aria-invalid")).toBe("true");
    expect(name().className).toContain("field-invalid");
    expect(saveWorkbook).not.toHaveBeenCalled();
    expect(f.calls).toEqual([]);
    expect(dialog()).not.toBeNull();
  });

  test("typing again clears the message", async () => {
    const user = userEvent.setup();
    server();
    openDialog();
    await user.click(ok());
    expect(name().getAttribute("aria-invalid")).toBe("true");
    await user.type(name(), "A");
    expect(name().getAttribute("aria-invalid")).toBeNull();
  });
});

describe("when the workbook cannot be saved", () => {
  test("stops: nothing is copied, the dialog stays and points to the Message Viewer without reporting again", async () => {
    const user = userEvent.setup();
    saveWorkbook.mockRejectedValue(new Error("เขียนไม่ได้")); // saveWorkbook has already reported its own error by the time it rejects
    const f = server();
    openDialog();
    await user.type(name(), "COPY1");
    await user.click(ok());
    expect(await screen.findByText(msg("saveAs.workbookFailed"))).toBeDefined();
    expect(f.calls).toEqual([]);
    expect(flow.load).not.toHaveBeenCalled();
    expect(useMessages.getState().items).toEqual([]);
    expect(name().value).toBe("COPY1"); // and the user can try again
    expect((ok() as HTMLButtonElement).disabled).toBe(false);
  });

  test("a later success clears that note", async () => {
    const user = userEvent.setup();
    saveWorkbook.mockRejectedValueOnce(new Error("เขียนไม่ได้"));
    server();
    openDialog();
    await user.type(name(), "COPY1");
    await user.click(ok());
    await screen.findByText(msg("saveAs.workbookFailed"));
    await user.click(ok());
    await waitFor(() => expect(dialog()).toBeNull());
  });
});

describe("errors from the server", () => {
  test("a taken name goes on the Name field with the server's text, and the dialog stays open", async () => {
    const user = userEvent.setup();
    server({
      "POST /api/scenarios/T/copy": { status: 409, json: { code: "NAME_EXISTS", text: "มี scenario ชื่อ COPY1 อยู่แล้ว", field: "new_name", detail: "COPY1" } },
    });
    openDialog();
    await user.type(name(), "COPY1");
    await user.click(ok());
    await waitFor(() => expect(name().getAttribute("aria-invalid")).toBe("true"));
    expect(errorOf(name())).toBe("มี scenario ชื่อ COPY1 อยู่แล้ว");
    expect(flow.load).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(useMessages.getState().items).toEqual([]);
  });

  test("a 422 on name goes there too", async () => {
    const user = userEvent.setup();
    server({ "POST /api/scenarios/T/copy": { status: 422, json: { code: "SCENARIO_INVALID", text: "ชื่อไม่ถูกต้อง", field: "name" } } });
    openDialog();
    await user.type(name(), "COPY1");
    await user.click(ok());
    await waitFor(() => expect(errorOf(name())).toBe("ชื่อไม่ถูกต้อง"));
  });

  test("another name can be tried after a refusal", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    server({
      "POST /api/scenarios/T/copy": () =>
        ++attempt === 1 ? { status: 409, json: { code: "NAME_EXISTS", text: "ซ้ำ", field: "new_name" } } : { status: 201, json: {} },
    });
    openDialog();
    await user.type(name(), "TAKEN");
    await user.click(ok());
    await waitFor(() => expect(errorOf(name())).toBe("ซ้ำ"));
    await user.clear(name());
    await user.type(name(), "FREE");
    await user.click(ok());
    await waitFor(() => expect(flow.calls).toContain("restore:FREE"));
  });

  test("an error that names no field is shown in the dialog and goes to the Message Viewer", async () => {
    const user = userEvent.setup();
    server({ "POST /api/scenarios/T/copy": { status: 404, json: { code: "NOT_FOUND", text: "ไม่พบ scenario T" } } });
    openDialog();
    await user.type(name(), "COPY1");
    await user.click(ok());
    expect(await screen.findByText("ไม่พบ scenario T")).toBeDefined();
    expect(useMessages.getState().items.map((m) => [m.level, m.code, m.text])).toEqual([["error", "NOT_FOUND", "ไม่พบ scenario T"]]);
    expect(dialog()).not.toBeNull();
  });
});

describe("Cancel", () => {
  test("closes the dialog and does nothing else", async () => {
    const user = userEvent.setup();
    const f = server();
    openDialog();
    await user.type(name(), "COPY1");
    await user.click(screen.getByRole("button", { name: t("dialog.cancel") }));
    expect(dialog()).toBeNull();
    expect(f.calls).toEqual([]);
    expect(saveWorkbook).not.toHaveBeenCalled();
  });

  test("Escape cancels", async () => {
    const user = userEvent.setup();
    server();
    openDialog();
    await user.keyboard("{Escape}");
    expect(dialog()).toBeNull();
  });

  test("neither Cancel nor Escape works while the copy is being made, so the dialog cannot vanish under a running save", async () => {
    const user = userEvent.setup();
    const gate = deferred<{ status: number; json: unknown }>();
    server({ "POST /api/scenarios/T/copy": () => gate.promise });
    openDialog();
    await user.type(name(), "COPY1");
    await user.click(ok());
    await waitFor(() => expect((ok() as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole("button", { name: t("dialog.cancel") }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Escape}");
    expect(dialog()).not.toBeNull();
    gate.resolve({ status: 201, json: {} });
    await waitFor(() => expect(dialog()).toBeNull());
  });
});
