// Detach module, Attach module and the windows of modules (spec §8, ref-D §9, plan decisions 9 and 10). Pure: no DOM and no React.
// App.tsx detaches a tab and shows the restore bar, DetachedApp.tsx is the page of a module window (/?module=<name>), and both
// give these functions the browser's window.open, the API calls and the clock.

import { errorText } from "./api";
import type { ModuleList, ModuleWindow } from "./types";

/** How often a module window looks at its position and size: the browser has no "the window moved" event (spec §8.1). */
export const DETACH_POLL_MS = 1000;
/** A position and size are saved once they have stayed the same this long. */
export const GEOMETRY_DEBOUNCE_MS = 1000;
/** The server's smallest window (WINDOW_SIZE_RANGE of module.py): a smaller size is not sent. */
const WINDOW_MIN = 100;
/** Gpredict's size of a window that has none stored when it leaves full screen (ref-D §9): ours also for the restore bar's windows. */
export const DEFAULT_WINDOW_SIZE: Readonly<Size> = { width: 800, height: 600 };

export interface Size {
  width: number;
  height: number;
}

/** A module window where it is: `x`, `y` the screen position of its corner, `width`, `height` the size of its page, in px. */
export interface Geometry extends Size {
  x: number;
  y: number;
}

/** What `geometryOk` needs of the browser's `screen`. */
export interface ScreenArea {
  availWidth: number;
  availHeight: number;
}

/** What the page uses of a window it opened (the browser's Window has all of it). */
export interface PopupWindow {
  readonly closed: boolean;
  focus(): void;
  readonly location: { readonly href: string; replace(url: string): void };
}

/** `window.open`: null when the browser blocks the window. */
export type OpenWindow = (url: string, target: string, features: string) => PopupWindow | null;

// ---------------------------------------------------------------- the address, the name, the size and the title

/** The page of a module window; `restored` for one opened by the restore bar, whose title is Gpredict's of a restored window. */
export function detachedUrl(module: string, restored = false): string {
  return `/?module=${encodeURIComponent(module)}${restored ? "&restored=1" : ""}`;
}

/** The name of the window of a module: window.open with it reaches the module's window if it is open (decision 10). */
export const detachTarget = (module: string): string => `gpredict-${module}`;

/** What a page address says: the page of a module window (`?module=`), or null for the main page. */
export function detachedPage(search: string): { module: string; restored: boolean } | null {
  const params = new URLSearchParams(search);
  const module = params.get("module");
  return module === null || module === "" ? null : { module, restored: params.get("restored") === "1" };
}

/**
 * The features of window.open for a module window (ref-D §9): the stored size, else `fallback` (the size of the module in its tab); the
 * stored position only when "Restore position of module windows" is on (`restorePos`) and both coordinates are stored.
 */
export function detachFeatures(win: ModuleWindow | null, fallback: Size, restorePos: boolean): string {
  const width = win?.width ?? Math.round(fallback.width);
  const height = win?.height ?? Math.round(fallback.height);
  const at = restorePos && win !== null && win.x !== null && win.y !== null ? `,left=${win.x},top=${win.y}` : "";
  return `popup,width=${width},height=${height}${at}`;
}

/**
 * A geometry that may be saved (ref-D §9: Gpredict skips negative coordinates and a window that does not fit inside the screen): not
 * negative, the whole window on the screen, and a size the server takes.
 */
export function geometryOk(g: Geometry, screen: ScreenArea): boolean {
  return (
    g.x >= 0 && g.y >= 0 && g.width >= WINDOW_MIN && g.height >= WINDOW_MIN && g.x + g.width <= screen.availWidth && g.y + g.height <= screen.availHeight
  );
}

