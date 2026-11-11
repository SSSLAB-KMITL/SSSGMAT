// แถบสถานะ (spec §12, W10): Message Viewer + จำนวนที่ยังไม่อ่าน, Active Object, Lat/Lon, ดาวที่ใช้ได้ + PDOP, อายุข้อมูลสูงสุด,
// ⚠ ดาวติดธง, งานประจำวัน/งานที่กำลังรัน (+ Stop), Animation Time, Time Step, และสถานะขาดการติดต่อ server (แดง)
// ทุกช่องมี data-field กับ aria-label ตามชื่อใน labels.ts

import { MessageSquare, Square, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, errorText } from "../api/client";
import { isEnabled, runCommand } from "../commands";
import { satelliteInfo } from "../data/catalog";
import { t } from "../labels/labels";
import { msg } from "../labels/messages.th";
import { isActiveJob, useJobs, type Job } from "../stores/jobs";
import { useLayout } from "../stores/layout";
import { messageKey, report, useMessages } from "../stores/messages";
import { useResults } from "../stores/results";
import { useScenario } from "../stores/scenario";
import { useSelection } from "../stores/selection";
import { useSettings } from "../stores/settings";
import { useTime } from "../stores/time";
import { formatStep } from "../time/steps";
import { useCommands, useThrottledTime, useTimeFormatter } from "./hooks";
import { TipProvider } from "./Tip";

const DASH = "—";

function Field({ name, label, className, children }: { name: string; label: string; className?: string; children: ReactNode }) {
  return (
    <span className={`status-field${className === undefined ? "" : ` ${className}`}`} data-field={name} role="group" aria-label={label} title={label}>
      {children}
    </span>
  );
}

// ---------- Message Viewer + ที่ยังไม่อ่าน ----------

const isProblem = (level: string): boolean => level === "error" || level === "warning";
const messageViewerVisible = (): boolean => useLayout.getState().api?.getPanel("messageViewer")?.api.isVisible === true;

/**
 * ข้อความผิดพลาด/เตือนที่ยังไม่อ่าน = ที่ยังไม่ถูก Clear all Tabs และมาหลังจุดที่อ่านล่าสุด
 * อ่านแล้วเมื่อกดไอคอน หรือเมื่อหน้าต่าง Message Viewer เห็นอยู่ (ข้อความที่มาตอนนั้นนับว่าอ่านทันที)
 */
function useUnread(): { count: number; markRead(): void } {
  const items = useMessages((s) => s.items);
  const hidden = useMessages((s) => s.hidden.all);
  const revision = useLayout((s) => s.revision);
  const [read, setRead] = useState<ReadonlySet<string>>(() => new Set());
  const count = useMemo(
    () => items.filter((m) => isProblem(m.level) && !hidden.has(messageKey(m)) && !read.has(messageKey(m))).length,
    [items, hidden, read],
  );
  const markRead = (): void => setRead(new Set(useMessages.getState().items.filter((m) => isProblem(m.level)).map(messageKey)));
  useEffect(() => {
    if (count > 0 && messageViewerVisible()) markRead();
  }, [count, revision]);
  return { count, markRead };
}

function MessagesField() {
  useCommands();
  const { count, markRead } = useUnread();
  return (
    <Field name="messages" label={t("window.messageViewer")}>
      <button
        type="button"
        className="status-button"
        aria-label={`${t("window.messageViewer")} (${count})`}
        aria-disabled={isEnabled("view.messageViewer") ? undefined : true}
        onClick={() => {
          markRead();
          runCommand("view.messageViewer");
        }}
      >
        <MessageSquare size={14} aria-hidden="true" />
        <span className={count > 0 ? "status-count status-count-unread" : "status-count"}>{count}</span>
      </button>
    </Field>
  );
}

// ---------- ข้อมูลของผลลัพธ์ ----------

function PdopField() {
  const current = useThrottledTime();
  const dop = useResults((s) => s.dop);
  // dop เปลี่ยน = ผลลัพธ์ใหม่; dopAt อ่านแถวของ store ที่ถืออยู่ (ค้นแบบทวิภาค)
  const row = useMemo(() => useResults.getState().dopAt(current), [current, dop]);
  const text = row === undefined || row.pdop === null ? DASH : `${t("status.pdop")} ${row.pdop.toFixed(2)} (${row.n_visible})`;
  return (
    <Field name="pdop" label={t("status.usableSatellites")}>
      {text}
    </Field>
  );
}

function MaxAgeField() {
  const manifest = useResults((s) => s.manifest);
  const ages = (manifest?.satellites ?? []).flatMap((s) => (s.propagated && typeof s.age_days === "number" ? [s.age_days] : []));
  return (
    <Field name="maxDataAge" label={t("status.maxDataAge")}>
      {ages.length === 0 ? DASH : `${Math.max(...ages).toFixed(1)} d`}
    </Field>
  );
}

