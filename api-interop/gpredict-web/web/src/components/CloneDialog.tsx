import { useState } from "react";
import type { FormEvent } from "react";
import { cloneModule, deleteModule, errorText } from "../api";
import { cloneNameError, MODULE_NAME_MAX, NAME_TIP, sanitizeModuleName } from "../moduleName";
import { FloatingWindow } from "./FloatingWindow";

const OPEN_TIP = "If checked, the new module will be opened after it has been created";

interface CloneProps {
  /** the module to copy */
  module: string;
  /** the names of all the modules, for the check that the new name is free */
  existing: readonly string[];
  onClose: () => void;
  /** the copy `name` was made; `opened`: it was opened too, and `open` are the open modules then (in tab order) */
  onCloned: (name: string, opened: boolean, open: string[]) => void;
}

/**
 * Module menu → Clone... (ref §2): the dialog "Clone Module" with the label "Name of new module:", an entry of at most 25
 * characters filled with the current name (a character that is not allowed is deleted as it is typed, like Gpredict), the
 * check box "Open module when created" (on) and the buttons Cancel and OK. OK is off while the name is empty or taken.
 * A refusal of the server is shown in Thai in the dialog.
 */
export function CloneDialog({ module, existing, onClose, onCloned }: CloneProps) {
  const [name, setName] = useState(module);
  const [open, setOpen] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = cloneNameError(name, existing);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name === "" || problem !== null || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await cloneModule(module, name, open);
      onCloned(name, open, r.open);
      onClose();
    } catch (err) {
      setFailure(errorText(err));
      setBusy(false);
    }
  };

  return (
    <FloatingWindow title="Clone Module" onClose={onClose} width={340}>
      <form className="dialog" onSubmit={(e) => void submit(e)}>
        <label htmlFor="clone-name">Name of new module:</label>
        <input
          id="clone-name"
          className="dialog-entry"
          type="text"
          value={name}
          maxLength={MODULE_NAME_MAX}
          title={NAME_TIP}
          autoComplete="off"
          spellCheck={false}
          data-autofocus
          onChange={(e) => setName(sanitizeModuleName(e.target.value))}
        />
        {(problem ?? failure) !== null && (
          <p className="dialog-error" role="alert">
            {problem ?? failure}
          </p>
        )}
        <label className="dialog-check" title={OPEN_TIP}>
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          Open module when created
        </label>
        <div className="dialog-buttons">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={name === "" || problem !== null || busy}>
            OK
          </button>
        </div>
      </form>
    </FloatingWindow>
  );
}

interface DeleteProps {
  module: string;
  onClose: () => void;
  /** the module was deleted on the server (it was closed first) */
  onDeleted: (name: string) => void;
}

/**
 * Module menu → Delete (ref §2): asks "This operation will permanently delete <b>NAME</b> from the disk.\nDo you want to
 * proceed?" with Yes and No, then deletes the module (the server closes it first). The safe answer, No, has the focus.
 * A refusal of the server is shown in Thai in the dialog.
 */
export function DeleteDialog({ module, onClose, onDeleted }: DeleteProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const yes = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await deleteModule(module);
      onDeleted(module);
      onClose();
    } catch (err) {
      setFailure(errorText(err));
      setBusy(false);
    }
  };

  return (
    <FloatingWindow title="Delete" onClose={onClose}>
      <div className="dialog">
        <p className="dialog-text">
          This operation will permanently delete <b>{module}</b> from the disk.
          {"\n"}Do you want to proceed?
        </p>
        {failure !== null && (
          <p className="dialog-error" role="alert">
            {failure}
          </p>
        )}
        <div className="dialog-buttons">
          <button type="button" className="button" data-autofocus onClick={onClose}>
            No
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => void yes()}>
            Yes
          </button>
        </div>
      </div>
    </FloatingWindow>
  );
}
