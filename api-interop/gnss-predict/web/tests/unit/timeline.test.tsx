// Timeline View (src/windows/TimelineView/TimelineView.tsx): แถวจาก access, การตั้งเวลา, ซูม/เลื่อน View Port, เมนูคลิกขวา, คีย์บอร์ดและการวาด
// jsdom ไม่มี canvas: ใช้ context ปลอมที่จดการเรียก (ไม่ทดสอบพิกเซล) ส่วนรูปทรงและการหาจุดทดสอบเป็นฟังก์ชันล้วนใน timeline-layout.test.ts

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { t } from "../../src/labels/labels";
import { msg } from "../../src/labels/messages.th";
import { getPanelDef } from "../../src/layout/panels";
import { validateWorkbook } from "../../src/layout/workbook";
import { useLayout } from "../../src/stores/layout";
import { useMessages } from "../../src/stores/messages";
import { useResults, type ResultsInfo } from "../../src/stores/results";
import { useScenario } from "../../src/stores/scenario";
import { useTime } from "../../src/stores/time";
import { formatTime } from "../../src/time/format";
import { DISPLAY_TOP, BAR_H, ROW_H, SCALE_H, needsScrollbar, plotOf } from "../../src/windows/TimelineView/layout";
import { timeToX, wheelZoomFactor, xToTime, zoomViewPort } from "../../src/windows/TimelineView/scale";
import { TimelineView, registerTimelineViewPanel } from "../../src/windows/TimelineView/TimelineView";
import { Workspace } from "../../src/Workspace";
import { makeDoc, openScenario, resetAll } from "./helpers/chrome";
import { stubFetch, type Handler } from "./helpers/fake-fetch";

const T0 = Date.UTC(2026, 10, 12) / 1000;
const DAY = 86_400;
const HOUR = 3600;
const iso = (sec: number) => new Date(sec * 1000).toISOString();
const ROUTE = "GET /api/scenarios/S1/access/intervals";
const SIZE = { width: 800, height: 300 };
const P = plotOf(SIZE, needsScrollbar(SIZE, 3));

/** G01: 06-08 และ 14-15, G02: 10-11 (ชั่วโมงของวันที่ 12 พ.ย. UTC) */
const REPLY = {
  G01: [
    { start: iso(T0 + 6 * HOUR), stop: iso(T0 + 8 * HOUR), duration_s: 2 * HOUR, max_el_deg: 62.4 },
    { start: iso(T0 + 14 * HOUR), stop: iso(T0 + 15 * HOUR), duration_s: HOUR, max_el_deg: 30 },
  ],
  G02: [{ start: iso(T0 + 10 * HOUR), stop: iso(T0 + 11 * HOUR), duration_s: HOUR, max_el_deg: 45 }],
};

const access = (over: object = {}) => ({
  from: "*/Facility/THBK", to: ["*/Constellation/GPS"], timeline: true, computed: true,
  graphics: { color_mode: "object", custom_color: null }, time_period: { mode: "object" }, ...over,
});

function makeScenario(accesses: object[] = [access()], over: object = {}) {
  return makeDoc({
    name: "S1",
    objects: [
      { class: "Facility", name: "THBK", position: { type: "Geodetic", lat_deg: 13.7, lon_deg: 100.5, alt_m: 0 } },
      { class: "Constellation", name: "GPS", system: "G", assigned_objects: ["*/Satellite/G01", "*/Satellite/G02"] },
      { class: "Satellite", name: "G01", norad: 40101 },
      { class: "Satellite", name: "G02", norad: 40102 },
    ] as never,
    accesses: accesses as never,
    ...over,
  });
}

// ---------- canvas ปลอม ----------

function fakeContext() {
  const props: Record<string, unknown> = {};
  const fns: Record<string, ReturnType<typeof vi.fn>> = { measureText: vi.fn((text: string) => ({ width: text.length * 6 })) };
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_, key: string) => (key in props ? props[key] : (fns[key] ??= vi.fn())),
    set: (_, key: string, value) => {
      props[key] = value;
      return true;
    },
  });
  return { ctx, fns, props };
}

let drawing: ReturnType<typeof fakeContext>;
let resize: ((size: { width: number; height: number }) => void) | null;
let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  resetAll();
  drawing = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => drawing.ctx) as never);
  resize = null;
  useLayout.setState({ onPanelResize: (_id: string, cb: (size: { width: number; height: number }) => void) => { resize = cb; return () => undefined; } } as never);
  user = userEvent.setup();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const canvas = () => screen.getByRole("img") as HTMLCanvasElement;
