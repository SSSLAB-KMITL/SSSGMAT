import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  DEFAULT_WINDOW_SIZE,
  DETACH_POLL_MS,
  detach,
  detachedPage,
  detachedStep,
  detachedTitle,
  detachedUrl,
  DetachedSession,
  detachFeatures,
  detachTarget,
  GEOMETRY_DEBOUNCE_MS,
  geometryOk,
  goneText,
  NO_GEOMETRY,
  popupBlockedText,
  restoreList,
  restoreWindow,
  sameGeometry,
  watchGeometry,
} from "./detach";
import type { DetachedDeps, Geometry, GeometryWatch, PopupWindow } from "./detach";
import type { ModuleList, ModuleWindow } from "./types";

const stored = (over: Partial<ModuleWindow> = {}): ModuleWindow => ({ state: 0, x: null, y: null, width: null, height: null, ...over });

/** A window the browser opened: `href` is what it shows. */
function popup(href = "about:blank"): PopupWindow & { log: string[] } {
  const log: string[] = [];
  return {
    closed: false,
    log,
    focus: () => log.push("focus"),
    location: {
      href,
      replace: (url: string) => log.push(`replace ${url}`),
    },
  };
}

/** window.open of a browser that lets the page open `win` (or blocks it: null), with its calls. */
function opener(win: PopupWindow | null) {
  const calls: [url: string, target: string, features: string][] = [];
  return { calls, open: (url: string, target: string, features: string) => (calls.push([url, target, features]), win) };
}

describe("the address and the name of the window of a module", () => {
  it("is the page of the module, by its name", () => {
    expect(detachedUrl("Amateur")).toBe("/?module=Amateur");
    expect(detachedUrl("GPS-1")).toBe("/?module=GPS-1");
    expect(detachedUrl("Amateur", true)).toBe("/?module=Amateur&restored=1");
    expect(detachTarget("Amateur")).toBe("gpredict-Amateur");
  });

  it("is read back by the page: the module and whether the window was restored", () => {
    expect(detachedPage("?module=Amateur")).toEqual({ module: "Amateur", restored: false });
    expect(detachedPage("?module=Amateur&restored=1")).toEqual({ module: "Amateur", restored: true });
    expect(detachedPage(new URL(detachedUrl("a b"), "http://127.0.0.1:8740").search)).toEqual({ module: "a b", restored: false });
    expect(detachedPage("")).toBeNull();
    expect(detachedPage("?module=")).toBeNull();
    expect(detachedPage("?other=1")).toBeNull();
  });
});

describe("detachFeatures (ref-D §9: size and position of a module window)", () => {
  it("features use the stored size, and position only when restoring positions", () => {
    const win = stored({ x: 10, y: 20, width: 640, height: 480 });
    expect(detachFeatures(win, { width: 900, height: 700 }, false)).toBe("popup,width=640,height=480");
    expect(detachFeatures(win, { width: 900, height: 700 }, true)).toBe("popup,width=640,height=480,left=10,top=20");
  });

  it("uses the size of the module in its tab when no size is stored", () => {
    expect(detachFeatures(stored(), { width: 900.4, height: 700.6 }, true)).toBe("popup,width=900,height=701");
    expect(detachFeatures(null, { width: 900, height: 700 }, true)).toBe("popup,width=900,height=700");
  });

  it("restores the position only when both coordinates are stored", () => {
    expect(detachFeatures(stored({ x: 10 }), { width: 900, height: 700 }, true)).toBe("popup,width=900,height=700");
    expect(detachFeatures(stored({ x: 0, y: 0 }), { width: 900, height: 700 }, true)).toBe("popup,width=900,height=700,left=0,top=0");
  });
});

