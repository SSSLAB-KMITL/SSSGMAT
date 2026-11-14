import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import type { Selections } from "../selection";
import type { Tick } from "../types";
import {
  CONFIGURE_BLOCKED_BOX,
  CONFIGURE_BLOCKED_TEXT,
  controllerOf,
  dropModule,
  dropRef,
  hasModule,
  mergeOpen,
  NO_CONFIG_TEXT,
  openRefusalBox,
  rotPlotOf,
  syncWindows,
  targetPosts,
  WATCH_START,
  watchTick,
  windowGone,
} from "./controllerWindows";
import type { ControllerWindow, Watch } from "./controllerWindows";
import type { ControllerRef, RadioState, RotatorState } from "./types";

const radioA: ControllerRef = { module: "A", kind: "radio" };
const rotA: ControllerRef = { module: "A", kind: "rotator" };
const radioB: ControllerRef = { module: "B", kind: "radio" };
const win = (ref: ControllerRef, raise = 0): ControllerWindow => ({ ...ref, raise });

describe("the open controller windows", () => {
  it("restores controller windows from GET /api/controllers", async () => {
    const getControllers = vi.fn(async (): Promise<ControllerRef[]> => [radioA, rotA]);
    const windows = syncWindows([], await getControllers());
    expect(windows).toEqual([win(radioA), win(rotA)]);
  });

  it("keeps a window that is open as it is, drops the one the server does not have and adds the new ones at the end", () => {
    const raised = win(radioA, 3);
    const list = [win(radioB), raised];
    const next = syncWindows(list, [rotA, radioA]);
    expect(next).toEqual([raised, win(rotA)]);
    expect(next[0]).toBe(raised);
  });

  it("answers the same list when the server has the same controllers", () => {
    const list = [win(radioA), win(rotA)];
    expect(syncWindows(list, [rotA, radioA])).toBe(list);
  });

  it("does not bring back a window that is being closed: the server still has its controller until the close is done", () => {
    expect(syncWindows([win(rotA)], [radioA, rotA], new Set(["radio:A"]))).toEqual([win(rotA)]);
  });

  it("adds a window when its controller opens, and raises the one that is open instead of opening a second (ref-R §1)", () => {
    const one = mergeOpen([], radioA);
    expect(one).toEqual([win(radioA)]);
    const two = mergeOpen(one, rotA);
    expect(two).toEqual([win(radioA), win(rotA)]);
    expect(mergeOpen(two, radioA)).toEqual([win(radioA, 1), win(rotA)]);
  });

  it("closes one window, and every window of a module that is closed or deleted", () => {
    const list = [win(radioA), win(rotA), win(radioB)];
    expect(dropRef(list, rotA)).toEqual([win(radioA), win(radioB)]);
    expect(dropRef(list, { module: "C", kind: "radio" })).toBe(list);
    expect(dropModule(list, "A")).toEqual([win(radioB)]);
    expect(dropModule(list, "C")).toBe(list);
  });

  it("tells whether a module has a controller window (Configure is blocked then)", () => {
    expect(hasModule([win(rotA)], "A")).toBe(true);
    expect(hasModule([win(rotA)], "B")).toBe(false);
  });
});

describe("a window follows the ticks of its own socket", () => {
  const RADIO = { engaged: false } as RadioState;
  const ROTATOR = { engaged: false } as RotatorState;
  const tick = (extra: Partial<Tick> = {}) => ({ t: "2026-11-14T00:00:00.000Z", status: "ok", ...extra }) as Tick;

  /** The watch after these ticks, each saying whether it carries the window's controller. */
  const after = (...has: boolean[]): Watch => has.reduce(watchTick, WATCH_START);

  it("finds its controller in the tick: radio for Radio Control, rotator for Antenna Control", () => {
    const t = tick({ radio: RADIO, rotator: ROTATOR });
    expect(controllerOf(t, "radio")).toBe(RADIO);
    expect(controllerOf(t, "rotator")).toBe(ROTATOR);
    expect(controllerOf(tick({ radio: RADIO }), "rotator")).toBeUndefined();
    expect(controllerOf(null, "radio")).toBeUndefined();
  });

  it("drops a window when its tick has no controller or the socket closed with 1000", () => {
    expect(windowGone(after(true), null)).toBe(false);
    expect(windowGone(after(true, true), null)).toBe(false);
    expect(windowGone(after(true, false), null)).toBe(true); // closed from another browser tab
    expect(windowGone(after(true), 1000)).toBe(true); // the module was closed or deleted
    expect(windowGone(WATCH_START, 1000)).toBe(true);
  });

  it("drops it after 1008 too (the module is not open, so it has no controller), but not after a close it reconnects from", () => {
    expect(windowGone(after(true), 1008)).toBe(true);
    for (const code of [1001, 1006, 1011, 1013]) expect(windowGone(after(true), code), String(code)).toBe(false);
  });

  it("waits for its controller while it has not had it: the first tick can have been made before the server opened it", () => {
    expect(windowGone(WATCH_START, null)).toBe(false);
    expect(windowGone(after(false), null)).toBe(false);
    expect(windowGone(after(false, true), null)).toBe(false);
    expect(windowGone(after(false, false), null)).toBe(true);
  });

  it("keeps the same watch while nothing changes, so a tick that carries the controller costs no new state", () => {
    const w = after(true);
    expect(watchTick(w, true)).toBe(w);
  });
});

