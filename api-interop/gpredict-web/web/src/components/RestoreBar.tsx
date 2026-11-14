import { memo, useEffect, useState } from "react";
import { getModule } from "../api";
import type { ModuleWindow } from "../types";

interface Props {
  /** the modules the server has as windows and that this page has no window of (detach.ts `restoreList`) */
  modules: readonly string[];
  /** the button เปิด: open the window of `module`; `win` is its stored window (size and position), null until it has been read */
  onOpen: (module: string, win: ModuleWindow | null) => void;
}

/**
 * (ของเรา, spec §8.4, plan decision 10) Gpredict opens the windows of the modules that were windows by itself when it starts; a browser
 * opens a window only on a click, so the main page shows a bar for each such module with a button that opens it. The button opens the
 * window in the click, so the stored size and position of the module are read before (GET /api/modules/{name}).
 */
export const RestoreBar = memo(
  function RestoreBar({ modules, onOpen }: Props) {
    if (modules.length === 0) return null;
    return (
      <div className="restore-bar">
        {modules.map((m) => (
          <RestoreRow key={m} module={m} onOpen={onOpen} />
        ))}
      </div>
    );
  },
  // the list is made again at every render of the page (it reads whether this page's windows are still open): the same names, nothing new
  (a, b) => a.onOpen === b.onOpen && a.modules.join("\n") === b.modules.join("\n"),
);

function RestoreRow({ module, onOpen }: { module: string; onOpen: Props["onOpen"] }) {
  const [win, setWin] = useState<ModuleWindow | null>(null);
  useEffect(() => {
    let alive = true;
    getModule(module).then(
      (m) => alive && setWin(m.window ?? null),
      () => {}, // without it the window opens with the default size: the click still works
    );
    return () => {
      alive = false;
    };
  }, [module]);
  return (
    <div className="notice notice-info restore-row" role="status">
      <span className="notice-text">module {module} ตั้งให้เปิดเป็นหน้าต่างแยก</span>
      <button type="button" className="button" onClick={() => onOpen(module, win)}>
        เปิด
      </button>
    </div>
  );
}
