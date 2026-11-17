// About GNSS Studio (spec §11): รุ่น engine (จาก /health), รุ่น GMAT (gmat_version ใน manifest ของ ephem ปัจจุบัน), หมายเหตุว่าชื่อเมนูอ้างอิงคู่มือ STK 13.1.0
// และ GNSS Studio ไม่ใช่ผลิตภัณฑ์ของผู้พัฒนา STK และรายการชื่อทั้งหมดที่เพิ่มเอง (source "ours" ใน labels.ts) ตามเกณฑ์ข้อ 4 ของ spec §1
// ไม่รู้ค่า (ยังไม่มีคำตอบ /health หรือยังไม่มีผลลัพธ์ที่ใช้ได้) แสดง "—"

import { useId, useMemo } from "react";
import { oursLabels, t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import type { PanelProps } from "../../layout/panels";
import { useResults } from "../../stores/results";
import { useSettings } from "../../stores/settings";

const UNKNOWN = "—";

const known = (value: string | null | undefined): string => (typeof value === "string" && value !== "" ? value : UNKNOWN);

/** params และ panelId ไม่ใช้ (รับไว้ให้เป็น component ของทะเบียนหน้าต่างได้) */
export function About(_props: Partial<PanelProps>) {
  const engine = useSettings((s) => s.health?.engine_version);
  const gmat = useResults((s) => s.manifest?.gmat_version);
  const headingId = useId();
  // หลายคีย์ใช้ข้อความเดียวกันได้ ("Save" ของเมนูกับของแถบเครื่องมือ) แสดงครั้งเดียว
  const texts = useMemo(() => [...new Set(oursLabels().map((o) => o.text))], []);

  return (
    <div className="about">
      <dl className="about-versions">
        <dt>{t("help.engineVersion")}</dt>
        <dd className="about-value">{known(engine)}</dd>
        <dt>{t("help.gmatVersion")}</dt>
        <dd className="about-value">{known(gmat)}</dd>
      </dl>
      <p className="about-note">{msg("about.disclaimer")}</p>
      <h3 id={headingId} className="about-heading">
        {t("help.sourceOurs")}
      </h3>
      <ul className="about-ours" aria-labelledby={headingId}>
        {texts.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </div>
  );
}
