// hook ร่วมของแถบเมนู แถบเครื่องมือ และแถบสถานะ

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { commandsVersion, subscribeCommands } from "../commands";
import { useScenario } from "../stores/scenario";
import { useTime } from "../stores/time";
import { formatTime, type DateFormat } from "../time/format";

/** วาดใหม่เมื่อทะเบียนคำสั่งเปลี่ยน (ลงทะเบียน หรือ invalidateCommands) เพื่อให้สถานะ enabled ตามทัน */
export function useCommands(): number {
  return useSyncExternalStore(subscribeCommands, commandsVersion);
}

/** เวลา animation ในช่องและแถบสถานะรีเฟรชไม่เกินกี่ครั้งต่อวินาที */
export const TIME_REFRESH_MS = 100;

/**
 * เวลา animation ปัจจุบัน รีเฟรชไม่เกิน ~10 ครั้งต่อวินาที (นาฬิกาเดิน 60 ครั้งต่อวินาที ไม่ต้องวาดทุกเฟรม)
 * การเปลี่ยนครั้งแรกหลังเงียบไปนานแสดงทันที ที่ตามมาภายในช่วงนั้นรอแล้วแสดงค่าล่าสุดตอนครบช่วง
 */
export function useThrottledTime(intervalMs: number = TIME_REFRESH_MS): Date {
  const [value, setValue] = useState(() => useTime.getState().current);
  useEffect(() => {
    let last = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = (): void => {
      timer = null;
      last = performance.now();
      setValue(useTime.getState().current);
    };
    setValue(useTime.getState().current); // เปลี่ยนระหว่าง render กับ effect
    const unsubscribe = useTime.subscribe((state, prev) => {
      if (state.current === prev.current || timer !== null) return; // timer ค้างอยู่ = จะอ่านค่าล่าสุดเองตอนครบช่วง
      const wait = last + intervalMs - performance.now();
      if (wait <= 0) push();
      else timer = setTimeout(push, wait);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [intervalMs]);
  return value;
}

export interface TimeFormatter {
  fmt: DateFormat;
  ltz: string;
  format(d: Date): string;
}

/** รูปแบบเวลาตาม DateFormat ของ scenario ที่เปิดอยู่ (ไม่มี scenario = UTCG) */
export function useTimeFormatter(): TimeFormatter {
  const units = useScenario((s) => s.doc?.units);
  const fmt: DateFormat = units?.date_format ?? "UTCG";
  const ltz = units?.ltz_offset ?? "+07:00";
  return useMemo(() => ({ fmt, ltz, format: (d: Date) => formatTime(d, fmt, ltz) }), [fmt, ltz]);
}
