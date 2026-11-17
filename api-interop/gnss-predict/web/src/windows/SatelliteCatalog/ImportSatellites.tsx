import { useState } from "react";
import { errorText } from "../../api/client";
import { useScenario } from "../../stores/scenario";

type ImportFormat = "norad" | "group" | "tle" | "omm" | "gpredict" | "gpredict_local";
const GROUPS = ["amateur", "stations", "visual", "weather", "noaa", "goes", "resource", "cubesat", "science", "education", "geo"];

/** Import and insert use the scenario's existing serialized ETag write queue. */
export function ImportSatellites() {
  const [format, setFormat] = useState<ImportFormat>("norad");
  const [norad, setNorad] = useState("");
  const [group, setGroup] = useState("amateur");
  const [text, setText] = useState("");
  const [addToScenario, setAddToScenario] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const active = useScenario(s => s.name !== null);
  const fileFormat = format === "tle" || format === "omm" || format === "gpredict";
  const importNow = async () => {
    setError(null); setDone(null);
    const number = Number(norad);
    if (format === "norad" && (!/^\d+$/.test(norad.trim()) || !Number.isSafeInteger(number) || number < 1 || number > 339999)) {
      setError("หมายเลข NORAD ต้องเป็นจำนวนเต็ม 1–339999"); return;
    }
    if (format === "group" && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(group.trim())) {
      setError("ชื่อกลุ่มต้องเป็น a-z, 0-9 หรือ - ยาวไม่เกิน 40 ตัว"); return;
    }
    if (fileFormat && !text.trim()) { setError("กรุณาวางข้อมูลหรือเลือกไฟล์วงโคจร"); return; }
    setBusy(true);
    try {
      const created = await useScenario.getState().insert({ class: "Satellite", method: "Import Orbits", format,
        ...(format === "norad" ? { norad: number } : format === "group" ? { group: group.trim() } : fileFormat ? { text } : {}),
        ...(!addToScenario ? { add_to_scenario: false } : {}) });
      setDone(`นำเข้าข้อมูลลง Catalog สำเร็จ เพิ่มดาวใหม่ ${created.length} ดวงลง Scenario แล้ว ดาวที่มีอยู่จะไม่ถูกสร้างซ้ำ${!addToScenario ? " เลือกดาวจากตารางเพื่อเพิ่มลง Scenario ได้" : ""}`);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    setError(null); setDone(null);
    if (file.size > 5 * 1024 * 1024) { setError("ไฟล์ต้องไม่เกิน 5 MB"); return; }
    try {
      const value = await file.text();
      let detected: ImportFormat = "tle";
      if (value.trimStart().startsWith("[") || value.trimStart().startsWith("{")) {
        detected = "omm";
        try {
          const parsed: unknown = JSON.parse(value.trimStart());
          if (parsed && typeof parsed === "object" && "satellites" in parsed && "version" in parsed) detected = "gpredict";
        } catch { /* Server provides the detailed validation error when submitted. */ }
      }
      setFormat(detected); setText(value);
    } catch (e) { setError(errorText(e)); }
  };
  return <details className="custom-orbit-import">
    <summary>เพิ่มดาวด้วย NORAD หรือไฟล์ TLE / OMM</summary>
    <p>นำเข้าดาวทั่วไปและรายการจาก Gpredict แล้วคำนวณวงโคจรและ Access ด้วย GMAT ได้ ดาวทั่วไปจะไม่รวมใน DOP</p>
    <label>แหล่งข้อมูล <select aria-label="รูปแบบข้อมูลวงโคจร" value={format} disabled={busy} onChange={e => {
      const next = e.target.value as ImportFormat;
      setFormat(next); setAddToScenario(next === "norad" || next === "tle" || next === "omm"); setDone(null); setError(null);
    }}>
      <option value="norad">ดึงจาก CelesTrak ด้วย NORAD</option>
      <option value="group">ดึงทั้งกลุ่มจาก CelesTrak</option>
      <option value="gpredict_local">ใช้รายการจาก Gpredict ในเครื่อง</option>
      <option value="tle">TLE</option><option value="omm">OMM JSON</option>
      <option value="gpredict">ไฟล์ Gpredict satdb.json</option>
    </select></label>
    {format === "norad" && <label> NORAD <input aria-label="NORAD ที่ต้องการเพิ่ม" inputMode="numeric" value={norad} placeholder="เช่น 25544" disabled={busy} onChange={e => setNorad(e.target.value)} /></label>}
    {format === "group" && <label>กลุ่ม CelesTrak <input aria-label="กลุ่ม CelesTrak" list="custom-celestrak-groups" value={group} disabled={busy} onChange={e => setGroup(e.target.value)} /><datalist id="custom-celestrak-groups">{GROUPS.map(g => <option key={g} value={g} />)}</datalist></label>}
    {format === "gpredict_local" && <p>อ่านรายการปัจจุบันจาก Gpredict ที่เชื่อมไว้ในเครื่อง กดนำเข้าอีกครั้งเพื่อรับข้อมูลรุ่นใหม่ หากยังไม่เชื่อม ให้ใช้ไฟล์ satdb.json</p>}
    {fileFormat && <>
      <label>เลือกไฟล์ <input aria-label="ไฟล์ TLE หรือ OMM JSON" type="file" accept=".tle,.txt,.json,.omm" disabled={busy} onChange={e => void readFile(e.target.files?.[0])} /></label>
      <textarea aria-label="ข้อมูล TLE หรือ OMM JSON" rows={5} value={text} disabled={busy} placeholder="วาง TLE, OMM JSON หรือ Gpredict satdb.json" onChange={e => setText(e.target.value)} />
    </>}
    <label><input type="checkbox" checked={addToScenario} disabled={busy} onChange={e => setAddToScenario(e.target.checked)} />เพิ่มดาวลง Scenario ทันที</label>
    <p>รองรับดาวนำเข้า 999 ดวงต่อชุดข้อมูล คำนวณรวม GNSS ได้สูงสุด 999 ดวงต่อ Scenario ไฟล์ไม่เกิน 5 MB เก็บ snapshot เดิมไว้ นำเข้าซ้ำเพื่ออัปเดตข้อมูล</p>
    <button disabled={busy || !active} onClick={() => void importNow()}>{busy ? "กำลังนำเข้า…" : "นำเข้าและเพิ่มลง Scenario"}</button>
    {error && <p role="alert" className="field-error">{error}</p>}
    {done && <p role="status">{done}</p>}
  </details>;
}
