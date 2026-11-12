// ช่วงเวลาของ access ที่ Timeline View ใช้ (GET /access/intervals ต่อ access): ดึงใหม่เมื่อ access ของ scenario เปลี่ยน
// หรือเมื่อผลลัพธ์ของ Facility ต้นทางเปลี่ยน (refresh ของ useResults ได้ bundle/สถานะใหม่) คำตอบของรอบเก่าถูกยกเลิกและทิ้ง

import { useEffect, useMemo, useState } from "react";
import { isAbortError } from "../../api/client";
import { msg } from "../../labels/messages.th";
import { report } from "../../stores/messages";
import { useResults } from "../../stores/results";
import { useScenario } from "../../stores/scenario";
import { accessKey, accessLabel, fetchAccessResult, isTimelineAccess, type IntervalsByAccess } from "./rows";

const NO_REPLIES: IntervalsByAccess = {};

interface Replies {
  /** scenario ที่คำตอบเป็นของ */
  scenario: string | null;
  replies: IntervalsByAccess;
}

const facilityOf = (from: string): string => from.split("/").at(-1) ?? from;

export function useAccessIntervals(): IntervalsByAccess {
  const name = useScenario((s) => s.name);
  const accesses = useScenario((s) => s.doc?.accesses);
  const info = useResults((s) => s.info);
  const [state, setState] = useState<Replies>({ scenario: null, replies: NO_REPLIES });

  const wanted = useMemo(() => (accesses ?? []).filter(isTimelineAccess), [accesses]);
  // access ที่ขอ (ตัวตนและช่วงเวลาที่ตัดผล) และสถานะของผล ephem กับสถานะ/hash ของ bundle ของ Facility ต้นทาง (bundle ของ access ผูกกับ ephem ที่ใช้คำนวณ
  // จึงเปลี่ยนตามเมื่อ ephem เปลี่ยน): ตัวอักษรเท่าเดิม = ไม่ต้องดึงใหม่
  const wantedKey = JSON.stringify(wanted.map((a) => [a.from, a.to, a.time_period ?? null]));
  const resultsKey = JSON.stringify([
    info?.ephem.status ?? null,
    wanted.map((a) => {
      const entry = info?.access[facilityOf(a.from)];
      return [entry?.status ?? null, entry?.hash ?? null];
    }),
  ]);

  useEffect(() => {
    if (name === null || wanted.length === 0) {
      setState((prev) => (prev.scenario === name && prev.replies === NO_REPLIES ? prev : { scenario: name, replies: NO_REPLIES }));
      return;
    }
    const ctl = new AbortController();
    void (async () => {
      try {
        const entries = await Promise.all(wanted.map(async (a) => [a, await fetchAccessResult(name, a, ctl.signal)] as const));
        if (ctl.signal.aborted) return;
        for (const [a, result] of entries) {
          // สายหลุดแจ้งที่แถบสถานะแล้ว ไม่ซ้ำใน Message Viewer
          if (result.status === "error" && result.code !== "NETWORK") {
            report("warning", result.code ?? "ACCESS_INTERVALS", msg("timeline.failed", { name: accessLabel(a), message: result.message }));
          }
        }
        setState({ scenario: name, replies: Object.fromEntries(entries.map(([a, result]) => [accessKey(a), result])) });
      } catch (e) {
        if (!isAbortError(e)) throw e;
      }
    })();
    return () => ctl.abort();
  }, [name, wantedKey, resultsKey]);

  return state.scenario === name ? state.replies : NO_REPLIES;
}
