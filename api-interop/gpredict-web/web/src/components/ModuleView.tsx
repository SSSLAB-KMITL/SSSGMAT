import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { putModule } from "../api";
import { gridFor, parseLayout, VIEW, VIEW_LABELS } from "../layout";
import type { ModuleConfig, Tick } from "../types";
import { EventListView } from "../views/EventListView";
import { ListView } from "../views/ListView";
import { MapView } from "../views/MapView";
import { PolarView } from "../views/PolarView";
import { SingleSatView } from "../views/SingleSatView";

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
  /**
   * Save a change to the module's configuration (PUT /api/modules/{name}, the whole configuration): `change` gets the newest
   * configuration and returns the new one. Every view gets the new `config` at once; if the server refuses, `config` goes back
   * to what it was and the promise rejects with the error. Views save through this, not with their own copy of `config`, so
   * that two views saving one after the other do not undo each other.
   */
  onSaveConfig: (change: (config: ModuleConfig) => ModuleConfig) => Promise<void>;
}

/** What the page gives ModuleView: the selection and the saving of the configuration are held here, not above. */
export type ModuleViewProps = Omit<ViewProps, "selected" | "onSelect" | "onSaveConfig">;

/** The component of each view type (ref §3); a cell whose type has no entry is a labelled placeholder. */
const VIEWS: Partial<Record<number, ComponentType<ViewProps>>> = {
  [VIEW.List]: ListView,
  [VIEW.Map]: MapView,
  [VIEW.Polar]: PolarView,
  [VIEW.SingleSat]: SingleSatView,
  [VIEW.EventList]: EventListView,
};

/**
 * The module's views laid out on the grid of its layout code; every column and row has the same size (ref §1, §3).
 * It holds the module's selected satellite (ref §5: one at a time, in every view); a new module starts with none.
 * It also holds the module's configuration for the views: the one the page gives it (read again when the page gives a new
 * one) with the changes the views have saved since.
 */
export function ModuleView(props: ModuleViewProps) {
  return <ModuleViews key={props.module} {...props} />;
}

function ModuleViews(props: ModuleViewProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [config, setConfig] = useState(props.config);
  const [given, setGiven] = useState(props.config);
  if (props.config !== given) {
    // the page read the configuration again (Configure): it replaces what the views have saved
    setGiven(props.config);
    setConfig(props.config);
  }
  const newest = useRef(config);
  useEffect(() => {
    newest.current = config;
  }, [config]);

  const saveConfig = useCallback(async (change: (c: ModuleConfig) => ModuleConfig) => {
    const before = newest.current;
    const next = change(before);
    newest.current = next;
    setConfig(next);
    try {
      await putModule(next);
    } catch (e) {
      if (newest.current === next) {
        newest.current = before;
        setConfig(before);
      }
      throw e;
    }
  }, []);

  let grid;
  try {
    grid = gridFor(parseLayout(config.layout_code));
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
            {View ? (
              <View {...props} config={config} selected={selected} onSelect={setSelected} onSaveConfig={saveConfig} />
            ) : (
              <div className="view-placeholder">{label}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
