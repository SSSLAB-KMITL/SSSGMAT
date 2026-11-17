// What the two pages share: the main page (App.tsx) and the page of a module window (DetachedApp.tsx, spec §8.1). Both show a module
// with its header, its views and its Module menu, so they hold its selection, Autotrack, its Radio Control and Antenna Control windows
// and its notices the same way, and both can be full screen (spec §8.3).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { errorText } from "./api";
import { autotrackTarget } from "./autotrack";
import { AttachInbox, handoverStart, listenAttach, takeOver } from "./handover";
import type { Handover } from "./handover";
import { rememberNames } from "./notices";
import type { SatNameMap } from "./notices";
import { dropModule, dropRef, mergeOpen, openRefusalBox, refKey, sameRef, syncWindows, targetPosts } from "./radio/controllerWindows";
import type { ControllerBox, ControllerWindow } from "./radio/controllerWindows";
import { closeController, getControllers, openController, postTarget } from "./radio/radioApi";
import type { ControllerKind, ControllerRef } from "./radio/types";
import { pruneToOpen, singleSatChange, withMember, withSelection } from "./selection";
import type { Selections } from "./selection";
import type { ModuleConfig, ModuleSaveOptions, Tick } from "./types";

const NO_NAMES: SatNameMap = new Map();

/**
 * The names of the satellites a module's ticks have shown, so that a notice can name a satellite that has dropped out of the
 * ticks (GMAT returned nothing for it, say). Forgotten when another module is shown.
 */
export function useSeenNames(module: string | null, tick: Tick | null): SatNameMap {
  const [seen, setSeen] = useState<{ module: string | null; names: SatNameMap }>({ module: null, names: NO_NAMES });
  const names = rememberNames(seen.module === module ? seen.names : NO_NAMES, tick);
  if (seen.module !== module || seen.names !== names) setSeen({ module, names }); // derived from the previous render, not an effect
  return names;
}

type SaveConfig = (change: (config: ModuleConfig) => ModuleConfig, opts?: ModuleSaveOptions) => Promise<void>;

/**
 * The selected satellite and Autotrack of the modules of a page (not saved), for the module `current` that is shown:
 * - kept for the modules of `held` only: the tabs of the main page (a module that is closed, deleted or detached is forgotten: its window
 *   has it now), the module of a module window;
 * - a module window starts with what Detach handed over (`initial`, handover.ts), and the main page takes over what the window had at
 *   Attach (`takeOver`, through useAttachHandovers); a satellite handed over is the target the controllers follow already: nothing is sent;
 * - the target of a module follows its selection (Select satellite, a click in a view, Autotrack): its controllers follow it (spec §3.3);
 * - Edit module taking the selected satellite out of the module unselects it;
 * - Autotrack (ref §2): every tick, the target is the satellite above the horizon or else the one with the earliest AOS.
 */
export function useSelection(
  current: string | null,
  held: readonly string[],
  tick: Tick | null,
  config: ModuleConfig | null,
  saveConfig: SaveConfig,
  onError: (text: string) => void,
  initial: Handover | null = null,
) {
  const [start] = useState(() => (initial === null || current === null ? null : handoverStart(current, initial)));
  const [selections, setSelections] = useState<Selections>(start?.selections ?? {});
  const [autotrack, setAutotrack] = useState<ReadonlySet<string>>(start?.autotrack ?? new Set());
  const targetsSent = useRef<Selections>(selections); // the selections whose targets have been sent (at first: what was handed over)

  useEffect(() => {
    setSelections((s) => pruneToOpen(s, held));
    setAutotrack((a) => {
      const kept = [...a].filter((m) => held.includes(m));
      return kept.length === a.size ? a : new Set(kept);
    });
  }, [held]);

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
      saveConfig(singleSatChange(norad)).catch((e: unknown) => onError(errorText(e)));
    },
    [select, config, saveConfig, onError],
  );

  useEffect(() => {
    const before = targetsSent.current;
    targetsSent.current = selections;
    for (const { module, norad } of targetPosts(before, selections)) {
      postTarget(module, norad).catch((e: unknown) => onError(errorText(e)));
    }
  }, [selections, onError]);

  useEffect(() => {
    if (config !== null && selected !== null && !config.satellites.includes(selected)) select(null);
  }, [config, selected, select]);

  const autotracking = current !== null && autotrack.has(current);
  useEffect(() => {
    if (!autotracking) return;
    const target = autotrackTarget(tick, selected);
    if (target !== selected) selectEverywhere(target);
  }, [autotracking, tick, selected, selectEverywhere]);

  /** The Module menu's Autotrack for the module that is shown. */
  const setAutotracking = useCallback(
    (on: boolean) => {
      if (current !== null) setAutotrack((a) => withMember(a, current, on));
    },
    [current],
  );

  /**
   * Attach module: `module` gets the selection and Autotrack its window had (handover.ts). Its satellite counts as sent, so this sends no
   * target. Call it from an effect that runs after this hook's (useAttachHandovers): the targets effect of the render before has run by
   * then, and the next one compares with the satellite taken over.
   */
  const takeOverModule = useCallback((module: string, h: Handover) => {
    const t = takeOver(module, h);
    targetsSent.current = t.selections(targetsSent.current);
    setSelections(t.selections);
    setAutotrack(t.autotrack);
  }, []);

  /** Detach module: the window takes the module's Autotrack with it (handover.ts), so this page stops it at once. */
  const release = useCallback((module: string) => setAutotrack((a) => withMember(a, module, false)), []);

  return { selected, select, selectEverywhere, autotracking, setAutotracking, takeOver: takeOverModule, release };
}