/** จำนวนดาวของ scenario ที่ติดธงเตือน (จับคู่ผ่าน NORAD: ดาวที่เปลี่ยนชื่อหรือคัดลอกก็นับตามธงของ NORAD นั้น) */
function useFlaggedCount(): number {
  const doc = useScenario((s) => s.doc);
  const catalog = useScenario((s) => s.catalog);
  return useMemo(
    () => (doc?.objects ?? []).filter((o) => o.class === "Satellite" && satelliteInfo(o.norad)?.warn === true).length,
    // satelliteInfo อ่านจาก store ตรง ๆ: catalog กับ doc เปลี่ยน = คำนวณใหม่
    [doc, catalog],
  );
}

function FlaggedField() {
  useCommands();
  const count = useFlaggedCount();
  const label = t("status.flaggedSatellites");
  return (
    <Field name="flagged" label={label}>
      <button
        type="button"
        className="status-button"
        aria-label={`${label}: ${count}`}
        aria-disabled={isEnabled("ob.showFlagged") ? undefined : true}
        onClick={() => runCommand("ob.showFlagged")}
      >
        <TriangleAlert size={14} aria-hidden="true" className={count > 0 ? "status-warn" : undefined} />
        <span className="status-count">{count}</span>
      </button>
    </Field>
  );
}

// ---------- งาน ----------

/** งานที่กำลังรัน: ของ scenario ที่เปิดอยู่ก่อน ไม่มีก็งานประจำวัน */
function useRunningJob(): Job | undefined {
  const jobs = useJobs((s) => s.jobs);
  const scenario = useScenario((s) => s.name);
  return useMemo(() => {
    const own = scenario === null ? undefined : useJobs.getState().activeFor(scenario);
    if (own !== undefined) return own;
    return Object.values(jobs)
      .filter((j) => j.kind === "daily" && isActiveJob(j))
      .sort((a, b) => a.id.localeCompare(b.id))
      .at(-1);
  }, [jobs, scenario]);
}

function stop(job: Job): void {
  useJobs.getState().cancel(job.id).catch((e: unknown) => report("error", e instanceof ApiError ? e.code : "JOB_CANCEL", errorText(e)));
}

function JobField() {
  const job = useRunningJob();
  if (job === undefined) return null;
  const fraction = job.progress.fraction;
  const percent = fraction === null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  const stage = job.progress.stage ?? job.kind;
  return (
    <Field name="job" label={t("status.dailyForecast")} className="status-job">
      <span className="progress" role="progressbar" aria-label={stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
        <span className="progress-fill" style={percent === null ? undefined : { width: `${percent}%` }} data-indeterminate={percent === null ? "" : undefined} />
      </span>
      <span className="status-job-text">{percent === null ? stage : `${stage} ${percent}%`}</span>
      <button type="button" className="status-button" aria-label={t("status.stop")} title={t("status.stop")} onClick={() => stop(job)}>
        <Square size={12} aria-hidden="true" />
      </button>
    </Field>
  );
}

function DailyField() {
  const daily = useJobs((s) => s.daily);
  return (
    <Field name="daily" label={t("status.dailyForecast")}>
      {`${t("status.dailyForecast")}: ${daily === null ? DASH : msg(`daily.state.${daily.state}`)}`}
    </Field>
  );
}

// ---------- ตำแหน่ง เวลา ----------

/** ตำแหน่งเมาส์เปลี่ยนทุกการขยับบนแผนที่ 2D: ช่องนี้ฟังเอง ทั้งแถบจะได้ไม่ถูกวาดใหม่ตามเมาส์ */
function LatLonField() {
  const latLon = useSelection((s) => s.cursorLatLon);
  return (
    <Field name="latLon" label={t("status.latLon")} className="status-mono">
      {latLon === null ? "" : `${latLon[0].toFixed(2)}°, ${latLon[1].toFixed(2)}°`}
    </Field>
  );
}

function TimeFields() {
  const { format } = useTimeFormatter();
  const current = useThrottledTime();
  const step = useTime((s) => s.step_s);
  return (
    <>
      <Field name="animationTime" label={t("status.animationTime")} className="status-mono">
        {format(current)}
      </Field>
      <Field name="timeStep" label={t("status.timeStep")} className="status-mono">
        {formatStep(step)}
      </Field>
    </>
  );
}

export function StatusBar() {
  const activePath = useSelection((s) => s.activePath);
  const connected = useSettings((s) => s.connected);
  return (
    <TipProvider>
      <div className="statusbar">
        <MessagesField />
        <Field name="activeObject" label={t("status.activeObject")} className="status-grow">
          {activePath ?? ""}
        </Field>
        <LatLonField />
        <PdopField />
        <MaxAgeField />
        <FlaggedField />
        <DailyField />
        <JobField />
        <TimeFields />
        {!connected && (
          <Field name="connection" label={t("status.disconnected")} className="status-disconnected">
            {msg("server.disconnected")}
          </Field>
        )}
      </div>
    </TipProvider>
  );
}
