// Welcome to GNSS Studio (spec §11): Create a Scenario, รายการล่าสุด และ Open a Scenario (รายชื่อจาก GET /api/scenarios พร้อมช่วงเวลาและเครื่องหมายงานประจำวัน)
// รายการล่าสุดอยู่ก่อนรายชื่อทั้งหมด คลิกชื่อ = เปิด scenario นั้น (scenarioFiles.openScenario); เปิดสำเร็จแล้ว workbook ของมันแทนที่หน้าต่างนี้เอง
// ช่วงเวลาแสดงเป็น UTCG เสมอ (ยังไม่ได้เปิด scenario จึงยังไม่มี DateFormat ของ scenario ใด)

import { Check } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { apiGet, errorText } from "../../api/client";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import type { PanelProps } from "../../layout/panels";
import * as recent from "../../recent";
import { openScenario } from "../../scenarioFiles";
import { useLayout } from "../../stores/layout";
import { formatTime } from "../../time/format";
import { parseIsoUtc } from "../../time/parse";

interface ScenarioRow {
  name: string;
  start: string | null;
  stop: string | null;
  daily: boolean;
}

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; rows: ScenarioRow[] };

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

/** แถวที่ใช้ได้จากคำตอบของ server (ข้ามรายการที่ไม่มีชื่อ) */
function toRows(data: unknown): ScenarioRow[] {
  if (!Array.isArray(data)) return [];
  const rows: ScenarioRow[] = [];
  for (const item of data) {
    if (!isRecord(item) || typeof item.name !== "string" || item.name === "") continue;
    rows.push({
      name: item.name,
      start: typeof item.start === "string" ? item.start : null,
      stop: typeof item.stop === "string" ? item.stop : null,
      daily: item.daily === true,
    });
  }
  return rows;
}

const DASH = "—";

function utcg(iso: string | null): string {
  const d = iso === null ? null : parseIsoUtc(iso);
  return d === null ? DASH : formatTime(d, "UTCG", "+00:00");
}

export function Welcome(_props: Partial<PanelProps>) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [recentNames] = useState(() => recent.list());
  const [opening, setOpening] = useState(false);
  const recentId = useId();
  const openId = useId();

  useEffect(() => {
    const ctl = new AbortController();
    apiGet<unknown>("/scenarios", { signal: ctl.signal }).then(
      ({ data }) => setList({ status: "ready", rows: toRows(data) }),
      (e: unknown) => {
        if (!ctl.signal.aborted) setList({ status: "error", message: errorText(e) });
      },
    );
    return () => ctl.abort();
  }, []);

  const open = async (name: string): Promise<void> => {
    if (opening) return;
    setOpening(true);
    try {
      await openScenario(name);
    } finally {
      setOpening(false);
    }
  };

  const nameButton = (name: string) => (
    <button type="button" className="link-btn" disabled={opening} onClick={() => void open(name)}>
      {name}
    </button>
  );

  return (
    <div className="welcome">
      <div className="welcome-create">
        <button type="button" className="btn" onClick={() => useLayout.getState().openPanel("newScenarioWizard")}>
          {t("dialog.welcome.createScenario")}
        </button>
      </div>

      {recentNames.length > 0 && (
        <section aria-labelledby={recentId}>
          <h3 id={recentId} className="welcome-heading">
            {t("menu.file.recent")}
          </h3>
          <ul className="welcome-recent">
            {recentNames.map((name) => (
              <li key={name}>{nameButton(name)}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby={openId}>
        <h3 id={openId} className="welcome-heading">
          {t("dialog.welcome.openScenario")}
        </h3>
        {list.status === "loading" && <p className="welcome-note">{msg("welcome.loading")}</p>}
        {list.status === "error" && (
          <p className="form-error" role="alert">
            {msg("welcome.listFailed", { message: list.message })}
          </p>
        )}
        {list.status === "ready" && list.rows.length === 0 && <p className="welcome-note">{msg("welcome.empty")}</p>}
        {list.status === "ready" && list.rows.length > 0 && (
          <table className="welcome-table">
            <thead>
              <tr>
                <th>{t("field.name")}</th>
                <th>{t("field.analysisStart")}</th>
                <th>{t("field.analysisStop")}</th>
                <th>{t("status.dailyForecast")}</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.name}>
                  <td>{nameButton(row.name)}</td>
                  <td className="welcome-time">{utcg(row.start)}</td>
                  <td className="welcome-time">{utcg(row.stop)}</td>
                  <td className="welcome-daily">
                    {row.daily && <Check size={14} role="img" aria-label={t("status.dailyForecast")} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
