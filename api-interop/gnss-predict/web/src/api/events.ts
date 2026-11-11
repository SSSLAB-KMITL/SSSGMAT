// การเชื่อมต่อ Server-Sent Events (/api/events, spec server §8) และการต่อเข้ากับ store ทุกตัว
//
// connectEvents: EventSource ที่ต่อใหม่เองเมื่อหลุด หน่วง 1, 2, 4, 8, 16, 30, 30, ... วินาที (ต่อสำเร็จแล้วกลับเป็น 1 วินาที)
// ปิด EventSource ที่หลุดเองแล้วสร้างใหม่ (ไม่ใช้ auto-reconnect ของเบราว์เซอร์ จึงคุมหน่วงเวลาได้)
// ทุกครั้งที่ต่อได้ เรียก backfill(เวลาของข้อความสดล่าสุด | null, signal) และ **รอให้เสร็จก่อน** ส่ง event สดต่อ (event ที่มาระหว่างนั้นรอคิว)
// ลำดับจึงเก่า -> ใหม่เสมอ backfill ที่ค้างเกิน backfillTimeoutMs (ตั้งต้น 10 วินาที) ถูกยกเลิกด้วย signal และนับเป็นล้มเหลว
// backfill ที่ล้ม: จุดเริ่มของ backfill (เวลาของข้อความสดล่าสุด) หยุดอยู่ที่เดิมจนกว่าจะสำเร็จ ไม่ขยับตามข้อความสดที่มาทีหลัง
// และลองใหม่ด้วย backoff ชุดเดียวกัน (1, 2, 4, ... วินาที) ข้อความสดไม่ถูกบล็อกนานเกินเวลา timeout ต่อรอบ

import { apiGet } from "./client";
import { msg } from "../labels/messages.th";
import { isMessage, report, useMessages } from "../stores/messages";
import { useJobs, type DailyStatus, type JobEvent } from "../stores/jobs";
import { useResults } from "../stores/results";
import { useScenario, type ScenarioEvent } from "../stores/scenario";
import { useSettings } from "../stores/settings";
import { parseIsoUtc } from "../time/parse";

export type EventName = "job" | "message" | "scenario" | "daily" | "ping";
export const EVENT_NAMES: readonly EventName[] = ["job", "message", "scenario", "daily", "ping"];

/** วินาทีที่หน่วงก่อนต่อใหม่ครั้งที่ 1, 2, 3, ... ค้างที่ค่าสุดท้าย */
export const DEFAULT_BACKOFF_S: readonly number[] = [1, 2, 4, 8, 16, 30];

export const DEFAULT_BACKFILL_TIMEOUT_MS = 10_000;

const EVENTS_PATH = "/api/events";

export interface EventHandlers {
  onEvent(name: EventName, data: unknown): void;
  /** เรียกเมื่อสถานะเปลี่ยน (ครั้งแรกที่ต่อไม่ได้ก็ถือว่าเปลี่ยนเป็น false) */
  onStatus(connected: boolean): void;
}

export interface ConnectOptions {
  EventSourceImpl?: typeof EventSource;
  backoffS?: number[];
  /**
   * เรียกทุกครั้งที่ต่อได้ ด้วยเวลา (`time` ตามที่ server ส่ง) ของข้อความสดล่าสุดที่เห็น; ยังไม่เคยเห็น = null
   * signal ถูก abort เมื่อเกิน backfillTimeoutMs; reject = ล้มเหลว (จะลองใหม่จากจุดเดิม)
   */
  backfill?(sinceIso: string | null, signal?: AbortSignal): Promise<void>;
  backfillTimeoutMs?: number;
}

