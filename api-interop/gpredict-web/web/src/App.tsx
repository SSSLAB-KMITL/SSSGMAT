import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { closeModule, errorText, getModules, putTabs, quit as quitServer, resetClock, retryModule } from "./api";
import { autotrackTarget } from "./autotrack";
import { Dialogs } from "./components/Dialogs";
import { MenuBar } from "./components/MenuBar";
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
import { pruneDismissed, startupNotices, tickNotices, visibleNotices } from "./notices";
import type { Notice } from "./notices";
import { overlayFor } from "./overlay";
import { pruneToOpen, singleSatChange, withMember, withSelection } from "./selection";
import type { Selections } from "./selection";
import { activeTab, windowTitle } from "./tabs";
import type { ApiMessage } from "./types";
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
  const [moduleMenu, setModuleMenu] = useState<{ x: number; y: number } | null>(null); // the Module menu, where it is open
  const [selections, setSelections] = useState<Selections>({}); // the selected satellite of each module (not saved)
  const [autotrack, setAutotrack] = useState<ReadonlySet<string>>(new Set()); // modules with Autotrack on (not saved)
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
  const { config, error: configError, reload: reloadConfig, save: saveConfig } = useModuleConfig(current);

  // the selection and Autotrack of a module that is not open any more are forgotten
  useEffect(() => {
    setSelections((s) => pruneToOpen(s, open));
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

  /** File → Quit (Ctrl+Q): stop the server; the page then says so */
  const quit = useCallback(async () => {
    try {
      await quitServer();
      onStopped();
    } catch (e) {
      addLocalError(errorText(e));
    }
  }, [onStopped, addLocalError]);

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
      case "timeController":
        return openTimeController(current);
      case "configure":
        return configureModule(current);
      case "clone":
        return show({ kind: "clone", module: current });
      case "delete":
        return show({ kind: "delete", module: current });
      case "close":
        return void closeModule(current).then(
          () => reloadModules(),
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
  const deleted = useCallback(() => void reloadModules(), [reloadModules]);
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
      ...(current === null ? [] : tickNotices(current, tick)),
    ],
    [local, startup, configError, current, tick],
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
      {current !== null && timeController === current && (
        <TimeController
          key={current}
          module={current}
          tick={tick}
          onClose={closeTimeController}
          onResetFailed={addLocalError}
        />
      )}
    </div>
  );
}
