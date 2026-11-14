import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { closeModule, errorText, getModules, putTabs, putWindow, quit as quitServer, resetClock, retryModule } from "./api";
import { connectAppEvents, keepIfSame, withConfigReads, withControllerSync } from "./appEvents";
import { Dialogs } from "./components/Dialogs";
import { MenuBar } from "./components/MenuBar";
import { MessageBox } from "./components/MessageBox";
import { ModuleHeader } from "./components/ModuleHeader";
import { ModuleMenu } from "./components/ModuleMenu";
import { ModuleView } from "./components/ModuleView";
import { NoticeStrip } from "./components/NoticeStrip";
import { Overlay } from "./components/Overlay";
import { RestoreBar } from "./components/RestoreBar";
import { SatInfoWindows } from "./components/SatInfoWindow";
import { Tabs } from "./components/Tabs";
import { TimeController } from "./components/TimeController";
import { TleOldNotice } from "./components/TleOldNotice";
import { DEFAULT_WINDOW_SIZE, detach, popupBlockedText, restoreList, restoreWindow } from "./detach";
import type { PopupWindow, Size } from "./detach";
import { closeDialog, showDialog } from "./dialogs";
import type { Dialog } from "./dialogs";
import { shortcutAction } from "./menus";
import type { BarAction } from "./menus";
import type { ModuleAction } from "./moduleMenu";
import { pruneDismissed, startupNotices, tickNotices, visibleNotices } from "./notices";
import type { Notice } from "./notices";
import { overlayFor } from "./overlay";
import { enterFullscreen, leaveFullscreen, useAttachHandovers, useControllers, useFullscreen, useSeenNames, useSelection } from "./pageHooks";
import { PassWindows } from "./passes/PassWindowsHost";
import { closeWindow, openWindow } from "./passes/passWindows";
import type { PassWindow } from "./passes/passWindows";
import { closeSky, openSky, pruneSky } from "./passes/skyGlance";
import type { SkyOpen } from "./passes/skyGlance";
import { SkyGlanceWindow } from "./passes/SkyGlanceWindow";
import { reloadPrefs, savePrefs, usePrefs } from "./prefs/prefsStore";
import { runQuit } from "./quit";
import { ControllerWindows } from "./radio/ControllerWindowsHost";
import { CONFIGURE_BLOCKED_BOX, hasModule } from "./radio/controllerWindows";
import { closeSatInfo, openSatInfo } from "./satInfo";
import type { SatInfoOpen } from "./satInfo";
import { activeTab, initialTab, pageIndex, tabOrderWithWindows, tabsOf, windowTitle } from "./tabs";
import { clockToReset, keptTimeController } from "./timeCtl";
import type { ApiMessage, ModuleWindow } from "./types";
import { useModuleConfig } from "./useModuleConfig";
import { useModuleSocket } from "./useModuleSocket";

const RELOAD_AFTER_ERROR_MS = 5000;

/** The page. After File → Quit it is only the message that the server has stopped (the sockets and timers of the page go with it). */
export function App() {
  const [stopped, setStopped] = useState(false);
  return stopped ? <Stopped /> : <Main onStopped={() => setStopped(true)} />;
}

/** (ของเรา) what File → Quit leaves: Gpredict closes its window, a web page cannot, so it says that the server has stopped. */
function Stopped() {
  return (
    <div className="stopped" role="status">
      <div className="stopped-title">Gpredict Web ปิดแล้ว</div>
      <div>server หยุดทำงานแล้ว ปิดแท็บนี้ได้เลย</div>
      <div className="stopped-detail">ถ้าจะใช้งานอีก ให้เริ่ม server ใหม่ แล้วเปิดหน้านี้อีกครั้ง</div>
    </div>
  );
}