describe("geometryOk and sameGeometry", () => {
  const screen = { availWidth: 1920, availHeight: 1080 };

  it("geometry outside the screen is not saved", () => {
    expect(geometryOk({ x: 10, y: 20, width: 800, height: 600 }, screen)).toBe(true);
    expect(geometryOk({ x: 0, y: 0, width: 1920, height: 1080 }, screen)).toBe(true);
    expect(geometryOk({ x: -1, y: 20, width: 800, height: 600 }, screen)).toBe(false); // negative
    expect(geometryOk({ x: 10, y: -5, width: 800, height: 600 }, screen)).toBe(false);
    expect(geometryOk({ x: 1200, y: 20, width: 800, height: 600 }, screen)).toBe(false); // past the right edge
    expect(geometryOk({ x: 10, y: 500, width: 800, height: 600 }, screen)).toBe(false); // past the bottom
  });

  it("does not save a size the server does not take (smaller than 100 px)", () => {
    expect(geometryOk({ x: 10, y: 20, width: 99, height: 600 }, screen)).toBe(false);
    expect(geometryOk({ x: 10, y: 20, width: 800, height: 0 }, screen)).toBe(false);
  });

  it("compares all four values", () => {
    const g = { x: 1, y: 2, width: 300, height: 400 };
    expect(sameGeometry(g, { ...g })).toBe(true);
    expect(sameGeometry(g, { ...g, height: 401 })).toBe(false);
    expect(sameGeometry(g, null)).toBe(false);
    expect(sameGeometry(null, null)).toBe(true);
  });
});

describe("watchGeometry (spec §8.1: checked every DETACH_POLL_MS, saved once it has stayed the same for GEOMETRY_DEBOUNCE_MS)", () => {
  const screen = { availWidth: 1920, availHeight: 1080 };
  const a: Geometry = { x: 10, y: 20, width: 800, height: 600 };
  const b: Geometry = { x: 30, y: 20, width: 800, height: 600 };

  it("are the plan's constants", () => {
    expect(DETACH_POLL_MS).toBe(1000);
    expect(GEOMETRY_DEBOUNCE_MS).toBe(1000);
  });

  it("saves a new geometry after it has stayed the same for the debounce, once", () => {
    let w: GeometryWatch = { ...NO_GEOMETRY, saved: a };
    let step = watchGeometry(w, b, 0, screen);
    expect(step.save).toBeNull(); // just moved
    w = step.watch;
    step = watchGeometry(w, b, DETACH_POLL_MS, screen);
    expect(step.save).toEqual(b);
    // not saved yet (the PUT failed, or has not been answered): asked again at the next look
    expect(watchGeometry(step.watch, b, 2 * DETACH_POLL_MS, screen).save).toEqual(b);
    w = { ...step.watch, saved: b }; // the save worked
    step = watchGeometry(w, b, 2 * DETACH_POLL_MS, screen);
    expect(step.save).toBeNull(); // saved already
  });

  it("does not save while the window keeps moving, nor what is saved already", () => {
    let w: GeometryWatch = { ...NO_GEOMETRY, saved: a };
    for (let i = 0; i < 5; i++) {
      const step = watchGeometry(w, { ...b, x: 30 + i }, i * DETACH_POLL_MS, screen);
      expect(step.save).toBeNull();
      w = step.watch;
    }
    let step = watchGeometry({ ...NO_GEOMETRY, saved: a }, a, 0, screen);
    step = watchGeometry(step.watch, a, DETACH_POLL_MS, screen);
    expect(step.save).toBeNull();
  });

  it("skips a geometry outside the screen", () => {
    const off = { ...b, x: -20 };
    let step = watchGeometry({ ...NO_GEOMETRY, saved: a }, off, 0, screen);
    step = watchGeometry(step.watch, off, DETACH_POLL_MS, screen);
    expect(step.save).toBeNull();
  });
});

describe("detachedTitle (ref §1: the capitals differ)", () => {
  it("is GPREDICT: for Detach and Gpredict: for a window opened again (decision 10)", () => {
    expect(detachedTitle("Amateur", "Bangkok", false)).toBe("GPREDICT: Amateur (Bangkok)");
    expect(detachedTitle("Amateur", "Bangkok", true)).toBe("Gpredict: Amateur (Bangkok)");
  });

  it("leaves out the station until the module has told it", () => {
    expect(detachedTitle("Amateur", null, false)).toBe("GPREDICT: Amateur");
  });
});

