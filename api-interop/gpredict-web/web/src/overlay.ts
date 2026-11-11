// What covers the module's views, if anything (ของเรา; spec §8.1: ขณะ status เป็น computing หรือ failed view ถูกบังด้วย overlay).

import type { Tick } from "./types";

/** Shown while the server computes the GMAT ephemeris window (the text of the server's EPHEM_COMPUTING message). */
export const COMPUTING_TEXT = "กำลังคำนวณวงโคจรด้วย GMAT…";

const FAILED_TEXT = "คำนวณวงโคจรด้วย GMAT ไม่สำเร็จ";
const GMAT_NOT_FOUND_TEXT = "ไม่พบ GMAT (GmatConsole)";

export type OverlayState =
  | { kind: "computing"; text: string }
  | { kind: "failed"; text: string; detail: string | null } // with Retry (ของเรา)
  | { kind: "connecting"; text: string }
  | { kind: "disconnected"; text: string }
  | { kind: "gone"; text: string };

/**
 * Overlay for the socket and tick state:
 * - closed by the server with 1000 (module closed or deleted) or 1008 (not open): `gone`, the socket does not come back
 * - not connected: `connecting` before the first tick, `disconnected` (stale data under it) after
 * - tick status `computing` / `failed`
 */
export function overlayFor(tick: Tick | null, connected: boolean, closeCode: number | null): OverlayState | null {
  if (!connected) {
    if (closeCode === 1000 || closeCode === 1008) {
      return { kind: "gone", text: "module นี้ถูกปิดหรือไม่ได้เปิดอยู่แล้ว" };
    }
    return tick === null
      ? { kind: "connecting", text: "กำลังเชื่อมต่อกับ server…" }
      : { kind: "disconnected", text: "ขาดการเชื่อมต่อกับ server กำลังเชื่อมต่อใหม่…" };
  }
  if (tick === null) return { kind: "connecting", text: "กำลังเชื่อมต่อกับ server…" };
  if (tick.status === "computing") return { kind: "computing", text: COMPUTING_TEXT };
  if (tick.status === "failed") {
    const failure = tick.messages.find((m) => m.level === "error");
    return {
      kind: "failed",
      text: failure?.code === "GMAT_NOT_FOUND" ? GMAT_NOT_FOUND_TEXT : FAILED_TEXT,
      detail: failure?.text ?? null,
    };
  }
  return null;
}
