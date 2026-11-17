import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { errorText, updateTleLocal } from "../api";
import { chooseDirectory, readTleFiles } from "../tleFiles";
import type { DirectoryChoice } from "../tleFiles";
import { Modal } from "./Modal";
import { TleUpdateDialog } from "./TleUpdateDialog";

interface Props {
  onClose: () => void;
  /** the update was done: the open modules have been reloaded by the server */
  onUpdated: () => void;
}

/** What the folder button shows before a folder is chosen: GTK's file chooser button says "(None)" with no selection. */
const NO_FOLDER = "(None)";

/** `<input webkitdirectory>` is not in React's typings; the attribute makes the browser's picker choose a folder and give back all the files under it. */
const FOLDER_PICKER = { webkitdirectory: "" } as Record<string, string>;

/**
 * Edit → Update TLE data from local files (ref-D §6, menubar.c:656-798): the modal "Update TLE from files" with the label "Select TLE
 * directory:", the folder button and the buttons Cancel and OK. OK reads the `.tle` and `.txt` files directly in the chosen folder as text
 * (the browser cannot give the server a path, plan decision 2), sends them (POST /api/tle/local) and shows the box "TLE Update" with the
 * heading "Updating TLE files from files". Cancel runs nothing.
 *
 * (ของเรา) A browser cannot preselect a folder (Gpredict starts at the last one, or the home directory, and its OK is always on), so OK
 * is off until a folder is chosen, and the folder button says "(None)" until then.
 */
export function TleFilesDialog({ onClose, onUpdated }: Props) {
  const [choice, setChoice] = useState<DirectoryChoice<File> | null>(null);
  const [running, setRunning] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const chosen = (e: ChangeEvent<HTMLInputElement>) => {
    // a cancelled picker gives no files: the folder chosen before stays
    if (e.target.files !== null && e.target.files.length > 0) setChoice(chooseDirectory(Array.from(e.target.files)));
    e.target.value = ""; // the same folder can be chosen again
  };

  if (running && choice !== null) {
    const files = choice.picked;
    const run = async () => {
      let body;
      try {
        body = await readTleFiles(files, (f) => f.text());
      } catch (e) {
        throw new Error(`อ่านไฟล์ในโฟลเดอร์ไม่ได้: ${errorText(e)}`); // (ของเรา)
      }
      return updateTleLocal(body);
    };
    return <TleUpdateDialog source="files" run={run} onClose={onClose} onUpdated={onUpdated} />;
  }

  return (
    <Modal title="Update TLE from files" onEscape={onClose}>
      <div className="dialog tle-files">
        <div className="tle-files-row">
          <span className="tle-files-label">Select TLE directory:</span>
          <button type="button" className="button tle-files-chooser" aria-label="Select directory" title={choice?.folder ?? undefined} data-autofocus onClick={() => picker.current?.click()}>
            {choice?.folder ?? NO_FOLDER}
          </button>
          <input ref={picker} type="file" className="tle-files-input" tabIndex={-1} aria-hidden="true" onChange={chosen} {...FOLDER_PICKER} />
        </div>
        <div className="dialog-buttons">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button" disabled={choice === null} onClick={() => setRunning(true)}>
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}
