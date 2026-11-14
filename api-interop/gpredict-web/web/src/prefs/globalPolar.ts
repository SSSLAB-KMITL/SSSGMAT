// The Polar View settings of Preferences → Modules that the polar plots of Pass details and Antenna Control use (plan decision 15): in
// Gpredict their widgets read the global `MODULES/POLAR_*` keys, whichever module the pass or the rotator is of, so the plots do not
// follow the Polar View of any module. numfmt.ts does the same for the number format: pure functions over the values and a hook.

import { useMemo } from "react";
import { coloursOf, POLAR_COLORS } from "../colors";
import type { PolarColours } from "../colors";
import type { Meta, PrefValue } from "../types";
import { useMeta } from "../useMeta";
import { POLAR_ORIENTATIONS } from "../views/polarGeom";
import { globalProps } from "./modulesPrefs";
import { usePrefs } from "./prefsStore";

export interface GlobalPolar {
  /** `MODULES/POLAR_CHART_ORIENT`: "N/E/S/W", "N/W/S/E", "S/E/N/W" or "S/W/N/E" */
  orientation: string;
  /** `MODULES/POLAR_QTH_INFO`: the plot shows the name of the station */
  qthInfo: boolean;
  /** the seven `MODULES/POLAR_*_COLOUR` keys */
  colours: PolarColours;
}

/** What the plots use until the Preferences and the constants of the server (which name the keys) have arrived: Gpredict's defaults. */
const DEFAULT_POLAR: GlobalPolar = { orientation: POLAR_ORIENTATIONS[0], qthInfo: true, colours: { ...POLAR_COLORS } };

/** The Polar View settings of Preferences → Modules in `values` (GET /api/prefs); Gpredict's defaults for what is not there (yet). */
export function globalPolarOf(values: Readonly<Record<string, PrefValue>> | undefined, meta: Meta | null): GlobalPolar {
  if (values === undefined || meta === null) return DEFAULT_POLAR;
  const { polar } = globalProps(values, meta);
  return { orientation: polar.orientation, qthInfo: polar.contents["QTH Info"] === true, colours: coloursOf(POLAR_COLORS, polar.colours) };
}

/** The Polar View settings of Preferences → Modules, Gpredict's defaults until they have arrived. */
export function useGlobalPolar(): GlobalPolar {
  const values = usePrefs()?.values;
  const meta = useMeta();
  return useMemo(() => globalPolarOf(values, meta), [values, meta]);
}
