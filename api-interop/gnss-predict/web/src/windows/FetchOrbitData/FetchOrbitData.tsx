// Fetch Orbit Data (spec §11, เพิ่มเอง): snapshot ล่าสุด, จำนวนดาวต่อระบบ, เวลาที่ส่งคำขอไป CelesTrak ล่าสุดและเวลาที่ดึงได้ครั้งถัดไปต่อระบบ, ปุ่ม Fetch Now
// - อ่านจาก GET /orbits (ใหม่สุดมาก่อน) และ GET /orbits/fetch-status (อ่านอย่างเดียว ไม่ดึงเน็ต) พร้อมกัน แล้วแสดงทีเดียว
//   เวลาแสดงตาม DateFormat ของ scenario ที่เปิดอยู่ (ไม่มี scenario = UTCG)
// - ผู้ใช้ห้ามถูกดาวน์โหลดโดยไม่ยินยอม: การเปิดหน้าต่างนี้ไม่ดึงอะไร Fetch Now ถามยืนยันเป็นภาษาไทยที่บอกว่าจะดาวน์โหลดจาก CelesTrak ก่อนทุกครั้ง
//   OK แล้วจึง POST /orbits/fetch ครั้งเดียว (ไม่มี body = ทั้งสี่ระบบ) ใส่ job ที่ได้เป็น queued ใน useJobs (api/startJob.ts) และแจ้งเป็นข้อความไทย
//   ข้อจำกัดความถี่ของ CelesTrak server เป็นผู้บังคับ (ดึงก่อนเวลาจะใช้ข้อมูลเดิม) หน้านี้แค่บอก ไม่ได้กันปุ่ม
// - job fetch (หรือ daily ซึ่งดึง snapshot ด้วย) ที่เคยเห็นว่ารอหรือกำลังรันแล้วสำเร็จ = อ่านรายการและสถานะใหม่ (ไม่ว่าใครสั่ง)
//   Fetch Now ปิดไว้ขณะมี job fetch ที่รอหรือรันอยู่ (server จะคืน job เดิมอยู่แล้ว)

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, errorText } from "../../api/client";
import { startJob } from "../../api/startJob";
import { reportWriteError } from "../../api/writes";
import { confirm } from "../../chrome/Dialogs";
import { useTimeFormatter } from "../../chrome/hooks";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { isActiveJob, useJobs } from "../../stores/jobs";
import { report } from "../../stores/messages";
import { parseIsoUtc } from "../../time/parse";

const DASH = "—";

interface Orbit {
  name: string;
  time_utc: string;
  groups: Record<string, number>;
  has_brdc: boolean;
}
interface GroupStatus {
  last: string | null;
  next: string | null;
}
type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };
type Loaded = { orbits: Outcome<Orbit[]>; status: Outcome<Record<string, GroupStatus>> };

/** ระบบดาว (ตัวอักษรของ snapshot) กับกลุ่ม CelesTrak (กุญแจของ fetch-status) ตามลำดับที่แสดง */
const SYSTEMS: readonly { letter: string; group: string; label: LabelKey }[] = [
  { letter: "G", group: "gps-ops", label: "option.system.gps" },
  { letter: "R", group: "glo-ops", label: "option.system.glonass" },
  { letter: "E", group: "galileo", label: "option.system.galileo" },
  { letter: "C", group: "beidou", label: "option.system.beidou" },
];

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const stringOrNull = (x: unknown): string | null => (typeof x === "string" ? x : null);

function toOrbits(data: unknown): Orbit[] {
  if (!Array.isArray(data)) throw new RangeError("the snapshot list is not a list");
  return data.flatMap((o: unknown): Orbit[] => {
    if (!isRecord(o) || typeof o.name !== "string") return [];
    const groups = isRecord(o.groups) ? Object.fromEntries(Object.entries(o.groups).filter(([, n]) => typeof n === "number")) as Record<string, number> : {};
    return [{ name: o.name, time_utc: stringOrNull(o.time_utc) ?? "", groups, has_brdc: o.has_brdc === true }];
  });
}

function toStatus(data: unknown): Record<string, GroupStatus> {
  const groups = isRecord(data) && isRecord(data.groups) ? data.groups : null;
  if (groups === null) throw new RangeError("the fetch status has no groups");
  return Object.fromEntries(
    Object.entries(groups).map(([group, v]) => [group, { last: isRecord(v) ? stringOrNull(v.last_request_utc) : null, next: isRecord(v) ? stringOrNull(v.next_allowed_utc) : null }]),
  );
}

async function settle<T>(work: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await work };
  } catch (e) {
    return { ok: false, message: errorText(e) };
  }
}

