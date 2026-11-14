// Preferences → General → Ground Stations (ref-D §3, sat-pref-qth.c): a table of the ground stations (Name, Location, Lat, Lon, Alt, QRA and the
// Default box) with the buttons Add new, Edit and Delete, and the editor that Add new and Edit open (components/QthEditor.tsx). The page reads the
// stations when the window opens and keeps its own list (groundStations.ts); nothing is written until OK of the Preferences window, which sends
// the whole list (PUT /api/qth/batch) after a dry run of it, and only if the list differs from the one the server had.

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { errorText, getQthList } from "../api";
import { MessageBox } from "../components/MessageBox";
import { QthEditor } from "../components/QthEditor";
import { useNumberFormat } from "../numfmt";
import { neighbour } from "../radio/hwconfForm";
import type { QthList } from "../types";
import { NUMBER_FORMAT_CONTROLS } from "./generalPrefs";
import {
  checkStations,
  commitStations,
  deleteStation,
  initialDraft,
  LAST_STATION_MESSAGE,
  putStation,
  setDefault,
  STATION_BUTTONS,
  stationColumns,
  stationRows,
  stationsBody,
} from "./groundStations";
import type { StationsDraft } from "./groundStations";
import type { PrefsPageApi } from "./prefGroups";

/** The Imperial box of Number Formats, as the window's draft has it. */
const IMPERIAL_KEY = NUMBER_FORMAT_CONTROLS.imperial.key;

/** Which editor is open: Add new (`editing` null) or Edit of a station. */
interface Editing {
  editing: string | null;
}

function StationsTable({ api, list }: { api: PrefsPageApi; list: QthList }) {
  const [original] = useState(() => initialDraft(list)); // what the server had when the window opened
  const [draft, setDraft] = useState<StationsDraft>(original);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editing | null>(null);
  const [lastStation, setLastStation] = useState(false);

  // The N/S/E/W box takes effect when the window saves it (Gpredict's cell functions read the saved setting); Imperial takes effect at once
  // (Gpredict writes it as soon as the box is ticked and converts this table), so both the table and the editor follow the window's draft of it
  const saved = useNumberFormat();
  const imperial = api.value<boolean>(IMPERIAL_KEY);
  const nf = useMemo(() => ({ ...saved, imperial }), [saved, imperial]);

  // OK of the window runs the registered functions: they must send the list as it is then, not as it was when they were registered, so they
  // read the latest draft through a ref; a list that is back to what the server had sends nothing
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);
  const changed = stationsBody(original, draft) !== null;
  useEffect(() => {
    if (!changed) return;
    // the window checks before it writes anything (all or nothing): the same list, as a dry run
    api.onCheck("qth", async () => {
      const body = stationsBody(original, latest.current);
      if (body !== null) await checkStations(body);
    });
    api.onCommit("qth", async () => {
      const body = stationsBody(original, latest.current);
      if (body !== null) await commitStations(body);
    });
  }, [api, changed, original]);

  const rows = stationRows(draft, nf);
  const names = rows.map((r) => r.name);

  // the buttons are never off (Gpredict's are always on): with no row selected Edit and Delete do nothing (ของเรา; Gpredict's Edit then opens an
  // empty editor that cannot save), except that Delete says "Can not delete ground station!" whenever the list has a single station
  const edit = (name: string | null) => {
    if (name !== null && draft.stations.some((s) => s.name === name)) setEditor({ editing: name });
  };
  const remove = () => {
    const next = deleteStation(draft, selected ?? "");
    if (next === "last") setLastStation(true);
    else if (next !== draft) {
      setDraft(next);
      setSelected(null);
    }
  };

  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(neighbour(names, selected, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" && selected !== null) {
      e.preventDefault();
      edit(selected);
    }
  };

  const editedStation = editor?.editing == null ? null : (draft.stations.find((s) => s.name === editor.editing) ?? null);

  return (
    <div className="hw-panel">
      <div className="hw-list" tabIndex={0} onKeyDown={key}>
        <table className="sat-table station-table" aria-label="Ground Stations">
          <thead>
            <tr>
              {stationColumns(imperial).map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                className={r.name === selected ? "selected" : undefined}
                aria-selected={r.name === selected}
                onClick={() => setSelected(r.name)}
                onDoubleClick={() => edit(r.name)}
              >
                <td className="align-left">{r.name}</td>
                <td className="align-left">{r.location}</td>
                <td className="align-left">{r.lat}</td>
                <td className="align-left">{r.lon}</td>
                <td className="align-center">{r.alt}</td>
                <td className="align-center">{r.qra}</td>
                <td className="align-center">
                  {/* ticking another row makes it the default; unticking the default does nothing, the box stays ticked */}
                  <input type="checkbox" checked={r.isDefault} aria-label={`Default: ${r.name}`} onChange={() => setDraft(setDefault(draft, r.name))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hw-buttons">
        <button type="button" className="button" title={STATION_BUTTONS.add.tip} onClick={() => setEditor({ editing: null })}>
          {STATION_BUTTONS.add.label}
        </button>
        <button type="button" className="button" title={STATION_BUTTONS.edit.tip} onClick={() => edit(selected)}>
          {STATION_BUTTONS.edit.label}
        </button>
        <button type="button" className="button" title={STATION_BUTTONS.delete.tip} onClick={remove}>
          {STATION_BUTTONS.delete.label}
        </button>
      </div>
      {editor !== null && (
        <QthEditor
          mode="draft"
          imperial={imperial}
          initial={editedStation}
          taken={draft.stations.filter((s) => s.name !== editor.editing).map((s) => s.name)}
          onSaved={(q) => {
            setDraft((d) => putStation(d, editor.editing, q));
            setSelected(q.name);
          }}
          onClose={() => setEditor(null)}
        />
      )}
      {lastStation && (
        // Gpredict's message dialog: error icon, the text, OK
        <MessageBox message={{ code: "QTH_LAST", level: "error", text: LAST_STATION_MESSAGE, object: null }} onOk={() => setLastStation(false)} />
      )}
    </div>
  );
}

/** Reads the stations when the page is built, as the window opens (the window keeps the page, and what was edited in it, while another tab or group is shown). */
export function GroundStationsPage({ api }: { api: PrefsPageApi }) {
  const [list, setList] = useState<QthList | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    getQthList().then(
      (l) => alive && setList(l),
      (e: unknown) => alive && setFailure(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (list !== null) return <StationsTable api={api} list={list} />;
  // (ของเรา) Gpredict reads its files at once and has nothing to wait for
  if (failure === null) return <p className="dialog-text hw-wait">กำลังอ่านรายการ ground station...</p>;
  return (
    <div className="hw-wait">
      <p className="dialog-error" role="alert">
        {failure}
      </p>
      <button
        type="button"
        className="button"
        onClick={() => {
          setFailure(null);
          setAttempt((n) => n + 1);
        }}
      >
        ลองอีกครั้ง
      </button>
    </div>
  );
}
