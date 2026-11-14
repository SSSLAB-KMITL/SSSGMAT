// The Interfaces group of Preferences (ref-R §8, sat-pref-interfaces.c): a notebook with the tabs "Radios" and "Rotators", each a table of
// the devices with the buttons Add new, Edit and Delete, and the editors that Add and Edit open (RadioEditor, RotatorEditor).
// Nothing is written until OK of the Preferences window: the page keeps its own list (hwconfForm.ts, the reducer) and registers one
// function with the window that sends it (PUT /api/hwconf), only when the list differs from the one the server had.

import { useEffect, useId, useReducer, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { errorText } from "../api";
import { NoPassMessage } from "../passes/NoPassMessage";
import type { PrefsPageApi } from "../prefs/prefGroups";
import {
  BUTTON_TIPS,
  commitBody,
  hwChanged,
  initialState,
  interfacesReducer,
  neighbour,
  RADIO_COLUMNS,
  radioCells,
  radioFormFor,
  ROTATOR_COLUMNS,
  rotatorCells,
  rotatorFormFor,
} from "./hwconfForm";
import { RadioEditor } from "./RadioEditor";
import { getHwconf, putHwconf } from "./radioApi";
import { RotatorEditor } from "./RotatorEditor";
import type { ControllerKind, HwConf } from "./types";

const TABS: readonly { kind: ControllerKind; label: string }[] = [
  { kind: "radio", label: "Radios" },
  { kind: "rotator", label: "Rotators" },
];

interface TableProps {
  label: string;
  columns: readonly string[];
  rows: readonly { name: string; cells: string[] }[];
  selected: string | null;
  onSelect: (name: string) => void;
  /** a double click on a row, or Enter on the selected one */
  onOpen: (name: string) => void;
}

/** A table of devices, already sorted: click selects a row, a double click edits it, the arrow keys move the selection (ของเรา: the keys). */
function DeviceTable({ label, columns, rows, selected, onSelect, onOpen }: TableProps) {
  const names = rows.map((r) => r.name);
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = neighbour(names, selected, e.key === "ArrowDown" ? 1 : -1);
      if (next !== null) onSelect(next);
    } else if (e.key === "Enter" && selected !== null) {
      e.preventDefault();
      onOpen(selected);
    }
  };
  return (
    <div className="hw-list" tabIndex={0} onKeyDown={key}>
      <table className="sat-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => (
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
              onClick={() => onSelect(r.name)}
              onDoubleClick={() => onOpen(r.name)}
            >
              {r.cells.map((c, i) => (
                <td key={i} className="align-left">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InterfacesNotebook({ api, hw }: { api: PrefsPageApi; hw: HwConf }) {
  const [state, dispatch] = useReducer(interfacesReducer, hw, initialState);
  const [tab, setTab] = useState<ControllerKind>("radio");
  const id = useId();

  // OK of the window runs the registered function after the preferences are saved: it must send the list as it is then, not as it was
  // when it was registered, so it reads the latest state through a ref
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  const changed = hwChanged(state.original, state.hw);
  useEffect(() => {
    if (!changed) return;
    api.onCommit("hwconf", async () => {
      const body = commitBody(latest.current);
      if (body !== null) await putHwconf(body);
    });
  }, [api, changed]);

  const tabKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
    const target = to === null ? undefined : TABS[to];
    if (target !== undefined) {
      e.preventDefault();
      setTab(target.kind);
      document.getElementById(`${id}-tab-${target.kind}`)?.focus();
    }
  };

  const rows =
    tab === "radio"
      ? state.hw.radios.map((r) => ({ name: r.name, cells: radioCells(r) }))
      : state.hw.rotators.map((r) => ({ name: r.name, cells: rotatorCells(r) }));
  const tips = BUTTON_TIPS[tab];
  const edited = state.editor;

  return (
    <div>
      <div className="dtabs" role="tablist">
        {TABS.map((t, i) => (
          <button
            key={t.kind}
            id={`${id}-tab-${t.kind}`}
            type="button"
            role="tab"
            aria-selected={t.kind === tab}
            aria-controls={`${id}-panel`}
            tabIndex={t.kind === tab ? 0 : -1}
            className={t.kind === tab ? "dtab active" : "dtab"}
            onClick={() => setTab(t.kind)}
            onKeyDown={(e) => tabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} className="hw-panel" role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}>
        <DeviceTable
          label={tab === "radio" ? "Radios" : "Rotators"}
          columns={tab === "radio" ? RADIO_COLUMNS : ROTATOR_COLUMNS}
          rows={rows}
          selected={state.selected[tab]}
          onSelect={(name) => dispatch({ type: "select", kind: tab, name })}
          onOpen={(name) => dispatch({ type: "open", kind: tab, name })}
        />
        {/* the buttons are never off, even with an empty table (ref-R §8.1); the rotator's first says "Add New" */}
        <div className="hw-buttons">
          <button type="button" className="button" title={tips.add} onClick={() => dispatch({ type: "add", kind: tab })}>
            {tab === "radio" ? "Add new" : "Add New"}
          </button>
          <button type="button" className="button" title={tips.edit} onClick={() => dispatch({ type: "edit", kind: tab })}>
            Edit
          </button>
          <button type="button" className="button" title={tips.delete} onClick={() => dispatch({ type: "delete", kind: tab })}>
            Delete
          </button>
        </div>
      </div>
      {edited?.kind === "radio" && (
        <RadioEditor
          initial={radioFormFor(state.hw, edited.editing)}
          existing={state.hw.radios}
          editing={edited.editing}
          onOk={(conf) => dispatch({ type: "saveRadio", conf })}
          onCancel={() => dispatch({ type: "cancel" })}
        />
      )}
      {edited?.kind === "rotator" && (
        <RotatorEditor
          initial={rotatorFormFor(state.hw, edited.editing)}
          existing={state.hw.rotators}
          editing={edited.editing}
          onOk={(conf) => dispatch({ type: "saveRotator", conf })}
          onCancel={() => dispatch({ type: "cancel" })}
        />
      )}
      {state.message !== null && (
        // the box of Gpredict's message dialogs (error icon, the text, OK), the one of "no pass" has the same look
        <NoPassMessage
          message={{ code: "NO_SELECTION", level: "error", text: state.message, object: null }}
          onOk={() => dispatch({ type: "dismiss" })}
        />
      )}
    </div>
  );
}

/** Reads the devices when the page is first shown (the window keeps the page, and what was edited in it, while another group is shown). */
function InterfacesPage({ api }: { api: PrefsPageApi }) {
  const [hw, setHw] = useState<HwConf | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    getHwconf().then(
      (h) => alive && setHw(h),
      (e: unknown) => alive && setFailure(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (hw !== null) return <InterfacesNotebook api={api} hw={hw} />;
  // (ของเรา) Gpredict reads its files at once and has nothing to wait for
  if (failure === null) return <p className="dialog-text hw-wait">กำลังอ่านรายการวิทยุและ rotator...</p>;
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

/** The page of the Interfaces group. */
export function InterfacesPages(api: PrefsPageApi): ReactNode {
  return <InterfacesPage api={api} />;
}
