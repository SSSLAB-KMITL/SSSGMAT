import { useCallback, useRef, useState } from "react";
import type { ComponentType } from "react";
import { gridFor, parseLayout, VIEW, VIEW_LABELS } from "../layout";
import { useNumberFormat } from "../numfmt";
import type { NumberFormat } from "../numfmt";
import { NoPassMessage } from "../passes/NoPassMessage";
import { passBody } from "../passes/passRequest";
import { PassWait } from "../passes/PassWait";
import type { PassWindow } from "../passes/passWindows";
import type { PassKind } from "../passes/types";
import { usePassRequest } from "../passes/usePassRequest";
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
  /** the number format of Preferences (time format and zone, N/S/E/W, Imperial units): every time, coordinate and distance a view shows goes through it */
  nf: NumberFormat;
  /** a view selects a satellite (null: unselects) */
  onSelect: (norad: number | null) => void;
  /** right click on a satellite: the view calls it with the client position; ModuleView opens the satellite's popup menu there */
  onSatContextMenu?: (norad: number, clientX: number, clientY: number) => void;
  /** double click on a satellite (a row of List or Event list, a satellite of Map or Polar): Satellite info */
  onSatDoubleClick?: (norad: number) => void;
  /** Single sat's popup chose Satellite info (its bold name) for `norad`; the other views' popups are opened by ModuleView, which opens the window itself */
  onSatInfo?: (norad: number) => void;
  /**
   * Single sat's popup chose Show current pass, Show next pass or Future passes for `norad`; `t` is the time of the view (the
   * tick it shows). The other views' popups are opened by ModuleView, which sends the request itself.
   */
  onPass?: (norad: number, kind: PassKind, t: string) => void;
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
 * satellite" and Autotrack change it too. `onOpenPassWindow` opens the Pass details or Upcoming passes window that the answer
 * of a pass request asks for (the pass windows belong to the page: they stay open when the module is closed), and `onOpenSatInfo` opens
 * a Satellite Info window (also the page's). The number format is read from Preferences here, once, and handed to every view.
 */
export type ModuleViewProps = Omit<ViewProps, "onSatContextMenu" | "onSatDoubleClick" | "onSatInfo" | "onPass" | "nf"> & {
  onOpenPassWindow: (w: PassWindow) => void;
  onOpenSatInfo: (norad: number) => void;
};

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
  /** the module time of the tick the popup was asked for: the start time the pass items give the server */
  t: string;
  x: number;
  y: number;
}

/**
 * The module's views laid out on the grid of its layout code; every column and row has the same size (ref §1, §3). It opens
 * the popup menu of a satellite where a view reports a right click (ref §4-§8), and sends the pass requests of the pass items of
 * every satellite popup (also Single sat's) and shows the waiting box and the no-pass message for them. Satellite info, the bold name
 * of Single sat and Event list and the double click on a satellite open a Satellite Info window (`onOpenSatInfo`). A new module starts
 * with no satellite selected.
 */
export function ModuleView(props: ModuleViewProps) {
  return <ModuleViews key={props.module} {...props} />;
}

function ModuleViews({ onOpenPassWindow, onOpenSatInfo, ...props }: ModuleViewProps) {
  const nf = useNumberFormat();
  const [popup, setPopup] = useState<OpenPopup | null>(null);
  const closePopup = useCallback(() => setPopup(null), []);
  const { onError } = props;
  const reportError = useCallback((text: string) => onError?.(text), [onError]);

  const pass = usePassRequest(props.module, onOpenPassWindow);
  const { start: startRequest } = pass;
  const latestTick = useRef(props.tick);
  latestTick.current = props.tick;
  /** A pass item was chosen: Show current pass checks El > 0 again on the newest tick (ref-P §1.1), then the request goes out. */
  const startPass = useCallback(
    (norad: number, kind: PassKind, t: string) => {
      const body = passBody(kind, norad, t, latestTick.current);
      if (body !== null) startRequest(body);
    },
    [startRequest],
  );

  const openPopup = (view: PopupView, norad: number, x: number, y: number) => {
    const sat = props.tick?.sats?.find((s) => s.norad === norad);
    if (sat !== undefined && props.tick !== null) setPopup({ view, sat: { norad, name: sat.name, el: sat.el, dir: sat.dir }, t: props.tick.t, x, y });
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
                  nf={nf}
                  onSatContextMenu={popupView === undefined ? undefined : (norad, x, y) => openPopup(popupView, norad, x, y)}
                  onSatDoubleClick={onOpenSatInfo}
                  onSatInfo={onOpenSatInfo}
                  onPass={startPass}
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
          t={popup.t}
          onPass={startPass}
          onSatInfo={onOpenSatInfo}
          onClose={closePopup}
        />
      )}
      {pass.box?.box === "wait" && <PassWait state={pass.box.state} onCancel={pass.cancel} onRetry={pass.retry} />}
      {pass.box?.box === "message" && <NoPassMessage message={pass.box.message} onOk={pass.ok} />}
    </>
  );
}
