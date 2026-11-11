import { useCallback, useState } from "react";
import type { ComponentType } from "react";
import { gridFor, parseLayout, VIEW, VIEW_LABELS } from "../layout";
import { SatPopup } from "./SatPopup";
import type { PopupSat, PopupView } from "../satPopup";
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
  /** right click on a satellite: the view calls it with the client position; ModuleView opens the satellite's popup menu there */
  onSatContextMenu?: (norad: number, clientX: number, clientY: number) => void;
  /** double click on a satellite: Satellite info (sub-project 4, nothing yet) */
  onSatDoubleClick?: (norad: number) => void;
  /**
   * Save a change to the module's configuration (the `save` of useModuleConfig, the one owner of the configuration): `change`
   * gets the newest configuration and returns the new one. Every view gets the new `config` at once; if the server refuses,
   * `config` goes back to what the server holds and the promise rejects with the error. Every write of the configuration goes
   * through this, never a PUT of a view's own copy of `config`: it would undo what another view saved (see configStore.ts).
   */
  onSaveConfig: (change: (config: ModuleConfig) => ModuleConfig) => Promise<void>;
  /** a change of a view or of a satellite popup was refused by the server: the Thai text for the notice strip */
  onError?: (text: string) => void;
}

/**
 * What the page gives ModuleView. The selected satellite is held by the page (App), not here: the Module menu's "Select
 * satellite" and Autotrack change it too.
 */
export type ModuleViewProps = Omit<ViewProps, "onSatContextMenu">;

/** The component of each view type (ref §3); a cell whose type has no entry is a labelled placeholder. */
const VIEWS: Partial<Record<number, ComponentType<ViewProps>>> = {
  [VIEW.List]: ListView,
  [VIEW.Map]: MapView,
  [VIEW.Polar]: PolarView,
  [VIEW.SingleSat]: SingleSatView,
  [VIEW.EventList]: EventListView,
};

/** The popup of a right click on a satellite in each view type (Single sat has its own, from its header button). */
const POPUP_VIEW: Partial<Record<number, PopupView>> = {
  [VIEW.List]: "list",
  [VIEW.Map]: "map",
  [VIEW.Polar]: "polar",
  [VIEW.EventList]: "event",
};

/** A satellite popup that is open: where, in which view and for which satellite (as it was when it was asked for). */
interface OpenPopup {
  view: PopupView;
  sat: PopupSat;
  x: number;
  y: number;
}

/**
 * The module's views laid out on the grid of its layout code; every column and row has the same size (ref §1, §3). It opens
 * the popup menu of a satellite where a view reports a right click (ref §4-§8). A new module starts with no satellite selected.
 */
export function ModuleView(props: ModuleViewProps) {
  return <ModuleViews key={props.module} {...props} />;
}

function ModuleViews(props: ModuleViewProps) {
  const [popup, setPopup] = useState<OpenPopup | null>(null);
  const closePopup = useCallback(() => setPopup(null), []);
  const { onError } = props;
  const reportError = useCallback((text: string) => onError?.(text), [onError]);

  const openPopup = (view: PopupView, norad: number, x: number, y: number) => {
    const sat = props.tick?.sats?.find((s) => s.norad === norad);
    if (sat !== undefined) setPopup({ view, sat: { norad, name: sat.name, el: sat.el, dir: sat.dir }, x, y });
  };

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
    <>
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
          const popupView = POPUP_VIEW[area.type];
          return (
            <div
              key={i}
              className="view-cell"
              data-view={label}
              style={{ gridColumn: area.gridColumn, gridRow: area.gridRow }}
            >
              {View ? (
                <View
                  {...props}
                  onSatContextMenu={popupView === undefined ? undefined : (norad, x, y) => openPopup(popupView, norad, x, y)}
                />
              ) : (
                <div className="view-placeholder">{label}</div>
              )}
            </div>
          );
        })}
      </div>
      {popup !== null && (
        <SatPopup
          key={`${popup.sat.norad}:${popup.x}:${popup.y}`}
          view={popup.view}
          sat={popup.sat}
          config={props.config}
          x={popup.x}
          y={popup.y}
          onSaveConfig={props.onSaveConfig}
          onError={reportError}
          onClose={closePopup}
        />
      )}
    </>
  );
}
