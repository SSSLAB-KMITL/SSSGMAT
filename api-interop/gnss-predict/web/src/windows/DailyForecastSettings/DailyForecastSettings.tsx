// Daily Forecast Settings (spec §11, เพิ่มเอง): ค่าตั้งงานประจำวันตาม server §9.1, สถานะงานประจำวัน, ที่อยู่ไฟล์ CSV สำหรับงาน TEC และปุ่ม Run Now
// - ช่องครบทุกตัวของ §9.1: enabled, run_at_utc (HH:MM), facility (กติกาชื่อ object), retention_days 1-3650, validation_retry_hours 1-168,
//   validation_give_up_days 1-365 และ Cesium Ion token (ช่องรหัสผ่าน) ตรวจก่อนส่งด้วยกติกาเดียวกับ server ข้อความไทยขึ้นที่ช่อง
// - Apply = PUT /settings ทั้งก้อน (server ต้องการครบทุกช่อง) 422 ที่ field แบบ `daily.run_at_utc` ขึ้นที่ช่องนั้น (ขอบแดง) OK = Apply แล้วปิด
// - `online_imagery` (สวิตช์ภาพออนไลน์ทั้งสี่แหล่ง) ไม่ใช่ช่องของหน้าต่างนี้ แต่ PUT ต้องส่งครบทั้งเอกสาร: Apply ใช้ useImagery.updateSettings
//   (GET /settings ใหม่ แล้ว PUT) ส่งสวิตช์ที่ server มีตอนนั้นคืนไปตามเดิม ไม่เปิดและไม่ปิดให้ (สวิตช์ที่ปิดจากแท็บอื่น, curl หรือแก้ไฟล์ จึงไม่ถูกเขียนกลับเป็นเปิด)
//   และสวิตช์ของหน้านี้ตามเอกสารที่บันทึก
// - token ของ Cesium ion แก้ได้จาก Globe Manager ด้วย (บันทึกลง store ตัวเดียวกัน): ช่อง token ที่ผู้ใช้ยังไม่ได้แก้ในหน้าต่างนี้ตามค่าที่ store ถืออยู่เสมอ
//   (store เปลี่ยนระหว่างที่หน้าต่างเปิดอยู่ = ช่องเปลี่ยนตาม และไม่นับเป็นการแก้) Apply ส่ง token ที่เพิ่งอ่านจาก server เมื่อช่องไม่ได้ถูกแก้
//   จึงไม่ส่ง token เก่าที่ฟอร์มอ่านมาตอนเปิดไปทับ token ใหม่ ; token ที่ผู้ใช้พิมพ์เองในหน้านี้ถูกเก็บและส่งตามที่พิมพ์
// - แสดงเวลาตาม DateFormat ของ scenario ที่เปิดอยู่ (ไม่มี = UTCG) สถานะมาจาก event `daily` ของ SSE (useJobs.daily) หรือ /health ตอนเปิดหน้าต่าง
//   ที่อยู่ CSV = `<data_dir>/daily/latest.csv` แสดงเป็นข้อความ (data_dir มาจาก /health)
// - ผู้ใช้ห้ามถูกดาวน์โหลดโดยไม่ยินยอม: การเปิดหน้าต่างไม่ดึงอะไร Apply ถามยืนยันก่อนเมื่อการบันทึกอาจให้ server เริ่มดาวน์โหลดเอง (เปิดงาน = ตรวจย้อนหลังจาก CDDIS เสมอ,
//   ถึง run_at_utc แล้ว = พยากรณ์ด้วย; ดู consentNeeded) Run Now ถามยืนยันเป็นภาษาไทยก่อนทุกครั้ง แล้วจึง POST /daily/run
//   (ไม่มี body = วันถัดไปตาม UTC) ใส่ job เป็น queued ใน useJobs; 409 (มี job ของวันนั้นอยู่แล้ว) ได้ข้อความไทย Run Now ใช้ค่าที่บันทึกแล้ว ไม่ใช่ค่าที่แก้ค้าง
// - เปิดงานประจำวัน (enabled) แล้วแสดงคำเตือนไทยว่า ถ้า server เริ่มหลังเวลา run_at_utc (ก่อน 24:00 UTC) จะดาวน์โหลดทันที (server §9.3)

