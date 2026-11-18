// The popup menu of a satellite (ref §4-§8, spec §8.2): right click on a satellite in List, Map, Polar and Event list, and the
// header button of Single sat. Pure; SatPopup.tsx shows it.

import { SEPARATOR } from "./menuSpec";
import type { MenuSpec } from "./menuSpec";
import type { PassKind } from "./passes/types";
import type { ModuleConfig } from "./types";

/** The views that have a satellite popup. */
export type PopupView = "list" | "map" | "polar" | "single" | "event";

/** What the popup needs to know of the satellite at the moment it opens. */
export interface PopupSat {
  norad: number;
  name: string;
  /** elevation in degrees, null if the server did not give one */
  el: number | null;
  /** direction symbol; "G" is a GEO satellite */
  dir: string;
}

/** The three lists of the module configuration that the check items switch. */
export type PopupLists = Pick<ModuleConfig, "footprint_off" | "ground_track" | "sky_track">;

/** Set one of the three per-satellite switches on or off: Highlight footprint, Ground Track, Sky track. */
export type SwitchAction = { type: "footprint"; on: boolean } | { type: "groundTrack"; on: boolean } | { type: "skyTrack"; on: boolean };

/**
 * What an item does: set one of the three switches (saved in the module's configuration), ask for passes of the satellite (Show
 * current pass, Show next pass, Future passes: SatPopup and SingleSatView send the request, passRequest.ts), or open the Satellite
 * Info window of the satellite ("Satellite info", or the bold name in Single sat and Event list).
 */
export type PopupAction = SwitchAction | { type: "pass"; kind: PassKind } | { type: "satInfo" };

const passItem = (label: string, kind: PassKind): MenuSpec<PopupAction> => ({ kind: "item", label, action: { type: "pass", kind } });

/**
 * The popup of `sat` in `view`, as Gpredict builds it:
 * 1. List, Map, Polar: "Satellite info"; Single sat and Event list: the satellite name in bold (it opens Satellite info);
 * 2. the passes: "Show current pass" (only while El > 0 when the popup is built), "Show next pass", "Future passes";
 * 3. Map: "Highlight footprint" (on unless the satellite is in footprint_off) and "Ground Track";
 *    Polar: "Sky track" (off for a GEO satellite).
 * Satellite info works since sub-project 4 (Task 19), the pass items since sub-project 2 (passes spec §4.1).
 */
export function satPopup(view: PopupView, sat: PopupSat, lists: PopupLists): MenuSpec<PopupAction>[] {
  const satInfo: PopupAction = { type: "satInfo" };
  const first: MenuSpec<PopupAction> =
    view === "single" || view === "event" ? { kind: "item", label: sat.name, bold: true, action: satInfo } : { kind: "item", label: "Satellite info", action: satInfo };
  const menu: MenuSpec<PopupAction>[] = [
    first,
    SEPARATOR,
    ...(sat.el !== null && sat.el > 0 ? [passItem("Show current pass", "current")] : []),
    passItem("Show next pass", "next"),
    passItem("Future passes", "future"),
  ];
  if (view === "map") {
    const footprint = !lists.footprint_off.includes(sat.norad);
    const track = lists.ground_track.includes(sat.norad);
    menu.push(
      SEPARATOR,
      { kind: "check", label: "Highlight footprint", checked: footprint, action: { type: "footprint", on: !footprint } },
      { kind: "check", label: "Ground Track", checked: track, action: { type: "groundTrack", on: !track } },
    );
  } else if (view === "polar") {
    const track = lists.sky_track.includes(sat.norad);
    const geo = sat.dir === "G";
    menu.push(SEPARATOR, {
      kind: "check",
      label: "Sky track",
      checked: track,
      action: { type: "skyTrack", on: !track },
      disabled: geo,
      // (ของเรา) Gpredict greys the item out without a tooltip
      hint: geo ? "ดาวค้างฟ้า (GEO) ไม่เคลื่อนที่บนฟ้า จึงไม่มี sky track" : undefined,
    });
  }
  return menu;
}

function listWith(list: readonly number[], norad: number, present: boolean): number[] {
  const without = list.filter((n) => n !== norad);
  return present ? [...without, norad] : without;
}

/**
 * The change of the module configuration that an item of the popup makes, for `save` of useModuleConfig: it says what to do
 * ("Ground Track on for 25544"), not what the result is, so it can be applied again to another base. Switching Highlight
 * footprint off adds the satellite to footprint_off. A satellite that is not in the module (any more) changes nothing, and
 * the configuration is returned as it is when the list would not change.
 */
export function popupChange(action: SwitchAction, norad: number): (config: ModuleConfig) => ModuleConfig {
  return (config) => {
    if (!config.satellites.includes(norad)) return config;
    const [key, present] =
      action.type === "footprint" ? (["footprint_off", !action.on] as const) : action.type === "groundTrack" ? (["ground_track", action.on] as const) : (["sky_track", action.on] as const);
    const before = config[key];
    const after = listWith(before, norad, present);
    return after.length === before.length && after.every((n, i) => n === before[i]) ? config : { ...config, [key]: after };
  };
}
