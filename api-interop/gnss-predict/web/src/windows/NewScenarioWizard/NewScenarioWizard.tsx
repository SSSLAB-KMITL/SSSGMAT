// New Scenario Wizard (spec §11): Name, Location (อ่านอย่างเดียว data/scenarios/), Start, Stop, Template, Orbit Data
// - Start ตั้งต้น = 00:00 UTC ของวันถัดไป, Stop ตั้งต้น = Start + 1 วัน; เวลาเป็นข้อความ UTCG (parseTime) ส่ง server เป็น ISO 8601 ลงท้าย Z
// - Template: THBK + ดาวทุกดวง 4 ระบบ (thbk-gnss) หรือ ว่าง (empty); Orbit Data: snapshot จาก GET /api/orbits (ใหม่สุดมาก่อน) ตั้งต้นใหม่สุด
// - ตรวจก่อนส่ง: ชื่อตามกติกา server, เวลาอ่านได้, Stop อยู่หลัง Start; ปัญหาขึ้นที่ช่องเป็นภาษาไทย
//   ข้อผิดพลาดของ server ที่ระบุ field (409 NAME_EXISTS, 422) ขึ้นที่ช่องนั้นด้วยข้อความของ server; ที่ไม่ระบุ field ขึ้นเหนือปุ่มและลง Message Viewer
// - สำเร็จ: เปิด scenario → ปิด wizard → เปิด Insert STK Objects (ตาม STK) ลำดับนี้สำคัญ เพราะการเปิด scenario แทนที่ทุกหน้าต่างด้วย workbook ของมัน

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiGet, apiSend, errorText } from "../../api/client";
import { FormField } from "../../chrome/FormField";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import type { PanelProps } from "../../layout/panels";
import { isScenarioName, openScenario } from "../../scenarioFiles";
import { report } from "../../stores/messages";
import { useLayout } from "../../stores/layout";
import { MS_PER_DAY, formatTime } from "../../time/format";
import { parseTime } from "../../time/parse";

type FieldName = "name" | "start" | "stop" | "template" | "snapshot";
type Errors = Partial<Record<FieldName, string>>;
type Template = "thbk-gnss" | "empty";
type Orbits = { status: "loading" } | { status: "ready"; names: string[] } | { status: "error"; message: string };

const FIELDS: ReadonlySet<string | null> = new Set<FieldName>(["name", "start", "stop", "template", "snapshot"]);
const isField = (f: string | null): f is FieldName => FIELDS.has(f);

/** เวลาในช่องเป็น UTCG เสมอ (ไม่มี scenario ที่ DateFormat จะเป็นอย่างอื่น) */
const show = (d: Date): string => formatTime(d, "UTCG", "+00:00");
const read = (text: string): Date | null => parseTime(text, "UTCG", "+00:00");
/** เวลา API: ISO 8601 UTC ลงท้าย Z (วินาทีเต็มไม่มีเศษ ตามที่ server ใช้) */
const iso = (d: Date): string => d.toISOString().replace(/\.000Z$/, "Z");

/** Start = 00:00 UTC ของวันถัดไป, Stop = Start + 1 วัน (คิดจากมิลลิวินาที UTC ไม่ขึ้นกับ timezone ของเครื่อง) */
function defaultPeriod(): { start: Date; stop: Date } {
  const start = new Date((Math.floor(Date.now() / MS_PER_DAY) + 1) * MS_PER_DAY);
  return { start, stop: new Date(start.getTime() + MS_PER_DAY) };
}