export function connectEvents(h: EventHandlers, o: ConnectOptions = {}): () => void {
  const backoff = o.backoffS !== undefined && o.backoffS.length > 0 ? o.backoffS : DEFAULT_BACKOFF_S;
  let closed = false;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let status: boolean | null = null;
  let lastMessageTime: string | null = null;
  let lastMessageMs = Number.NEGATIVE_INFINITY;
  let backfillFailing = false;
  let backfillAttempt = 0;
  let backfillTimer: ReturnType<typeof setTimeout> | null = null;
  const backfillTimeoutMs = o.backfillTimeoutMs ?? DEFAULT_BACKFILL_TIMEOUT_MS;
  // งานทุกอย่างที่ส่งออกไปให้ผู้ใช้ (backfill และ event สด) เรียงต่อกันในโซ่เดียว
  let chain: Promise<void> = Promise.resolve();

  const enqueue = (task: () => void | Promise<void>): void => {
    chain = chain.then(async () => {
      if (closed) return;
      try {
        await task();
      } catch (e) {
        console.error("event handler failed", e);
      }
    });
  };

  const setStatus = (connected: boolean): void => {
    if (status === connected) return;
    status = connected;
    h.onStatus(connected);
  };

  const noteMessage = (data: unknown): void => {
    if (backfillFailing) return; // จุดเริ่มของ backfill ไม่ข้ามช่องว่างที่ยังไม่ได้เติม
    const time = typeof data === "object" && data !== null ? (data as { time?: unknown }).time : undefined;
    const ms = typeof time === "string" ? parseIsoUtc(time)?.getTime() : undefined;
    if (typeof time === "string" && ms !== undefined && ms >= lastMessageMs) {
      lastMessageMs = ms;
      lastMessageTime = time;
    }
  };

  const cancelBackfillRetry = (): void => {
    if (backfillTimer !== null) clearTimeout(backfillTimer);
    backfillTimer = null;
  };

  const runBackfill = (): void => {
    const backfill = o.backfill;
    if (backfill === undefined) return;
    enqueue(async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), backfillTimeoutMs);
      const timedOut = new Promise<never>((_, reject) => ctl.signal.addEventListener("abort", () => reject(new Error("backfill timed out"))));
      try {
        await Promise.race([backfill(lastMessageTime, ctl.signal), timedOut]);
        backfillFailing = false;
        backfillAttempt = 0;
      } catch (e) {
        console.error("event backfill failed", e);
        backfillFailing = true;
        scheduleBackfillRetry();
      } finally {
        clearTimeout(timer);
      }
    });
  };

  function scheduleBackfillRetry(): void {
    if (closed || backfillTimer !== null || status !== true) return; // สายหลุดอยู่: ครั้งหน้าที่ open จะ backfill เอง
    const seconds = backoff[Math.min(backfillAttempt, backoff.length - 1)];
    backfillAttempt++;
    backfillTimer = setTimeout(() => {
      backfillTimer = null;
      if (!closed && status === true) runBackfill();
    }, seconds * 1000);
  }

  const retryLater = (): void => {
    setStatus(false);
    const seconds = backoff[Math.min(attempt, backoff.length - 1)];
    attempt++;
    timer = setTimeout(connect, seconds * 1000);
  };

  function connect(): void {
    timer = null;
    if (closed) return;
    let src: EventSource;
    try {
      const Impl = o.EventSourceImpl ?? globalThis.EventSource;
      src = new Impl(EVENTS_PATH);
    } catch {
      retryLater();
      return;
    }
    source = src;
    src.addEventListener("open", () => {
      if (closed || src !== source) return;
      attempt = 0;
      setStatus(true);
      cancelBackfillRetry();
      runBackfill();
    });
    src.addEventListener("error", () => {
      if (closed || src !== source) return;
      src.close();
      source = null;
      retryLater();
    });
    for (const name of EVENT_NAMES) {
      src.addEventListener(name, (ev) => {
        if (closed || src !== source) return;
        let data: unknown;
        try {
          data = JSON.parse((ev as MessageEvent<string>).data);
        } catch {
          return; // ข้อมูลที่อ่านไม่ได้ทิ้ง ไม่ให้กระแสทั้งสายพัง
        }
        enqueue(() => {
          if (name === "message") noteMessage(data);
          h.onEvent(name, data);
        });
      });
    }
  }

  connect();

  return () => {
    closed = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    cancelBackfillRetry();
    source?.close();
    source = null;
  };
}

// ---------- ต่อเข้ากับ store ----------

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function isJobEvent(x: unknown): x is JobEvent {
  return isRecord(x) && typeof x.id === "string" && typeof x.state === "string";
}

function toScenarioEvent(x: unknown): ScenarioEvent | null {
  if (!isRecord(x) || typeof x.name !== "string") return null;
  if (x.etag !== null && typeof x.etag !== "string") return null;
  return { name: x.name, etag: x.etag, results_stale: x.results_stale === true };
}

