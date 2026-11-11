// The "TLE Update" dialog (ref §1, spec §8.10): what it shows while it runs and when it is done. Pure; TleUpdateDialog.tsx shows it.

import type { ApiMessage, TleUpdateResult } from "./types";

export const TLE_TITLE = "TLE Update";
/** Gpredict shows it in bold at the top. */
export const TLE_HEADING = "Updating TLE files from network";

/** The three counts as Gpredict writes them (a tab after the colon, a space before the number, a line break after each). */
function stats(updated: number, skipped: number, missing: number): string {
  return `Satellites updated:\t ${updated}\nSatellites skipped:\t ${skipped}\nMissing Satellites:\t ${missing}\n`;
}

export type TlePhase = { kind: "running" } | { kind: "done"; result: TleUpdateResult } | { kind: "failed"; error: string };

export interface TleDialogView {
  /** the line under the heading: "..." while it runs, "Finished" when done */
  activity: string;
  /** the three counts */
  stats: string;
  /** the Close button works */
  finished: boolean;
  /** messages of the server, shown after the counts (Thai, ของเรา) */
  warnings: readonly ApiMessage[];
  /** why the update could not be done (Thai, ของเรา) */
  error: string | null;
}

export function tleDialogView(phase: TlePhase): TleDialogView {
  switch (phase.kind) {
    case "running":
      return { activity: "...", stats: stats(0, 0, 0), finished: false, warnings: [], error: null };
    case "done":
      return { activity: "Finished", stats: stats(phase.result.updated, phase.result.skipped, phase.result.missing), finished: true, warnings: phase.result.messages, error: null };
    case "failed":
      return { activity: "", stats: stats(0, 0, 0), finished: true, warnings: [], error: phase.error };
  }
}