const rowList = () => screen.getByRole("list", { name: t("window.timelineView") });
const rowNames = () => within(rowList()).queryAllByRole("listitem").map((li) => li.getAttribute("data-row"));
const display = () => screen.getByRole("group", { name: t("timeline.timeDisplay") });
const timeMs = () => useTime.getState().current.getTime();
const fmt = (sec: number) => formatTime(new Date(Math.round(sec * 1000)), "UTCG", "+07:00");
const stage = (c: Element) => c.closest(".tl-stage") ?? c;

/** ตำแหน่งบน canvas ของเวลา t ตาม View Port (ปกติทั้งช่วงวิเคราะห์) */
const xAt = (t: number, view: [number, number] = [T0, T0 + DAY]) => P.left + timeToX(t, view[0], view[1], P.width);
const rowY = (row: number) => DISPLAY_TOP + row * ROW_H + ROW_H / 2;
const timeAtX = (x: number, view: [number, number] = [T0, T0 + DAY]) => xToTime(x - P.left, view[0], view[1], P.width);
const BAR_Y = BAR_H / 2;
const SCALE_Y = BAR_H + SCALE_H / 2;

interface Mounted {
  stub: ReturnType<typeof stubFetch>;
  doc: ReturnType<typeof makeScenario>;
}

async function mountTimeline(opts: { accesses?: object[]; reply?: Handler; waitRows?: boolean; docOver?: object } = {}): Promise<Mounted> {
  const doc = makeScenario(opts.accesses, opts.docOver);
  openScenario(doc);
  const stub = stubFetch({ [ROUTE]: opts.reply ?? { json: REPLY } });
  render(<TimelineView params={{}} panelId="timelineView" />);
  act(() => resize?.(SIZE));
  if (opts.waitRows !== false) await waitFor(() => expect(rowNames().length).toBeGreaterThan(0));
  return { stub, doc };
}

const aria = () => canvas().getAttribute("aria-label");
const labelFor = (current: number, view: [number, number], rows: number) =>
  msg("timeline.canvas", { time: fmt(current), from: fmt(view[0]), to: fmt(view[1]), rows });
const NOW_VIEW: [number, number] = [T0, T0 + DAY];

