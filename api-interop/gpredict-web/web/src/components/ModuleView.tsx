import type { ComponentType } from "react";
import { gridFor, parseLayout, VIEW_LABELS } from "../layout";
import type { ModuleConfig, Tick } from "../types";

/** What every view receives. */
export interface ViewProps {
  /** module name */
  module: string;
  config: ModuleConfig;
  /** newest tick, null before the first one */
  tick: Tick | null;
}

/**
 * The component of each view type. Tasks 14-16 add their entry here, one line each:
 *   [VIEW.Map]: MapView (Task 14), [VIEW.Polar]: PolarView and [VIEW.SingleSat]: SingleSatView (Task 15),
 *   [VIEW.List]: ListView and [VIEW.EventList]: EventListView (Task 16).
 * A cell whose type has no entry yet is a labelled placeholder.
 */
const VIEWS: Partial<Record<number, ComponentType<ViewProps>>> = {};

/** The module's views laid out on the grid of its layout code; every column and row has the same size (ref §1, §3). */
export function ModuleView(props: ViewProps) {
  let grid;
  try {
    grid = gridFor(parseLayout(props.config.layout_code));
  } catch (e) {
    return (
      <div className="view-error" role="alert">
        layout code ของ module นี้ไม่ถูกต้อง: {e instanceof Error ? e.message : String(e)}
      </div>
    );
  }
  return (
    <div
      className="view-grid"
      style={{
        gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
      }}
    >
      {grid.areas.map((area, i) => {
        const View = VIEWS[area.type];
        const label = VIEW_LABELS[area.type] ?? `View ${area.type}`;
        return (
          <div
            key={i}
            className="view-cell"
            data-view={label}
            style={{ gridColumn: area.gridColumn, gridRow: area.gridRow }}
          >
            {View ? <View {...props} /> : <div className="view-placeholder">{label}</div>}
          </div>
        );
      })}
    </div>
  );
}
