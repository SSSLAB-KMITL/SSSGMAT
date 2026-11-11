// Daily Forecast Settings (spec §11, เพิ่มเอง): ค่าตั้งงานประจำวันตาม server §9.1, สถานะงานประจำวัน, ที่อยู่ไฟล์ CSV สำหรับงาน TEC และปุ่ม Run Now
// - ช่องครบทุกตัวของ §9.1: enabled, run_at_utc (HH:MM), facility (กติกาชื่อ object), retention_days 1-3650, validation_retry_hours 1-168,
//   validation_give_up_days 1-365 และ Cesium Ion token (ช่องรหัสผ่าน) ตรวจก่อนส่งด้วยกติกาเดียวกับ server ข้อความไทยขึ้นที่ช่อง
// - Apply = PUT /settings ทั้งก้อน (server ต้องการครบทุกช่อง) 422 ที่ field แบบ `daily.run_at_utc` ขึ้นที่ช่องนั้น (ขอบแดง) OK = Apply แล้วปิด
// - แสดงเวลาตาม DateFormat ของ scenario ที่เปิดอยู่ (ไม่มี = UTCG) สถานะมาจาก event `daily` ของ SSE (useJobs.daily) หรือ /health ตอนเปิดหน้าต่าง
//   ที่อยู่ CSV = `<data_dir>/daily/latest.csv` แสดงเป็นข้อความ (data_dir มาจาก /health)
// - ผู้ใช้ห้ามถูกดาวน์โหลดโดยไม่ยินยอม: การเปิดหน้าต่างและ Apply ไม่ดึงอะไร Run Now ถามยืนยันเป็นภาษาไทยก่อนทุกครั้ง แล้วจึง POST /daily/run
//   (ไม่มี body = วันถัดไปตาม UTC) ใส่ job เป็น queued ใน useJobs; 409 (มี job ของวันนั้นอยู่แล้ว) ได้ข้อความไทย Run Now ใช้ค่าที่บันทึกแล้ว ไม่ใช่ค่าที่แก้ค้าง
// - เปิดงานประจำวัน (enabled) แล้วแสดงคำเตือนไทยว่า ถ้า server เริ่มหลังเวลา run_at_utc (ก่อน 24:00 UTC) จะดาวน์โหลดทันที (server §9.3)

import { useEffect, useState } from "react";
import { ApiError, errorText } from "../../api/client";
import { isObjectName } from "../../api/names";
import { startJob } from "../../api/startJob";
import { reportWriteError } from "../../api/writes";
import { confirm } from "../../chrome/Dialogs";
import { FormField } from "../../chrome/FormField";
import { useTimeFormatter } from "../../chrome/hooks";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useJobs } from "../../stores/jobs";
import { useLayout } from "../../stores/layout";
import { report } from "../../stores/messages";
import { useSettings, type Settings } from "../../stores/settings";
import { parseIsoUtc } from "../../time/parse";
import { parseInteger } from "../fieldRules";

const DASH = "—";
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** ค่าในฟอร์ม (ข้อความตามที่พิมพ์ ตรวจและแปลงตอน Apply) */
interface Draft {
  enabled: boolean;
  runAt: string;
  facility: string;
  retention: string;
  retry: string;
  giveUp: string;
  token: string;
}
type Key = keyof Draft;
type TextKey = Exclude<Key, "enabled">;
type Errors = Partial<Record<Key, string>>;

/** ชื่อ field ของ server (422) -> ช่องของฟอร์ม */
const SERVER_FIELDS: Record<string, Key> = {
  "daily.enabled": "enabled",
  "daily.run_at_utc": "runAt",
  "daily.facility": "facility",
  "daily.retention_days": "retention",
  "daily.validation_retry_hours": "retry",
  "daily.validation_give_up_days": "giveUp",
  cesium_ion_token: "token",
};

const draftOf = (s: Settings): Draft => ({
  enabled: s.daily.enabled,
  runAt: s.daily.run_at_utc,
  facility: s.daily.facility,
  retention: String(s.daily.retention_days),
  retry: String(s.daily.validation_retry_hours),
  giveUp: String(s.daily.validation_give_up_days),
  token: s.cesium_ion_token,
});

const EMPTY: Draft = { enabled: false, runAt: "", facility: "", retention: "", retry: "", giveUp: "", token: "" };

const sameDraft = (a: Draft, b: Draft): boolean => (Object.keys(a) as Key[]).every((k) => a[k] === b[k]);

