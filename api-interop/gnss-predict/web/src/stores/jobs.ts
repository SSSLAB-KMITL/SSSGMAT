// งานของ server (spec server §7) และสถานะงานประจำวัน (§8 `daily`)
// event `job` มีแค่ {id, kind, scenario, state, progress, error?} จึงรวมเข้ากับบันทึกเต็มที่ได้จาก GET /api/jobs

import { create } from "zustand";
import { apiGet, apiSend } from "../api/client";

export type JobKind = "fetch" | "propagate" | "analyze" | "validate" | "daily";
export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobError {
  code: string;
  text: string;
  detail: string | null;
}

export interface JobProgress {
  stage: string | null;
  fraction: number | null;
}

export interface JobEvent {
  id: string;
  kind: JobKind;
  scenario: string | null;
  state: JobState;
  progress: JobProgress;
  error?: JobError | null;
}

export interface Job extends JobEvent {
  error: JobError | null;
  params?: Record<string, unknown>;
  messages?: unknown[];
  result?: unknown;
  created_utc?: string;
  started_utc?: string | null;
  finished_utc?: string | null;
  origin?: "user" | "scheduler";
}

export interface DailyStatus {
  state: "idle" | "running" | "ok" | "failed";
  last_run_utc: string | null;
  next_run_utc: string | null;
  for_date: string | null;
}

interface JobsState {
  jobs: Record<string, Job>;
  daily: DailyStatus | null;
  onJobEvent(e: JobEvent): void;
  onDailyEvent(d: DailyStatus): void;
  /** job ที่ยังรอหรือกำลังรันของ scenario นี้ (กำลังรันก่อน แล้วใหม่สุดก่อน) */
  activeFor(scenario: string): Job | undefined;
  cancel(id: string): Promise<void>;
  /** ดึงรายการทั้งหมดจาก server (ตอนต่อ SSE ได้ เพื่อปิดช่องว่างที่ event หลุด) ผิดพลาดเงียบ: สถานะการเชื่อมต่อแจ้งอยู่แล้ว */
  refresh(): Promise<void>;
  /** เหมือน refresh() แต่บอกว่าโหลดได้ไหม (true = รายการใน store มาจาก server แล้ว, false = ผิดพลาดและคงรายการเดิม) */
  fetchAll(): Promise<boolean>;
}

export const useJobs = create<JobsState>()((set, get) => ({
  jobs: {},
  daily: null,

  onJobEvent: (e) =>
    set((s) => ({ jobs: { ...s.jobs, [e.id]: { ...s.jobs[e.id], ...e, error: e.error ?? null } } })),

  onDailyEvent: (d) => set({ daily: d }),

  activeFor: (scenario) => {
    const active = Object.values(get().jobs).filter((j) => j.scenario === scenario && (j.state === "running" || j.state === "queued"));
    const rank = (j: Job) => (j.state === "running" ? 1 : 0);
    // id ขึ้นต้นด้วยเวลา (j-YYYYMMDDThhmmss-xxxx) เรียงตามตัวอักษรได้ใหม่สุดท้ายสุด
    active.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
    return active.at(-1);
  },

  cancel: async (id) => {
    const { data } = await apiSend<Job>("POST", `/jobs/${encodeURIComponent(id)}/cancel`);
    if (data) set((s) => ({ jobs: { ...s.jobs, [id]: { ...s.jobs[id], ...data } } }));
  },

  fetchAll: async () => {
    try {
      const { data } = await apiGet<Job[]>("/jobs");
      if (!Array.isArray(data)) return false;
      set({ jobs: Object.fromEntries(data.map((j) => [j.id, j])) });
      return true;
    } catch {
      return false; // ดึงไม่ได้: คงรายการเดิม (การเชื่อมต่อที่หลุดแสดงที่แถบสถานะอยู่แล้ว)
    }
  },

  refresh: async () => {
    await get().fetchAll();
  },
}));
