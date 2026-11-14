import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { closeModule, closeModuleKeepalive, errorText, getModules, openModule, putWindow, retryModule } from "./api";
import { connectAppEvents } from "./appEvents";
import { Dialogs } from "./components/Dialogs";
import { MessageBox } from "./components/MessageBox";
import { ModuleHeader } from "./components/ModuleHeader";
import { ModuleMenu } from "./components/ModuleMenu";
import { ModuleView } from "./components/ModuleView";
import { NoticeStrip } from "./components/NoticeStrip";
import { Overlay } from "./components/Overlay";
import { SatInfoWindows } from "./components/SatInfoWindow";
import { TimeController } from "./components/TimeController";
import { DETACH_POLL_MS, detachedTitle, DetachedSession, goneText, NO_GEOMETRY, watchGeometry } from "./detach";
import type { DetachedDeps, GeometryWatch } from "./detach";
import { closeDialog, showDialog } from "./dialogs";
import type { Dialog } from "./dialogs";
import type { ModuleAction } from "./moduleMenu";
import { pruneDismissed, tickNotices, visibleNotices } from "./notices";
import type { Notice } from "./notices";
import { overlayFor } from "./overlay";
import { enterFullscreen, leaveFullscreen, useControllers, useFullscreen, useSeenNames, useSelection } from "./pageHooks";
import { PassWindows } from "./passes/PassWindowsHost";
import { closeWindow, openWindow } from "./passes/passWindows";
import type { PassWindow } from "./passes/passWindows";
import { closeSky, openSky } from "./passes/skyGlance";
import type { SkyOpen } from "./passes/skyGlance";
import { SkyGlanceWindow } from "./passes/SkyGlanceWindow";
import { reloadPrefs } from "./prefs/prefsStore";
import { ControllerWindows } from "./radio/ControllerWindowsHost";
import { CONFIGURE_BLOCKED_BOX, hasModule } from "./radio/controllerWindows";
import { closeSatInfo, openSatInfo } from "./satInfo";
import type { SatInfoOpen } from "./satInfo";
import { useModuleConfig } from "./useModuleConfig";
import { useModuleSocket } from "./useModuleSocket";

/** What the page of a module window does with the browser and the server. */
const BROWSER: DetachedDeps = {
  openModule,
  getModules,
  putWindow,
  closeModule,
  closeWindow: () => window.close(),
  postClose: closeModuleKeepalive,
};

interface Props {
  module: string;
  /** opened by the restore bar of the main page: Gpredict's title of a restored window */
  restored: boolean;
}

/**
 * The page of a module window (/?module=<name>, spec §8.1-§8.3, plan decision 9): the module's header, views and Module menu, with the
 * windows its menu opens (Sky at a glance, Time Controller, Radio Control, Antenna Control, Configure, Clone, Delete) and those of its views
 * (pass windows, Satellite info). No menu bar and no tabs, like Gpredict's module window.
 *
 * DetachedSession (detach.ts) opens the module every time the page loads (also after F5), follows the list of modules (/ws/app), and
 * sends the close of the module when the window is closed (pagehide), but not after Attach module, Close or Delete.
 */
export function DetachedApp({ module, restored }: Props) {
  const [session] = useState(() => new DetachedSession(module, BROWSER));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);

  useEffect(() => void session.start(), [session]);

  // the events of the program (/ws/app): the list of modules (an Attach, a Delete, the close of the page before this one), and the
  // Preferences (number formats apply at once). The TLE notice is the main page's.
  useEffect(
    () =>
      connectAppEvents({
        connected: () => {
          void session.connected();
          reloadPrefs().catch(() => {});
        },
        prefsChanged: () => void reloadPrefs().catch(() => {}),
        modulesChanged: () => void session.sync(),
        tleOld: () => {},
      }),
    [session],
  );

  // the browser's close button (or a reload): Close module (spec §8.1), as long as the page has its module as a window
  useEffect(() => {
    const hide = () => session.pageHide();
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, [session]);

  useEffect(() => {
    if (state.phase !== "open") document.title = detachedTitle(module, null, restored);
  }, [module, restored, state.phase]);

  if (state.phase === "opening" || state.phase === "gone") {
    // (ของเรา) while the module opens, or when it could not; and when the window did not close itself after Attach, Close or Delete
    const text =
      state.phase === "gone"
        ? goneText(module, state.gone ?? "closed")
        : state.error === null
          ? `กำลังเปิด module ${module}…`
          : `เปิด module ${module} ไม่ได้: ${state.error}`;
    return (
      <div className="app detached">
        <div className="empty" role="status">
          {text}
        </div>
      </div>
    );
  }
  // a new epoch (the module was opened again) makes the views, its socket and its configuration again
  return <DetachedModule key={state.epoch} module={module} restored={restored} session={session} modules={state.modules} />;
}

