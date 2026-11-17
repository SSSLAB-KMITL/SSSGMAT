import { useState } from "react";
import { errorText } from "../../api/client";
import { useScenario } from "../../stores/scenario";

/** Import and insert use the scenario's existing serialized ETag write queue. */
export function ImportSatellites() {
  const [format, setFormat] = useState<"norad" | "tle" | "omm">("norad");
  const [norad, setNorad] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const active = useScenario(s => s.name !== null);
  const importNow = async () => {
    setError(null); setDone(null);
    const number = Number(norad);
    if (format === "norad" && (!/^\d+$/.test(norad.trim()) || !Number.isSafeInteger(number) || number < 1 || number > 339999)) {
      setError("หมายเลข NORAD ต้องเป็นจำนวนเต็ม 1–339999"); return;
    }
    if (format !== "norad" && !text.trim()) { setError("กรุณาวางข้อมูลหรือเลือกไฟล์ TLE / OMM JSON"); return; }
    setBusy(true);
    try {
      const created = await useScenario.getState().insert({ class: "Satellite", method: "Import Orbits", format,
        ...(format === "norad" ? { norad: number } : { text }) });
      setDone(`นำเข้าข้อมูลสำเร็จ เพิ่มดาวใหม่ ${created.length} ดวงลง Scenario แล้ว ดาวที่มีอยู่จะไม่ถูกสร้างซ้ำ`);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    setError(null); setDone(null);
    if (file.size > 5 * 1024 * 1024) { setError("ไฟล์ต้องไม่เกิน 5 MB"); return; }
    try {
      const value = await file.text();
      setFormat(value.trimStart().startsWith("[") || value.trimStart().startsWith("{") ? "omm" : "tle");
      setText(value);
    } catch (e) { setError(errorText(e)); }
  };
  return <details className="custom-orbit-import">
    <summary>เพิ่มดาวด้วย NORAD หรือไฟล์ TLE / OMM</summary>
    <p>นำเข้าดาวทั่วไป เช่น ISS, CubeSat หรือ Starlink แล้วคำนวณวงโคจรและ Access ด้วย GMAT ได้ ดาวทั่วไปจะไม่รวมใน DOP</p>
    <label>แหล่งข้อมูล <select aria-label="รูปแบบข้อมูลวงโคจร" value={format} disabled={busy} onChange={e => setFormat(e.target.value as typeof format)}>
      <option value="norad">ดึงจาก CelesTrak ด้วย NORAD</option><option value="tle">TLE</option><option value="omm">OMM JSON</option>
    </select></label>
    {format === "norad" ? <label> NORAD <input aria-label="NORAD ที่ต้องการเพิ่ม" inputMode="numeric" value={norad} placeholder="เช่น 25544" disabled={busy} onChange={e => setNorad(e.target.value)} /></label> : <>
      <label>เลือกไฟล์ <input aria-label="ไฟล์ TLE หรือ OMM JSON" type="file" accept=".tle,.txt,.json,.omm" disabled={busy} onChange={e => void readFile(e.target.files?.[0])} /></label>
      <textarea aria-label="ข้อมูล TLE หรือ OMM JSON" rows={5} value={text} disabled={busy} placeholder="วาง TLE 2/3 บรรทัด หรือ OMM JSON" onChange={e => setText(e.target.value)} />
    </>}
    <p>เก็บเป็นข้อมูลวงโคจรชุดใหม่ของ Scenario นี้ โดยคง snapshot เดิมไว้ นำเข้าดาวเดิมอีกครั้งเพื่ออัปเดตข้อมูล รองรับดาวทั่วไปสูงสุด 99 ดวงต่อชุดข้อมูล ไฟล์ไม่เกิน 5 MB</p>
    <button disabled={busy || !active} onClick={() => void importNow()}>{busy ? "กำลังนำเข้า…" : "นำเข้าและเพิ่มลง Scenario"}</button>
    {error && <p role="alert" className="field-error">{error}</p>}
    {done && <p role="status">{done}</p>}
  </details>;
}
