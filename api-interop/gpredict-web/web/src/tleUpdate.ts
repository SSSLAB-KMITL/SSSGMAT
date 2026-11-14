// The "TLE Update" dialog (ref §1, spec §8.10): what it shows while it runs and when it is done. Pure; TleUpdateDialog.tsx shows it.

import type { ApiMessage, TleUpdateResult } from "./types";

export const TLE_TITLE = "TLE Update";
/** Gpredict shows it in bold at the top. */
export const TLE_HEADING = "Updating TLE files from network";
/** The heading of the box that Edit → Update TLE data from local files opens: the only text that differs (menubar.c:746-747). */
export const TLE_HEADING_FILES = "Updating TLE files from files";

/** Which update the box belongs to: Edit → Update TLE data from network, or from local files. */
export type TleSource = "network" | "files";

/** The three counts as Gpredict writes them (a tab after the colon, a space before the number, a line break after each). */
function stats(updated: number, skipped: number, missing: number): string {
  return `Satellites updated:\t ${updated}\nSatellites skipped:\t ${skipped}\nMissing Satellites:\t ${missing}\n`;
}

/** When satellites may be added to the database the label is replaced at the end by four lines, the last with two tabs and no line break (tle-update.c:380-389). */
function statsWithNew(updated: number, skipped: number, missing: number, added: number): string {
  return `Satellites updated:\t ${updated}\nSatellites skipped:\t ${skipped}\nMissing Satellites:\t ${missing}\nNew Satellites:\t\t ${added}`;
}

export type TlePhase = { kind: "running" } | { kind: "done"; result: TleUpdateResult } | { kind: "failed"; error: string };

export interface TleDialogView {
  /** the bold line at the top: it says "network" or "files" */
  heading: string;
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

export function tleDialogView(phase: TlePhase, source: TleSource): TleDialogView {
  const heading = source === "files" ? TLE_HEADING_FILES : TLE_HEADING;
  switch (phase.kind) {
    case "running":
      return { heading, activity: "...", stats: stats(0, 0, 0), finished: false, warnings: [], error: null };
    case "done": {
      const r = phase.result;
      return {
        heading,
        activity: "Finished",
        stats: r.add_new ? statsWithNew(r.updated, r.skipped, r.missing, r.new) : stats(r.updated, r.skipped, r.missing),
        finished: true,
        warnings: r.messages,
        error: null,
      };
    }
    case "failed":
      return { heading, activity: "", stats: stats(0, 0, 0), finished: true, warnings: [], error: phase.error };
  }
}

/** A part of a text that has Gpredict's `<b>` markup: `bold` for what is between the tags. */
export interface Segment {
  text: string;
  bold: boolean;
}

const BOLD = /<b>([\s\S]*?)<\/b>/g;

/**
 * The text of a notice from the server (the notice "Your TLE files are getting out of date." is Pango markup in Gpredict, main.c:519-527) as
 * plain and bold parts, in order. Only `<b>…</b>` is markup; anything else, tags included, is text, so that nothing the server sends
 * can become HTML. A tag with no partner stays in the text.
 */
export function boldSegments(text: string): Segment[] {
  const parts: Segment[] = [];
  let from = 0;
  for (const m of text.matchAll(BOLD)) {
    if (m.index > from) parts.push({ text: text.slice(from, m.index), bold: false });
    parts.push({ text: m[1]!, bold: true });
    from = m.index + m[0].length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), bold: false });
  return parts;
}
