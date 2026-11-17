import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { errorText, searchSatellites } from "../api";
import { addSat, availableSats, groupOptions, HINT, removeSat, SEARCH_LIMIT, TOO_MANY_HINT } from "../moduleForm";
import type { SelectedSat } from "../moduleForm";
import type { SatRecord } from "../types";

/** The server accepts a search text of at most this many characters (GET /api/satellites). */
const SEARCH_MAX = 64;
/** How long after the last key the search is sent. */
const DEBOUNCE_MS = 200;

interface ListProps {
  /** the title of the first column ("Available Satellites" / "Selected Satellites") */
  title: string;
  rows: readonly SelectedSat[];
  pick: number | null;
  onPick: (norad: number | null) => void;
  /** double click or Enter: move the satellite to the other box */
  onMove: (sat: SelectedSat) => void;
  /** text shown instead of rows when there are none */
  empty?: string | null;
  /** where the list sits in the selector's grid */
  className: string;
}

/** One of the two lists: the columns title and "Catnum" (the third, Updated / Epoch, is hidden in Gpredict too). */
function SatList({ title, rows, pick, onPick, onMove, empty, className }: ListProps) {
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      const row = rows.find((r) => r.norad === pick);
      if (row !== undefined) {
        e.preventDefault();
        onMove(row);
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const at = rows.findIndex((r) => r.norad === pick);
      const next = rows[e.key === "ArrowDown" ? Math.min(at + 1, rows.length - 1) : Math.max(at - 1, 0)];
      if (next !== undefined) onPick(next.norad);
    }
  };
  return (
    <div className={`dialog-list sat-list ${className}`} role="listbox" aria-label={title} tabIndex={0} onKeyDown={keys}>
      <div className="dialog-list-head sat-row">
        <span>{title}</span>
        <span className="num">Catnum</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.norad}
          role="option"
          aria-selected={r.norad === pick}
          className={r.norad === pick ? "dialog-row sat-row selected" : "dialog-row sat-row"}
          onClick={() => onPick(r.norad)}
          onDoubleClick={() => onMove(r)}
        >
          <span>{r.name}</span>
          <span className="num">{r.norad}</span>
        </div>
      ))}
      {rows.length === 0 && empty != null && <div className="sat-empty">{empty}</div>}
    </div>
  );
}

interface Props {
  /** the CelesTrak groups of the group combo */
  groups: readonly string[];
  /** the satellites of the module, sorted by name */
  selected: readonly SelectedSat[];
  onChange: (selected: readonly SelectedSat[]) => void;
  /** the names of the selected satellites are still being read */
  loading?: boolean;
}

/**
 * The satellite selector of Create new module / Edit module (ref §3, gtk-sat-selector.c): a search entry, the group combo,
 * the list "Available Satellites" / "Catnum", the buttons " --> " and " <-- ", Gpredict's hint and the list "Selected
 * Satellites" / "Catnum". A double click on a satellite moves it to the other box. The search and the group are the
 * server's (GET /api/satellites, at most 500 rows); a satellite that is selected is not listed as available.
 */
export function SatSelector({ groups, selected, onChange, loading = false }: Props) {
  const [text, setText] = useState("");
  const [group, setGroup] = useState("");
  const [found, setFound] = useState<SatRecord[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pickAvailable, setPickAvailable] = useState<number | null>(null);
  const [pickSelected, setPickSelected] = useState<number | null>(null);
  const first = useRef(true);
  const options = useMemo(() => groupOptions(groups), [groups]);

  // search when the text or the group changes (the first time at once, then a moment after the last key)
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () => {
        searchSatellites(text.trim(), group === "" ? undefined : group).then(
          (r) => {
            if (!alive) return;
            setFound(r.satellites);
            setFailure(null);
          },
          (e: unknown) => {
            if (!alive) return;
            setFound([]);
            setFailure(errorText(e));
          },
        );
      },
      first.current ? 0 : DEBOUNCE_MS,
    );
    first.current = false;
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [text, group]);

  const available = useMemo(() => (found === null ? [] : availableSats(found, selected)), [found, selected]);

  const moveRight = (sat: SelectedSat) => {
    onChange(addSat(selected, sat));
    setPickAvailable(null);
  };
  const moveLeft = (sat: SelectedSat) => {
    onChange(removeSat(selected, sat.norad));
    setPickSelected(null);
  };
  const picked = available.find((s) => s.norad === pickAvailable);
  const pickedBack = selected.find((s) => s.norad === pickSelected);

  const emptyAvailable = found === null ? "กำลังค้นหา..." : failure === null ? "ไม่พบดาวที่ตรงกับที่ค้นหา" : null;

  return (
    <div className="selector">
      <div className="search-box">
        <svg className="search-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8.5 8.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          className="dialog-entry search-input"
          type="text"
          value={text}
          maxLength={SEARCH_MAX}
          title="Search for a satellite by name or catalog number"
          aria-label="Search for a satellite by name or catalog number"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} // the search is already on its way: Enter is not OK of the dialog
        />
        <button
          type="button"
          className="search-clear"
          title="Clear the search field"
          aria-label="Clear the search field"
          tabIndex={-1}
          hidden={text === ""}
          onClick={() => setText("")}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      </div>
      <select
        className="dialog-entry selector-group"
        value={group}
        title="Satellite group / category"
        aria-label="Satellite group / category"
        onChange={(e) => setGroup(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="selector-hint">{HINT}</p>
      <SatList
        className="sel-available"
        title="Available Satellites"
        rows={available}
        pick={pickAvailable}
        onPick={setPickAvailable}
        onMove={moveRight}
        empty={emptyAvailable}
      />
      <div className="selector-buttons">
        <button
          type="button"
          className="button"
          title="Add satellite to list"
          disabled={picked === undefined}
          onClick={() => picked !== undefined && moveRight(picked)}
        >
          {" --> "}
        </button>
        <button
          type="button"
          className="button"
          title="Delete satellite from list"
          disabled={pickedBack === undefined}
          onClick={() => pickedBack !== undefined && moveLeft(pickedBack)}
        >
          {" <-- "}
        </button>
      </div>
      <SatList
        className="sel-chosen"
        title="Selected Satellites"
        rows={selected}
        pick={pickSelected}
        onPick={setPickSelected}
        onMove={moveLeft}
        empty={loading ? "กำลังอ่านรายชื่อดาวของ module..." : null}
      />
      <div className="selector-notes">
        {failure !== null && (
          <p className="dialog-error" role="alert">
            {failure}
          </p>
        )}
        {found !== null && found.length >= SEARCH_LIMIT && <p className="selector-note">{TOO_MANY_HINT}</p>}
      </div>
    </div>
  );
}
