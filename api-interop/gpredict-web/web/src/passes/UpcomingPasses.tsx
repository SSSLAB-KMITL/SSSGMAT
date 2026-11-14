import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { FloatingWindow } from "../components/FloatingWindow";
import { PopupMenu } from "../components/PopupMenu";
import { useNumberFormat } from "../numfmt";
import { usePrefs } from "../prefs/prefsStore";
import { MULTI_COLUMNS, passCell } from "./passCells";
import { columnTitles, moveRow, newId, upcomingMenu, upcomingTitle, visibleColumns } from "./passWindows";
import type { PassWindow } from "./passWindows";
import { SavePassDialog } from "./SavePassDialog";
import type { PassInfo, PassQth, PassSat } from "./types";

const MULTI_COLUMNS_KEY = "PREDICT/MULTI_PASS_COL";

interface Props {
  /** the id of this window: the Pass details windows opened from it have it as their parent */
  id: string;
  answer: { sat: PassSat; qth: PassQth; passes: PassInfo[] };
  /** opens a window (a Pass details window of one of the rows) */
  onOpen: (w: PassWindow) => void;
  onClose: () => void;
  /** where the window opens, in client px */
  position: { x: number; y: number };
}

/**
 * The Upcoming passes window (ref-P §3, spec §6.1): one row for each pass, in time order, with the columns that are on in Multiple
 * Passes. The columns cannot be sorted. A click selects a row, Up and Down move the selection; a double click or Enter opens Pass details
 * of the row (this window is its parent: it closes with it); a right click (which selects the row first) or Shift+F10 opens the row
 * popup (Show details; Polar plot and Az/El plot cannot be chosen). Buttons: Print does nothing, as in Gpredict (which only writes
 * "PRINT not implemented" in its log: sub-project 4 has that log), Save opens "Save Passes", Close closes. The list has the focus
 * when the window opens, so the keys work at once.
 */
export function UpcomingPasses({ id, answer, onOpen, onClose, position }: Props) {
  const { sat, qth, passes } = answer;
  const prefs = usePrefs();
  const nf = useNumberFormat();
  const titles = prefs === null ? null : columnTitles(prefs.values[MULTI_COLUMNS_KEY]);
  const columns = visibleColumns(MULTI_COLUMNS, titles ?? []);
  const [selected, setSelected] = useState<number | null>(null);
  // the row popup, where it is open, and the row it was opened for
  const [menu, setMenu] = useState<{ x: number; y: number; row: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  // the row that was selected by a key must be seen
  useEffect(() => {
    list.current?.querySelector('tr[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const showDetails = (row: number) => {
    const pass = passes[row];
    if (pass !== undefined) onOpen({ id: newId(), kind: "details", answer: { sat, qth, pass }, parent: id });
  };

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenu(null);
    if (restoreFocus) list.current?.focus();
  }, []);

  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => moveRow(s, e.key === "ArrowDown" ? 1 : -1, passes.length));
    } else if (e.key === "Enter") {
      if (selected === null) return; // nothing to open: Gpredict logs an error here
      e.preventDefault();
      showDetails(selected);
    } else if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      if (selected === null) return; // with no selection nothing happens (ref-P §3.3)
      e.preventDefault();
      const row = list.current?.querySelector('tr[aria-selected="true"]')?.getBoundingClientRect();
      if (row !== undefined) setMenu({ x: row.left + 16, y: row.bottom, row: selected });
    }
  };

  return (
    <>
      <FloatingWindow title={upcomingTitle(sat)} onClose={onClose} initialPosition={position}>
        <div className="dialog pass-window upcoming">
          <div ref={list} className="pass-list" tabIndex={0} data-autofocus onKeyDown={key}>
            <table className="sat-table" role="grid">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.title}>{c.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {passes.map((p, i) => (
                  <tr
                    key={i}
                    aria-selected={i === selected}
                    className={i === selected ? "selected" : undefined}
                    onClick={() => setSelected(i)}
                    onDoubleClick={() => showDetails(i)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSelected(i);
                      setMenu({ x: e.clientX, y: e.clientY, row: i });
                    }}
                  >
                    {columns.map((c) => (
                      <td key={c.title} className={`align-${c.align}`}>
                        {passCell(p, c.title, nf)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dialog-buttons">
            {/* does nothing, as in Gpredict (ref-P §3.1) */}
            <button type="button" className="button">
              Print
            </button>
            <button type="button" className="button" disabled={titles === null} onClick={() => setSaving(true)}>
              Save
            </button>
            <button type="button" className="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </FloatingWindow>
      {menu !== null && <PopupMenu x={menu.x} y={menu.y} items={upcomingMenu(() => showDetails(menu.row))} onClose={closeMenu} />}
      {saving && titles !== null && <SavePassDialog kind="list" answer={answer} columns={titles} onClose={() => setSaving(false)} />}
    </>
  );
}