describe("detach (Module menu → Detach module, in the main page)", () => {
  const putLog = () => {
    const calls: [string, unknown][] = [];
    return { calls, putWindow: async (module: string, body: unknown) => void calls.push([module, body]) };
  };

  it("opens the page of the module in a window named after it, then makes it a window on the server", async () => {
    const win = popup();
    const o = opener(win);
    const p = putLog();
    const out = detach({ open: o.open, putWindow: p.putWindow, host: "127.0.0.1:8740" }, "Amateur", stored({ width: 640, height: 480 }), { width: 900, height: 700 }, false);
    expect(o.calls).toEqual([["/?module=Amateur", "gpredict-Amateur", "popup,width=640,height=480"]]);
    expect("window" in out && out.window).toBe(win);
    if ("window" in out) await out.saved;
    expect(p.calls).toEqual([["Amateur", { state: 1 }]]);
  });

  it("blocked popup keeps the tab and shows the notice", () => {
    const o = opener(null);
    const p = putLog();
    const out = detach({ open: o.open, putWindow: p.putWindow, host: "127.0.0.1:8740" }, "Amateur", null, { width: 900, height: 700 }, false);
    expect(o.calls).toHaveLength(1);
    expect(p.calls).toEqual([]); // the module stays docked: nothing is sent
    expect(out).toEqual({ notice: popupBlockedText("Amateur", "127.0.0.1:8740") });
    expect("notice" in out && out.notice).toContain("127.0.0.1:8740");
    expect("notice" in out && out.notice).toContain("Amateur");
  });
});

describe("restoreWindow (the button เปิด of the restore bar, decision 10)", () => {
  const base = "http://127.0.0.1:8740/";

  it("opens the page of the module, restored, with the stored size", () => {
    const win = popup();
    const o = opener(win);
    expect(restoreWindow(o.open, "Amateur", stored({ state: 1, width: 640, height: 480 }), DEFAULT_WINDOW_SIZE, false, base)).toBe(win);
    // the window is asked for by its name only, so that a window of the module that is open already is not loaded again
    expect(o.calls).toEqual([["", "gpredict-Amateur", "popup,width=640,height=480"]]);
    expect(win.log).toEqual(["replace http://127.0.0.1:8740/?module=Amateur&restored=1", "focus"]);
  });

  it("brings the window of the module to the front when it is open already (the main page was loaded again)", () => {
    const win = popup("http://127.0.0.1:8740/?module=Amateur");
    expect(restoreWindow(opener(win).open, "Amateur", null, DEFAULT_WINDOW_SIZE, false, base)).toBe(win);
    expect(win.log).toEqual(["focus"]);
  });

  it("is null when the browser blocks the window", () => {
    expect(restoreWindow(opener(null).open, "Amateur", null, DEFAULT_WINDOW_SIZE, false, base)).toBeNull();
  });
});

describe("restoreList (the modules of the restore bar)", () => {
  it("has the windows of the server that this page has not opened itself, or whose window was closed", () => {
    const mine = popup();
    const closed = { ...popup(), closed: true };
    const own = new Map<string, PopupWindow>([
      ["A", mine],
      ["B", closed],
    ]);
    expect(restoreList(["A", "B", "C"], own)).toEqual(["B", "C"]);
    expect(restoreList([], own)).toEqual([]);
  });
});

describe("detachedStep (what the page of a module window does with the list of modules)", () => {
  const list = (open: string[], windows: string[], modules = ["A", "B"]): Pick<ModuleList, "modules" | "open" | "windows"> => ({ modules, open, windows });

  it("keeps a module that is open and a window", () => {
    expect(detachedStep(list(["A"], ["A"]), "A", false)).toBe("keep");
    expect(detachedStep(list(["A"], ["A"]), "A", true)).toBe("keep");
  });

  it("opens the module again when it is not open (the close of the page before an F5 came after its open)", () => {
    expect(detachedStep(list(["B"], []), "A", true)).toBe("reopen");
  });

  it("makes the module a window until the server has had it as one, then takes its leaving the windows for an Attach", () => {
    expect(detachedStep(list(["A"], []), "A", false)).toBe("window");
    expect(detachedStep(list(["A"], []), "A", true)).toBe("attached");
  });

  it("goes when the module has been deleted", () => {
    expect(detachedStep(list([], [], ["B"]), "A", true)).toBe("deleted");
  });
});

// ---------------------------------------------------------------- the page of a module window