describe("rows", () => {
  test("an access with timeline on gives the rows THBK-To-G01 and THBK-To-G02, from one request with from and to", async () => {
    const { stub } = await mountTimeline();
    expect(rowNames()).toEqual(["THBK-To-G01", "THBK-To-G02"]);
    expect(stub.count(ROUTE)).toBe(1);
    expect(stub.calls[0].query.get("from")).toBe("*/Facility/THBK");
    expect(stub.calls[0].query.getAll("to")).toEqual(["*/Constellation/GPS"]);
  });

  test("one request per access with timeline on; an access with timeline off is not asked for", async () => {
    const accesses = [access(), access({ from: "*/Facility/HOME", to: ["*/Satellite/G01"] }), access({ from: "*/Facility/OFF", timeline: false })];
    const { stub } = await mountTimeline({ accesses, reply: (call) => ({ json: call.query.get("from") === "*/Facility/HOME" ? { G01: [] } : REPLY }) });
    await waitFor(() => expect(rowNames()).toEqual(["THBK-To-G01", "THBK-To-G02", "HOME-To-G01"]));
    expect(stub.calls.map((c) => c.query.get("from")).sort()).toEqual(["*/Facility/HOME", "*/Facility/THBK"]);
  });

  test("rows named in timelineHidden are not shown", async () => {
    useLayout.setState({ timelineHidden: ["THBK-To-G01"] });
    await mountTimeline();
    expect(rowNames()).toEqual(["THBK-To-G02"]);
    act(() => useLayout.getState().setTimelineHidden([]));
    expect(rowNames()).toEqual(["THBK-To-G01", "THBK-To-G02"]);
  });

  test("409 RESULTS_NOT_CURRENT gives an empty row for the access with the Thai note, and shows it on hover", async () => {
    await mountTimeline({ reply: { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "x", field: null, detail: null } } });
    expect(rowNames()).toEqual(["THBK-To-GPS"]);
    const item = within(rowList()).getByRole("listitem");
    expect(item.textContent).toContain(msg("timeline.notCurrent"));
    expect(document.querySelector(".tl-note")).toBeNull();
    fireEvent.pointerMove(canvas(), { clientX: xAt(T0 + 5 * HOUR), clientY: rowY(0) });
    expect(document.querySelector(".tl-note")?.textContent).toBe(msg("timeline.notCurrent"));
    fireEvent.pointerLeave(stage(canvas()));
    expect(document.querySelector(".tl-note")).toBeNull();
  });

  test("another failure is a row with the failure in the note, and a message for the Message Viewer", async () => {
    await mountTimeline({ reply: { status: 422, json: { code: "VALIDATION", text: "ไม่พบ object ปลายทาง", field: "to", detail: null } } });
    expect(rowNames()).toEqual(["THBK-To-GPS"]);
    expect(within(rowList()).getByRole("listitem").textContent).toContain("ไม่พบ object ปลายทาง");
    expect(useMessages.getState().items.filter((m) => m.code === "VALIDATION")).toHaveLength(1);
  });

  test("a scenario that is not open has no rows, no request and says so", () => {
    const stub = stubFetch({});
    render(<TimelineView params={{}} panelId="timelineView" />);
    expect(stub.calls).toHaveLength(0);
    expect(rowNames()).toEqual([]);
    expect(screen.getByText(msg("tooltip.noScenario"))).toBeDefined();
  });

  test("an open scenario without rows says there is nothing to show", async () => {
    await mountTimeline({ accesses: [], waitRows: false });
    expect(screen.getByText(msg("timeline.empty"))).toBeDefined();
  });

  test("asks again when the accesses of the scenario change, but not for other edits", async () => {
    const { stub, doc } = await mountTimeline();
    expect(stub.count(ROUTE)).toBe(1);
    act(() => useScenario.setState({ doc: { ...doc, description: "edited" } as never }));
    await act(async () => undefined);
    expect(stub.count(ROUTE)).toBe(1);
    const more = makeScenario([access(), access({ from: "*/Facility/HOME", to: ["*/Satellite/G02"] })]);
    act(() => useScenario.setState({ doc: more }));
    await waitFor(() => expect(stub.count(ROUTE)).toBe(3)); // both accesses are asked for again
  });

  test("asks again when the results of the Facility are refreshed", async () => {
    const info = (hash: string): ResultsInfo => ({
      ephem: { hash: "e1", status: "current", available: [] },
      access: { THBK: { hash, status: "current", available: [] } },
      error: null,
    });
    act(() => useResults.setState({ info: info("a1") }));
    const { stub } = await mountTimeline();
    expect(stub.count(ROUTE)).toBe(1);
    act(() => useResults.setState({ info: info("a1") })); // the same results again: nothing to do
    await act(async () => undefined);
    expect(stub.count(ROUTE)).toBe(1);
    act(() => useResults.setState({ info: info("a2") }));
    await waitFor(() => expect(stub.count(ROUTE)).toBe(2));
  });

  test("asks again when the orbit results go stale (the intervals then answer 409)", async () => {
    const info = (status: "current" | "stale"): ResultsInfo => ({
      ephem: { hash: "e1", status, available: [] },
      access: { THBK: { hash: "a1", status: "current", available: [] } },
      error: null,
    });
    act(() => useResults.setState({ info: info("current") }));
    const { stub } = await mountTimeline();
    expect(stub.count(ROUTE)).toBe(1);
    act(() => useResults.setState({ info: info("stale") }));
    await waitFor(() => expect(stub.count(ROUTE)).toBe(2));
  });

  test("a late answer for an old request is dropped", async () => {
    let calls = 0;
    const answers: ((v: object) => void)[] = [];
    const doc = makeScenario();
    openScenario(doc);
    stubFetch({
      [ROUTE]: () => {
        calls++;
        return new Promise((resolve) => answers.push((json) => resolve({ json })));
      },
    }, { ignoreAbort: true });
    render(<TimelineView params={{}} panelId="timelineView" />);
    act(() => useScenario.setState({ doc: makeScenario([access({ from: "*/Facility/HOME", to: ["*/Satellite/G02"] })]) }));
    await waitFor(() => expect(calls).toBe(2));
    await act(async () => { answers[1]({ G02: [] }); });
    await act(async () => { answers[0](REPLY); });
    expect(rowNames()).toEqual(["HOME-To-G02"]);
  });
});

