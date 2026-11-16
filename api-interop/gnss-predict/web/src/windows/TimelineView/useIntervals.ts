// ช่วงเวลาของ access ที่ Timeline View ใช้ (GET /access/intervals ต่อ access): ดึงใหม่เมื่อ access ของ scenario เปลี่ยน
// หรือเมื่อผลลัพธ์ของ Facility ต้นทางเปลี่ยน (refresh ของ useResults ได้ bundle/สถานะใหม่) คำตอบของรอบเก่าถูกยกเลิกและทิ้ง

import { useEffect, useMemo, useState } from "react";
import { isAbortError } from "../../api/client";
import { msg } from "../../labels/messages.th";
import { report } from "../../stores/messages";
import { useResults } from "../../stores/results";
import { useScenario } from "../../stores/scenario";
import { accessKey, accessLabel, accessResultsKey, fetchAccessResult, isTimelineAccess, type IntervalsByAccess } from "./rows";

const NO_REPLIES: IntervalsByAccess = {};

interface Replies {
  /** scenario ที่คำตอบเป็นของ */
  scenario: string | null;
  replies: IntervalsByAccess;
}

export function useAccessIntervals(): IntervalsByAccess {
  const name = useScenario((s) => s.name);
  const accesses = useScenario((s) => s.doc?.accesses);
  const info = useResults((s) => s.info);
  const [state, setState] = useState<Replies>({ scenario: null, replies: NO_REPLIES });

  const wanted = useMemo(() => (accesses ?? []).filter(isTimelineAccess), [accesses]);
  // กติกาเดียวกับ highlight ของหน้าต่าง 2D (accessResultsKey): ตัวอักษรเท่าเดิม = ไม่ต้องดึงใหม่
  const key = accessResultsKey(wanted, info);

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
        // ยกเลิก = รอบใหม่แทนแล้ว; อย่างอื่นเป็นบั๊กของเราเอง (fetchAccessResult แปลงข้อผิดพลาดของ server เป็นแถวแล้ว) บันทึกไว้
        // ไม่โยนต่อ: async ที่ไม่มีใครรอ = unhandled rejection แถวเดิมคงอยู่
        if (!isAbortError(e)) console.error("useAccessIntervals", e);
      }
    })();
    return () => ctl.abort();
  }, [name, key]);

  return state.scenario === name ? state.replies : NO_REPLIES;
}
