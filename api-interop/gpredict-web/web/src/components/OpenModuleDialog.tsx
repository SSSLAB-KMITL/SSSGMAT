import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { errorText, getModules, openModule } from "../api";
import { openableModules, openModuleEmptyText } from "../openModule";
import { FloatingWindow } from "./FloatingWindow";

interface Props {
  /** the modules that are open now */
  open: readonly string[];
  onClose: () => void;
  /** `name` was opened on the server; `open` are the open modules then (in tab order) */
  onOpened: (name: string, open: string[]) => void;
}

/**
 * File → Open module (ref §1): the dialog "Select a module" with one column "Module" and the buttons Cancel and OK. It lists
 * the modules that are not open (the server's list, read when the dialog opens). A double click on a module opens it, like
 * Gpredict. If there is nothing to choose it says so. A refusal of the server is shown in Thai in the dialog.
 */
export function OpenModuleDialog({ open, onClose, onOpened }: Props) {
  const [all, setAll] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getModules().then(
      (r) => alive && setAll(r.modules),
      (e: unknown) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, []);

  const names = all === null ? [] : openableModules(all, open);
  const empty = all === null ? null : openModuleEmptyText(all, open);

  const submit = async (name: string | null) => {
    if (name === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await openModule(name);
      onOpened(name, r.open);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const keys = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit(chosen);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const at = chosen === null ? -1 : names.indexOf(chosen);
      const next = names[e.key === "ArrowDown" ? Math.min(at + 1, names.length - 1) : Math.max(at - 1, 0)];
      if (next !== undefined) setChosen(next);
    }
  };

  return (
    <FloatingWindow title="Select a module" onClose={onClose} width={320}>
      <div className="dialog">
        {empty !== null ? (
          <p className="dialog-text">{empty}</p>
        ) : (
          <div className="dialog-list" role="listbox" aria-label="Module" tabIndex={0} data-autofocus onKeyDown={keys}>
            <div className="dialog-list-head">Module</div>
            {names.map((name) => (
              <div
                key={name}
                role="option"
                aria-selected={name === chosen}
                className={name === chosen ? "dialog-row selected" : "dialog-row"}
                onClick={() => setChosen(name)}
                onDoubleClick={() => void submit(name)}
              >
                {name}
              </div>
            ))}
          </div>
        )}
        {error !== null && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-buttons">
          {empty !== null ? (
            <button type="button" className="button" onClick={onClose}>
              OK
            </button>
          ) : (
            <>
              <button type="button" className="button" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="button" disabled={chosen === null || busy} onClick={() => void submit(chosen)}>
                OK
              </button>
            </>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