/** ตรวจทุกช่อง (ครบทุกข้อผิดพลาดในครั้งเดียว) ผ่านหมด = เอกสารที่ส่ง PUT ได้ทั้งก้อน */
function validate(d: Draft): { errors: Errors; doc: Settings | null } {
  const errors: Errors = {};
  if (!TIME_RE.test(d.runAt)) errors.runAt = msg("daily.timeInvalid");
  if (!isObjectName(d.facility)) errors.facility = msg("ob.nameInvalid");
  const retention = parseInteger(d.retention, { min: 1, max: 3650 });
  const retry = parseInteger(d.retry, { min: 1, max: 168 });
  const giveUp = parseInteger(d.giveUp, { min: 1, max: 365 });
  if (!retention.ok) errors.retention = retention.error;
  if (!retry.ok) errors.retry = retry.error;
  if (!giveUp.ok) errors.giveUp = giveUp.error;
  if (Object.keys(errors).length > 0 || !retention.ok || !retry.ok || !giveUp.ok) return { errors, doc: null };
  return {
    errors,
    doc: {
      daily: {
        enabled: d.enabled,
        run_at_utc: d.runAt,
        facility: d.facility,
        retention_days: retention.value,
        validation_retry_hours: retry.value,
        validation_give_up_days: giveUp.value,
      },
      cesium_ion_token: d.token,
    },
  };
}

/** `<data_dir>/daily/latest.csv` ใช้ตัวคั่นแบบเดียวกับ data_dir (Windows ใช้ \) */
function csvPath(dataDir: string): string {
  const sep = dataDir.includes("\\") && !dataDir.includes("/") ? "\\" : "/";
  return `${dataDir.replace(/[\\/]+$/, "")}${sep}daily${sep}latest.csv`;
}

const isActive = (state: string): boolean => state === "queued" || state === "running";

