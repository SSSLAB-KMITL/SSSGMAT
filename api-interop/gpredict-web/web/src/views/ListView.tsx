import { useMemo } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ViewProps } from "../components/ModuleView";
import { useMeta } from "../useMeta";
import { clickSelection } from "./canvasCommon";
import { useRefreshGate } from "./canvasHooks";
import { inCanonicalOrder, isDecayed, LIST_ALIGN, listCell } from "./cells";
import { nextSort, sortSaveFailureText, sortSats } from "./listSort";

/**
 * The List view (ref §4, spec §8.6): one row per satellite, one column per visible field of the module in the canonical order
 * of /api/meta, the header of each with its hint as tooltip.
 *
 * - It redraws from the tick only every `refresh.list` ticks (the first at once); a tick that is not "ok" leaves the last rows.
 * - Rows with El > 0 are bold; the selected satellite's row (the module's, shared with the Map and the Polar) is highlighted.
 *   A click on a row selects its satellite or, on the selected one, unselects it; double click calls `onSatDoubleClick`;
 *   right click calls `onSatContextMenu` (and the browser's own menu is never shown).
 * - A click on a column header sorts by it, or reverses the order if it is the sorted column; the module remembers both
 *   (`list_sort`, saved with PUT /api/modules/{name}; if the server refuses, the Thai text goes to `onError`, the notice strip).
 *   Next AOS, Next LOS and Next Event sort by time, empty ones last.
 */
export function ListView({ config, tick, selected, onSelect, onSaveConfig, onSatContextMenu, onSatDoubleClick, onError }: ViewProps) {
  const meta = useMeta();
  const shown = useRefreshGate(tick, config.refresh.list);
  const { column: sortColumn, ascending } = config.list_sort;

  const columns = useMemo(() => inCanonicalOrder(meta?.list_columns ?? [], config.list_columns), [meta, config.list_columns]);
  const rows = useMemo(
    () => sortSats((shown?.sats ?? []).filter((s) => !isDecayed(s)), sortColumn, ascending),
    [shown, sortColumn, ascending],
  );
  const time = useMemo(() => new Date(shown?.t ?? Number.NaN), [shown]);

  const sortBy = (column: string) => {
    onSaveConfig((c) => ({ ...c, list_sort: nextSort(c.list_sort, column) })).catch((e: unknown) => onError?.(sortSaveFailureText(e)));
  };
  const sortKey = (column: string) => (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      sortBy(column);
    }
  };

  return (
    <div className="table-view">
      <table className="sat-table">
        <thead>
          <tr>
            {columns.map((c) => {
              const sorted = c.name === sortColumn;
              return (
                <th
                  key={c.name}
                  className="sortable"
                  title={c.hint}
                  tabIndex={0}
                  aria-sort={sorted ? (ascending ? "ascending" : "descending") : "none"}
                  onClick={() => sortBy(c.name)}
                  onKeyDown={sortKey(c.name)}
                >
                  {c.name}
                  {sorted && (
                    <span className="sort-arrow" aria-hidden="true">
                      {ascending ? "▲" : "▼"}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr
              key={s.norad}
              className={`${s.el !== null && s.el > 0 ? "bold" : ""} ${s.norad === selected ? "selected" : ""}`}
              onClick={(e) => {
                const change = clickSelection(e.detail, s.norad, selected);
                if (change !== null) onSelect(change.norad);
              }}
              onDoubleClick={() => onSatDoubleClick?.(s.norad)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSatContextMenu?.(s.norad, e.clientX, e.clientY);
              }}
            >
              {columns.map((c) => (
                <td key={c.name} className={`align-${LIST_ALIGN[c.name] ?? "left"}`}>
                  {listCell(c.name, s, time)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
