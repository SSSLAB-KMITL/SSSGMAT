// ข้อความของ Message Viewer (spec §12): ข้อความจาก server (SSE `message` และ GET /api/messages) และข้อความที่หน้าเว็บสร้างเอง
// - เก็บเรียงเก่า -> ใหม่ ไม่ซ้ำ (กุญแจ = time + code + text + object) ไม่เกิน 5,000 ข้อความ (ทิ้งข้อความเก่าสุดก่อน)
// - Clear this Tab / Clear All เป็นการซ่อน (ไม่ลบ) เฉพาะแท็บที่สั่ง ข้อความที่มาใหม่แสดงตามปกติ
//   ข้อความที่ซ่อนแล้วถูกส่งมาซ้ำ (backfill) ยังซ่อนอยู่ เพราะกุญแจเดิม

import { useMemo } from "react";
import { create } from "zustand";
import { parseIsoUtc } from "../time/parse";

export type MessageLevel = "info" | "warning" | "error";
export type MessageTab = "all" | MessageLevel;

export interface Message {
  time: string;
  level: MessageLevel;
  code: string;
  text: string;
  object: string | null;
}

export const MESSAGE_CAP = 5000;

export function messageKey(m: Message): string {
  return [m.time, m.code, m.text, m.object ?? ""].join("\u0000");
}

/** รูปร่างของข้อความที่ server ส่งมา (ตรวจก่อนเก็บ เพราะมาจากเครือข่าย) */
export function isMessage(x: unknown): x is Message {
  if (typeof x !== "object" || x === null) return false;
  const m = x as Record<string, unknown>;
  return typeof m.time === "string" && typeof m.code === "string" && typeof m.text === "string"
    && (m.level === "info" || m.level === "warning" || m.level === "error")
    && (m.object === undefined || m.object === null || typeof m.object === "string");
}

/** ข้อความที่หน้าเว็บสร้างเอง (เวลา = ตอนนี้) */
export function localMessage(level: MessageLevel, code: string, text: string, object: string | null = null): Message {
  return { time: new Date().toISOString(), level, code, text, object };
}

/** ใส่ข้อความที่หน้าเว็บสร้างเองเข้า store */
export function report(level: MessageLevel, code: string, text: string, object: string | null = null): void {
  useMessages.getState().add(localMessage(level, code, text, object));
}

function matches(tab: MessageTab, m: Message): boolean {
  return tab === "all" || m.level === tab;
}

export function filterVisible(items: readonly Message[], hidden: ReadonlySet<string>, tab: MessageTab): Message[] {
  return items.filter((m) => matches(tab, m) && !hidden.has(messageKey(m)));
}

const timeMs = (m: Message): number => parseIsoUtc(m.time)?.getTime() ?? Number.NaN;

/** เรียงเก่า -> ใหม่ แบบ stable; เวลาที่อ่านไม่ได้อยู่ที่เดิม (ใช้เวลาของข้อความก่อนหน้า) */
function sortOldestFirst(items: Message[]): Message[] {
  let carry = Number.NEGATIVE_INFINITY;
  const keyed = items.map((m) => {
    const t = timeMs(m);
    if (!Number.isNaN(t)) carry = t;
    return { m, t: carry };
  });
  return keyed.sort((a, b) => a.t - b.t).map((k) => k.m);
}

function isInOrder(head: Message | undefined, fresh: Message[]): boolean {
  let last = head === undefined ? Number.NEGATIVE_INFINITY : timeMs(head);
  if (Number.isNaN(last)) return false;
  for (const m of fresh) {
    const t = timeMs(m);
    if (Number.isNaN(t) || t < last) return false;
    last = t;
  }
  return true;
}

export interface AddOptions {
  /** ข้อความนี้มาจาก server (SSE หรือ GET /api/messages) ไม่ใช่ที่หน้าเว็บสร้างเอง: ใช้นับ lastServerTime */
  fromServer?: boolean;
}

