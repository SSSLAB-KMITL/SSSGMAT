import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { errorText } from "../api";
import {
  loadLocations,
  locationTree,
  moveCursor,
  nodeCells,
  parentKey,
  SELECT_COLUMNS,
  SELECT_LOCATION_BUTTONS,
  SELECT_LOCATION_TITLE,
  visibleNodes,
} from "../locations";
import type { LocationRow, SelectMode, TreeNode } from "../locations";
import { useNumberFormat } from "../numfmt";
import { Modal } from "./Modal";

interface Props {
  /** which Select button opened it: the one of Location shows Lat, Lon and Alt too */
  mode: SelectMode;
  /** OK with a city chosen */
  onPick: (row: LocationRow) => void;
  /** Cancel, Escape, or (the caller closes it) after OK */
  onClose: () => void;
}

/** The width class of the columns that have a fixed one; Location takes what is left, and cuts a long name short. */
const COLUMN_CLASS: Readonly<Record<string, string>> = { Lat: "tree-col-deg", Lon: "tree-col-deg", Alt: "tree-col-alt", WX: "tree-col-wx" };

/** How far each level of the tree is indented (the first cell of a row is indented by its depth). */
const INDENT_PX = 16;

/**
 * Gpredict's "Select Location" dialog (ref-D §3, loc-tree.c), a modal with the cities as a tree: continents, the countries in each and the
 * cities in each country, all closed when it opens. Only a city can be chosen; OK is off until one is. A continent or a country opens and closes
 * by a click (Gpredict: its arrow), and by the keys: Up and Down move, Right opens, Left closes (or goes to the parent), Enter or Space opens and
 * closes. The columns are those of the Select button that opened it. Lat and Lon follow the N/S/E/W setting; Alt is in metres, with no unit,
 * whatever the Imperial setting is, as in Gpredict. (ของเรา: the list is read from the server the first time and kept, and the keys.)
 */
export function LocationSelector({ mode, onPick, onClose }: Props) {
  const [rows, setRows] = useState<readonly LocationRow[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ key: string; row: LocationRow } | null>(null);
  const nf = useNumberFormat();
  const cursorRow = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    let alive = true;
    loadLocations().then(
      (r) => alive && setRows(r),
      (e: unknown) => alive && setFailure(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const tree = useMemo(() => locationTree(rows ?? []), [rows]);
  const nodes = useMemo(() => visibleNodes(tree, open), [tree, open]);
  const columns = SELECT_COLUMNS[mode];

  // the row the cursor is on stays in view while the keys move it
  useEffect(() => {
    cursorRow.current?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const toggle = (key: string, on: boolean) => {
    setOpen((was) => {
      const next = new Set(was);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
    // closing a continent or a country that holds the chosen city takes the choice away with the row (OK then has nothing to take)
    if (!on && chosen !== null && chosen.key.startsWith(`${key}\u0001`)) setChosen(null);
  };

  /** the cursor goes to the row; a city that it reaches is chosen (GTK selects the row the cursor lands on, if it may be selected) */
  const land = (node: TreeNode) => {
    setCursor(node.key);
    if (node.kind === "city") setChosen({ key: node.key, row: node.row });
  };

  const press = (node: TreeNode) => {
    if (node.kind === "city") land(node);
    else {
      setCursor(node.key);
      toggle(node.key, !open.has(node.key));
    }
  };

  const onKey = (e: KeyboardEvent) => {
    const at = nodes.find((n) => n.key === cursor);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = moveCursor(nodes, cursor, e.key === "ArrowDown" ? 1 : -1);
      const node = nodes.find((n) => n.key === next);
      if (node !== undefined) land(node);
    } else if (e.key === "ArrowRight" && at !== undefined && at.kind !== "city" && !open.has(at.key)) {
      e.preventDefault();
      toggle(at.key, true);
    } else if (e.key === "ArrowLeft" && at !== undefined) {
      e.preventDefault();
      if (at.kind !== "city" && open.has(at.key)) toggle(at.key, false);
      else {
        const parent = parentKey(at);
        if (parent !== null) setCursor(parent);
      }
    } else if ((e.key === "Enter" || e.key === " ") && at !== undefined && at.kind !== "city") {
      e.preventDefault();
      toggle(at.key, !open.has(at.key));
    }
  };

  return (
    <Modal title={SELECT_LOCATION_TITLE} onEscape={onClose}>
      <div className="dialog location-select">
        {rows === null ? (
          failure === null ? (
            // (ของเรา) Gpredict reads its list from a file at once
            <p className="dialog-text tree-wait">กำลังอ่านรายชื่อเมือง...</p>
          ) : (
            <div className="tree-wait">
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
          )
        ) : (
          <div className="tree-list" tabIndex={0} data-autofocus onKeyDown={onKey}>
            <table className="sat-table" role="treegrid" aria-label={SELECT_LOCATION_TITLE}>
              <colgroup>
                {columns.map((c) => (
                  <col key={c} className={COLUMN_CLASS[c]} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => {
                  const cells = nodeCells(n, mode, nf);
                  const isChosen = n.kind === "city" && chosen?.key === n.key;
                  const classes = [isChosen ? "selected" : "", n.key === cursor ? "cursor" : ""].filter(Boolean).join(" ");
                  return (
                    <tr
                      key={n.key}
                      ref={n.key === cursor ? cursorRow : undefined}
                      className={classes || undefined}
                      role="row"
                      aria-level={n.depth + 1}
                      aria-expanded={n.kind === "city" ? undefined : open.has(n.key)}
                      aria-selected={n.kind === "city" ? isChosen : undefined}
                      onClick={() => press(n)}
                    >
                      {cells.map((c, i) => (
                        <td key={i} className="align-left" style={i === 0 ? { paddingLeft: 10 + n.depth * INDENT_PX } : undefined}>
                          {i === 0 && n.kind !== "city" && (
                            <span className="tree-arrow" aria-hidden="true">
                              {open.has(n.key) ? "▾" : "▸"}
                            </span>
                          )}
                          {c}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="dialog-buttons">
          <button type="button" className="button" onClick={onClose}>
            {SELECT_LOCATION_BUTTONS.cancel}
          </button>
          <button type="button" className="button" disabled={chosen === null} onClick={() => chosen !== null && onPick(chosen.row)}>
            {SELECT_LOCATION_BUTTONS.ok}
          </button>
        </div>
      </div>
    </Modal>
  );
}
