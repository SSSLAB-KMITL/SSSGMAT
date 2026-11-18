// The "Transponder Update" dialog (ref-R §11.1, spec §7.1): what it shows while it waits and when it is done. Pure;
// TrspUpdateDialog.tsx shows it.

import type { ApiMessage } from "../types";
import type { TrspUpdateAnswer } from "./types";

export const TRSP_TITLE = "Transponder Update";
/** Gpredict shows it in bold at the top ("<b>Updating transponder files from network</b>"). */
export const TRSP_HEADING = "Updating transponder files from network";
/** The statistics label: "\n" at the start and never filled in (Gpredict counts nothing for transponders). */
export const TRSP_STATS = "\n";

/** Before the request, while the server fetches, done (the server's answer) or the request failed (our Thai text). */
export type TrspPhase = { kind: "start" } | { kind: "fetching" } | { kind: "done"; answer: TrspUpdateAnswer } | { kind: "failed"; error: string };

export interface TrspDialogView {
  /** the activity label: "...", then "Fetching transmitters.json", then "Finished" */
  activity: string;
  /** the progress bar, 0 to 1: Gpredict's jumps to 100 % at the end */
  progress: number;
  /** the Close button works */
  finished: boolean;
  /** (ของเรา) the Thai lines under "Finished": what was fetched and when, or why nothing was */
  lines: readonly ApiMessage[];
}

/** "2026-11-14 03:00:00 UTC", the way the server writes its times in the messages, from an ISO 8601 UTC time. */
const shownTime = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;

/** (ของเรา) The line from `fetched_at` for an answer that has no message (the server always sends one; this is the fallback). */
function fetchedLine(fetchedAt: string | null): ApiMessage {
  const text = fetchedAt === null ? "ยังไม่เคยดึงข้อมูล transponder จาก SatNOGS DB" : `ข้อมูล transponder ที่ใช้อยู่ดึงจาก SatNOGS DB เมื่อ ${shownTime(fetchedAt)}`;
  return { code: "TRSP_FETCHED_AT", level: "info", text, object: null };
}

/**
 * The dialog in each phase. "Finished" comes whatever happened, as in Gpredict (which shows it even when the download failed and
 * says why only in its log); the reason is in the Thai lines.
 */
export function trspDialogView(phase: TrspPhase): TrspDialogView {
  switch (phase.kind) {
    case "start":
      return { activity: "...", progress: 0, finished: false, lines: [] };
    case "fetching":
      return { activity: "Fetching transmitters.json", progress: 0, finished: false, lines: [] };
    case "done": {
      const { messages, fetched_at } = phase.answer;
      return { activity: "Finished", progress: 1, finished: true, lines: messages.length > 0 ? messages : [fetchedLine(fetched_at)] };
    }
    case "failed":
      return { activity: "Finished", progress: 1, finished: true, lines: [{ code: "REQUEST_FAILED", level: "error", text: phase.error, object: null }] };
  }
}