const NOTHING = () => {};
const NO_OPEN: readonly string[] = [];

interface ModuleProps extends Props {
  session: DetachedSession;
  /** every module, for Clone */
  modules: readonly string[];
}

function DetachedModule({ module, restored, session, modules }: ModuleProps) {
  const [local, setLocal] = useState<Notice[]>([]); // errors of this page's own requests
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [dialogs, setDialogs] = useState<readonly Dialog[]>([]);
  const [passWindows, setPassWindows] = useState<readonly PassWindow[]>([]);
  const [satInfos, setSatInfos] = useState<readonly SatInfoOpen[]>([]);
  const [skyGlance, setSkyGlance] = useState<SkyOpen>(new Map());
  const [timeController, setTimeController] = useState(false);
  const [moduleMenu, setModuleMenu] = useState<{ x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const moduleButton = useRef<HTMLButtonElement>(null);
  const nextLocalId = useRef(0);
  const fullscreen = useFullscreen();
  const only = useMemo(() => [module], [module]);

  const addLocalError = useCallback((text: string) => {
    setLocal((l) => [...l, { id: `local:${nextLocalId.current++}`, level: "error", text }]);
  }, []);

  const { tick, connected, closeCode } = useModuleSocket(module);
  const satNames = useSeenNames(module, tick);
  const { config, error: configError, reload: reloadConfig, save: saveConfig } = useModuleConfig(module);
  const { selected, select, selectEverywhere, autotracking, setAutotracking } = useSelection(module, only, tick, config, saveConfig, addLocalError);
  const ctl = useControllers(true, addLocalError, module);

  // "GPREDICT: <module> (<station>)", or "Gpredict: …" for a window of the restore bar (ref §1, decision 10)
  const qth = tick?.qth.name ?? null;
  useEffect(() => {
    document.title = detachedTitle(module, qth, restored);
  }, [module, qth, restored]);

  // the socket of the module was closed for good: the module was closed (the close of the page before an F5 may come after this page's
  // open: the session opens it again) or deleted
  useEffect(() => {
    if (closeCode !== null) void session.sync();
  }, [closeCode, session]);

  // the position and size of the window (spec §8.1): looked at every DETACH_POLL_MS, saved once they stay the same, never while full
  // screen (ref-D §9: full screen is not remembered); the first comparison is with what the module has stored
  const latestConfig = useRef(config);
  latestConfig.current = config;
  const haveConfig = config !== null;
  useEffect(() => {
    if (!haveConfig) return;
    const w = latestConfig.current?.window;
    let watch: GeometryWatch = {
      ...NO_GEOMETRY,
      saved: w !== undefined && w.x !== null && w.y !== null && w.width !== null && w.height !== null ? { x: w.x, y: w.y, width: w.width, height: w.height } : null,
    };
    let saving = false;
    const id = setInterval(() => {
      if (saving || document.fullscreenElement !== null) return;
      const seen = { x: window.screenX, y: window.screenY, width: window.innerWidth, height: window.innerHeight };
      const step = watchGeometry(watch, seen, Date.now(), window.screen);
      watch = step.watch;
      const g = step.save;
      if (g === null) return;
      saving = true;
      putWindow(module, g).then(
        () => (watch = { ...watch, saved: g }),
        () => {}, // not saved: asked again at the next look (the server is not there; its notices say so)
      ).finally(() => (saving = false));
    }, DETACH_POLL_MS);
    return () => clearInterval(id);
  }, [module, haveConfig]);

  const show = useCallback((d: Dialog) => setDialogs((l) => showDialog(l, d)), []);
  const hide = useCallback((d: Dialog) => setDialogs((l) => closeDialog(l, d)), []);
  const openPassWindow = useCallback((w: PassWindow) => setPassWindows((l) => openWindow(l, w)), []);
  const closePassWindow = useCallback((id: string) => setPassWindows((l) => closeWindow(l, id)), []);
  const showSatInfo = useCallback((norad: number) => setSatInfos((l) => openSatInfo(l, norad)), []);
  const closeSatInfoWindow = useCallback((id: string) => setSatInfos((l) => closeSatInfo(l, id)), []);
  const closeSkyGlance = useCallback(() => setSkyGlance((s) => closeSky(s, module)), [module]);
  const closeTimeController = useCallback(() => setTimeController(false), []);
  /** Delete of the Module menu deleted the module: the window goes */
  const deleted = useCallback(() => session.deleted(), [session]);

  const moduleAction = (action: ModuleAction) => {
    switch (action.type) {
      case "attach":
        return void session.attach().catch((e: unknown) => addLocalError(errorText(e)));
      case "detach":
        return; // not in the menu of a window
      case "fullscreen":
        return enterFullscreen(root.current, addLocalError);
      case "exitFullscreen":
        return leaveFullscreen(); // a window again (spec §8.3)
      case "autotrack":
        return setAutotracking(action.on);
      case "select":
        return selectEverywhere(action.norad);
      case "skyGlance":
        return setSkyGlance((s) => openSky(s, module)); // opens the window, or brings the open one to the front (ref-P §7.1)
      case "timeController":
        return setTimeController(true);
      case "radio":
      case "rotator":
        return void ctl.open(module, action.type);
      case "configure":
        // not while a controller window of the module is open: Gpredict's box without a title says so (ref-R §1, spec §4.6)
        return hasModule(ctl.controllers, module) ? ctl.setBox(CONFIGURE_BLOCKED_BOX) : show({ kind: "editModule", module });
      case "clone":
        return show({ kind: "clone", module });
      case "delete":
        return show({ kind: "delete", module });
      case "close":
        // Gpredict: closing a module window closes the module (its controllers go with it on the server)
        return void session.closeModule().catch((e: unknown) => addLocalError(errorText(e)));
    }
  };
  const closeModuleMenu = useCallback((restoreFocus: boolean) => {
    setModuleMenu(null);
    if (restoreFocus) moduleButton.current?.focus();
  }, []);

  const notices = useMemo(
    () => [
      ...local,
      ...(configError === null ? [] : [{ id: `config:${module}`, level: "error" as const, text: configError }]),
      ...tickNotices(module, tick, satNames),
    ],
    [local, configError, module, tick, satNames],
  );
  useEffect(() => setDismissed((d) => pruneDismissed(d, notices)), [notices]);
  const dismiss = useCallback((id: string) => {
    setLocal((l) => l.filter((n) => n.id !== id));
    setDismissed((d) => new Set(d).add(id));
  }, []);
  const retry = async () => {
    try {
      await retryModule(module);
    } catch (e) {
      addLocalError(errorText(e));
    }
  };

  return (
    <div className="app detached" ref={root}>
      <NoticeStrip notices={visibleNotices(notices, dismissed)} onDismiss={dismiss} onRetry={() => void retry()} />
      <div className="module">
        <ModuleHeader
          key={module}
          time={tick?.t ?? null}
          menuButton={moduleButton}
          menuOpen={moduleMenu !== null}
          onModuleMenu={(at) => setModuleMenu((m) => (m === null ? at : null))}
        />
        <div className="module-body">
          {config !== null && (
            <ModuleView
              module={module}
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
          <Overlay state={overlayFor(tick, connected, closeCode)} onRetry={retry} />
        </div>
      </div>
      {moduleMenu !== null && (
        <ModuleMenu
          x={moduleMenu.x}
          y={moduleMenu.y}
          anchor={moduleButton}
          place="window"
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
        open={NO_OPEN}
        modules={modules}
        current={module}
        config={config}
        saveConfig={saveConfig}
        reloadConfig={reloadConfig}
        hide={hide}
        onCreated={NOTHING}
        onModuleSaved={NOTHING}
        onOpened={NOTHING}
        onCloned={NOTHING} // the new module is opened as a tab of the main page (modules_changed tells it)
        onDeleted={deleted}
        onTleUpdated={reloadConfig}
      />
      <PassWindows windows={passWindows} onOpen={openPassWindow} onClose={closePassWindow} />
      <SatInfoWindows windows={satInfos} onClose={closeSatInfoWindow} />
      <ControllerWindows refs={ctl.controllers} onClosed={ctl.close} onGone={ctl.gone} />
      {config !== null && skyGlance.has(module) && (
        <SkyGlanceWindow
          key={`sky:${module}`} // not the Time Controller's key: siblings with one key are mixed up by React (appKeys.test.ts)
          module={module}
          satellites={config.satellites}
          tick={tick}
          raiseToken={skyGlance.get(module)!}
          onOpenPassWindow={openPassWindow}
          onClose={closeSkyGlance}
        />
      )}
      {timeController && <TimeController key={module} module={module} tick={tick} onClose={closeTimeController} onResetFailed={addLocalError} />}
      {ctl.box !== null && <MessageBox title={ctl.box.title} message={ctl.box.message} onOk={ctl.closeBox} />}
    </div>
  );
}