describe("setting the animation time", () => {
  test("the canvas is an image that describes the animation time, the View Port and the rows", async () => {
    await mountTimeline();
    expect(canvas().tagName).toBe("CANVAS");
    expect(aria()).toBe(labelFor(T0, NOW_VIEW, 2));
    act(() => useTime.getState().setCurrent(new Date((T0 + 5 * HOUR) * 1000)));
    await waitFor(() => expect(aria()).toBe(labelFor(T0 + 5 * HOUR, NOW_VIEW, 2)));
  });

  test("a click in the Time Display sets the time under the cursor", async () => {
    await mountTimeline();
    const x = 400;
    fireEvent.pointerDown(canvas(), { clientX: x, clientY: rowY(0), button: 0 });
    fireEvent.pointerUp(window);
    expect(timeMs()).toBe(Math.round(timeAtX(x) * 1000));
  });

  test("dragging in the Time Display moves the time with the cursor until the button is released", async () => {
    await mountTimeline();
    fireEvent.pointerDown(canvas(), { clientX: 300, clientY: rowY(0), button: 0 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: rowY(1) });
    expect(timeMs()).toBe(Math.round(timeAtX(500) * 1000));
    fireEvent.pointerUp(window);
    fireEvent.pointerMove(window, { clientX: 600, clientY: rowY(1) });
    expect(timeMs()).toBe(Math.round(timeAtX(500) * 1000));
  });

  test("the right button does not set the time", async () => {
    await mountTimeline();
    fireEvent.pointerDown(canvas(), { clientX: 400, clientY: rowY(0), button: 2 });
    expect(timeMs()).toBe(T0 * 1000);
  });

  test("a click in the row name column does not set the time", async () => {
    await mountTimeline();
    fireEvent.pointerDown(canvas(), { clientX: 20, clientY: rowY(0), button: 0 });
    expect(timeMs()).toBe(T0 * 1000);
  });
});

