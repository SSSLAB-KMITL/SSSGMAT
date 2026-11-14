import { memo, useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { errorText, getSatellite } from "../api";
import { useNumberFormat } from "../numfmt";
import { cascadePosition } from "../passes/passWindows";
import { getTransponders } from "../radio/radioApi";
import type { Transponder } from "../radio/types";
import { orbitInfoRows, ORBIT_SEPARATOR_AFTER, scriptParts, transponderLines, UNREADABLE_TEXT, unreadableRows } from "../satInfo";
import type { InfoRow, SatInfoOpen } from "../satInfo";
import type { SatRecord } from "../types";
import { FloatingWindow } from "./FloatingWindow";

type TabId = "orbit" | "trsp";

/** Gpredict's two tabs, in its order (`sat-info.c:518-523`). */
const TABS: readonly { id: TabId; label: string }[] = [
  { id: "orbit", label: "Orbit Info" },
  { id: "trsp", label: "Transponders" },
];

/** What a request has brought so far. */
type Load<T> = { state: "loading" } | { state: "failed"; text: string } | { state: "ready"; value: T };

/** A text with `<sub>` and `<sup>` in it (only the units of the Orbit Info rows have them), as real subscripts and superscripts; never as HTML. */
function Scripted({ text }: { text: string }) {
  return (
    <>
      {scriptParts(text).map((p, i) => (p.script === "sub" ? <sub key={i}>{p.text}</sub> : p.script === "sup" ? <sup key={i}>{p.text}</sup> : p.text))}
    </>
  );
}

function Cell({ text, row }: { text: string; row: InfoRow }) {
  const content = row.markup ? <Scripted text={text} /> : text;
  return <td>{row.bold ? <b>{content}</b> : content}</td>;
}

/**
 * The grid of the Orbit Info tab (`sat-info.c:286-289`): a label column and a value column, both left-aligned, with a separator after
 * row `ORBIT_SEPARATOR_AFTER` (when there are that many rows). The first row, the satellite's name, is bold. Every text is a text node.
 */
export function OrbitInfoTable({ rows }: { rows: readonly InfoRow[] }) {
  return (
    <table className="satinfo-grid">
      <tbody>
        {rows.flatMap((row, i) => [
          <tr key={row.label}>
            <Cell text={row.label} row={row} />
            <Cell text={row.value} row={row} />
          </tr>,
          ...(i === ORBIT_SEPARATOR_AFTER && i < rows.length - 1
            ? [
                <tr key="separator" className="satinfo-separator">
                  <td colSpan={2}>
                    <hr />
                  </td>
                </tr>,
              ]
            : []),
        ])}
      </tbody>
    </table>
  );
}

/**
 * The Transponders tab (`sat-info.c:59-189`): "No transponders" for an empty list, else for each transponder in file order a blank
 * line, its name in bold (written as it is: Gpredict puts it in markup unescaped, so `&` or `<` in a SatNOGS description breaks
 * its label, here a name is only text), a separator and its lines.
 */
export function TransponderList({ transponders }: { transponders: readonly Transponder[] }) {
  if (transponders.length === 0) return <div className="satinfo-none">No transponders</div>;
  return (
    <div className="satinfo-trsp">
      {transponders.map((t, i) => (
        <div key={i} className="satinfo-trsp-item">
          <div className="satinfo-trsp-gap">&nbsp;</div>
          <div className="satinfo-trsp-name">
            <b>{t.name}</b>
          </div>
          <hr />
          {transponderLines(t).map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The Orbit Info tab for a satellite's record: its rows, or the rows that can still be shown with the line that says why not. */
function OrbitPanel({ load }: { load: Load<SatRecord> }) {
  const nf = useNumberFormat();
  if (load.state === "loading") return <div role="status">กำลังอ่านข้อมูลดาว…</div>; // (ของเรา) Gpredict reads it before it opens the window
  if (load.state === "failed") return <p className="dialog-error">{load.text}</p>;
  const info = load.value.orbit_info;
  if (info === null || info === undefined) {
    return (
      <>
        <OrbitInfoTable rows={unreadableRows(load.value)} />
        <p className="dialog-error">{UNREADABLE_TEXT}</p>
      </>
    );
  }
  return <OrbitInfoTable rows={orbitInfoRows(info, nf)} />;
}

function TransponderPanel({ load }: { load: Load<Transponder[]> }) {
  if (load.state === "loading") return <div role="status">กำลังอ่านข้อมูล transponder…</div>; // (ของเรา)
  if (load.state === "failed") return <p className="dialog-error">{load.text}</p>;
  return <TransponderList transponders={load.value} />;
}

/** Asks `read` for satellite `norad` when the window opens; an answer that comes after the window has closed is dropped. */
function useLoad<T>(read: (norad: number) => Promise<T>, norad: number): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    let current = true;
    read(norad).then(
      (value) => {
        if (current) setLoad({ state: "ready", value });
      },
      (e: unknown) => {
        if (current) setLoad({ state: "failed", text: errorText(e) });
      },
    );
    return () => {
      current = false;
    };
  }, [read, norad]);
  return load;
}

interface Props {
  norad: number;
  onClose: () => void;
  /** where the window opens, in client px */
  position?: { x: number; y: number };
}

/**
 * The Satellite Info window (ref-D §8, `sat-info.c`): title "Satellite Info", not modal (any number can be open), a notebook with the
 * tabs "Orbit Info" and "Transponders", and one button, OK (the default: it has the focus, so Enter closes; so does Escape).
 * The satellite is read when the window opens (GET /api/satellites/{norad} and GET /api/trsp/{norad}); each tab says in Thai if its
 * request failed. The tabs lie one on top of the other, so the window keeps its size when the tab changes, as GTK's notebook does.
 */
export function SatInfoWindow({ norad, onClose, position }: Props) {
  const [tab, setTab] = useState<TabId>("orbit");
  const record = useLoad(getSatellite, norad);
  const transponders = useLoad(getTransponders, norad);

  const tabKey = (e: ReactKeyboardEvent, i: number) => {
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
    const target = to === null ? undefined : TABS[to];
    if (target !== undefined) {
      e.preventDefault();
      setTab(target.id);
      (e.currentTarget.parentElement?.querySelector(`[data-tab="${target.id}"]`) as HTMLElement | null)?.focus();
    }
  };

  return (
    <FloatingWindow title="Satellite Info" onClose={onClose} initialPosition={position}>
      <div className="dialog satinfo-window">
        <div className="dtabs" role="tablist">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tab={t.id}
              aria-selected={t.id === tab}
              tabIndex={t.id === tab ? 0 : -1}
              className={t.id === tab ? "dtab active" : "dtab"}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => tabKey(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="satinfo-panels">
          <div className="satinfo-panel orbit" role="tabpanel" aria-hidden={tab !== "orbit"}>
            <OrbitPanel load={record} />
          </div>
          <div className="satinfo-panel trsp" role="tabpanel" aria-hidden={tab !== "trsp"}>
            <TransponderPanel load={transponders} />
          </div>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="button" data-autofocus onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </FloatingWindow>
  );
}

interface HostProps {
  windows: readonly SatInfoOpen[];
  /** closes window `id` */
  onClose: (id: string) => void;
}

/** The Satellite Info windows that are open, each a step lower and to the right of the one before (ของเรา: Gpredict leaves it to the window manager). Not re-rendered on every tick, only when a window opens or closes. */
export const SatInfoWindows = memo(function SatInfoWindows({ windows, onClose }: HostProps) {
  return (
    <>
      {windows.map((w, i) => (
        <SatInfoWindow key={w.id} norad={w.norad} position={cascadePosition(i)} onClose={() => onClose(w.id)} />
      ))}
    </>
  );
});