export function DailyForecastSettings({ panelId = "dailyForecastSettings" }: Partial<PanelProps>) {
  const { format } = useTimeFormatter();
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [base, setBase] = useState<Draft>(EMPTY);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const health = useSettings((s) => s.health);
  const daily = useJobs((s) => s.daily) ?? health?.daily ?? null;
  const dailyActive = useJobs((s) => Object.values(s.jobs).some((j) => j.kind === "daily" && isActive(j.state)));

  useEffect(() => {
    let live = true;
    useSettings.getState().loadSettings().then(
      () => {
        const settings = useSettings.getState().settings;
        if (!live || settings === null) return;
        const loaded = draftOf(settings);
        setBase(loaded);
        setDraft(loaded);
        setPhase("ready");
      },
      (e: unknown) => {
        if (!live) return;
        setGeneral(msg("daily.loadFailed", { message: errorText(e) }));
        setPhase("failed");
      },
    );
    void useSettings.getState().loadHealth();
    return () => {
      live = false;
    };
  }, []);

  const dirty = !sameDraft(draft, base);
  const ready = phase === "ready";

  const edit = <K extends Key>(key: K, value: Draft[K]): void => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors(({ [key]: _gone, ...rest }) => rest);
    setNotice(null);
  };

  const close = (): void => useLayout.getState().closePanel(panelId);

  /** Apply: true = ไม่มีอะไรค้าง (บันทึกแล้ว หรือไม่มีอะไรเปลี่ยน) */
  const apply = async (): Promise<boolean> => {
    if (saving || !ready) return false;
    if (!dirty) return true;
    const result = validate(draft);
    setErrors(result.errors);
    setGeneral(null);
    setNotice(null);
    if (result.doc === null) return false;
    setSaving(true);
    try {
      await useSettings.getState().saveSettings(result.doc);
      const saved = useSettings.getState().settings;
      if (saved !== null) {
        const next = draftOf(saved);
        setBase(next);
        setDraft(next);
      }
      setNotice(msg("daily.saved"));
      return true;
    } catch (e) {
      const key = e instanceof ApiError && e.field !== null ? SERVER_FIELDS[e.field] : undefined;
      if (e instanceof ApiError && key !== undefined) {
        setErrors({ [key]: e.text });
      } else {
        reportWriteError(e);
        setGeneral(msg("daily.applyFailed", { message: errorText(e) }));
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const runNow = async (): Promise<void> => {
    if (running || dailyActive) return;
    setRunning(true);
    setGeneral(null);
    setNotice(null);
    try {
      if (!(await confirm(msg("daily.runNowConfirm")))) return;
      const job = await startJob("/daily/run", "daily");
      const text = msg("daily.queued", { job });
      report("info", "DAILY_RUN_QUEUED", text);
      setNotice(text);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setGeneral(msg("daily.runConflict"));
      } else {
        reportWriteError(e);
        setGeneral(msg("daily.runFailed", { message: errorText(e) }));
      }
    } finally {
      setRunning(false);
    }
  };

  const timeText = (iso: string | null | undefined): string => {
    const d = iso == null ? null : parseIsoUtc(iso);
    return d === null ? DASH : format(d);
  };
  const row = (label: LabelKey, value: string, mono = true) => (
    <>
      <dt>{t(label)}</dt>
      <dd className={mono ? "kv-mono" : undefined}>{value}</dd>
    </>
  );
  const warnTime = TIME_RE.test(draft.runAt) ? draft.runAt : base.runAt;
  const locked = !ready || saving;
  const textRow = (key: TextKey, label: string, opts: { unit?: LabelKey; numeric?: boolean; password?: boolean } = {}) => (
    <FormField label={label} error={errors[key]} hint={opts.unit === undefined ? undefined : t(opts.unit)}>
      {(control) => (
        <input
          {...control}
          type={opts.password === true ? "password" : "text"}
          inputMode={opts.numeric === true ? "numeric" : undefined}
          value={draft[key]}
          disabled={locked}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => edit(key, e.target.value)}
        />
      )}
    </FormField>
  );

  return (
    <div className="daily">
      <div className="daily-body">
        <div className="daily-form">
          <FormField label={t("field.dailyEnabled")} error={errors.enabled}>
            {({ id, "aria-invalid": invalid, "aria-describedby": describedBy }) => (
              <input
                id={id}
                type="checkbox"
                className="form-check"
                aria-invalid={invalid}
                aria-describedby={describedBy}
                checked={draft.enabled}
                disabled={locked}
                onChange={(e) => edit("enabled", e.target.checked)}
              />
            )}
          </FormField>
          {textRow("runAt", t("field.runAt"))}
          {textRow("facility", t("ob.class.facility"))}
          {textRow("retention", t("field.retention"), { unit: "field.unit.days", numeric: true })}
          {textRow("retry", t("field.validationRetry"), { unit: "field.unit.hours", numeric: true })}
          {textRow("giveUp", t("field.validationGiveUp"), { unit: "field.unit.days", numeric: true })}
          {textRow("token", t("field.cesiumToken"), { password: true })}
        </div>

        {draft.enabled && <p className="daily-warning">{msg("daily.warnEnabled", { time: warnTime })}</p>}

        <section className="daily-status" aria-label={t("status.dailyForecast")}>
          <dl className="kv">
            {row("field.status", daily === null ? DASH : msg(`daily.state.${daily.state}`), false)}
            {row("field.lastRun", timeText(daily?.last_run_utc))}
            {row("field.nextRun", timeText(daily?.next_run_utc))}
            {row("field.forDate", daily?.for_date ?? DASH)}
            {row("field.tecCsv", health === null ? DASH : csvPath(health.data_dir))}
          </dl>
          <div className="daily-run">
            <button type="button" className="btn" disabled={running || dailyActive} onClick={() => void runNow()}>
              {t("dialog.runNow")}
            </button>
            <span className="daily-hint">{msg("daily.runNowHint")}</span>
          </div>
        </section>

        {notice !== null && (
          <p className="daily-note" role="status">
            {notice}
          </p>
        )}
        {general !== null && (
          <p className="form-error daily-note" role="alert">
            {general}
          </p>
        )}
      </div>

      <div className="daily-buttons">
        <button
          type="button"
          className="btn"
          disabled={!ready || saving}
          onClick={() => {
            void apply().then((done) => {
              if (done) close();
            });
          }}
        >
          {t("dialog.ok")}
        </button>
        <button type="button" className="btn" onClick={close}>
          {t("dialog.cancel")}
        </button>
        <button type="button" className="btn" disabled={!ready || saving || !dirty} onClick={() => void apply()}>
          {t("dialog.apply")}
        </button>
      </div>
    </div>
  );
}

/** ลงทะเบียน Daily Forecast Settings เป็นหน้าต่างชนิด dailyForecastSettings (แทนตัวแทนชั่วคราว) ชื่อ ชนิด และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerDailyForecastSettingsPanel(): void {
  const base = getPanelDef("dailyForecastSettings");
  if (base === undefined) throw new Error('panel kind "dailyForecastSettings" is not registered');
  registerPanel("dailyForecastSettings", { ...base, component: DailyForecastSettings, size: { width: 600, height: 580 } });
}