describe("right-click menus", () => {
  const openMenu = async (x: number, y: number) => {
    fireEvent.contextMenu(canvas(), { clientX: x, clientY: y });
    await screen.findByRole("menu");
  };
  const itemNames = () => screen.getAllByRole("menuitem").map((i) => i.textContent);
  const choose = async (name: string) => user.click(screen.getByRole("menuitem", { name }));

  test("on empty space the only item is Set Animation Time to Here, and it sets the time at the click", async () => {
    await mountTimeline();
    const x = xAt(T0 + 12 * HOUR);
    await openMenu(x, rowY(0));
    expect(itemNames()).toEqual([t("timeline.setAnimationTimeToHere")]);
    await choose(t("timeline.setAnimationTimeToHere"));
    expect(timeMs()).toBe(Math.round(timeAtX(x) * 1000));
  });

  test("Set Animation Time to Here also works on the Global Time Bar and the Global Time Scale", async () => {
    await mountTimeline();
    await openMenu(xAt(T0 + 18 * HOUR), BAR_Y);
    await choose(t("timeline.setAnimationTimeToHere"));
    expect(timeMs()).toBe(Math.round(timeAtX(xAt(T0 + 18 * HOUR)) * 1000));
    await openMenu(xAt(T0 + 20 * HOUR), SCALE_Y);
    await choose(t("timeline.setAnimationTimeToHere"));
    expect(timeMs()).toBe(Math.round(timeAtX(xAt(T0 + 20 * HOUR)) * 1000));
  });

  test("on a bar there are the interval items and Remove from Timeline as well", async () => {
    await mountTimeline();
    await openMenu(xAt(T0 + 7 * HOUR), rowY(0));
    expect(itemNames()).toEqual([
      t("timeline.setAnimationTimeToHere"),
      t("timeline.setAnimationTimeToIntervalStart"),
      t("timeline.setAnimationTimeToIntervalStop"),
      t("timeline.center"),
      t("timeline.removeFromTimeline"),
    ]);
  });

  test("Set Animation Time to Interval Start Time and Stop Time set the ends of that interval", async () => {
    await mountTimeline();
    await openMenu(xAt(T0 + 7 * HOUR), rowY(0));
    await choose(t("timeline.setAnimationTimeToIntervalStop"));
    expect(timeMs()).toBe((T0 + 8 * HOUR) * 1000);
    await openMenu(xAt(T0 + 14.5 * HOUR), rowY(0)); // the second interval of G01
    await choose(t("timeline.setAnimationTimeToIntervalStart"));
    expect(timeMs()).toBe((T0 + 14 * HOUR) * 1000);
    await openMenu(xAt(T0 + 10.5 * HOUR), rowY(1)); // the interval of G02
    await choose(t("timeline.setAnimationTimeToIntervalStop"));
    expect(timeMs()).toBe((T0 + 11 * HOUR) * 1000);
  });

  test("Center moves the View Port to the middle of the interval and keeps its width", async () => {
    await mountTimeline();
    for (let i = 0; i < 2; i++) fireEvent.keyDown(display(), { key: "+" }); // 24 h -> 12 h -> 6 h around the middle: 09:00-15:00
    const view: [number, number] = [T0 + 9 * HOUR, T0 + 15 * HOUR];
    await waitFor(() => expect(aria()).toBe(labelFor(T0, view, 2)));
    await openMenu(xAt(T0 + 14.5 * HOUR, view), rowY(0));
    await choose(t("timeline.center"));
    const centred: [number, number] = [T0 + 11.5 * HOUR, T0 + 17.5 * HOUR]; // the interval 14:00-15:00 is centred at 14:30
    await waitFor(() => expect(aria()).toBe(labelFor(T0, centred, 2)));
    expect(timeMs()).toBe(T0 * 1000); // Center does not change the time
  });

  test("Remove from Timeline hides the row, and the name is kept in timelineHidden", async () => {
    await mountTimeline();
    await openMenu(xAt(T0 + 10.5 * HOUR), rowY(1));
    await choose(t("timeline.removeFromTimeline"));
    expect(useLayout.getState().timelineHidden).toEqual(["THBK-To-G02"]);
    expect(rowNames()).toEqual(["THBK-To-G01"]);
    await openMenu(xAt(T0 + 7 * HOUR), rowY(0));
    await choose(t("timeline.removeFromTimeline"));
    expect(useLayout.getState().timelineHidden).toEqual(["THBK-To-G02", "THBK-To-G01"]);
    expect(rowNames()).toEqual([]);
  });

  test("there is no menu over the row names or outside the plot", async () => {
    await mountTimeline();
    fireEvent.contextMenu(canvas(), { clientX: 20, clientY: rowY(0) });
    fireEvent.contextMenu(canvas(), { clientX: SIZE.width - 2, clientY: rowY(0) });
    await act(async () => undefined);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  describe("touch (a long press opens the menu without a contextmenu event)", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    test("a long press on a bar opens the menu of that bar", async () => {
      await mountTimeline();
      fireEvent.pointerDown(canvas(), { clientX: xAt(T0 + 7 * HOUR), clientY: rowY(0), button: 0, pointerType: "touch" });
      await act(async () => { vi.advanceTimersByTime(800); });
      fireEvent.pointerUp(window, { pointerType: "touch" });
      await screen.findByRole("menu");
      expect(itemNames()).toContain(t("timeline.removeFromTimeline"));
    });

    test("a long press over the row names opens no menu", async () => {
      await mountTimeline();
      fireEvent.pointerDown(canvas(), { clientX: 20, clientY: rowY(0), button: 0, pointerType: "touch" });
      await act(async () => { vi.advanceTimersByTime(800); });
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  test("an unavailable row (409) offers only Set Animation Time to Here", async () => {
    await mountTimeline({ reply: { status: 409, json: { code: "RESULTS_NOT_CURRENT", text: "x", field: null, detail: null } } });
    await openMenu(xAt(T0 + 5 * HOUR), rowY(0));
    expect(itemNames()).toEqual([t("timeline.setAnimationTimeToHere")]);
  });
});

describe("View Port", () => {
  test("the wheel zooms about the cursor and the time under the cursor stays under it", async () => {
    await mountTimeline();
    const x = xAt(T0 + 6 * HOUR);
    const under = timeAtX(x);
    fireEvent.wheel(canvas(), { clientX: x, clientY: rowY(0), deltaY: -100 });
    const expected = zoomViewPort(T0, T0 + DAY, under, wheelZoomFactor(-100, 0), [T0, T0 + DAY]);
    await waitFor(() => expect(aria()).toBe(labelFor(T0, expected, 2)));
    expect(timeAtX(x, expected)).toBeCloseTo(under, 6);
  });

  test("the wheel never zooms out past the whole analysis period or in below 60 s", async () => {
    await mountTimeline();
    fireEvent.wheel(canvas(), { clientX: 400, clientY: rowY(0), deltaY: 1000 });
    await act(async () => undefined);
    expect(aria()).toBe(labelFor(T0, NOW_VIEW, 2));
    let view: [number, number] = [T0, T0 + DAY];
    for (let i = 0; i < 40; i++) {
      fireEvent.wheel(canvas(), { clientX: 400, clientY: rowY(0), deltaY: -1000 });
      view = zoomViewPort(view[0], view[1], timeAtX(400, view), wheelZoomFactor(-1000, 0), [T0, T0 + DAY]);
    }
    expect(view[1] - view[0]).toBe(60);
    await waitFor(() => expect(aria()).toBe(labelFor(T0, view, 2)));
  });

  test("the wheel over the Global Time Bar is left alone (the page may scroll)", async () => {
    await mountTimeline();
    const event = new WheelEvent("wheel", { clientX: 400, clientY: BAR_Y, deltaY: -100, cancelable: true, bubbles: true });
    canvas().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    const over = new WheelEvent("wheel", { clientX: 400, clientY: rowY(0), deltaY: -100, cancelable: true, bubbles: true });
    canvas().dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
  });

  test("dragging the pointer in the Global Time Bar moves the animation time over the whole analysis period", async () => {
    await mountTimeline();
    act(() => useTime.getState().setCurrent(new Date((T0 + 3 * HOUR) * 1000)));
    fireEvent.pointerDown(canvas(), { clientX: xAt(T0 + 3 * HOUR), clientY: BAR_Y, button: 0 });
    fireEvent.pointerMove(window, { clientX: xAt(T0 + 9 * HOUR), clientY: BAR_Y });
    expect(timeMs()).toBe(Math.round(timeAtX(xAt(T0 + 9 * HOUR)) * 1000));
    fireEvent.pointerMove(window, { clientX: -500, clientY: 200 }); // far left of the bar: stops at the start
    expect(timeMs()).toBe(T0 * 1000);
    fireEvent.pointerUp(window);
  });

  test("a click on the Global Time Bar sets the time there", async () => {
    await mountTimeline();
    fireEvent.pointerDown(canvas(), { clientX: xAt(T0 + 20 * HOUR), clientY: BAR_Y, button: 0 });
    fireEvent.pointerUp(window);
    expect(timeMs()).toBe(Math.round(timeAtX(xAt(T0 + 20 * HOUR)) * 1000));
  });

  test("dragging the body of the View Port frame pans it, and dragging an edge resizes it", async () => {
    await mountTimeline();
    for (let i = 0; i < 2; i++) fireEvent.keyDown(display(), { key: "+" });
    let view: [number, number] = [T0 + 9 * HOUR, T0 + 15 * HOUR];
    await waitFor(() => expect(aria()).toBe(labelFor(T0, view, 2)));

    // body: 09-15 moved three hours later
    fireEvent.pointerDown(canvas(), { clientX: xAt(T0 + 12 * HOUR), clientY: BAR_Y, button: 0 });
    fireEvent.pointerMove(window, { clientX: xAt(T0 + 15 * HOUR), clientY: BAR_Y });
    fireEvent.pointerUp(window);
    view = [T0 + 12 * HOUR, T0 + 18 * HOUR];
    await waitFor(() => expect(aria()).toBe(labelFor(T0, view, 2)));
    expect(timeMs()).toBe(T0 * 1000); // panning is not setting the time

    // right edge: 18:00 -> 21:00
    fireEvent.pointerDown(canvas(), { clientX: xAt(T0 + 18 * HOUR) - 1, clientY: BAR_Y, button: 0 });
    fireEvent.pointerMove(window, { clientX: xAt(T0 + 21 * HOUR) - 1, clientY: BAR_Y });
    fireEvent.pointerUp(window);
    view = [T0 + 12 * HOUR, T0 + 21 * HOUR];
    await waitFor(() => expect(aria()).toBe(labelFor(T0, view, 2)));

    // left edge: 12:00 -> 16:00
    fireEvent.pointerDown(canvas(), { clientX: xAt(T0 + 12 * HOUR) + 1, clientY: BAR_Y, button: 0 });
    fireEvent.pointerMove(window, { clientX: xAt(T0 + 16 * HOUR) + 1, clientY: BAR_Y });
    fireEvent.pointerUp(window);
    view = [T0 + 16 * HOUR, T0 + 21 * HOUR];
    await waitFor(() => expect(aria()).toBe(labelFor(T0, view, 2)));
    expect(timeMs()).toBe(T0 * 1000);
  });

  test("the Time Display follows the View Port: a click sets the time inside it", async () => {
    await mountTimeline();
    for (let i = 0; i < 2; i++) fireEvent.keyDown(display(), { key: "+" });
    const view: [number, number] = [T0 + 9 * HOUR, T0 + 15 * HOUR];
    await waitFor(() => expect(aria()).toBe(labelFor(T0, view, 2)));
    fireEvent.pointerDown(canvas(), { clientX: 500, clientY: rowY(0), button: 0 });
    fireEvent.pointerUp(window);
    expect(timeMs()).toBe(Math.round(timeAtX(500, view) * 1000));
  });

  test("the View Port stays when the time is set up again with the same analysis period (e.g. another Time Step was applied)", async () => {
    await mountTimeline();
    fireEvent.keyDown(display(), { key: "+" });
    const view: [number, number] = [T0 + 6 * HOUR, T0 + 18 * HOUR];
    await waitFor(() => expect(aria()).toBe(labelFor(T0, view, 2)));
    act(() => useTime.getState().init(makeScenario([access()], { animation: { time_step_s: 30, update_mode: "time_step", cycle: "loop", x_real_time_multiplier: 60 } })));
    expect(useTime.getState().step_s).toBe(30);
    expect(aria()).toBe(labelFor(T0, view, 2));
  });

  test("the View Port goes back to the whole period when the analysis period changes", async () => {
    await mountTimeline();
    fireEvent.keyDown(display(), { key: "+" });
    await waitFor(() => expect(aria()).toBe(labelFor(T0, [T0 + 6 * HOUR, T0 + 18 * HOUR], 2)));
    const longer = makeScenario([access()], { analysis_period: { start: "2026-11-12T00:00:00Z", stop: "2026-11-14T00:00:00Z" } });
    act(() => {
      useScenario.setState({ doc: longer });
      useTime.getState().init(longer); // what the scenario store does when the analysis period changes
    });
    await waitFor(() => expect(aria()).toBe(labelFor(T0, [T0, T0 + 2 * DAY], 2)));
  });
});

describe("keyboard", () => {
  test("the Time Display can take focus", async () => {
    await mountTimeline();
    expect(display().tabIndex).toBe(0);
    await user.tab();
    expect(document.activeElement).toBe(display());
  });

  test("a click focuses the Time Display", async () => {
    await mountTimeline();
    fireEvent.pointerDown(canvas(), { clientX: 400, clientY: rowY(0), button: 0 });
    fireEvent.pointerUp(window);
    expect(document.activeElement).toBe(display());
  });

  test("Right and Left step the time forward and backward by the time step", async () => {
    await mountTimeline();
    fireEvent.keyDown(display(), { key: "ArrowRight" });
    expect(timeMs()).toBe((T0 + 60) * 1000);
    fireEvent.keyDown(display(), { key: "ArrowRight" });
    fireEvent.keyDown(display(), { key: "ArrowLeft" });
    expect(timeMs()).toBe((T0 + 60) * 1000);
    act(() => useTime.getState().increaseStep());
    fireEvent.keyDown(display(), { key: "ArrowRight" });
    expect(timeMs()).toBe((T0 + 60 + useTime.getState().step_s) * 1000);
  });

  test("+ zooms in and - zooms out about the middle of the View Port", async () => {
    await mountTimeline();
    fireEvent.keyDown(display(), { key: "+" });
    await waitFor(() => expect(aria()).toBe(labelFor(T0, [T0 + 6 * HOUR, T0 + 18 * HOUR], 2)));
    fireEvent.keyDown(display(), { key: "=" });
    await waitFor(() => expect(aria()).toBe(labelFor(T0, [T0 + 9 * HOUR, T0 + 15 * HOUR], 2)));
    fireEvent.keyDown(display(), { key: "-" });
    fireEvent.keyDown(display(), { key: "_" });
    await waitFor(() => expect(aria()).toBe(labelFor(T0, NOW_VIEW, 2)));
  });

  test("keys with Ctrl, Alt or Meta are left to the app", async () => {
    await mountTimeline();
    const before = timeMs();
    fireEvent.keyDown(display(), { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(display(), { key: "+", metaKey: true });
    expect(timeMs()).toBe(before);
    expect(aria()).toBe(labelFor(T0, NOW_VIEW, 2));
  });
});

describe("drawing", () => {
  test("draws with the pixel ratio: the bitmap is the CSS size times the ratio", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    try {
      await mountTimeline();
      await waitFor(() => expect(canvas().width).toBe(SIZE.width * 2));
      expect(canvas().height).toBe(SIZE.height * 2);
      expect(canvas().style.width).toBe(`${SIZE.width}px`);
      expect(canvas().style.height).toBe(`${SIZE.height}px`);
      await waitFor(() => expect(drawing.fns.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0));
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
    }
  });

  test("a canvas that cannot give a 2D context does not break the window", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => null) as never);
    await mountTimeline();
    expect(rowNames()).toEqual(["THBK-To-G01", "THBK-To-G02"]);
  });

  describe("at most one redraw per animation frame", () => {
    let frames: Map<number, FrameRequestCallback>;
    let nextId: number;
    const flush = () => act(() => {
      const run = [...frames.values()];
      frames.clear();
      for (const cb of run) cb(0);
    });
    const draws = () => drawing.fns.clearRect?.mock.calls.length ?? 0;

    beforeEach(() => {
      frames = new Map();
      nextId = 0;
      vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        frames.set(++nextId, cb);
        return nextId;
      });
      vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    });

    test("many changes of time, rows, size or View Port before the frame are one draw", async () => {
      await mountTimeline();
      flush();
      const before = draws();
      expect(before).toBeGreaterThan(0);
      expect(frames.size).toBe(0);

      act(() => {
        for (let i = 1; i <= 20; i++) useTime.getState().setCurrent(new Date((T0 + i * 60) * 1000));
        resize?.({ width: 900, height: 320 });
      });
      fireEvent.keyDown(display(), { key: "+" });
      fireEvent.pointerDown(canvas(), { clientX: 400, clientY: rowY(0), button: 0 });
      fireEvent.pointerUp(window);
      expect(draws()).toBe(before); // nothing is drawn until the frame
      expect(frames.size).toBe(1);
      flush();
      expect(draws()).toBe(before + 1);
      expect(frames.size).toBe(0);
    });

    test("a frame with nothing to draw does not happen; the clock moving the time draws once per frame", async () => {
      await mountTimeline();
      flush();
      expect(frames.size).toBe(0);
      const before = draws();
      act(() => useTime.getState().setCurrent(new Date((T0 + 100) * 1000)));
      expect(frames.size).toBe(1);
      flush();
      act(() => useTime.getState().setCurrent(new Date((T0 + 200) * 1000)));
      flush();
      expect(draws()).toBe(before + 2);
    });

    test("closing the window cancels the frame that was waiting", async () => {
      await mountTimeline();
      flush();
      act(() => useTime.getState().setCurrent(new Date((T0 + 100) * 1000)));
      expect(frames.size).toBe(1);
      cleanup();
      expect(frames.size).toBe(0);
    });
  });
});

describe("hover", () => {
  test("hovering a bar shows its interval; leaving hides it", async () => {
    await mountTimeline();
    fireEvent.pointerMove(canvas(), { clientX: xAt(T0 + 7 * HOUR), clientY: rowY(0) });
    const note = document.querySelector(".tl-note");
    expect(note?.textContent).toContain("THBK-To-G01");
    expect(note?.textContent).toContain(fmt(T0 + 6 * HOUR));
    expect(note?.textContent).toContain(fmt(T0 + 8 * HOUR));
    fireEvent.pointerMove(canvas(), { clientX: xAt(T0 + 12 * HOUR), clientY: rowY(0) });
    expect(document.querySelector(".tl-note")).toBeNull();
  });
});

describe("hover and rows", () => {
  test("a note that is showing goes away when its row does", async () => {
    await mountTimeline();
    fireEvent.pointerMove(canvas(), { clientX: xAt(T0 + 7 * HOUR), clientY: rowY(0) });
    expect(document.querySelector(".tl-note")).not.toBeNull();
    act(() => useLayout.getState().setTimelineHidden(["THBK-To-G01"]));
    expect(document.querySelector(".tl-note")).toBeNull();
  });
});

describe("registration and the workbook", () => {
  test("registerTimelineViewPanel puts the window in place of the placeholder and keeps the registered title, type and size", () => {
    const before = getPanelDef("timelineView");
    expect(before).toBeDefined();
    registerTimelineViewPanel();
    const def = getPanelDef("timelineView")!;
    expect(def.component).toBe(TimelineView);
    expect(def.title({})).toBe(t("window.timelineView"));
    expect(def.type).toBe(before!.type);
    expect(def.edge).toBe(before!.edge);
    expect(def.persist).toBe(true);
    expect(def.scenarioBound).toBe(false);
    registerTimelineViewPanel(); // can be registered again
    expect(getPanelDef("timelineView")!.component).toBe(TimelineView);
  });

  test("Remove from Timeline is saved in the workbook (timelineHidden) and comes back when it is opened", async () => {
    registerTimelineViewPanel();
    const doc = makeScenario();
    openScenario(doc);
    stubFetch({ [ROUTE]: { json: REPLY } });
    render(<Workspace />);
    await waitFor(() => expect(useLayout.getState().api).not.toBeNull());
    await waitFor(() => expect(resize).not.toBeNull());
    act(() => resize?.(SIZE));
    await waitFor(() => expect(rowNames().length).toBe(2));

    fireEvent.contextMenu(canvas(), { clientX: xAt(T0 + 7 * HOUR), clientY: rowY(0) });
    await user.click(await screen.findByRole("menuitem", { name: t("timeline.removeFromTimeline") }));
    expect(rowNames()).toEqual(["THBK-To-G02"]);

    const workbook = useLayout.getState().toWorkbook();
    expect(workbook.timelineHidden).toEqual(["THBK-To-G01"]);
    expect(validateWorkbook(JSON.parse(JSON.stringify(workbook)))?.timelineHidden).toEqual(["THBK-To-G01"]);

    act(() => useLayout.getState().applyDefault());
    expect(useLayout.getState().timelineHidden).toEqual([]);
    act(() => useLayout.getState().fromWorkbook(JSON.parse(JSON.stringify(workbook))));
    expect(useLayout.getState().timelineHidden).toEqual(["THBK-To-G01"]);
    await waitFor(() => expect(rowNames()).toEqual(["THBK-To-G02"]));
  });
});
