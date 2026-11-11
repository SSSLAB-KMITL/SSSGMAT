import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, getModules, putTabs, retryModule } from "./api";
import { ModuleHeader } from "./components/ModuleHeader";
import { ModuleView } from "./components/ModuleView";
import { NoticeStrip } from "./components/NoticeStrip";
import { Overlay } from "./components/Overlay";
import { Tabs } from "./components/Tabs";
import { pruneDismissed, startupNotices, tickNotices, visibleNotices } from "./notices";
import type { Notice } from "./notices";
import { overlayFor } from "./overlay";
import { activeTab, windowTitle } from "./tabs";
import type { ApiMessage } from "./types";
import { useModuleConfig } from "./useModuleConfig";
import { useModuleSocket } from "./useModuleSocket";

/** Menu titles as in Gpredict (ref §1). Task 18 mounts the menus (File, Edit, Help) and their dialogs here. */
const MENU_TITLES = ["File", "Edit", "Help"] as const;

const RELOAD_AFTER_ERROR_MS = 5000;

export function App() {
  const [open, setOpen] = useState<string[]>([]); // open modules in tab order
  const [startup, setStartup] = useState<ApiMessage[]>([]); // messages of GET /api/modules
  const [chosen, setChosen] = useState<string | null>(null);
  const [local, setLocal] = useState<Notice[]>([]); // errors of this page's own requests
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false); // GET /api/modules has answered at least once
  const nextLocalId = useRef(0);

  const addLocalError = useCallback((text: string) => {
    setLocal((l) => [...l, { id: `local:${nextLocalId.current++}`, level: "error", text }]);
  }, []);

  /** (Re)read the open modules and the startup messages. Task 18 calls it after New, Open, Close, Delete and Clone. */
  const reloadModules = useCallback(async () => {
    try {
      const r = await getModules();
      setOpen(r.open);
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
  const { config, error: configError, save: saveConfig } = useModuleConfig(current);

  // the module was closed or deleted (1000) or is not open (1008): from another browser tab, say. Drop its tab.
  useEffect(() => {
    if (closeCode !== null) void reloadModules();
  }, [closeCode, reloadModules]);

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
      <div className="menubar" role="menubar">
        {MENU_TITLES.map((title) => (
          <button key={title} type="button" role="menuitem" className="button flat menubar-item">
            {title}
          </button>
        ))}
      </div>
      <Tabs tabs={open} active={current} onSelect={setChosen} onReorder={reorder} />
      <NoticeStrip notices={visibleNotices(notices, dismissed)} onDismiss={dismiss} onRetry={(m) => void retry(m)} />
      {current === null ? (
        // (ของเรา) Gpredict shows an empty notebook here; this is our Thai hint
        loaded && <div className="empty">ยังไม่มี module ที่เปิดอยู่ เปิดได้จาก File → Open module หรือ File → New module</div>
      ) : (
        <div className="module">
          <ModuleHeader key={current} time={tick?.t ?? null} />
          <div className="module-body">
            {config !== null && <ModuleView module={current} config={config} tick={tick} onSaveConfig={saveConfig} />}
            <Overlay state={overlayFor(tick, connected, closeCode)} onRetry={() => retry(current)} />
          </div>
        </div>
      )}
    </div>
  );
}
