import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { closeModule, errorText, getModules, putTabs, quit as quitServer, resetClock, retryModule } from "./api";
import { autotrackTarget } from "./autotrack";
import { Dialogs } from "./components/Dialogs";
import { MenuBar } from "./components/MenuBar";
import { MessageBox } from "./components/MessageBox";
import { ModuleHeader } from "./components/ModuleHeader";
import { ModuleMenu } from "./components/ModuleMenu";
import { ModuleView } from "./components/ModuleView";
import { NoticeStrip } from "./components/NoticeStrip";
import { Overlay } from "./components/Overlay";
import { Tabs } from "./components/Tabs";
import { TimeController } from "./components/TimeController";
import { closeDialog, showDialog } from "./dialogs";
import type { Dialog } from "./dialogs";
import { shortcutAction } from "./menus";
import type { BarAction } from "./menus";
import type { ModuleAction } from "./moduleMenu";
import { pruneDismissed, rememberNames, startupNotices, tickNotices, visibleNotices } from "./notices";
import type { Notice, SatNameMap } from "./notices";
import { overlayFor } from "./overlay";
import { PassWindows } from "./passes/PassWindowsHost";
import { closeWindow, openWindow } from "./passes/passWindows";
import type { PassWindow } from "./passes/passWindows";
import { closeSky, openSky, pruneSky } from "./passes/skyGlance";
import type { SkyOpen } from "./passes/skyGlance";
import { SkyGlanceWindow } from "./passes/SkyGlanceWindow";
import { runQuit } from "./quit";
import { ControllerWindows } from "./radio/ControllerWindowsHost";
import {
  CONFIGURE_BLOCKED_BOX,
  dropModule,
  dropRef,
  hasModule,
  mergeOpen,
  openRefusalBox,
  refKey,
  sameRef,
  syncWindows,
  targetPosts,
} from "./radio/controllerWindows";
import type { ControllerBox, ControllerWindow } from "./radio/controllerWindows";
import { closeController, getControllers, openController, postTarget } from "./radio/radioApi";
import type { ControllerKind, ControllerRef } from "./radio/types";
import { pruneToOpen, singleSatChange, withMember, withSelection } from "./selection";
import type { Selections } from "./selection";
import { activeTab, windowTitle } from "./tabs";
import type { ApiMessage, Tick } from "./types";
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

const NO_NAMES: SatNameMap = new Map();

/**
 * The names of the satellites a module's ticks have shown, so that a notice can name a satellite that has dropped out of the
 * ticks (GMAT returned nothing for it, say). Forgotten when another module is shown.
 */
function useSeenNames(module: string | null, tick: Tick | null): SatNameMap {
  const [seen, setSeen] = useState<{ module: string | null; names: SatNameMap }>({ module: null, names: NO_NAMES });
  const names = rememberNames(seen.module === module ? seen.names : NO_NAMES, tick);
  if (seen.module !== module || seen.names !== names) setSeen({ module, names }); // derived from the previous render, not an effect
  return names;
}