/** เวลาปัจจุบันที่วาดซ้ำเป็นระยะ (ให้ "ดึงได้ตอนนี้" ตามทันเมื่อเวลาผ่านไปโดยไม่ต้องอ่านใหม่) */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function FetchOrbitData(_props: Partial<PanelProps>) {
  const { format } = useTimeFormatter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const fetching = useJobs((s) => Object.values(s.jobs).some((j) => j.kind === "fetch" && isActiveJob(j)));
  const now = useNow(30_000);
  const control = useRef<AbortController | null>(null);

  const refresh = useCallback((): void => {
    control.current?.abort();
    const ctl = new AbortController();
    control.current = ctl;
    void Promise.all([
      settle(apiGet<unknown>("/orbits", { signal: ctl.signal }).then(({ data }) => toOrbits(data))),
      settle(apiGet<unknown>("/orbits/fetch-status", { signal: ctl.signal }).then(({ data }) => toStatus(data))),
    ]).then(([orbits, status]) => {
      if (!ctl.signal.aborted) setLoaded({ orbits, status });
    });
  }, []);

  useEffect(() => {
    refresh();
    return () => control.current?.abort();
  }, [refresh]);

  // job ที่เห็นว่ารอ/รันแล้วสำเร็จ (ผ่าน event หรือการดึงรายการใหม่) = snapshot และเวลาที่ดึงได้อาจเปลี่ยน; job ที่โผล่มาเสร็จแล้วเลย (ประวัติ) ไม่นับ
  useEffect(
    () =>
      useJobs.subscribe((state, prev) => {
        if (state.jobs === prev.jobs) return;
        const done = Object.values(state.jobs).some((job) => {
          const before = prev.jobs[job.id];
          return before !== job && job.state === "succeeded" && (job.kind === "fetch" || job.kind === "daily") && before !== undefined && isActiveJob(before);
        });
        if (done) refresh();
      }),
    [refresh],
  );

  const fetchNow = async (): Promise<void> => {
    if (asking || fetching) return;
    setAsking(true);
    setNotice(null);
    setFailure(null);
    try {
      if (!(await confirm(msg("fetch.confirm")))) return;
      const job = await startJob("/orbits/fetch", "fetch");
      const text = msg("fetch.queued", { job });
      report("info", "FETCH_QUEUED", text);
      setNotice(text);
    } catch (e) {
      reportWriteError(e);
      setFailure(msg("fetch.failed", { message: errorText(e) }));
    } finally {
      setAsking(false);
    }
  };

  const orbits = loaded?.orbits.ok === true ? loaded.orbits.value : [];
  const latest = orbits[0];
  const status = loaded?.status.ok === true ? loaded.status.value : {};
  const timeText = (iso: string | null): string => {
    const d = iso === null ? null : parseIsoUtc(iso);
    return d === null ? DASH : format(d);
  };
  const nextText = (iso: string | null): string => {
    const d = iso === null ? null : parseIsoUtc(iso);
    if (d === null) return DASH;
    return d.getTime() <= now ? msg("fetch.availableNow") : format(d);
  };

  // ทุกระบบต้องรอ = บอกเวลาที่เร็วที่สุดที่จะดึงได้อีก (ระบบที่ไม่เคยดึงหรืออ่านไม่ได้ = ดึงได้เลย จึงไม่บอก)
  const nexts = SYSTEMS.map((s) => parseIsoUtc(status[s.group]?.next ?? ""));
  const allWaiting = nexts.every((d) => d !== null && d.getTime() > now);
  const earliest = allWaiting ? Math.min(...nexts.map((d) => (d as Date).getTime())) : null;

  return (
    <div className="fetch">
      {loaded === null && <p className="fetch-note">{msg("fetch.loading")}</p>}
      {loaded?.orbits.ok === false && (
        <p className="form-error fetch-note" role="alert">
          {msg("fetch.loadFailed", { message: loaded.orbits.message })}
        </p>
      )}
      {loaded?.status.ok === false && (
        <p className="form-error fetch-note" role="alert">
          {msg("fetch.statusFailed", { message: loaded.status.message })}
        </p>
      )}

      <section className="fetch-latest" aria-label={t("field.latestSnapshot")}>
        <dl className="kv">
          <dt>{t("field.latestSnapshot")}</dt>
          <dd className="kv-mono">{latest?.name ?? DASH}</dd>
          <dt>{t("field.snapshotTime")}</dt>
          <dd className="kv-mono">{latest === undefined ? DASH : timeText(latest.time_utc)}</dd>
          <dt>{t("field.broadcast")}</dt>
          <dd>{latest === undefined ? DASH : latest.has_brdc ? msg("fetch.yes") : msg("fetch.no")}</dd>
        </dl>
        {loaded?.orbits.ok === true && latest === undefined && <p className="fetch-note">{msg("fetch.noSnapshot")}</p>}
      </section>

      <table className="fetch-table">
        <thead>
          <tr>
            <th>{t("field.system")}</th>
            <th>{t("field.satellites")}</th>
            <th>{t("field.lastRequest")}</th>
            <th>{t("field.nextFetch")}</th>
          </tr>
        </thead>
        <tbody>
          {SYSTEMS.map((s) => {
            const count = latest?.groups[s.letter];
            return (
              <tr key={s.group}>
                <td>{t(s.label)}</td>
                <td className="fetch-num">{count === undefined ? DASH : count}</td>
                <td className="fetch-time">{timeText(status[s.group]?.last ?? null)}</td>
                <td className="fetch-time">{nextText(status[s.group]?.next ?? null)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {earliest !== null && <p className="fetch-note">{msg("fetch.nextAvailable", { time: format(new Date(earliest)) })}</p>}
      <p className="fetch-note">{msg("fetch.limitNote")}</p>
      {fetching && <p className="fetch-note">{msg("fetch.running")}</p>}
      {notice !== null && (
        <p className="fetch-note" role="status">
          {notice}
        </p>
      )}
      {failure !== null && (
        <p className="form-error fetch-note" role="alert">
          {failure}
        </p>
      )}

      <div className="fetch-buttons">
        <button type="button" className="btn" disabled={asking || fetching} onClick={() => void fetchNow()}>
          {t("dialog.fetchNow")}
        </button>
      </div>
    </div>
  );
}

/** ลงทะเบียน Fetch Orbit Data เป็นหน้าต่างชนิด fetchOrbitData (แทนตัวแทนชั่วคราว) ชื่อ ชนิด และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerFetchOrbitDataPanel(): void {
  const base = getPanelDef("fetchOrbitData");
  if (base === undefined) throw new Error('panel kind "fetchOrbitData" is not registered');
  registerPanel("fetchOrbitData", { ...base, component: FetchOrbitData, size: { width: 620, height: 440 } });
}