export function sameGeometry(a: Geometry | null, b: Geometry | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * The title of a module window (ref §1): "GPREDICT: <module> (<station>)" after Detach, "Gpredict: <module> (<station>)" for one opened
 * again by the restore bar (decision 10, Gpredict's restore at start-up). Without the station until the module has told it.
 */
export function detachedTitle(module: string, qth: string | null, restored: boolean): string {
  return `${restored ? "Gpredict" : "GPREDICT"}: ${module}${qth === null ? "" : ` (${qth})`}`;
}

/**
 * (ของเรา, spec §8.1) the notice when the browser blocks the window of a module (Detach module, or the restore bar's button): the module
 * stays where it was. `host` is the host of the page, 127.0.0.1:8740 when the server serves it (the browser allows popups per host).
 */
export function popupBlockedText(module: string, host: string): string {
  return `browser ไม่ยอมให้เปิดหน้าต่างของ module ${module} ให้อนุญาต popup ของ ${host} ในการตั้งค่าของ browser แล้วลองอีกครั้ง`;
}

// ---------------------------------------------------------------- the main page

export interface DetachDeps {
  open: OpenWindow;
  putWindow: (module: string, body: Partial<ModuleWindow>) => Promise<unknown>;
  /** the page's host, for the notice */
  host: string;
}

/** A window was opened (`saved`: the module is a window on the server then), or the browser blocked it (`notice`). */
export type DetachOutcome = { window: PopupWindow; saved: Promise<unknown> } | { notice: string };

/**
 * Detach module (spec §8.1): open the page of the module in a window of its own (at once, in the click: a browser opens a window only
 * then), and once there is one tell the server that the module is a window (PUT …/window state 1: it leaves the tabs of every main
 * page through /ws/app). A blocked window sends nothing: the module stays in its tab, and `notice` says how to allow the window.
 */
export function detach(deps: DetachDeps, module: string, win: ModuleWindow | null, fallback: Size, restorePos: boolean): DetachOutcome {
  const opened = deps.open(detachedUrl(module), detachTarget(module), detachFeatures(win, fallback, restorePos));
  if (opened === null) return { notice: popupBlockedText(module, deps.host) };
  return { window: opened, saved: deps.putWindow(module, { state: 1 }) };
}

/**
 * The button "เปิด" of the restore bar (decision 10): the window of a module that the server has as a window. It is asked for by its name
 * only, so a window of the module that is open already (opened before this page was loaded again) comes to the front without being
 * loaded again (that would close and open the module); a new one, still blank, is sent to the page of the module (`base`: the address of
 * this page). Null when the browser blocks it.
 */
export function restoreWindow(open: OpenWindow, module: string, win: ModuleWindow | null, fallback: Size, restorePos: boolean, base: string): PopupWindow | null {
  const opened = open("", detachTarget(module), detachFeatures(win, fallback, restorePos));
  if (opened === null) return null;
  if (!showsModule(opened, module)) opened.location.replace(new URL(detachedUrl(module, true), base).href);
  opened.focus();
  return opened;
}

/** The window shows the page of `module` (a window of another site cannot be read: then it does not). */
function showsModule(win: PopupWindow, module: string): boolean {
  try {
    const href = win.location.href;
    return href !== "about:blank" && detachedPage(new URL(href).search)?.module === module;
  } catch {
    return false;
  }
}

/** The modules of the restore bar (decision 10): the windows of the server that this page has not opened, or whose window has closed. */
export function restoreList(windows: readonly string[], own: ReadonlyMap<string, PopupWindow>): string[] {
  return windows.filter((m) => {
    const w = own.get(m);
    return w === undefined || w.closed;
  });
}

// ---------------------------------------------------------------- the position and size of a module window

/** What the module window has seen of its geometry: the last one (since `since`, ms) and the one saved last. */
export interface GeometryWatch {
  seen: Geometry | null;
  since: number;
  saved: Geometry | null;
}

export const NO_GEOMETRY: GeometryWatch = { seen: null, since: 0, saved: null };

/**
 * One look at the window (every DETACH_POLL_MS, at `now` ms): a geometry is saved (`save`) once it has stayed the same for
 * GEOMETRY_DEBOUNCE_MS, if it is not the one saved already and `geometryOk` takes it. The caller sets `saved` only when the save worked.
 */
export function watchGeometry(w: GeometryWatch, g: Geometry, now: number, screen: ScreenArea): { watch: GeometryWatch; save: Geometry | null } {
  if (!sameGeometry(w.seen, g)) return { watch: { ...w, seen: g, since: now }, save: null };
  const settled = now - w.since >= GEOMETRY_DEBOUNCE_MS;
  return { watch: w, save: settled && !sameGeometry(w.saved, g) && geometryOk(g, screen) ? g : null };
}

// ---------------------------------------------------------------- the page of a module window

/**
 * - opening: its module is being opened (or could not be: `error`)
 * - open: the page shows its module, a window of its own
 * - leaving: Attach module or Close is on its way
 * - gone: the module was attached, closed or deleted, and the window was asked to close
 */
export type DetachedPhase = "opening" | "open" | "leaving" | "gone";
export type GoneReason = "attached" | "closed" | "deleted";

export interface DetachedState {
  phase: DetachedPhase;
  /** counts the opens of the module: a new one (the module was opened again) connects the views again */
  epoch: number;
  /** why the module could not be opened (Thai text), null if it was */
  error: string | null;
  gone: GoneReason | null;
  /** every module, for Clone (the names it may not take) */
  modules: readonly string[];
}

export interface DetachedDeps {
  openModule(name: string): Promise<unknown>;
  getModules(): Promise<ModuleList>;
  putWindow(name: string, body: Partial<ModuleWindow>): Promise<unknown>;
  closeModule(name: string): Promise<unknown>;
  /** window.close() */
  closeWindow(): void;
  /** POST …/close with keepalive (api.ts closeModuleKeepalive) */
  postClose(name: string): void;
}

/**
 * What the page of a module window does with the list of modules (GET /api/modules):
 * - deleted: the module is gone, the window goes
 * - reopen: it is not open: the close sent by the pagehide of the page before this one (F5) was done after this page's open (decision 9)
 * - window: it is open but not a window yet: the PUT of the Detach that opened this page has not been done yet, or the server was started
 *   again without "Restore the state of modules" (`ensured` false: the page has not had its module as a window from this server yet)
 * - attached: it was a window and is not any more: Attach module from another page of the same module
 * - keep
 */
export function detachedStep(list: Pick<ModuleList, "modules" | "open" | "windows">, module: string, ensured: boolean): "keep" | "reopen" | "window" | "attached" | "deleted" {
  if (!list.modules.includes(module)) return "deleted";
  if (!list.open.includes(module)) return "reopen";
  if (!list.windows.includes(module)) return ensured ? "attached" : "window";
  return "keep";
}

/** (ของเรา) what the page says when its window does not close itself (a page not opened by the main page cannot be closed by script). */
export function goneText(module: string, reason: GoneReason): string {
  switch (reason) {
    case "attached":
      return `module ${module} กลับไปเป็นแท็บของหน้าหลักแล้ว ปิดหน้านี้ได้เลย`;
    case "closed":
      return `ปิด module ${module} แล้ว ปิดหน้านี้ได้เลย`;
    case "deleted":
      return `ไม่มี module ${module} แล้ว ปิดหน้านี้ได้เลย`;
  }
}

/**
 * The page of a module window (/?module=<name>, spec §8.1-§8.2, plan decision 9), for useSyncExternalStore.
 *
 * - `start` opens the module every time the page loads (POST …/open, also after F5) and then reads the list of modules.
 * - `sync` reads the list again (on every modules_changed of /ws/app and when the module's socket closes for good) and follows
 *   `detachedStep`; calls that come while one runs are folded into one more run after it.
 * - `connected` (the /ws/app socket opened): the module is made a window again if the server lost that, or opened if it could not be.
 * - `attach` sends state 0 and closes the window; `closeModule` closes the module and the window; `deleted` closes the window.
 * - `pageHide` sends the close of the module (keepalive) only while the page has it open as a window: never after Attach, Close or Delete.
 */
export class DetachedSession {
  private state: DetachedState = { phase: "opening", epoch: 0, error: null, gone: null, modules: [] };
  private readonly listeners = new Set<() => void>();
  private started: Promise<void> | null = null;
  private opening = false; // an open is on its way
  private ensured = false; // the server has had the module as a window since the page (or its /ws/app socket) started
  private syncing = false;
  private again = false;

  constructor(
    readonly module: string,
    private readonly deps: DetachedDeps,
  ) {}

  readonly getSnapshot = (): DetachedState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Open the module (once, however often it is called) and read the list. */
  start(): Promise<void> {
    this.started ??= this.open();
    return this.started;
  }

  connected(): Promise<void> {
    this.ensured = false;
    return this.state.phase === "opening" ? this.open() : this.sync();
  }

  async sync(): Promise<void> {
    if (this.syncing) {
      this.again = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.again = false;
        await this.syncOnce();
      } while (this.again && this.state.phase === "open");
    } finally {
      this.syncing = false;
    }
  }

  async attach(): Promise<void> {
    if (this.state.phase !== "open") return;
    this.set({ phase: "leaving" });
    try {
      await this.deps.putWindow(this.module, { state: 0 });
    } catch (e) {
      this.set({ phase: "open" });
      throw e;
    }
    this.leave("attached");
  }

  async closeModule(): Promise<void> {
    if (this.state.phase !== "open") return;
    this.set({ phase: "leaving" });
    try {
      await this.deps.closeModule(this.module);
    } catch (e) {
      this.set({ phase: "open" });
      throw e;
    }
    this.leave("closed");
  }

  /** Delete of the Module menu has deleted the module. */
  deleted(): void {
    this.leave("deleted");
  }

  /** The page is going away (closed by the browser's button, or loaded again): Close module, if the module is this window's. */
  pageHide(): void {
    if (this.state.phase === "open" || this.opening) this.deps.postClose(this.module);
  }

  private async open(): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    try {
      await this.deps.openModule(this.module);
    } catch (e) {
      if (this.state.phase === "opening") this.set({ error: errorText(e) });
      return; // open again: tried at the next `connected` (opening), or the next `sync` (open)
    } finally {
      this.opening = false;
    }
    if (this.state.phase !== "opening" && this.state.phase !== "open") return; // left meanwhile
    this.set({ phase: "open", epoch: this.state.epoch + 1, error: null });
    await this.sync();
  }

  private async syncOnce(): Promise<void> {
    if (this.state.phase !== "open") return;
    let list: ModuleList;
    try {
      list = await this.deps.getModules();
    } catch {
      return; // the server is not there: its /ws/app socket reads again when it is back
    }
    if (this.state.phase !== "open") return;
    if (list.modules.join("\n") !== this.state.modules.join("\n")) this.set({ modules: list.modules });
    switch (detachedStep(list, this.module, this.ensured)) {
      case "keep":
        this.ensured = true;
        return;
      case "window":
        try {
          await this.deps.putWindow(this.module, { state: 1 });
          this.ensured = true;
        } catch {
          // tried again at the next sync
        }
        return;
      case "reopen":
        return this.open();
      case "attached":
        return this.leave("attached");
      case "deleted":
        return this.leave("deleted");
    }
  }

  private leave(reason: GoneReason): void {
    this.set({ phase: "gone", gone: reason });
    this.deps.closeWindow();
  }

  private set(change: Partial<DetachedState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of [...this.listeners]) listener();
  }
}