export function NewScenarioWizard({ panelId = "newScenarioWizard" }: Partial<PanelProps>) {
  const [initial] = useState(defaultPeriod);
  const [name, setName] = useState("");
  const [start, setStart] = useState(() => show(initial.start));
  const [stop, setStop] = useState(() => show(initial.stop));
  const [template, setTemplate] = useState<Template>("thbk-gnss");
  const [snapshot, setSnapshot] = useState("");
  const [orbits, setOrbits] = useState<Orbits>({ status: "loading" });
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    apiGet<unknown>("/orbits", { signal: ctl.signal }).then(
      ({ data }) => {
        const names = Array.isArray(data)
          ? data.map((o: unknown) => (typeof o === "object" && o !== null ? (o as { name?: unknown }).name : undefined)).filter((n): n is string => typeof n === "string")
          : [];
        setOrbits({ status: "ready", names });
        setSnapshot((current) => (current === "" ? (names[0] ?? "") : current)); // ใหม่สุดก่อน: ตัวแรกคือตั้งต้น
      },
      (e: unknown) => {
        if (!ctl.signal.aborted) setOrbits({ status: "error", message: errorText(e) });
      },
    );
    return () => ctl.abort();
  }, []);

  /** แก้ช่องนั้น = ข้อความผิดพลาดของช่องนั้นหายไป (ช่องอื่นคงเดิม) */
  const edit = <V,>(field: FieldName, set: (v: V) => void) => (value: V): void => {
    set(value);
    setErrors((e) => {
      const { [field]: _gone, ...rest } = e;
      return rest;
    });
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const found: Errors = {};
    if (!isScenarioName(name)) found.name = msg("scenario.nameInvalid");
    const startAt = read(start);
    const stopAt = read(stop);
    const example = show(initial.start);
    if (startAt === null) found.start = msg("time.invalid", { example });
    if (stopAt === null) found.stop = msg("time.invalid", { example });
    else if (startAt !== null && stopAt.getTime() <= startAt.getTime()) found.stop = msg("wizard.stopBeforeStart");
    setErrors(found);
    setGeneral(null);
    if (startAt === null || stopAt === null || Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await apiSend("POST", "/scenarios", {
        name, start: iso(startAt), stop: iso(stopAt), template, ...(snapshot !== "" ? { snapshot } : {}),
      });
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && isField(e.field)) {
        setErrors({ [e.field]: e.text });
      } else {
        const text = errorText(e);
        setGeneral(text);
        report("error", e instanceof ApiError ? e.code : "SCENARIO_CREATE", text);
      }
      return;
    }

    // สร้างแล้ว: เปิด (แทนที่ทุกหน้าต่างด้วย workbook ของมัน) → ปิด wizard → เปิด Insert STK Objects; เปิดไม่ได้ก็ปิด wizard (scenario มีอยู่จริงแล้ว เปิดทีหลังจาก Welcome ได้)
    const opened = await openScenario(name);
    const layout = useLayout.getState();
    layout.closePanel(panelId);
    if (opened) layout.openPanel("insertObjects");
    setBusy(false);
  };

  const noSnapshot = orbits.status === "ready" && orbits.names.length === 0;
  const orbitHint =
    orbits.status === "error" ? msg("wizard.orbitsFailed", { message: orbits.message }) : noSnapshot ? msg("wizard.noSnapshot") : undefined;

  return (
    <form className="form wizard" noValidate onSubmit={(e) => void submit(e)}>
      <FormField label={t("field.name")} error={errors.name}>
        {(control) => (
          <input
            {...control}
            type="text"
            value={name}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => edit("name", setName)(e.target.value)}
          />
        )}
      </FormField>
      <FormField label={t("field.location")}>
        {(control) => <input {...control} type="text" value="data/scenarios/" readOnly />}
      </FormField>
      <FormField label={t("field.analysisStart")} error={errors.start}>
        {(control) => (
          <input {...control} type="text" value={start} spellCheck={false} autoComplete="off" onChange={(e) => edit("start", setStart)(e.target.value)} />
        )}
      </FormField>
      <FormField label={t("field.analysisStop")} error={errors.stop}>
        {(control) => (
          <input {...control} type="text" value={stop} spellCheck={false} autoComplete="off" onChange={(e) => edit("stop", setStop)(e.target.value)} />
        )}
      </FormField>
      <FormField label={t("field.template")} error={errors.template}>
        {(control) => (
          <select {...control} value={template} onChange={(e) => edit("template", setTemplate)(e.target.value as Template)}>
            <option value="thbk-gnss">{t("option.template.thbkAll")}</option>
            <option value="empty">{t("option.template.empty")}</option>
          </select>
        )}
      </FormField>
      <FormField label={t("field.orbitData")} error={errors.snapshot} hint={orbitHint}>
        {(control) => (
          <select
            {...control}
            value={snapshot}
            disabled={orbits.status !== "ready" || noSnapshot}
            onChange={(e) => edit("snapshot", setSnapshot)(e.target.value)}
          >
            {orbits.status === "ready" && orbits.names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
      </FormField>
      {general !== null && (
        <div className="form-error form-general" role="alert">
          {general}
        </div>
      )}
      <div className="dlg-buttons">
        <button type="submit" className="btn" disabled={busy}>
          {t("dialog.ok")}
        </button>
        <button type="button" className="btn" onClick={() => useLayout.getState().closePanel(panelId)}>
          {t("dialog.cancel")}
        </button>
      </div>
    </form>
  );
}