/** The server as the page of a module window sees it, with every call written down. */
function server(initial: { open: string[]; windows: string[]; modules?: string[] }) {
  const s = { modules: initial.modules ?? ["A", "B"], open: [...initial.open], windows: [...initial.windows] };
  const calls: string[] = [];
  let failOpen: unknown = null;
  let failWindow: unknown = null;
  const deps: DetachedDeps = {
    openModule: async (name) => {
      calls.push(`open ${name}`);
      if (failOpen !== null) throw failOpen;
      if (!s.open.includes(name)) s.open.push(name);
    },
    getModules: async () => ({ modules: [...s.modules], open: [...s.open], windows: s.windows.filter((w) => s.open.includes(w)), messages: [] }),
    putWindow: async (name, body) => {
      calls.push(`window ${name} ${JSON.stringify(body)}`);
      if (failWindow !== null) throw failWindow;
      if (body.state === 1 && !s.windows.includes(name)) s.windows.push(name);
      if (body.state === 0) s.windows = s.windows.filter((w) => w !== name);
      return stored({ state: body.state ?? 0 });
    },
    closeModule: async (name) => {
      calls.push(`close ${name}`);
      s.open = s.open.filter((o) => o !== name);
    },
    closeWindow: () => void calls.push("window.close"),
    postClose: (name) => void calls.push(`keepalive close ${name}`),
  };
  return {
    s,
    calls,
    deps,
    failOpenWith: (e: unknown) => (failOpen = e),
    failWindowWith: (e: unknown) => (failWindow = e),
  };
}