interface MessagesState {
  items: Message[];
  /** กุญแจของข้อความที่ซ่อนอยู่ในแต่ละแท็บ */
  hidden: Record<MessageTab, ReadonlySet<string>>;
  /** เวลาของข้อความใหม่สุดในรายการ (รวมข้อความที่หน้าเว็บสร้างเอง) ไม่ถอยหลังเมื่อกด Clear */
  lastTime: string | null;
  /**
   * เวลา (ตามนาฬิกาของ server) ของข้อความใหม่สุดที่มาจาก server: จุดที่ใช้ backfill ด้วย `since`
   * แยกจาก lastTime เพราะข้อความที่หน้าเว็บสร้างเองใช้นาฬิกาของเครื่องนี้ ถ้านาฬิกาเดินเร็วกว่า server จะข้ามข้อความของ server ไปเงียบ ๆ
   */
  lastServerTime: string | null;
  add(m: Message, opts?: AddOptions): void;
  addMany(ms: readonly Message[], opts?: AddOptions): void;
  clearTab(tab: MessageTab): void;
  clearAll(): void;
  /** ข้อความที่แท็บนี้แสดง (อาร์เรย์ใหม่ทุกครั้ง: ใน React ใช้ useVisibleMessages) */
  visible(tab: MessageTab): Message[];
}

const emptyHidden = (): Record<MessageTab, ReadonlySet<string>> => ({ all: new Set(), error: new Set(), warning: new Set(), info: new Set() });

export const useMessages = create<MessagesState>()((set, get) => ({
  items: [],
  hidden: emptyHidden(),
  lastTime: null,
  lastServerTime: null,

  add: (m, opts) => get().addMany([m], opts),

  addMany: (ms, opts) =>
    set((s) => {
      let lastServerTime = s.lastServerTime;
      if (opts?.fromServer) {
        let best = lastServerTime === null ? Number.NEGATIVE_INFINITY : (parseIsoUtc(lastServerTime)?.getTime() ?? Number.NEGATIVE_INFINITY);
        for (const m of ms) {
          const t = timeMs(m);
          if (t > best) {
            best = t;
            lastServerTime = m.time;
          }
        }
      }
      const known = new Set(s.items.map(messageKey));
      const fresh: Message[] = [];
      for (const raw of ms) {
        const m: Message = { ...raw, object: raw.object ?? null };
        const key = messageKey(m);
        if (known.has(key)) continue;
        known.add(key);
        fresh.push(m);
      }
      if (fresh.length === 0) return lastServerTime === s.lastServerTime ? s : { lastServerTime };
      let items = [...s.items, ...fresh];
      if (!isInOrder(s.items.at(-1), fresh)) items = sortOldestFirst(items);
      if (items.length > MESSAGE_CAP) items = items.slice(items.length - MESSAGE_CAP);
      return { items, lastTime: items.at(-1)?.time ?? s.lastTime, lastServerTime };
    }),

  clearTab: (tab) =>
    set((s) => {
      const present = new Set(s.items.map(messageKey));
      const next = new Set([...s.hidden[tab]].filter((k) => present.has(k)));
      for (const m of filterVisible(s.items, s.hidden[tab], tab)) next.add(messageKey(m));
      return { hidden: { ...s.hidden, [tab]: next } };
    }),

  clearAll: () =>
    set((s) => {
      const all = new Set(s.items.map(messageKey));
      return { hidden: { all: new Set(all), error: new Set(all), warning: new Set(all), info: new Set(all) } };
    }),

  visible: (tab) => filterVisible(get().items, get().hidden[tab], tab),
}));

/** hook สำหรับหน้าต่าง: เลือกเฉพาะค่าที่คงที่ แล้วกรองด้วย useMemo (ห้ามเรียก `visible()` ใน selector: ได้อาร์เรย์ใหม่ทุกครั้ง) */
export function useVisibleMessages(tab: MessageTab): Message[] {
  const items = useMessages((s) => s.items);
  const hidden = useMessages((s) => s.hidden[tab]);
  return useMemo(() => filterVisible(items, hidden, tab), [items, hidden, tab]);
}
