import { useRef, useState } from "react";
import { errorText } from "../api";
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
  onClose: (restoreFocus: boolean) => void;
}

/**
 * The popup of a satellite (ref §4-§8): right click on a satellite in List, Map, Polar or Event list. Satellite info, the pass
 * items and (Single sat, Event list) the bold name are for later sub-projects; Highlight footprint, Ground Track and Sky track
 * are saved in the module's configuration. Built once, when it opens.
 */
export function SatPopup({ view, sat, config, x, y, onSaveConfig, onError, onClose }: Props) {
  const save = useRef(onSaveConfig);
  save.current = onSaveConfig;
  const report = useRef(onError);
  report.current = onError;
  const [entries] = useState(() =>
    toEntries(satPopup(view, sat, config), (action) => {
      save.current(popupChange(action, sat.norad)).catch((e: unknown) => report.current(errorText(e)));
    }),
  );
  return <PopupMenu x={x} y={y} items={entries} onClose={onClose} />;
}