function dispatch(name: EventName, data: unknown): void {
  switch (name) {
    case "message":
      if (isMessage(data)) useMessages.getState().add(data, { fromServer: true });
      break;
    case "job":
      if (isJobEvent(data)) {
        useJobs.getState().onJobEvent(data);
        if (data.state === "succeeded" && data.scenario !== null && data.scenario === useScenario.getState().name) void useResults.getState().refresh();
      }
      break;
    case "scenario": {
      const e = toScenarioEvent(data);
      if (e !== null) void useScenario.getState().onScenarioEvent(e);
      break;
    }
    case "daily":
      if (isRecord(data) && typeof data.state === "string") useJobs.getState().onDailyEvent(data as unknown as DailyStatus);
      break;
    case "ping":
      break;
  }
}

const later = (a: string | null, b: string | null): string | null => {
  const ta = a === null ? null : parseIsoUtc(a);
  const tb = b === null ? null : parseIsoUtc(b);
  if (ta === null) return tb === null ? null : b;
  if (tb === null) return a;
  return tb.getTime() > ta.getTime() ? b : a;
};

/** ข้อความที่ server ส่งมาหลังเวลา `from`; ถอย 1 ms เพราะ server ส่งเฉพาะที่ **หลัง** since และข้อความหลายข้อความอาจมีมิลลิวินาทีเดียวกัน (ซ้ำถูกตัดด้วยกุญแจของ store) */
async function fetchMessagesSince(from: string | null, signal: AbortSignal | undefined): Promise<void> {
  const t = from === null ? null : parseIsoUtc(from);
  const query = t === null ? "" : `?since=${encodeURIComponent(new Date(t.getTime() - 1).toISOString())}`;
  const { data } = await apiGet<unknown>(`/messages${query}`, { signal });
  if (Array.isArray(data)) useMessages.getState().addMany(data.filter(isMessage), { fromServer: true });
}

/** ปิดช่องว่างของสถานะอื่นที่ event อาจหลุดไปตอนไม่ได้ต่อ */
async function resync(reconnected: boolean): Promise<void> {
  const tasks: Promise<void>[] = [
    useSettings.getState().loadHealth().then(() => {
      const daily = useSettings.getState().health?.daily;
      if (daily !== undefined) useJobs.getState().onDailyEvent(daily);
    }),
    useJobs.getState().refresh(),
  ];
  if (reconnected) {
    tasks.push(useScenario.getState().resync());
    if (useScenario.getState().name !== null) tasks.push(useResults.getState().refresh());
  }
  await Promise.all(tasks);
}

/** ต่อ /api/events เข้ากับทุก store: connected, ข้อความ (backfill ด้วย GET /api/messages?since=), job, scenario, daily; คืนฟังก์ชันหยุด */
export function startEventWiring(o: ConnectOptions = {}): () => void {
  let connectedBefore = false;
  /**
   * backfill ที่ล้มอยู่: จุดเริ่มที่ใช้ตอนล้มครั้งแรก (null = ตั้งแต่ต้น) ใช้ซ้ำทุกครั้งที่ลองใหม่จนสำเร็จ
   * ข้อความสดที่มาระหว่างนั้นจึงไม่ดันจุดเริ่มข้ามช่องว่าง; เตือนในหน้าครั้งเดียวต่อช่วงที่ล้ม
   */
  let failedFrom: { from: string | null } | null = null;

  const backfillMessages = async (since: string | null, signal?: AbortSignal): Promise<void> => {
    // จุดเริ่มปกติ: ใหม่กว่าของสองอย่าง คือที่การเชื่อมต่อเห็นสดล่าสุด กับข้อความของ server ล่าสุดใน store (ไม่นับข้อความที่หน้าเว็บสร้างเอง)
    const from = failedFrom !== null ? failedFrom.from : later(since, useMessages.getState().lastServerTime);
    try {
      await fetchMessagesSince(from, signal);
      failedFrom = null;
    } catch (e) {
      if (failedFrom === null) {
        failedFrom = { from };
        report("warning", "BACKFILL", msg("messages.backfillFailed"));
      }
      throw e;
    }
  };

  const stop = connectEvents(
    {
      onEvent: dispatch,
      onStatus: (connected) => {
        useSettings.setState({ connected });
        if (!connected) return;
        const reconnected = connectedBefore;
        connectedBefore = true;
        void resync(reconnected);
      },
    },
    { backfill: backfillMessages, ...o },
  );
  return () => {
    stop();
    useSettings.setState({ connected: false });
  };
}
