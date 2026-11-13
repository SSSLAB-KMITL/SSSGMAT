import { useRef, useState } from "react";
import { errorText } from "../api";
import type { PassKind } from "../passes/types";
import { popupChange, satPopup } from "../satPopup";
import type { PopupSat, PopupView } from "../satPopup";
import type { ModuleConfig } from "../types";
import { toEntries } from "./menuEntries";
import { PopupMenu } from "./PopupMenu";

interface Props {
  view: PopupView;
  /** the satellite as it was when the popup was asked for */
  sat: PopupSat;
  /** the module's configuration: which of Highlight footprint, Ground Track and Sky track are on for the satellite */
  config: ModuleConfig;
  x: number;
  y: number;
  /** the `save` of useModuleConfig: the only way to change the configuration of an open module */
  onSaveConfig: (change: (config: ModuleConfig) => ModuleConfig) => Promise<void>;
  /** the server refused a change (Thai text) */
  onError: (text: string) => void;
  /** the time of the view the popup was asked from (ISO 8601 UTC): Gpredict gives its pass routines the view's own time stamp */
  t: string;
  /** Show current pass, Show next pass or Future passes was chosen: the request outlives the popup, so ModuleView sends it */
  onPass: (norad: number, kind: PassKind, t: string) => void;
  onClose: (restoreFocus: boolean) => void;
}

/**
 * The popup of a satellite (ref §4-§8): right click on a satellite in List, Map, Polar or Event list. Satellite info and (Event
 * list) the bold name are for a later sub-project; the pass items go to `onPass`; Highlight footprint, Ground Track and Sky track
 * are saved in the module's configuration. Built once, when it opens.
 */
export function SatPopup({ view, sat, config, x, y, onSaveConfig, onError, t, onPass, onClose }: Props) {
  const save = useRef(onSaveConfig);
  save.current = onSaveConfig;
  const report = useRef(onError);
  report.current = onError;
  const pass = useRef(onPass);
  pass.current = onPass;
  const [entries] = useState(() =>
    toEntries(satPopup(view, sat, config), (action) => {
      if (action.type === "pass") pass.current(sat.norad, action.kind, t);
      else save.current(popupChange(action, sat.norad)).catch((e: unknown) => report.current(errorText(e)));
    }),
  );
  return <PopupMenu x={x} y={y} items={entries} onClose={onClose} />;
}
