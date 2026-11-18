import { useMemo } from "react";
import type { ViewProps } from "../components/ModuleView";
import { useRefreshGate } from "./canvasHooks";
import { EVENT_COLUMNS, eventRows } from "./cells";

/**
 * The Event list "Upcoming passes" (ref §8, spec §8.8): Satellite, Az, El and the countdown to the next AOS (satellites below
 * the horizon) or LOS (above it), smallest first, "Never" last. Rows with El > 0 are bold. There is no preference page.
 *
 * - It redraws from the tick only every `refresh.event` ticks (the first at once); a tick that is not "ok" leaves the last rows.
 * - Double click on a row calls `onSatDoubleClick`; right click calls `onSatContextMenu` (and the browser's own menu is
 *   never shown). A click does not select: Gpredict's Event list has no selection of the module's.
 */
export function EventListView({ tick, config, onSatContextMenu, onSatDoubleClick }: ViewProps) {
  const shown = useRefreshGate(tick, config.refresh.event);
  const rows = useMemo(() => (shown === null ? [] : eventRows(shown)), [shown]);

  return (
    <div className="table-view">
      <table className="sat-table">
        <thead>
          <tr>
            {EVENT_COLUMNS.map((c) => (
              <th key={c.title} title={c.hint} className={`align-${c.headAlign}`}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.norad}
              className={r.bold ? "bold" : ""}
              onDoubleClick={() => onSatDoubleClick?.(r.norad)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSatContextMenu?.(r.norad, e.clientX, e.clientY);
              }}
            >
              <td className="align-left">{r.name}</td>
              <td className="align-right">{r.az}</td>
              <td className="align-right">{r.el}</td>
              <td className="align-right">{r.countdown}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
