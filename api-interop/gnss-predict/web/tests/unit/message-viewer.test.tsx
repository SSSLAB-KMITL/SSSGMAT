// Message Viewer (src/windows/MessageViewer/MessageViewer.tsx): แท็บ All Messages / Errors / Infos / Warnings, ตาราง virtual, Details, Clear this Tab, Clear all Tabs

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { useLayout } from "../../src/stores/layout";
import { useMessages, type Message } from "../../src/stores/messages";
import { useScenario } from "../../src/stores/scenario";
import { MessageViewer, registerMessageViewerPanel } from "../../src/windows/MessageViewer/MessageViewer";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";

let user: ReturnType<typeof userEvent.setup>;

const at = (n: number) => new Date(Date.UTC(2026, 10, 12, 3, 4, 5, 678) + n * 1000).toISOString();
const message = (n: number, level: Message["level"], text = `${level} ${n}`, over: Partial<Message> = {}): Message => ({
  time: at(n), level, code: `CODE_${n}`, text, object: null, ...over,
});

/** 1 info, 2 error, 3 warning, 4 error, 5 info (เรียงเก่า -> ใหม่) */
function seed(): Message[] {
  const items = [
    message(1, "info"),
    message(2, "error", "error 2", { object: "*/Satellite/G01", detail: "Traceback (most recent call last):\n  File gmat.py" }),
    message(3, "warning"),
    message(4, "error", "error 4"),
    message(5, "info"),
  ];
  act(() => useMessages.getState().addMany(items));
  return items;
}

