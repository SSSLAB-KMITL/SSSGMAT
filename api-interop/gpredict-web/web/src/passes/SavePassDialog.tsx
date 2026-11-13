import { useId, useState } from "react";
import type { FormEvent } from "react";
import { Modal } from "../components/Modal";
import { savePrefs, usePrefs } from "../prefs/prefsStore";
import {
  cleanFileName,
  defaultFileName,
  downloadText,
  FILE_NAME_MAX,
  listContents,
  onePassText,
  oneContents,
  passListText,
  SAVE_CONTENTS_LABELS,
  SAVE_PASSES_LABELS,
  validFileName,
} from "./passText";
import type { OneContents } from "./passText";
import type { PassInfo, PassQth, PassSat } from "./types";

const CONTENTS_KEY = "PREDICT/SAVE_CONTENTS";
const SINGLE_COLUMNS_KEY = "PREDICT/SINGLE_PASS_COL";

type Props = {
  /** the visible columns: the Single Pass ones for "one", the Multiple Passes ones for "list" */
  columns: readonly string[];
  onClose: () => void;
} & (
  | { kind: "one"; answer: { sat: PassSat; qth: PassQth; pass: PassInfo } }
  | { kind: "list"; answer: { sat: PassSat; qth: PassQth; passes: PassInfo[] } }
);

/**
 * "Save Pass Details" (the Save button of Pass details) and "Save Passes" (Upcoming passes), ref-P §8.1, §8.2, spec §6.3: a modal
 * with the rows "Save in folder:", "Save using file name:" and "File contents:" and the buttons Cancel and Save.
 *
 * - The folder is the browser's download folder: a page cannot choose one, so the row tells that in Thai (ของเรา).
 * - The file name starts as `<satellite>-<orbit>` or `<satellite>-passes`; a character that is not a letter, digit, "-" or "_" is
 *   deleted as it is typed, at most 100. Save is off while the name is empty. ".txt" is added by the download.
 * - Save Pass Details starts on the choice kept in `PREDICT/SAVE_CONTENTS`, and keeps the choice made when Save is pressed (not on
 *   Cancel, as in Gpredict). Save Passes always starts on "Complete report" and keeps nothing.
 * - Gpredict shows an error box when it cannot write the file; the browser does not tell the page, so there is nothing to show.
 */
export function SavePassDialog(props: Props) {
  const { columns, onClose } = props;
  const id = useId();
  const prefs = usePrefs();
  const [name, setName] = useState(() =>
    props.kind === "one" ? defaultFileName("one", props.answer.sat.name, props.answer.pass.orbit) : defaultFileName("list", props.answer.sat.name),
  );
  const [picked, setPicked] = useState<OneContents | null>(null);

  const stored = prefs === null ? null : oneContents(prefs.values[CONTENTS_KEY]);
  const choice = props.kind === "one" ? (picked ?? stored ?? 0) : listContents(picked);
  const labels = props.kind === "one" ? SAVE_CONTENTS_LABELS : SAVE_PASSES_LABELS;
  // the blocks of the complete report are tables of the Single Pass columns, which the window knows only from Preferences
  const singleColumns = prefs === null ? undefined : prefs.values[SINGLE_COLUMNS_KEY];
  const blocks = Array.isArray(singleColumns) ? singleColumns : null;
  const canSave = validFileName(name) && (props.kind === "one" || blocks !== null);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    if (props.kind === "one") {
      downloadText(name, onePassText(props.answer, columns, choice));
      if (stored !== null && choice !== stored) {
        // The file is saved; the choice is a convenience for the next time, and nobody is left to tell if it cannot be kept.
        savePrefs({ [CONTENTS_KEY]: choice }, []).catch(() => undefined);
      }
    } else if (blocks !== null) {
      downloadText(name, passListText(props.answer, columns, listContents(choice), blocks));
    }
    onClose();
  };

  return (
    <Modal title={props.kind === "one" ? "Save Pass Details" : "Save Passes"} onEscape={onClose}>
      <form className="dialog" onSubmit={save}>
        <div className="save-grid">
          <span>Save in folder:</span>
          {/* (ของเรา) Gpredict has a folder chooser here */}
          <span className="save-folder">บันทึกลงโฟลเดอร์ดาวน์โหลดของ browser</span>
          <label htmlFor={`${id}-name`}>Save using file name:</label>
          <input
            id={`${id}-name`}
            className="dialog-entry"
            type="text"
            value={name}
            maxLength={FILE_NAME_MAX}
            autoComplete="off"
            spellCheck={false}
            data-autofocus
            onChange={(e) => setName(cleanFileName(e.target.value))}
          />
          <label htmlFor={`${id}-contents`}>File contents:</label>
          <select id={`${id}-contents`} className="dialog-entry" value={choice} onChange={(e) => setPicked(oneContents(Number(e.target.value)))}>
            {labels.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={!canSave}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