import { useEffect, useRef, useState } from "react";
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
import { isActiveJob, useJobs } from "../../stores/jobs";
import { useImagery } from "../../stores/imagery";
import { useLayout } from "../../stores/layout";
import { report } from "../../stores/messages";
import { useSettings, type OnlineImagerySettings, type Settings } from "../../stores/settings";
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

/**
 * ตรวจทุกช่อง (ครบทุกข้อผิดพลาดในครั้งเดียว) ผ่านหมด = เอกสารที่ส่ง PUT ได้ทั้งก้อน
 * `onlineImagery` ไม่ใช่ช่องของหน้าต่างนี้ (สวิตช์อยู่ที่ Globe Manager): ส่งคืนไปตามที่ได้มา ห้ามเปลี่ยน (PUT ต้องส่งครบทั้งเอกสาร)
 */
function validate(d: Draft, onlineImagery: OnlineImagerySettings): { errors: Errors; doc: Settings | null } {
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
      online_imagery: { ...onlineImagery },
    },
  };
}

/** เวลา UTC ของ run_at_utc ("HH:MM") ในวันเดียวกับ now */
const todayAt = (now: Date, hhmm: string): number => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));

/**
 * การบันทึกนี้อาจทำให้ server เริ่มดาวน์โหลดเองภายในประมาณ 60 วินาทีไหม (ตัวตั้งเวลาอ่านค่าตั้งใหม่ทุก tick):
 * - validation: เพิ่งเปิดงาน (false -> true) ไม่ว่ากี่โมง เพราะขั้นตรวจย้อนหลัง (server §9.4) อ่าน SP3 ของ MGEX จาก CDDIS ของวันที่ผ่านมาได้ทันที
 * - forecast: ค่าที่จะบันทึก enabled และ (เพิ่งเปิด หรือเปลี่ยน run_at_utc) และเวลา UTC ตอนนี้ถึง run_at_utc ใหม่ของวันนี้แล้ว (server §9.3: now >= run_at_utc
 *   ก่อน 24:00 UTC และยังไม่มีผลของวันถัดไป จึงสั่ง job daily ของวันถัดไป)
 * แก้ช่องอื่นขณะเปิดอยู่แล้ว หรือปิดงาน ไม่ถาม เพราะไม่ได้ทำให้เริ่มงานที่ไม่เคยเริ่ม
 */
function consentNeeded(saved: Draft, next: Settings, now: Date): { forecast: boolean; validation: boolean } {
  const { enabled, run_at_utc: runAt } = next.daily;
  if (!enabled) return { forecast: false, validation: false };
  const switchedOn = !saved.enabled;
  return { validation: switchedOn, forecast: (switchedOn || runAt !== saved.runAt) && now.getTime() >= todayAt(now, runAt) };
}

/** คำถามของกล่องยืนยันก่อนบันทึก (ส่วนที่เข้าเงื่อนไขตามลำดับ แล้วคำถาม); null = ไม่ต้องถาม */
function consentQuestion(saved: Draft, next: Settings, now: Date): string | null {
  const need = consentNeeded(saved, next, now);
  if (!need.forecast && !need.validation) return null;
  const parts = [
    ...(need.forecast ? [msg("daily.confirmForecast", { time: next.daily.run_at_utc })] : []),
    ...(need.validation ? [msg("daily.confirmValidation")] : []),
    msg("daily.confirmSave"),
  ];
  return parts.join("\n\n");
}