beforeEach(() => {
  resetAll();
  user = userEvent.setup();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderMv = () => render(<MessageViewer params={{}} panelId="messageViewer" />);
const tab = (name: RegExp | string) => screen.getByRole("tab", { name });
const grid = () => screen.getByRole("grid");
const dataRows = () => within(grid()).queryAllByRole("row").filter((r) => Number(r.getAttribute("aria-rowindex")) >= 2);
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("gridcell").map((c) => c.textContent);
const texts = () => dataRows().map((r) => cellsOf(r)[4]);
const button = (name: string) => screen.getByRole("button", { name });
const select = async (n: number) => user.click(dataRows().find((r) => cellsOf(r)[2] === `CODE_${n}`)!);

describe("tabs", () => {
  test("All Messages, Errors, Infos and Warnings, in that order, each with the number of messages in it", () => {
    seed();
    renderMv();
    expect(screen.getAllByRole("tab").map((x) => x.textContent)).toEqual([
      `${t("mv.tab.all")} (5)`, `${t("mv.tab.errors")} (2)`, `${t("mv.tab.infos")} (2)`, `${t("mv.tab.warnings")} (1)`,
    ]);
    expect(tab(/^All Messages/).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tablist")).toBeDefined();
  });

  test("All Messages shows every message, oldest at the top and newest at the bottom", () => {
    seed();
    renderMv();
    expect(texts()).toEqual(["info 1", "error 2", "warning 3", "error 4", "info 5"]);
  });

  test("the Errors tab shows only errors; Infos only infos; Warnings only warnings", async () => {
    seed();
    renderMv();
    await user.click(tab(/^Errors/));
    expect(tab(/^Errors/).getAttribute("aria-selected")).toBe("true");
    expect(texts()).toEqual(["error 2", "error 4"]);
    await user.click(tab(/^Infos/));
    expect(texts()).toEqual(["info 1", "info 5"]);
    await user.click(tab(/^Warnings/));
    expect(texts()).toEqual(["warning 3"]);
    await user.click(tab(/^All Messages/));
    expect(texts()).toHaveLength(5);
  });

  test("the arrow keys move between the tabs", async () => {
    seed();
    renderMv();
    tab(/^All Messages/).focus();
    await user.keyboard("{ArrowRight}");
    expect(tab(/^Errors/).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab(/^Errors/));
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(tab(/^Warnings/).getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Home}");
    expect(tab(/^All Messages/).getAttribute("aria-selected")).toBe("true");
  });

  test("a tab with no messages says so", async () => {
    act(() => useMessages.getState().add(message(1, "info")));
    renderMv();
    await user.click(tab(/^Errors/));
    expect(screen.getByText(msg("mv.empty"))).toBeDefined();
    expect(dataRows()).toHaveLength(0);
  });

  test("a message that arrives while the window is open is added to its tabs, with the counts", async () => {
    seed();
    renderMv();
    act(() => useMessages.getState().add(message(6, "error", "error 6")));
    expect(tab(/^Errors/).textContent).toBe(`${t("mv.tab.errors")} (3)`);
    expect(tab(/^All Messages/).textContent).toBe(`${t("mv.tab.all")} (6)`);
    expect(texts().at(-1)).toBe("error 6");
    await user.click(tab(/^Errors/));
    expect(texts()).toEqual(["error 2", "error 4", "error 6"]);
  });
});

describe("columns", () => {
  test("Time, Level, Code, Object and Message, with the name of each column", () => {
    seed();
    renderMv();
    expect(within(grid()).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      t("mv.col.time"), t("mv.col.level"), t("mv.col.code"), t("mv.col.object"), t("mv.col.message"),
    ]);
    expect(t("mv.col.time")).toBe("Time");
    expect(t("mv.col.level")).toBe("Level");
  });

  test("a row shows the time in the DateFormat (UTCG without a scenario), the localised level, the code, the object and the text", () => {
    seed();
    renderMv();
    expect(cellsOf(dataRows()[1])).toEqual(["12 Nov 2026 03:04:07.678 UTCG", t("mv.level.error"), "CODE_2", "*/Satellite/G01", "error 2"]);
    expect(cellsOf(dataRows()[0])[1]).toBe(t("mv.level.info"));
    expect(cellsOf(dataRows()[2])[1]).toBe(t("mv.level.warning"));
    expect(cellsOf(dataRows()[0])[3]).toBe("");
  });

  test("the time follows the DateFormat of the open scenario", () => {
    openScenario(makeDoc({ units: { date_format: "LTZG", ltz_offset: "+07:00" } }));
    seed();
    renderMv();
    expect(cellsOf(dataRows()[0])[0]).toBe("12 Nov 2026 10:04:06.678 LTZG+07:00");
    act(() => useScenario.setState({ doc: makeDoc({ units: { date_format: "UTCG", ltz_offset: "+07:00" } }) }));
    expect(cellsOf(dataRows()[0])[0]).toBe("12 Nov 2026 03:04:06.678 UTCG");
  });

  test("a time that cannot be read is shown as it came", () => {
    act(() => useMessages.getState().add({ time: "not a time", level: "info", code: "X", text: "odd", object: null }));
    renderMv();
    expect(cellsOf(dataRows()[0])[0]).toBe("not a time");
  });
});

describe("clearing", () => {
  test("Clear this Tab on Errors empties Errors but All Messages still has everything", async () => {
    seed();
    renderMv();
    await user.click(tab(/^Errors/));
    await user.click(button(t("mv.clearTab")));
    expect(texts()).toEqual([]);
    expect(tab(/^Errors/).textContent).toBe(`${t("mv.tab.errors")} (0)`);
    await user.click(tab(/^All Messages/));
    expect(texts()).toEqual(["info 1", "error 2", "warning 3", "error 4", "info 5"]);
    expect(tab(/^All Messages/).textContent).toBe(`${t("mv.tab.all")} (5)`);
    expect(tab(/^Infos/).textContent).toBe(`${t("mv.tab.infos")} (2)`);
  });

  test("Clear this Tab on All Messages empties All Messages only", async () => {
    seed();
    renderMv();
    await user.click(button(t("mv.clearTab")));
    expect(texts()).toEqual([]);
    await user.click(tab(/^Errors/));
    expect(texts()).toEqual(["error 2", "error 4"]);
  });

  test("Clear all Tabs empties every tab", async () => {
    seed();
    renderMv();
    await user.click(button(t("mv.clearAll")));
    for (const name of [/^All Messages/, /^Errors/, /^Infos/, /^Warnings/]) {
      await user.click(tab(name));
      expect(texts(), String(name)).toEqual([]);
      expect(tab(name).textContent).toMatch(/\(0\)$/);
    }
  });

  test("a message that comes after Clear is shown", async () => {
    seed();
    renderMv();
    await user.click(button(t("mv.clearAll")));
    act(() => useMessages.getState().add(message(9, "warning", "warning 9")));
    expect(texts()).toEqual(["warning 9"]);
  });

  test("the buttons are named as STK names them", () => {
    renderMv();
    expect(t("mv.clearTab")).toBe("Clear this Tab");
    expect(t("mv.clearAll")).toBe("Clear all Tabs");
    expect(t("mv.details")).toBe("Details");
    expect(button("Details")).toBeDefined();
  });
});

describe("selection and Details", () => {
  test("clicking a row selects it; Details is off until a row is selected", async () => {
    seed();
    renderMv();
    expect((button(t("mv.details")) as HTMLButtonElement).disabled).toBe(true);
    expect(dataRows().every((r) => r.getAttribute("aria-selected") === "false")).toBe(true);
    await select(3);
    expect(dataRows().filter((r) => r.getAttribute("aria-selected") === "true").map((r) => cellsOf(r)[2])).toEqual(["CODE_3"]);
    expect((button(t("mv.details")) as HTMLButtonElement).disabled).toBe(false);
  });

  test("Details shows the full text, the detail, the code, the object and the time of the selected message", async () => {
    seed();
    renderMv();
    await select(2);
    await user.click(button(t("mv.details")));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("error 2")).toBeDefined();
    expect(dialog.textContent).toContain("Traceback (most recent call last):");
    expect(dialog.textContent).toContain("File gmat.py");
    expect(dialog.textContent).toContain("CODE_2");
    expect(dialog.textContent).toContain("*/Satellite/G01");
    expect(dialog.textContent).toContain("12 Nov 2026 03:04:07.678 UTCG");
    expect(dialog.textContent).toContain(t("mv.level.error"));
  });

  test("a message without a detail says so", async () => {
    seed();
    renderMv();
    await select(3);
    await user.click(button(t("mv.details")));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("warning 3");
    expect(dialog.textContent).toContain(msg("mv.noDetail"));
  });

  test("a long text is shown in full in the dialog", async () => {
    const long = "ข้อความยาวมาก ".repeat(60).trim();
    act(() => useMessages.getState().add(message(1, "error", long)));
    renderMv();
    await select(1);
    await user.click(button(t("mv.details")));
    expect(within(await screen.findByRole("dialog")).getByText(long)).toBeDefined();
  });

  test("double-clicking a row opens Details for it", async () => {
    seed();
    renderMv();
    await user.dblClick(dataRows().find((r) => cellsOf(r)[2] === "CODE_2")!);
    expect((await screen.findByRole("dialog")).textContent).toContain("Traceback");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // the row is selected too
    expect(dataRows().find((r) => cellsOf(r)[2] === "CODE_2")!.getAttribute("aria-selected")).toBe("true");
  });

  test("Esc and Close close the dialog and give the focus back", async () => {
    seed();
    renderMv();
    await select(2);
    await user.click(button(t("mv.details")));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(button(t("mv.details")));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: t("dialog.windows.close") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("the selection stays on the message when others arrive, and goes when its message is cleared", async () => {
    seed();
    renderMv();
    await select(2);
    act(() => useMessages.getState().add(message(6, "info")));
    expect(dataRows().filter((r) => r.getAttribute("aria-selected") === "true").map((r) => cellsOf(r)[2])).toEqual(["CODE_2"]);
    await user.click(button(t("mv.clearTab")));
    act(() => useMessages.getState().add(message(7, "info")));
    expect(dataRows().filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(0);
    expect((button(t("mv.details")) as HTMLButtonElement).disabled).toBe(true);
  });

  test("Up and Down move the selection, Home and End go to the ends, and Enter opens Details", async () => {
    seed();
    renderMv();
    await select(2);
    grid().focus();
    await user.keyboard("{ArrowDown}");
    expect(dataRows().find((r) => r.getAttribute("aria-selected") === "true")!.textContent).toContain("CODE_3");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(dataRows().find((r) => r.getAttribute("aria-selected") === "true")!.textContent).toContain("CODE_1");
    await user.keyboard("{End}");
    expect(dataRows().find((r) => r.getAttribute("aria-selected") === "true")!.textContent).toContain("CODE_5");
    await user.keyboard("{Home}");
    expect(dataRows().find((r) => r.getAttribute("aria-selected") === "true")!.textContent).toContain("CODE_1");
    await user.keyboard("{Enter}");
    expect((await screen.findByRole("dialog")).textContent).toContain("info 1");
  });
});

describe("virtual list and scrolling", () => {
  const many = (n: number) => act(() => useMessages.getState().addMany(Array.from({ length: n }, (_, i) => message(i, i % 3 === 0 ? "error" : "info"))));

  test("a long list has only the rows near the viewport in the DOM", () => {
    many(3000);
    renderMv();
    const rows = dataRows();
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(120);
    expect(grid().getAttribute("aria-rowcount")).toBe("3001"); // the header and every message
  });

  /** ทำให้ element ที่เลื่อนได้มีขนาดและตำแหน่งเลื่อนที่ jsdom ไม่มีให้ */
  function scrollBox() {
    const el = document.querySelector<HTMLElement>(".mv-scroll")!;
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => Number.parseFloat(el.querySelector<HTMLElement>(".mv-body")!.style.height || "0") });
    return el;
  }

  test("opens scrolled to the newest message", () => {
    many(100);
    renderMv();
    const el = scrollBox();
    // the first render happens before the sizes exist: a message that arrives now keeps the list at the bottom
    act(() => useMessages.getState().add(message(500, "info")));
    expect(el.scrollTop).toBe(el.scrollHeight);
  });

  test("a new message scrolls the list to the bottom when it was at the bottom, and leaves it when the reader scrolled up", () => {
    many(100);
    renderMv();
    const el = scrollBox();
    act(() => useMessages.getState().add(message(500, "info")));
    expect(el.scrollTop).toBe(el.scrollHeight);

    el.scrollTop = 300; // the reader scrolls up
    fireEvent.scroll(el);
    act(() => useMessages.getState().add(message(501, "info")));
    expect(el.scrollTop).toBe(300);

    el.scrollTop = el.scrollHeight - 200; // and back to the bottom
    fireEvent.scroll(el);
    act(() => useMessages.getState().add(message(502, "info")));
    expect(el.scrollTop).toBe(el.scrollHeight);
  });

  test("when the window is resized or shown again it goes to the bottom if it was at the bottom, and stays where the reader left it otherwise", () => {
    let panelResized: ((size: { width: number; height: number }) => void) | undefined;
    useLayout.setState({ onPanelResize: (_id: string, cb: typeof panelResized) => { panelResized = cb; return () => undefined; } } as never);
    many(100);
    renderMv();
    const el = scrollBox();
    expect(panelResized).toBeDefined();

    el.scrollTop = 0; // a tab that was hidden comes back at the top (the browser forgets the position of what it did not draw)
    act(() => panelResized?.({ width: 700, height: 300 }));
    expect(el.scrollTop).toBe(el.scrollHeight);

    el.scrollTop = 100; // the reader scrolls up
    fireEvent.scroll(el);
    act(() => panelResized?.({ width: 700, height: 320 }));
    expect(el.scrollTop).toBe(100);
  });

  test("changing the tab goes to the bottom of the new tab", async () => {
    many(100);
    renderMv();
    const el = scrollBox();
    el.scrollTop = 100;
    fireEvent.scroll(el);
    await user.click(tab(/^Errors/));
    expect(el.scrollTop).toBe(el.scrollHeight);
  });
});

describe("registration", () => {
  test("registerMessageViewerPanel puts the window in place of the placeholder and keeps the registered title, type and size", () => {
    const before = getPanelDef("messageViewer")!;
    registerMessageViewerPanel();
    const def = getPanelDef("messageViewer")!;
    expect(def.component).toBe(MessageViewer);
    expect(def.title({})).toBe(t("window.messageViewer"));
    expect(def.type).toBe(before.type);
    expect(def.edge).toBe(before.edge);
    expect(def.size).toEqual(before.size);
    expect(def.persist).toBe(true);
    expect(def.scenarioBound).toBe(false);
    registerMessageViewerPanel();
    expect(getPanelDef("messageViewer")!.component).toBe(MessageViewer);
  });
});
