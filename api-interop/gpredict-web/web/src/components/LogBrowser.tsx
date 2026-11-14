import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { errorText, getCurrentLog } from "../api";
import { currentLogPath, LEVEL_NAMES, logBrowserTitle, logFileTooLarge, logFileTooLargeText, logSummary, parseLog } from "../logParse";
import type { LogRow } from "../logParse";
import { useMeta } from "../useMeta";
import { FloatingWindow } from "./FloatingWindow";

/** Gpredict's window is 600 x 300 (`sat-log-browser.c:493`). */
const WIDTH = 600;

/** Where the rows come from: the log of this run of the server, or a file the user chose (its name is all a browser tells). */
type Source = { kind: "current" } | { kind: "file"; name: string };

/**
 * The Log Browser window (ref-D §7.3, `sat-log-browser.c`): not modal, one at a time, 600 x 300, a list with the columns Time, Level and
 * Message (plain text: no sorting, no filter, no search, no refresh) and, at its right, the frame " Summary " with the counts of the rows
 * (Errors, Warnings, Info, Debug and, under a line, Total, in bold). The buttons are Open, Clear and Close, in that order.
 *
 * When it opens it reads the log of this run once (GET /api/logs/current): what is logged later is not shown, and the title is "Log
 * Browser: <the file>" if there was a log. Open asks the browser for a file (its chooser cannot be told to start in the folder of the
 * logs, as Gpredict's "Select Log File" is, and gives only the name of the file), clears the list, reads the file and takes its name for
 * the title; Clear empties the list and the counts. A file of more than 10 MB is not read (a line in Thai says so). Every text of the log is
 * shown as a text node: the server writes any text it is given.
 */
export function LogBrowser({ onClose }: { onClose: () => void }) {
  const meta = useMeta();
  const [rows, setRows] = useState<readonly LogRow[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const reads = useRef(0); // reads started so far: only the last one counts, and none after the window has closed

  useEffect(() => {
    const read = ++reads.current;
    getCurrentLog().then(
      (text) => {
        if (read !== reads.current) return;
        setRows(parseLog(text));
        setSource(text === "" ? null : { kind: "current" }); // a log has its first line at once, so no text is no file (Gpredict: file not read)
      },
      (e: unknown) => {
        if (read === reads.current) setError(errorText(e));
      },
    );
    return () => {
      reads.current++;
    };
  }, []);

  const summary = useMemo(() => logSummary(rows), [rows]);
  const shown = source === null ? null : source.kind === "file" ? source.name : meta === null ? null : currentLogPath(meta.log_dir);

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be chosen again
    if (file === undefined) return; // cancelled: nothing changes
    const read = ++reads.current;
    setRows([]); // Gpredict clears the list as soon as a file is chosen, then reads it
    setSource(null);
    setError(null);
    if (logFileTooLarge(file.size)) {
      setError(logFileTooLargeText(file.name)); // not read: the list stays empty and the title is "Log Browser", as after a read that failed
      return;
    }
    try {
      const text = await file.text();
      if (read !== reads.current) return;
      setRows(parseLog(text));
      setSource({ kind: "file", name: file.name });
    } catch (err) {
      if (read === reads.current) setError(`อ่านไฟล์ ${file.name} ไม่ได้: ${errorText(err)}`); // (ของเรา)
    }
  };

  const clear = () => {
    setRows([]);
    setError(null);
  };

  return (
    <FloatingWindow title={logBrowserTitle(shown)} onClose={onClose} width={WIDTH}>
      <div className="dialog log-browser">
        {error !== null && <p className="dialog-error">{error}</p>}
        <div className="log-main">
          <div className="log-list" tabIndex={0} role="region" aria-label="ข้อความใน log" data-autofocus>
            <table className="sat-table log-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Level</th>
                  <th className="align-left">Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.time}</td>
                    <td>{LEVEL_NAMES[row.level] ?? ""}</td>
                    <td>{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <fieldset className="log-summary">
            <legend>{" Summary "}</legend>
            <div className="log-summary-grid">
              <span>Errors</span>
              <span className="log-count">{summary.errors}</span>
              <span>Warnings</span>
              <span className="log-count">{summary.warnings}</span>
              <span>Info</span>
              <span className="log-count">{summary.info}</span>
              <span>Debug</span>
              <span className="log-count">{summary.debug}</span>
              <hr className="log-rule" />
              <b>Total</b>
              <b className="log-count">{summary.total}</b>
            </div>
          </fieldset>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="button" onClick={() => picker.current?.click()}>
            Open
          </button>
          <button type="button" className="button" onClick={clear}>
            Clear
          </button>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
          <input ref={picker} type="file" className="log-file-input" tabIndex={-1} aria-hidden="true" onChange={(e) => void choose(e)} />
        </div>
      </div>
    </FloatingWindow>
  );
}
