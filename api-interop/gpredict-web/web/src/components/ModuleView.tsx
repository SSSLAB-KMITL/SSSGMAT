import { useState } from "react";
import type { ComponentType } from "react";
import { gridFor, parseLayout, VIEW, VIEW_LABELS } from "../layout";
import type { ModuleConfig, Tick } from "../types";
import { MapView } from "../views/MapView";
import { PolarView } from "../views/PolarView";

/** What every view receives. */
export interface ViewProps {
  /** module name */
  module: string;
  config: ModuleConfig;
  /** newest tick, null before the first one */
  tick: Tick | null;
  /** NORAD number of the module's selected satellite, null if none (one per module, shared by Map, Polar and List; not saved) */
  selected: number | null;
  /** a view selects a satellite (null: unselects) */
  onSelect: (norad: number | null) => void;
  /** right click on a satellite: the view calls it with the client position for the popup menu (Task 18) */
  onSatContextMenu?: (norad: number, clientX: number, clientY: number) => void;
  /** double click on a satellite: Satellite info (sub-project 4, nothing yet) */
  onSatDoubleClick?: (norad: number) => void;
}

/** What the page gives ModuleView: the selection is held here, not above. */
export type ModuleViewProps = Omit<ViewProps, "selected" | "onSelect">;

/**
 * The component of each view type. Tasks 15-16 add their entry here, one line each:
 *   [VIEW.SingleSat]: SingleSatView (Task 15),
 *   [VIEW.List]: ListView and [VIEW.EventList]: EventListView (Task 16).
 * A cell whose type has no entry yet is a labelled placeholder.
 */
const VIEWS: Partial<Record<number, ComponentType<ViewProps>>> = {
  [VIEW.Map]: MapView,
  [VIEW.Polar]: PolarView,
};

/**
 * The module's views laid out on the grid of its layout code; every column and row has the same size (ref §1, §3).
 * It holds the module's selected satellite (ref §5: one at a time, in every view); a new module starts with none.
 */
export function ModuleView(props: ModuleViewProps) {
  return <ModuleViews key={props.module} {...props} />;
}

function ModuleViews(props: ModuleViewProps) {
  const [selected, setSelected] = useState<number | null>(null);
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
            {View ? <View {...props} selected={selected} onSelect={setSelected} /> : <div className="view-placeholder">{label}</div>}
          </div>
        );
      })}
    </div>
  );
}