/** `<data_dir>/daily/latest.csv` ใช้ตัวคั่นแบบเดียวกับ data_dir (Windows ใช้ \) */
function csvPath(dataDir: string): string {
  const sep = dataDir.includes("\\") && !dataDir.includes("/") ? "\\" : "/";
  return `${dataDir.replace(/[\\/]+$/, "")}${sep}daily${sep}latest.csv`;
}

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
  const dailyJobActive = useJobs((s) => Object.values(s.jobs).some((j) => j.kind === "daily" && isActiveJob(j)));
  // งานรันอยู่ได้แม้ไม่มี record ของ job ในหน้านี้ (เปิดหน้าเว็บกลางงาน หรือ SSE ยังไม่ส่ง): สถานะ running จาก /health หรือ event daily ก็ห้ามสั่งซ้ำ
  const dailyActive = dailyJobActive || daily?.state === "running";

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

  // token ที่ store ถืออยู่ (Globe Manager บันทึกลง store ตัวนี้เหมือนกัน): ช่องที่ผู้ใช้ยังไม่ได้แก้ (ค่าในช่อง = ค่าฐาน) ตามไปทั้งฐานและช่อง ช่องที่แก้แล้วไม่ถูกแตะ
  const storeToken = useSettings((s) => s.settings?.cesium_ion_token);
  const baseToken = useRef(base.token);
  baseToken.current = base.token;
  useEffect(() => {
    if (storeToken === undefined || storeToken === baseToken.current) return;
    const before = baseToken.current;
    setBase((b) => ({ ...b, token: storeToken }));
    setDraft((d) => (d.token === before ? { ...d, token: storeToken } : d));
  }, [storeToken]);

  const dirty = !sameDraft(draft, base);
  const ready = phase === "ready";

  const edit = <K extends Key>(key: K, value: Draft[K]): void => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors(({ [key]: _gone, ...rest }) => rest);
    setNotice(null);
  };

  const close = (): void => useLayout.getState().closePanel(panelId);

  /** Apply: true = ไม่มีอะไรค้าง (บันทึกแล้ว หรือไม่มีอะไรเปลี่ยน); ไม่ยินยอมในกล่องถาม = false ไม่ส่งอะไร */
  const apply = async (): Promise<boolean> => {
    if (saving || !ready) return false;
    if (!dirty) return true;
    const current = useSettings.getState().settings;
    if (current === null) return false;
    const tokenEdited = draft.token !== base.token;
    const result = validate(draft, current.online_imagery);
    setErrors(result.errors);
    setGeneral(null);
    setNotice(null);
    if (result.doc === null) return false;
    setSaving(true); // ระหว่างถามก็นับว่ากำลังบันทึก: กด Apply ซ้ำไม่ได้
    try {
      const question = consentQuestion(base, result.doc, new Date());
      if (question !== null && !(await confirm(question))) return false;
      const doc = result.doc;
      // GET ใหม่แล้ว PUT: สวิตช์ภาพออนไลน์ตามที่ server มีตอนนี้ (ไม่ใช่ที่ store ถือ ซึ่งอาจเก่า: แท็บอื่น, curl, แก้ไฟล์)
      // token ที่ไม่ได้แก้ในหน้านี้ = ค่าที่เพิ่งอ่านจาก server (กัน token ที่ฟอร์มอ่านมาตอนเปิดไปทับ token ที่บันทึกจากที่อื่นไปแล้ว)
      await useImagery.getState().updateSettings((fresh) => ({
        ...doc,
        cesium_ion_token: tokenEdited ? doc.cesium_ion_token : fresh.cesium_ion_token,
        online_imagery: { ...fresh.online_imagery },
      }));
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
            <button
              type="button"
              className="btn"
              disabled={running || dailyActive}
              title={dailyActive ? msg("daily.runningNow") : undefined}
              onClick={() => void runNow()}
            >
              {t("dialog.runNow")}
            </button>
            <span className="daily-hint">{dailyActive ? msg("daily.runningNow") : msg("daily.runNowHint")}</span>
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