function Main({ onStopped }: { onStopped: () => void }) {
  const [open, setOpen] = useState<string[]>([]); // open modules in tab order
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
  const [skyGlance, setSkyGlance] = useState<SkyOpen>(new Map()); // the modules whose "The sky at a glance" window is open (it shows with its module's tab)
  const [moduleMenu, setModuleMenu] = useState<{ x: number; y: number } | null>(null); // the Module menu, where it is open
  const [selections, setSelections] = useState<Selections>({}); // the selected satellite of each module (not saved)
  const [autotrack, setAutotrack] = useState<ReadonlySet<string>>(new Set()); // modules with Autotrack on (not saved)
  const [controllers, setControllers] = useState<readonly ControllerWindow[]>([]); // the Radio Control and Antenna Control windows of every module
  const [controllerBox, setControllerBox] = useState<ControllerBox | null>(null); // Gpredict's error box of the controllers (no device, Configure blocked)
  const controllersAsked = useRef(0); // GET /api/controllers sent so far: only the answer of the last one counts
  const closingControllers = useRef(new Set<string>()); // (refKey) the controllers whose window was closed and that the server is still closing
  const targetsSent = useRef<Selections>({}); // the selections whose targets have been sent
  const moduleButton = useRef<HTMLButtonElement>(null);
  const nextLocalId = useRef(0);

  const addLocalError = useCallback((text: string) => {
    setLocal((l) => [...l, { id: `local:${nextLocalId.current++}`, level: "error", text }]);
  }, []);

  /** (Re)read the modules, the open ones and the startup messages. Called after Open, Clone, Delete, Close and the TLE update (and after New module). */
  const reloadModules = useCallback(async () => {
    try {
      const r = await getModules();
      setOpen(r.open);
      setModules(r.modules);
      setStartup(r.messages);
      setLoadFailed(false);
      setLoaded(true);
      setLocal((l) => l.filter((n) => n.id !== "load"));
    } catch (e) {
      setLoadFailed(true);
      setLocal((l) => [...l.filter((n) => n.id !== "load"), { id: "load", level: "error", text: errorText(e) }]);
    }
  }, []);

  useEffect(() => {
    void reloadModules();
  }, [reloadModules]);

  /**
   * Show the windows of the controllers the server has open (GET /api/controllers), at page load and after every open and close
   * (decision 2 of the plan). Only the answer of the last request counts: an older one can miss a controller this page has just opened.
   */
  const syncControllers = useCallback(async () => {
    const asked = ++controllersAsked.current;
    try {
      const open = await getControllers();
      if (asked === controllersAsked.current) setControllers((l) => syncWindows(l, open, closingControllers.current));
    } catch (e) {
      addLocalError(errorText(e));
    }
  }, [addLocalError]);

  // the controllers keep running in the server when the browser tab is closed: their windows come back when the page is loaded
  useEffect(() => {
    if (loaded) void syncControllers();
  }, [loaded, syncControllers]);

  // the server is not there (yet): keep trying, so the page comes alive when it starts
  useEffect(() => {
    if (!loadFailed) return;
    const id = setTimeout(() => void reloadModules(), RELOAD_AFTER_ERROR_MS);
    return () => clearTimeout(id);
  }, [loadFailed, reloadModules]);

  const current = activeTab(open, chosen);
  useEffect(() => {
    document.title = windowTitle(current);
  }, [current]);

  // only the active tab's module holds a WebSocket (it is closed when the tab changes)
  const { tick, connected, closeCode } = useModuleSocket(current);
  const satNames = useSeenNames(current, tick);
  const { config, error: configError, reload: reloadConfig, save: saveConfig } = useModuleConfig(current);

  // the selection, Autotrack and the Sky at a glance window of a module that is not open any more are forgotten
  useEffect(() => {
    setSelections((s) => pruneToOpen(s, open));
    setSkyGlance((s) => pruneSky(s, open));
    setAutotrack((a) => {
      const kept = [...a].filter((m) => open.includes(m));
      return kept.length === a.size ? a : new Set(kept);
    });
  }, [open]);

  const selected = current === null ? null : (selections[current] ?? null);
  const select = useCallback(
    (norad: number | null) => {
      if (current !== null) setSelections((s) => withSelection(s, current, norad));
    },
    [current],
  );

  /**
   * Select satellite and Autotrack choose a satellite "in all views" (spec §8.2): the selection of List, Map and Polar, and the
   * satellite Single sat shows (which the module remembers, so that goes through `save` like every change of the configuration).
   */
  const selectEverywhere = useCallback(
    (norad: number | null) => {
      select(norad);
      if (norad === null || config === null || config.single.selected === norad) return;
      saveConfig(singleSatChange(norad)).catch((e: unknown) => addLocalError(errorText(e)));
    },
    [select, config, saveConfig, addLocalError],
  );

  // the target of a module follows its selection (Select satellite, a click in a view, Autotrack): its controllers follow it (spec §3.3)
  useEffect(() => {
    const before = targetsSent.current;
    targetsSent.current = selections;
    for (const { module, norad } of targetPosts(before, selections)) {
      postTarget(module, norad).catch((e: unknown) => addLocalError(errorText(e)));
    }
  }, [selections, addLocalError]);

  // Edit module took the selected satellite out of the module
  useEffect(() => {
    if (config !== null && selected !== null && !config.satellites.includes(selected)) select(null);
  }, [config, selected, select]);

  // Autotrack (ref §2): every tick, the target is the satellite above the horizon or else the one with the earliest AOS
  const autotracking = current !== null && autotrack.has(current);
  useEffect(() => {
    if (!autotracking) return;
    const target = autotrackTarget(tick, selected);
    if (target !== selected) selectEverywhere(target);
  }, [autotracking, tick, selected, selectEverywhere]);

  // the module was closed or deleted (1000) or is not open (1008): from another browser tab, say. Drop its tab.
  useEffect(() => {
    if (closeCode !== null) void reloadModules();
  }, [closeCode, reloadModules]);

  // the module of the Time Controller was closed or deleted: its window goes with it (no reset, the clock is gone too)
  useEffect(() => {
    if (loaded && timeController !== null && !open.includes(timeController)) setTimeController(null);
  }, [loaded, open, timeController]);

  /**
   * Open the Time Controller of a module (the Module menu's "Time Controller", Task 18). One window at a time: another
   * module's window is closed, which resets its clock like closing it does (ref §9). The window shows while its module's
   * tab is the active one; the tick it follows is that tab's.
   */
  const openTimeController = useCallback(
    (name: string) => {
      if (timeController !== null && timeController !== name) {
        resetClock(timeController).catch((e) => addLocalError(errorText(e)));
      }
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
    async (order: string[]) => {
      const before = open;
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

  // ---------------------------------------------------------------- Radio Control and Antenna Control (ref-R §1)

  /**
   * Module menu → Radio Control / Antenna Control: the window of the controller of `module`, opened on the server first; one that is
   * open already comes to the front instead. Without a device of the kind, Gpredict's "ERROR" box.
   */
  const openControl = useCallback(
    async (module: string, kind: ControllerKind) => {
      const ref = { module, kind };
      if (controllers.some((w) => sameRef(w, ref))) {
        setControllers((l) => mergeOpen(l, ref));
        return;
      }
      try {
        await openController(module, kind);
      } catch (e) {
        const box = openRefusalBox(kind, e);
        if (box === null) addLocalError(errorText(e));
        else setControllerBox(box);
        return;
      }
      closingControllers.current.delete(refKey(ref)); // opened again while its close was on the way: the server has done the close first
      setControllers((l) => mergeOpen(l, ref));
      void syncControllers();
    },
    [controllers, addLocalError, syncControllers],
  );
  /** The user closed a controller window: it goes at once, the server disengages and closes the controller, then the list is read again. */
  const closeControl = useCallback(
    async (ref: ControllerRef) => {
      const key = refKey(ref);
      closingControllers.current.add(key);
      setControllers((l) => dropRef(l, ref));
      try {
        await closeController(ref.module, ref.kind);
      } catch (e) {
        addLocalError(errorText(e));
      } finally {
        closingControllers.current.delete(key);
      }
      void syncControllers();
    },
    [addLocalError, syncControllers],
  );
  /** A window went by itself: its controller was closed from another browser tab, or its module was closed or deleted. */
  const controllerGone = useCallback(
    (ref: ControllerRef) => {
      setControllers((l) => dropRef(l, ref));
      void syncControllers();
    },
    [syncControllers],
  );
  const closeControllerBox = useCallback(() => setControllerBox(null), []);

  /** File → Quit (Ctrl+Q): stop the server and the page says so; a server that cannot be stopped from here says why instead */
  const quit = useCallback(() => runQuit(quitServer, onStopped, addLocalError), [onStopped, addLocalError]);

  const barAction = useCallback(
    (action: BarAction) => {
      switch (action) {
        case "newModule":
          return newModule();
        case "openModule":
          return show({ kind: "open" });
        case "quit":
          return void quit();
        case "updateTle":
          return show({ kind: "tle" });
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

  // Ctrl+N, Ctrl+O, Ctrl+Q and F1, as far as the browser lets the page have them
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
      case "autotrack":
        return setAutotrack((a) => withMember(a, current, action.on));
      case "select":
        return selectEverywhere(action.norad);
      case "skyGlance":
        return setSkyGlance((s) => openSky(s, current)); // opens the window, or brings the open one to the front (ref-P §7.1)
      case "timeController":
        return openTimeController(current);
      case "radio":
      case "rotator":
        return void openControl(current, action.type);
      case "configure":
        // not while a controller window of the module is open: Gpredict's box without a title says so (ref-R §1, spec §4.6)
        return hasModule(controllers, current) ? setControllerBox(CONFIGURE_BLOCKED_BOX) : configureModule(current);
      case "clone":
        return show({ kind: "clone", module: current });
      case "delete":
        return show({ kind: "delete", module: current });
      case "close":
        return void closeModule(current).then(
          () => {
            setControllers((l) => dropModule(l, current)); // the server has closed its controllers with it
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
  const deleted = useCallback(
    (name: string) => {
      setControllers((l) => dropModule(l, name)); // the server has closed its controllers with it
      void reloadModules();
    },
    [reloadModules],
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
    <div className="app">
      <MenuBar onAction={barAction} />
      <Tabs tabs={open} active={current} onSelect={setChosen} onReorder={reorder} />
      <NoticeStrip notices={visibleNotices(notices, dismissed)} onDismiss={dismiss} onRetry={(m) => void retry(m)} />
      {current === null ? (
        // (ของเรา) Gpredict shows an empty notebook here; this is our Thai hint
        loaded && <div className="empty">ยังไม่มี module ที่เปิดอยู่ เปิดได้จาก File → Open module หรือ File → New module</div>
      ) : (
        <div className="module">
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
        hide={hide}
        onCreated={opened}
        onModuleSaved={moduleSaved}
        onOpened={opened}
        onCloned={cloned}
        onDeleted={deleted}
        onTleUpdated={tleUpdated}
      />
      <PassWindows windows={passWindows} onOpen={openPassWindow} onClose={closePassWindow} />
      <ControllerWindows refs={controllers} onClosed={closeControl} onGone={controllerGone} />
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
      {controllerBox !== null && <MessageBox title={controllerBox.title} message={controllerBox.message} onOk={closeControllerBox} />}
    </div>
  );
}