function Main({ onStopped }: { onStopped: () => void }) {
  const [open, setOpen] = useState<string[]>([]); // open modules in session order, the windows too
  const [windows, setWindows] = useState<string[]>([]); // the open modules that are windows of their own: not tabs (spec §8.1)
  const [modules, setModules] = useState<string[]>([]); // all modules, open or not
  const [startup, setStartup] = useState<ApiMessage[]>([]); // messages of GET /api/modules
  const [chosen, setChosen] = useState<string | null>(null);
  const [local, setLocal] = useState<Notice[]>([]); // errors of this page's own requests
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false); // GET /api/modules has answered at least once
  const [timeController, setTimeController] = useState<string | null>(null); // module whose Time Controller is open
  const [dialogs, setDialogs] = useState<readonly Dialog[]>([]); // the floating dialogs that are open
  const [passWindows, setPassWindows] = useState<readonly PassWindow[]>([]); // the Pass details and Upcoming passes windows that are open
  const [satInfos, setSatInfos] = useState<readonly SatInfoOpen[]>([]); // the Satellite Info windows that are open (they belong to the page, not to a module)
  const [skyGlance, setSkyGlance] = useState<SkyOpen>(new Map()); // the modules whose "The sky at a glance" window is open (it shows with its module's tab)
  const [moduleMenu, setModuleMenu] = useState<{ x: number; y: number } | null>(null); // the Module menu, where it is open
  const [tleOld, setTleOld] = useState<string | null>(null); // the text of the notice "TLE files are getting out of date", while it is shown
  const [ownWindows, setOwnWindows] = useState<ReadonlyMap<string, PopupWindow>>(new Map()); // the module windows this page has opened
  const [savedPage, setSavedPage] = useState<number | null>(null); // GLOBAL/CURRENT_PAGE as read at load or written since; null before
  const [configRereads, setConfigRereads] = useState(0); // the reads of the shown module's configuration /ws/app asked for
  const shown = useRef<string | null>(null); // the module of the tab shown, for the handlers of /ws/app
  const modulesAsked = useRef(0); // GET /api/modules sent so far: only the answer of the last one counts
  const moduleButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null); // what Full screen makes full screen (spec §8.3)
  const moduleArea = useRef<HTMLDivElement>(null); // the module of the tab: its size is the size of its window at Detach
  const nextLocalId = useRef(0);
  const prefs = usePrefs();
  const fullscreen = useFullscreen();

  const addLocalError = useCallback((text: string) => {
    setLocal((l) => [...l, { id: `local:${nextLocalId.current++}`, level: "error", text }]);
  }, []);
  /** A warning of the page that replaces the one with the same `id` (the blocked window of a module, asked for again). */
  const addLocalWarning = useCallback((id: string, text: string) => {
    setLocal((l) => [...l.filter((n) => n.id !== id), { id, level: "warning", text }]);
  }, []);

  /**
   * (Re)read the modules, the open ones and the startup messages. Called after Open, Clone, Delete, Close and the TLE update (and after
   * New module), and when the server says that the modules changed (`modules_changed` of /ws/app, which also arrives for what this
   * page did itself). Safe to call at any time and as often as you like: only the answer of the last request sent counts, and an answer
   * with what the page holds already sets nothing (the same objects stay in the state), so the tab that is shown is not rendered again.
   */
  const reloadModules = useCallback(async () => {
    const asked = ++modulesAsked.current;
    try {
      const r = await getModules();
      if (asked !== modulesAsked.current) return; // a newer read was sent after this one: its answer is the newer
      setOpen((o) => keepIfSame(o, r.open));
      setWindows((w) => keepIfSame(w, r.windows));
      setModules((m) => keepIfSame(m, r.modules));
      setStartup((s) => keepIfSame(s, r.messages));
      setLoadFailed(false);
      setLoaded(true);
      setLocal((l) => (l.some((n) => n.id === "load") ? l.filter((n) => n.id !== "load") : l));
    } catch (e) {
      if (asked !== modulesAsked.current) return;
      setLoadFailed(true);
      setLocal((l) => [...l.filter((n) => n.id !== "load"), { id: "load", level: "error", text: errorText(e) }]);
    }
  }, []);

  useEffect(() => {
    void reloadModules();
  }, [reloadModules]);

  // the Radio Control and Antenna Control windows of every module, the module windows' too (each has its own socket)
  const ctl = useControllers(loaded, addLocalError);
  const { sync: syncControllers } = ctl;

  // the events of the program (/ws/app, spec §12): the page follows what changes on the server, from another browser tab too. Events sent
  // while the socket was not connected are lost, so the page reads again every time it connects, the configuration of the module shown
  // (`withConfigReads`) and the open controllers (`withControllerSync`: a controller opened in a module window shows here again after
  // Attach) too. A read that fails (the server is going away) leaves what the page holds: the socket's reconnect reads again.
  useEffect(
    () =>
      connectAppEvents(
        withConfigReads(
          withControllerSync(
            {
              connected: () => {
                void reloadModules();
                reloadPrefs().catch(() => {});
              },
              // New Preferences do not read the open modules again: a module keeps the Modules values it was made with until it is made
              // again (opened, Configure → OK, server restart), as in Gpredict (ref-D §10, spec §9.1 and §11); GET /api/modules/{name}
              // answers what it runs with. Edit module reads its module freshly when it opens (moduleForm.ts `readEditOpening`), so
              // Module properties shows and pins the current values, and its OK re-creates the module (the save's `recreate`, ref-D §9).
              prefsChanged: () => void reloadPrefs().catch(() => {}),
              modulesChanged: () => void reloadModules(),
              // the TLE age check found old data (once per server run): Gpredict's notice, which does not block the page
              tleOld: setTleOld,
            },
            () => void syncControllers(),
          ),
          // module_config_changed (a deleted ground station, a save of another page, Configure → OK) and every connect
          { shown: () => (shown.current === null ? [] : [shown.current]), reread: () => setConfigRereads((n) => n + 1) },
        ),
      ),
    [reloadModules, syncControllers],
  );

  // the server is not there (yet): keep trying, so the page comes alive when it starts
  useEffect(() => {
    if (!loadFailed) return;
    const id = setTimeout(() => void reloadModules(), RELOAD_AFTER_ERROR_MS);
    return () => clearTimeout(id);
  }, [loadFailed, reloadModules]);

  const tabs = useMemo(() => tabsOf(open, windows), [open, windows]); // the same array while neither changes: the tab shown is not rendered again

  // the tab of GLOBAL/CURRENT_PAGE when the page loads (spec §8.4, plan decision 8), once the modules and the Preferences are there; a tab
  // the user has chosen meanwhile stays
  if (savedPage === null && loaded && prefs !== null) {
    const page = prefs.values["GLOBAL/CURRENT_PAGE"];
    const saved = typeof page === "number" ? page : -1;
    setSavedPage(saved);
    if (chosen === null) setChosen(initialTab(tabs, saved));
  }

  const current = activeTab(tabs, chosen);
  shown.current = current;
  // a chosen tab that went (detached, closed, deleted) leaves the choice to the tab shown instead: a module that comes back as a tab
  // (Attach module: the last tab, spec §8.2) is not chosen again by it
  if (chosen !== null && chosen !== current) setChosen(current);
  useEffect(() => {
    document.title = windowTitle(current);
  }, [current]);

  // the place of the tab that is shown is written to GLOBAL/CURRENT_PAGE when it changes (another tab chosen, dragged, opened, detached or closed)
  const page = pageIndex(tabs, current);
  useEffect(() => {
    if (savedPage === null || current === null || page === savedPage) return;
    setSavedPage(page);
    // a failure is not told: the place of the tab is a convenience, and a server that is not there says so through the other requests
    savePrefs({ "GLOBAL/CURRENT_PAGE": page }, []).catch(() => {});
  }, [savedPage, current, page]);

  // only the active tab's module holds a WebSocket (it is closed when the tab changes)
  const { tick, connected, closeCode } = useModuleSocket(current);
  const satNames = useSeenNames(current, tick);
  const { config, error: configError, reload: reloadConfig, save: saveConfig } = useModuleConfig(current, configRereads);

  // the selection and Autotrack of each tab's module (forgotten when it is not a tab any more: closed, deleted, or detached, its window has
  // it then), and the target its controllers follow; at Attach the window hands its own back (handover.ts)
  const { selected, select, selectEverywhere, autotracking, setAutotracking, takeOver, release } = useSelection(
    current,
    tabs,
    tick,
    config,
    saveConfig,
    addLocalError,
  );
  useAttachHandovers(tabs, takeOver);

  // the Sky at a glance window of a module that is not a tab any more is forgotten (it shows only with its tab; a detached module's window
  // opens its own)
  useEffect(() => setSkyGlance((s) => pruneSky(s, tabs)), [tabs]);

  // the module was closed or deleted (1000) or is not open (1008): from another browser tab, say. Drop its tab.
  useEffect(() => {
    if (closeCode !== null) void reloadModules();
  }, [closeCode, reloadModules]);

  // the module of the Time Controller is not a tab any more: its window goes, without a reset (closed or deleted: the clock is gone too;
  // detached: its clock runs on in its window, whose Module menu has a Time Controller of its own)
  useEffect(() => {
    if (loaded) setTimeController((t) => keptTimeController(t, tabs));
  }, [loaded, tabs]);

  /**
   * Open the Time Controller of a module (the Module menu's "Time Controller"). One window at a time: another module's window is closed,
   * which resets its clock like closing it does (ref §9). The window shows while its module's tab is the active one; the tick it follows
   * is that tab's.
   */
  const openTimeController = useCallback(
    (name: string) => {
      const reset = clockToReset(timeController, name);
      if (reset !== null) resetClock(reset).catch((e) => addLocalError(errorText(e)));
      setTimeController(name);
    },
    [timeController, addLocalError],
  );
  const closeTimeController = useCallback(() => setTimeController(null), []);
  /** Closing the Sky at a glance window of the module whose tab is shown (the window releases what the server holds for it) */
  const closeSkyGlance = useCallback(() => {
    if (current !== null) setSkyGlance((s) => closeSky(s, current));
  }, [current]);

  const retry = useCallback(
    async (module: string) => {
      try {
        await retryModule(module);
      } catch (e) {
        addLocalError(errorText(e));
      }
    },
    [addLocalError],
  );

  const reorder = useCallback(
    async (tabOrder: string[]) => {
      const before = open;
      const order = tabOrderWithWindows(open, tabOrder); // the server takes every open module: the windows keep their places
      setOpen(order);
      try {
        setOpen((await putTabs(order)).open);
      } catch (e) {
        setOpen(before);
        addLocalError(errorText(e));
      }
    },
    [open, addLocalError],
  );

  // ---------------------------------------------------------------- the menus and their dialogs

  const show = useCallback((d: Dialog) => setDialogs((l) => showDialog(l, d)), []);
  const hide = useCallback((d: Dialog) => setDialogs((l) => closeDialog(l, d)), []);

  // A pass window keeps the answer it was opened with and belongs to no module: closing the module or taking the satellite out leaves it as it is.
  /** Open a Pass details or an Upcoming passes window; the pass items of the satellite popup and the Module menu call it with the server's answer (Task 13). */
  const openPassWindow = useCallback((w: PassWindow) => setPassWindows((l) => openWindow(l, w)), []);
  const closePassWindow = useCallback((id: string) => setPassWindows((l) => closeWindow(l, id)), []);

  /** Satellite info (a popup item, the bold name, a double click on a satellite): a new Satellite Info window; any number can be open (Task 19). */
  const showSatInfo = useCallback((norad: number) => setSatInfos((l) => openSatInfo(l, norad)), []);
  const closeSatInfoWindow = useCallback((id: string) => setSatInfos((l) => closeSatInfo(l, id)), []);

  /** File → New module (Ctrl+N): the Create new module dialog */
  const newModule = useCallback(() => show({ kind: "newModule" }), [show]);
  /** Module menu → Configure: the Edit module dialog of `name` (an open module: it is changed through `saveConfig`) */
  const configureModule = useCallback((name: string) => show({ kind: "editModule", module: name }), [show]);

  // the Edit module dialog changes the configuration of the tab that is shown: it goes when another tab is shown or its module closes
  useEffect(() => {
    setDialogs((l) => {
      const kept = l.filter((d) => d.kind !== "editModule" || d.module === current);
      return kept.length === l.length ? l : kept;
    });
  }, [current]);

  const closeTleOld = useCallback(() => setTleOld(null), []);

  // ---------------------------------------------------------------- module windows (spec §8)

  /** "Restore position of module windows" (Preferences → Modules → Layout, ref-D §10) */
  const restorePos = prefs?.values["GLOBAL/MOD_WIN_POS"] === true;

  /**
   * Detach module (spec §8.1): the page of the module in a window of its own, `fallback` its size when none is stored, with the selection
   * and Autotrack of the tab (handover.ts: this page stops the module's Autotrack at once, the window goes on with it). A blocked window
   * leaves the module in its tab and says how to allow it (ของเรา).
   */
  const detachTab = (name: string, fallback: Size) => {
    const win = config?.name === name ? (config.window ?? null) : null;
    const handover = name === current ? { selected, autotrack: autotracking } : null;
    const browser = { open: (url: string, target: string, features: string) => window.open(url, target, features), putWindow, host: window.location.host };
    const out = detach(browser, name, win, fallback, restorePos, handover);
    if ("notice" in out) return addLocalWarning(`popup:${name}`, out.notice);
    release(name);
    setOwnWindows((m) => new Map(m).set(name, out.window));
    out.saved.then(
      () => reloadModules(), // it leaves the tabs (the modules_changed of /ws/app says so too)
      (e: unknown) => addLocalError(errorText(e)),
    );
  };
  /** The size of the module in its tab (header and views): the size of its window when it has none stored (ref-D §9). */
  const moduleSize = (): Size => {
    const box = moduleArea.current?.getBoundingClientRect();
    return box === undefined ? DEFAULT_WINDOW_SIZE : { width: box.width, height: box.height };
  };

  /** The button เปิด of the restore bar (decision 10): the window of a module the server has as a window, titled as a restored one. */
  const restore = useCallback(
    (name: string, win: ModuleWindow | null) => {
      const opened = restoreWindow((url, target, features) => window.open(url, target, features), name, win, DEFAULT_WINDOW_SIZE, restorePos, window.location.href);
      if (opened === null) addLocalWarning(`popup:${name}`, popupBlockedText(name, window.location.host));
      else setOwnWindows((m) => new Map(m).set(name, opened));
    },
    [restorePos, addLocalWarning],
  );

  /** File → Quit (Ctrl+Q): stop the server and the page says so; a server that cannot be stopped from here says why instead */
  const quit = useCallback(() => runQuit(quitServer, onStopped, addLocalError), [onStopped, addLocalError]);

  const barAction = useCallback(
    (action: BarAction) => {
      switch (action) {
        case "newModule":
          return newModule();
        case "openModule":
          return show({ kind: "open" });
        case "logBrowser":
          return show({ kind: "logBrowser" }); // a second time while it is open: nothing (showDialog), as in Gpredict
        case "quit":
          return void quit();
        case "updateTle":
          return show({ kind: "tle" });
        case "updateTleFiles":
          return show({ kind: "tleFiles" });
        case "updateTrsp":
          return show({ kind: "trsp" });
        case "preferences":
          return show({ kind: "preferences" });
        case "onlineHelp":
          return show({ kind: "help" });
        case "license":
          return show({ kind: "license" });
        case "about":
          return show({ kind: "about" });
      }
    },
    [newModule, show, quit],
  );

  // Ctrl+N, Ctrl+O, Ctrl+L, Ctrl+Q and F1, as far as the browser lets the page have them
  const latestBarAction = useRef(barAction);
  latestBarAction.current = barAction;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const action = shortcutAction(e);
      if (action === null) return;
      e.preventDefault();
      latestBarAction.current(action);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const moduleAction = (action: ModuleAction) => {
    if (current === null) return;
    switch (action.type) {
      case "detach":
        return detachTab(current, moduleSize());
      case "fullscreen":
        return enterFullscreen(root.current, addLocalError);
      case "exitFullscreen":
        // Gpredict: the module leaves full screen as a window (spec §8.3); the window is opened first, in the click
        detachTab(current, DEFAULT_WINDOW_SIZE);
        return leaveFullscreen();
      case "attach":
        // full screen in its tab (Gpredict's full screen state, whose Attach docks the module): back to the tab as it was
        return leaveFullscreen();
      case "autotrack":
        return setAutotracking(action.on);
      case "select":
        return selectEverywhere(action.norad);
      case "skyGlance":
        return setSkyGlance((s) => openSky(s, current)); // opens the window, or brings the open one to the front (ref-P §7.1)
      case "timeController":
        return openTimeController(current);
      case "radio":
      case "rotator":
        return void ctl.open(current, action.type);
      case "configure":
        // not while a controller window of the module is open: Gpredict's box without a title says so (ref-R §1, spec §4.6)
        return hasModule(ctl.controllers, current) ? ctl.setBox(CONFIGURE_BLOCKED_BOX) : configureModule(current);
      case "clone":
        return show({ kind: "clone", module: current });
      case "delete":
        return show({ kind: "delete", module: current });
      case "close":
        return void closeModule(current).then(
          () => {
            ctl.dropModuleWindows(current); // the server has closed its controllers with it
            return reloadModules();
          },
          (e: unknown) => addLocalError(errorText(e)),
        );
    }
  };
  const closeModuleMenu = useCallback((restoreFocus: boolean) => {
    setModuleMenu(null);
    if (restoreFocus) moduleButton.current?.focus();
  }, []);

  const opened = useCallback(
    (name: string, openNow: string[]) => {
      setOpen(openNow);
      setChosen(name); // Gpredict shows the module it opens
      void reloadModules();
    },
    [reloadModules],
  );
  const cloned = useCallback(
    (name: string, wasOpened: boolean, openNow: string[]) => {
      setOpen(openNow);
      if (wasOpened) setChosen(name);
      void reloadModules();
    },
    [reloadModules],
  );
  const { dropModuleWindows } = ctl;
  const deleted = useCallback(
    (name: string) => {
      dropModuleWindows(name); // the server has closed its controllers with it
      void reloadModules();
    },
    [dropModuleWindows, reloadModules],
  );
  const moduleSaved = useCallback(() => void reloadModules(), [reloadModules]);
  const tleUpdated = useCallback(() => {
    void reloadModules(); // the server reloaded the open modules with the new TLEs and dropped its start-up hint to update them
    reloadConfig();
  }, [reloadModules, reloadConfig]);

  const notices = useMemo(
    () => [
      ...local,
      ...startupNotices(startup),
      ...(configError === null ? [] : [{ id: `config:${current}`, level: "error" as const, text: configError }]),
      ...(current === null ? [] : tickNotices(current, tick, satNames)),
    ],
    [local, startup, configError, current, tick, satNames],
  );
  useEffect(() => setDismissed((d) => pruneDismissed(d, notices)), [notices]);
  const dismiss = useCallback((id: string) => {
    setLocal((l) => l.filter((n) => n.id !== id));
    setDismissed((d) => new Set(d).add(id));
  }, []);

  return (
    <div className="app" ref={root}>
      <MenuBar onAction={barAction} />
      <Tabs tabs={tabs} active={current} onSelect={setChosen} onReorder={reorder} />
      <RestoreBar modules={restoreList(windows, ownWindows)} onOpen={restore} />
      <NoticeStrip notices={visibleNotices(notices, dismissed)} onDismiss={dismiss} onRetry={(m) => void retry(m)} />
      {current === null ? (
        // (ของเรา) Gpredict shows an empty notebook here; this is our Thai hint
        loaded && (
          <div className="empty">
            {open.length === 0
              ? "ยังไม่มี module ที่เปิดอยู่ เปิดได้จาก File → Open module หรือ File → New module"
              : "module ที่เปิดอยู่ทุกตัวเป็นหน้าต่างแยก"}
          </div>
        )
      ) : (
        <div className="module" ref={moduleArea}>
          <ModuleHeader
            key={current}
            time={tick?.t ?? null}
            menuButton={moduleButton}
            menuOpen={moduleMenu !== null}
            onModuleMenu={(at) => setModuleMenu((m) => (m === null ? at : null))}
          />
          <div className="module-body">
            {config !== null && (
              <ModuleView
                module={current}
                config={config}
                tick={tick}
                selected={selected}
                onSelect={select}
                onSaveConfig={saveConfig}
                onError={addLocalError}
                onOpenPassWindow={openPassWindow}
                onOpenSatInfo={showSatInfo}
              />
            )}
            <Overlay state={overlayFor(tick, connected, closeCode)} onRetry={() => retry(current)} />
          </div>
        </div>
      )}
      {current !== null && moduleMenu !== null && (
        <ModuleMenu
          x={moduleMenu.x}
          y={moduleMenu.y}
          anchor={moduleButton}
          place="docked"
          fullscreen={fullscreen}
          autotrack={autotracking}
          sats={tick?.sats}
          selected={selected}
          onAction={moduleAction}
          onClose={closeModuleMenu}
        />
      )}
      <Dialogs
        dialogs={dialogs}
        open={open}
        modules={modules}
        current={current}
        config={config}
        saveConfig={saveConfig}
        reloadConfig={reloadConfig}
        hide={hide}
        onCreated={opened}
        onModuleSaved={moduleSaved}
        onOpened={opened}
        onCloned={cloned}
        onDeleted={deleted}
        onTleUpdated={tleUpdated}
      />
      <PassWindows windows={passWindows} onOpen={openPassWindow} onClose={closePassWindow} />
      <SatInfoWindows windows={satInfos} onClose={closeSatInfoWindow} />
      <ControllerWindows refs={ctl.controllers} onClosed={ctl.close} onGone={ctl.gone} />
      {current !== null && config !== null && skyGlance.has(current) && (
        <SkyGlanceWindow
          key={`sky:${current}`} // not the Time Controller's key: siblings with one key are mixed up by React (appKeys.test.ts)
          module={current}
          satellites={config.satellites}
          tick={tick}
          raiseToken={skyGlance.get(current)!}
          onOpenPassWindow={openPassWindow}
          onClose={closeSkyGlance}
        />
      )}
      {current !== null && timeController === current && (
        <TimeController
          key={current}
          module={current}
          tick={tick}
          onClose={closeTimeController}
          onResetFailed={addLocalError}
        />
      )}
      {ctl.box !== null && <MessageBox title={ctl.box.title} message={ctl.box.message} onOk={ctl.closeBox} />}
      {tleOld !== null && <TleOldNotice text={tleOld} onClose={closeTleOld} />}
    </div>
  );
}