describe("DetachedSession (the page /?module=<name>, spec §8.1-§8.2, decision 9)", () => {
  it("detached page re-opens its module on load", async () => {
    const srv = server({ open: ["A"], windows: ["A"] });
    const first = new DetachedSession("A", srv.deps);
    await first.start();
    expect(srv.calls).toEqual(["open A"]);
    expect(first.getSnapshot()).toMatchObject({ phase: "open", epoch: 1, error: null });

    // F5: the page goes (its pagehide sends the close) and the new page opens the module again, every time it loads
    first.pageHide();
    const second = new DetachedSession("A", srv.deps);
    await second.start();
    expect(srv.calls).toEqual(["open A", "keepalive close A", "open A"]);
    expect(second.getSnapshot().phase).toBe("open");
  });

  it("opens once however often it is started (React's StrictMode runs the effect twice)", async () => {
    const srv = server({ open: [], windows: ["A"] });
    const page = new DetachedSession("A", srv.deps);
    await Promise.all([page.start(), page.start()]);
    expect(srv.calls).toEqual(["open A"]);
  });

  it("opens the module again when the close of the page before it arrives after its open", async () => {
    const srv = server({ open: ["A"], windows: ["A"] });
    const page = new DetachedSession("A", srv.deps);
    await page.start();
    srv.s.open = []; // the keepalive close of the old page has been done now
    await page.sync();
    expect(srv.calls).toEqual(["open A", "open A"]);
    expect(page.getSnapshot()).toMatchObject({ phase: "open", epoch: 2 }); // a new epoch: the views connect again
    expect(srv.s.open).toEqual(["A"]);
  });

  it("makes its module a window when the server does not have it as one yet (its Detach is still on the way)", async () => {
    const srv = server({ open: ["A"], windows: [] });
    const page = new DetachedSession("A", srv.deps);
    await page.start();
    expect(srv.calls).toEqual(["open A", 'window A {"state":1}']);
    await page.sync();
    expect(srv.calls).toHaveLength(2); // a window now: nothing more
  });

  it("attach puts state 0 and closes the window", async () => {
    const srv = server({ open: ["A"], windows: ["A"] });
    const page = new DetachedSession("A", srv.deps);
    await page.start();
    await page.attach();
    expect(srv.calls).toEqual(["open A", 'window A {"state":0}', "window.close"]);
    expect(page.getSnapshot()).toMatchObject({ phase: "gone", gone: "attached" });
    // the window goes: its pagehide must not close the module that is a tab of the main page now
    page.pageHide();
    expect(srv.calls).not.toContain("keepalive close A");
    expect(srv.s.open).toEqual(["A"]);
  });

  it("stays a window when the Attach is refused, and says why", async () => {
    const srv = server({ open: ["A"], windows: ["A"] });
    const page = new DetachedSession("A", srv.deps);
    await page.start();
    srv.failWindowWith(new ApiError("NETWORK_ERROR", "ติดต่อ server ไม่ได้", 0));
    await expect(page.attach()).rejects.toThrow("ติดต่อ server ไม่ได้");
    expect(page.getSnapshot().phase).toBe("open");
    expect(srv.calls).not.toContain("window.close");
    page.pageHide();
    expect(srv.calls).toContain("keepalive close A"); // still the window of the module
  });

  it("closing the window is Close module: its pagehide closes the module, with keepalive", async () => {
    const srv = server({ open: ["A"], windows: ["A"] });
    const page = new DetachedSession("A", srv.deps);
    await page.start();
    page.pageHide();
    expect(srv.calls).toEqual(["open A", "keepalive close A"]);
  });

  it("Close of its Module menu closes the module and then the window, and its pagehide sends nothing more", async () => {
    const srv = server({ open: ["A"], windows: ["A"] });
    const page = new DetachedSession("A", srv.deps);
    await page.start();
    await page.closeModule();
    page.pageHide();
    expect(srv.calls).toEqual(["open A", "close A", "window.close"]);
    expect(page.getSnapshot()).toMatchObject({ phase: "gone", gone: "closed" });
  });

  it("Delete closes the window and sends nothing at pagehide", async () => {
    const srv = server({ open: ["A"], windows: ["A"] });
    const page = new DetachedSession("A", srv.deps);
    await page.start();
    page.deleted();
    page.pageHide();
    expect(srv.calls).toEqual(["open A", "window.close"]);
    expect(page.getSnapshot()).toMatchObject({ phase: "gone", gone: "deleted" });
  });

  it("goes by itself when its module was attached from another page or deleted", async () => {
    const attached = server({ open: ["A"], windows: ["A"] });
    const page = new DetachedSession("A", attached.deps);
    await page.start();
    attached.s.windows = [];
    await page.sync();
    expect(page.getSnapshot()).toMatchObject({ phase: "gone", gone: "attached" });
    expect(attached.calls).toEqual(["open A", "window.close"]);

    const deleted = server({ open: ["A"], windows: ["A"] });
    const other = new DetachedSession("A", deleted.deps);
    await other.start();
    deleted.s.modules = ["B"];
    deleted.s.open = [];
    await other.sync();
    expect(other.getSnapshot()).toMatchObject({ phase: "gone", gone: "deleted" });
  });

  it("makes its module a window again after the server restarted without it (connected)", async () => {
    const srv = server({ open: ["A"], windows: ["A"] });
    const page = new DetachedSession("A", srv.deps);
    await page.start();
    srv.s.windows = []; // a new run of the server with "Restore the state of modules" off
    await page.connected();
    expect(srv.calls).toEqual(["open A", 'window A {"state":1}']);
    expect(page.getSnapshot().phase).toBe("open");
  });

  it("says why the module could not be opened, sends no close, and tries again when the server is back", async () => {
    const srv = server({ open: [], windows: ["A"] });
    srv.failOpenWith(new ApiError("NETWORK_ERROR", "ติดต่อ server ไม่ได้", 0));
    const page = new DetachedSession("A", srv.deps);
    await page.start();
    expect(page.getSnapshot()).toMatchObject({ phase: "opening", error: "ติดต่อ server ไม่ได้" });
    page.pageHide();
    expect(srv.calls).toEqual(["open A"]);
    srv.failOpenWith(null);
    await page.connected();
    expect(page.getSnapshot()).toMatchObject({ phase: "open", error: null, epoch: 1 });
  });

  it("tells its listeners of every change, and keeps the list of modules for Clone", async () => {
    const srv = server({ open: ["A"], windows: ["A"], modules: ["A", "B", "C"] });
    const page = new DetachedSession("A", srv.deps);
    let told = 0;
    const stop = page.subscribe(() => told++);
    await page.start();
    expect(told).toBeGreaterThan(0);
    expect(page.getSnapshot().modules).toEqual(["A", "B", "C"]);
    stop();
  });
});

describe("goneText (ของเรา: what the page says when its window cannot close itself)", () => {
  it("says what happened to the module and that the page can be closed", () => {
    expect(goneText("A", "attached")).toContain("A");
    expect(goneText("A", "attached")).toContain("แท็บ");
    expect(goneText("A", "closed")).toContain("ปิด");
    expect(goneText("A", "deleted")).toContain("A");
  });
});