/**
 * The main page hears the Attach of the module windows (handover.ts) and gives each module back the selection and Autotrack its window
 * had, once the module is one of its `tabs` (the message and the new list of modules can come in either order). `takeOver` is
 * useSelection's; call this hook after it, so that its effect runs after useSelection's.
 */
export function useAttachHandovers(tabs: readonly string[], takeOver: (module: string, h: Handover) => void): void {
  const [inbox] = useState(() => new AttachInbox());
  const [heard, setHeard] = useState(0); // the messages heard so far: each one looks at the tabs again

  useEffect(
    () =>
      listenAttach((module, h) => {
        inbox.receive(module, h);
        setHeard((n) => n + 1);
      }),
    [inbox],
  );

  useEffect(() => {
    for (const [module, h] of inbox.arrived(tabs)) takeOver(module, h);
  }, [inbox, tabs, heard, takeOver]);
}

/**
 * The Radio Control and Antenna Control windows of a page (ref-R §1, decision 2 of the radio plan): every module's on the main page,
 * only those of `only` on the page of a module window (the main page keeps showing them too: each window has its own socket).
 *
 * The page shows the windows of the controllers the server has open (GET /api/controllers) once `ready`, after every open and close, and
 * whenever the page calls `sync` (the main page: on every connect and modules_changed of /ws/app, appEvents.ts `withControllerSync`).
 * Only the answer of the last request counts: an older one can miss a controller this page has just opened.
 */
export function useControllers(ready: boolean, onError: (text: string) => void, only: string | null = null) {
  const [controllers, setControllers] = useState<readonly ControllerWindow[]>([]);
  const [box, setBox] = useState<ControllerBox | null>(null); // Gpredict's error box of the controllers (no device, Configure blocked)
  const asked = useRef(0); // GET /api/controllers sent so far
  const closing = useRef(new Set<string>()); // (refKey) the controllers whose window was closed and that the server is still closing

  const sync = useCallback(async () => {
    const n = ++asked.current;
    try {
      const open = await getControllers();
      const mine = only === null ? open : open.filter((r) => r.module === only);
      if (n === asked.current) setControllers((l) => syncWindows(l, mine, closing.current));
    } catch (e) {
      onError(errorText(e));
    }
  }, [onError, only]);

  // the controllers keep running in the server when the browser tab is closed: their windows come back when the page is loaded
  useEffect(() => {
    if (ready) void sync();
  }, [ready, sync]);

  /**
   * Module menu → Radio Control / Antenna Control: the window of the controller of `module`, opened on the server first; one that is
   * open already comes to the front instead. Without a device of the kind, Gpredict's "ERROR" box.
   */
  const open = useCallback(
    async (module: string, kind: ControllerKind) => {
      const ref = { module, kind };
      if (controllers.some((w) => sameRef(w, ref))) {
        setControllers((l) => mergeOpen(l, ref));
        return;
      }
      try {
        await openController(module, kind);
      } catch (e) {
        const refusal = openRefusalBox(kind, e);
        if (refusal === null) onError(errorText(e));
        else setBox(refusal);
        return;
      }
      closing.current.delete(refKey(ref)); // opened again while its close was on the way: the server has done the close first
      setControllers((l) => mergeOpen(l, ref));
      void sync();
    },
    [controllers, onError, sync],
  );

  /** The user closed a controller window: it goes at once, the server disengages and closes the controller, then the list is read again. */
  const close = useCallback(
    async (ref: ControllerRef) => {
      const key = refKey(ref);
      closing.current.add(key);
      setControllers((l) => dropRef(l, ref));
      try {
        await closeController(ref.module, ref.kind);
      } catch (e) {
        onError(errorText(e));
      } finally {
        closing.current.delete(key);
      }
      void sync();
    },
    [onError, sync],
  );

  /** A window went by itself: its controller was closed from another browser tab, or its module was closed or deleted. */
  const gone = useCallback(
    (ref: ControllerRef) => {
      setControllers((l) => dropRef(l, ref));
      void sync();
    },
    [sync],
  );

  /** The module was closed or deleted from this page: the server has closed its controllers with it. */
  const dropModuleWindows = useCallback((module: string) => setControllers((l) => dropModule(l, module)), []);
  const closeBox = useCallback(() => setBox(null), []);

  return { controllers, box, setBox, open, close, gone, dropModuleWindows, closeBox, sync };
}

// ---------------------------------------------------------------- full screen (spec §8.3)

const subscribeFullscreen = (listener: () => void): (() => void) => {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
};

/** The page is full screen (the Fullscreen API: the browser's own F11 full screen is not). */
export const useFullscreen = (): boolean => useSyncExternalStore(subscribeFullscreen, () => document.fullscreenElement !== null);

/**
 * Full screen (spec §8.3): the Fullscreen API on `area`, the page's root, whose menu bar, tabs and restore bar are hidden while it is full
 * screen (styles.css), so that the module fills the screen and the Module menu and the windows it opens are still shown over it. A
 * refusal of the browser is told in Thai (ของเรา).
 */
export function enterFullscreen(area: HTMLElement | null, onError: (text: string) => void): void {
  area?.requestFullscreen().catch((e: unknown) => onError(`เปิดเต็มจอไม่ได้: ${errorText(e)}`));
}

/** Exit full screen; nothing when the page is not full screen. */
export function leaveFullscreen(): void {
  if (document.fullscreenElement !== null) document.exitFullscreen().catch(() => {}); // a page that is not full screen any more: nothing to do
}