describe("the boxes of the controllers (ref-R §1, spec §4.5, §4.6)", () => {
  it("no-config error texts", () => {
    expect(NO_CONFIG_TEXT.radio).toBe("You have no radio configuration!\nPlease configure a radio first.");
    expect(NO_CONFIG_TEXT.rotator).toBe("You have no rotator configuration!\nPlease configure an antenna rotator first.");
  });

  it("shows the ERROR box for the server's no-device refusal of each kind, and nothing for another error", () => {
    const refusal = (code: string) => new ApiError(code, "ยังไม่มีอุปกรณ์", 409);
    expect(openRefusalBox("radio", refusal("NO_RADIO_CONFIG"))).toEqual({
      title: "ERROR",
      message: { code: "NO_RADIO_CONFIG", level: "error", text: NO_CONFIG_TEXT.radio, object: null },
    });
    expect(openRefusalBox("rotator", refusal("NO_ROTATOR_CONFIG"))).toEqual({
      title: "ERROR",
      message: { code: "NO_ROTATOR_CONFIG", level: "error", text: NO_CONFIG_TEXT.rotator, object: null },
    });
    expect(openRefusalBox("radio", refusal("NO_ROTATOR_CONFIG"))).toBeNull();
    expect(openRefusalBox("radio", new ApiError("NOT_FOUND", "module ไม่ได้เปิดอยู่", 404))).toBeNull();
    expect(openRefusalBox("radio", new Error("network"))).toBeNull();
  });

  it("configure blocked text", () => {
    expect(CONFIGURE_BLOCKED_TEXT).toBe(
      "A module can not be configured while the radio or rotator controller is active.\n\nPlease close the radio and rotator controllers and try again.",
    );
    expect(CONFIGURE_BLOCKED_BOX.title).toBeUndefined(); // Gpredict's box has no title
    expect(CONFIGURE_BLOCKED_BOX.message).toMatchObject({ level: "error", text: CONFIGURE_BLOCKED_TEXT });
  });
});

describe("the target of a module (spec §3.3)", () => {
  /** What App does on every change of the selections: post the targets, then remember what it has seen. */
  function sender() {
    const postTarget = vi.fn(async (_module: string, _norad: number) => undefined);
    let seen: Selections = {};
    const change = (next: Selections) => {
      for (const t of targetPosts(seen, next)) void postTarget(t.module, t.norad);
      seen = next;
    };
    return { postTarget, change };
  }

  it("posts the target when the selection changes", () => {
    const { postTarget, change } = sender();
    const one: Selections = { A: 25544 };
    change(one);
    expect(postTarget.mock.calls).toEqual([["A", 25544]]);
    change(one); // the same selections again (an effect that runs twice): nothing more
    change({ ...one }); // equal in value: nothing either
    expect(postTarget).toHaveBeenCalledTimes(1);
    change({ A: 7530, B: 25544 });
    expect(postTarget.mock.calls.slice(1)).toEqual([
      ["A", 7530],
      ["B", 25544],
    ]);
  });

  it("does not post an unselect (null), nor a module that went", () => {
    const { postTarget, change } = sender();
    change({ A: 25544, B: 7530 });
    postTarget.mockClear();
    change({ A: null, B: 7530 });
    change({ A: null });
    expect(postTarget).not.toHaveBeenCalled();
    change({ A: 25544 }); // selected again after an unselect: the controllers follow again
    expect(postTarget.mock.calls).toEqual([["A", 25544]]);
  });
});

describe("the plot of Antenna Control (ref-R §5.6, plan decision 15)", () => {
  const polar = (orientation: string, qthInfo: boolean) => ({ orientation, qthInfo });

  it("is drawn the way Preferences → Modules → Polar View says, with the station name only while its QTH Info is on", () => {
    expect(rotPlotOf(polar("S/W/N/E", true), "Bangkok")).toEqual({ orientation: "S/W/N/E", qthName: "Bangkok" });
    expect(rotPlotOf(polar("N/W/S/E", false), "Bangkok")).toEqual({ orientation: "N/W/S/E", qthName: null });
  });

  it("has no name before the first tick", () => {
    expect(rotPlotOf(polar("S/E/N/W", true), null)).toEqual({ orientation: "S/E/N/W", qthName: null });
  });
});
