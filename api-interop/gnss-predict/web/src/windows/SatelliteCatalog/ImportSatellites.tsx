import { useEffect, useState } from "react";
import { apiGet, errorText } from "../../api/client";
import { useScenario } from "../../stores/scenario";

type ImportFormat = "norad" | "group" | "tle" | "omm" | "gpredict" | "gpredict_local";
type GpredictGroups = { total: number; groups: { name: string; count: number }[] };
const GROUPS = ["amateur", "stations", "visual", "weather", "noaa", "goes", "resource", "cubesat", "science", "education", "geo"];

/** Import and insert use the scenario's existing serialized ETag write queue. */
export function ImportSatellites({ initialFormat = "norad", initiallyOpen = false }: { initialFormat?: ImportFormat; initiallyOpen?: boolean } = {}) {
  const [format, setFormat] = useState<ImportFormat>(initialFormat);
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [norad, setNorad] = useState("");
  const [group, setGroup] = useState("amateur");
  const [gpredict, setGpredict] = useState<GpredictGroups | null>(null);
  const [gpredictGroup, setGpredictGroup] = useState("");
  const [batch, setBatch] = useState(1);
  const [batchSize, setBatchSize] = useState(999);
  const [replaceUnselected, setReplaceUnselected] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [addToScenario, setAddToScenario] = useState(initialFormat === "norad" || initialFormat === "tle" || initialFormat === "omm");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const active = useScenario(s => s.name !== null);
  const fileFormat = format === "tle" || format === "omm" || format === "gpredict";
  const selectedCount = gpredictGroup ? gpredict?.groups.find(g => g.name === gpredictGroup)?.count ?? 0 : gpredict?.total ?? 0;
  const pages = batchSize > 0 ? Math.ceil(selectedCount / batchSize) : 0;
  useEffect(() => {
    if (format !== "gpredict_local") return;
    const controller = new AbortController();
    setLookupError(null);
    apiGet<GpredictGroups>("/gpredict/groups", { signal: controller.signal }).then(({ data }) => {
      if (!Number.isSafeInteger(data.total) || !Array.isArray(data.groups)) throw new Error("รายชื่อกลุ่ม Gpredict ไม่ถูกต้อง");
      setGpredict(data);
      if (data.total > 999) {
        setGpredictGroup(current => current || (data.groups.find(g => g.name === "amateur") ?? data.groups[0])?.name || "");
        setBatchSize(100);
      }
    }).catch(e => { if (!controller.signal.aborted) setLookupError(errorText(e)); });
    return () => controller.abort();
  }, [format]);
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
    if (format === "gpredict_local" && (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 999 || !Number.isSafeInteger(batch) || batch < 1 || (pages > 0 && batch > pages))) {
      setError("เลือกจำนวนดาวต่อชุด 1–999 และหมายเลขชุดที่มีอยู่"); return;
    }
    setBusy(true);
    try {
      const created = await useScenario.getState().insert({ class: "Satellite", method: "Import Orbits", format,
        ...(format === "norad" ? { norad: number } : format === "group" ? { group: group.trim() } : fileFormat ? { text } : {}),
        ...(format === "gpredict_local" && (gpredictGroup !== "" || selectedCount > batchSize || batch > 1) ? { group: gpredictGroup, batch: batch - 1, batch_size: batchSize } : {}),
        ...(format === "gpredict_local" && replaceUnselected ? { replace_unselected: true } : {}),
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
  return <details className="custom-orbit-import" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
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
    {format === "gpredict_local" && <>
      <p>อ่านรายการปัจจุบันจาก Gpredict ในเครื่อง{gpredict ? ` ทั้งหมด ${gpredict.total.toLocaleString()} ดวง` : ""} เลือกกลุ่มหรือแบ่งชุดเพื่อนำเข้า กดนำเข้าอีกครั้งเพื่อรับข้อมูลรุ่นใหม่</p>
      {gpredict && <>
        <label>กลุ่มจาก Gpredict <select aria-label="กลุ่มจาก Gpredict" value={gpredictGroup} disabled={busy} onChange={e => { setGpredictGroup(e.target.value); setBatch(1); }}>
          <option value="">ทั้งหมด ({gpredict.total.toLocaleString()})</option>
          {gpredict.groups.map(g => <option key={g.name} value={g.name}>{g.name} ({g.count.toLocaleString()})</option>)}
        </select></label>
        <label>จำนวนดาวต่อชุด <input aria-label="จำนวนดาวต่อชุด" type="number" min={1} max={999} value={batchSize} disabled={busy} onChange={e => { setBatchSize(Number(e.target.value)); setBatch(1); }} /></label>
        <label>ชุดที่ <input aria-label="ชุดที่นำเข้า" type="number" min={1} max={pages || 1} value={batch} disabled={busy} onChange={e => setBatch(Number(e.target.value))} /> จาก {pages} ชุด</label>
        <p>เรียงตามหมายเลข NORAD ชุดละไม่เกิน 999 ดวง หากชุดข้อมูลเต็ม ให้ใช้ Scenario ใหม่หรือแทนที่รายการที่ยังไม่ได้ใช้ด้านล่าง</p>
      </>}
      {lookupError && <p role="alert" className="field-error">{lookupError}</p>}
    </>}
    {fileFormat && <>
      <label>เลือกไฟล์ <input aria-label="ไฟล์ TLE หรือ OMM JSON" type="file" accept=".tle,.txt,.json,.omm" disabled={busy} onChange={e => void readFile(e.target.files?.[0])} /></label>
      <textarea aria-label="ข้อมูล TLE หรือ OMM JSON" rows={5} value={text} disabled={busy} placeholder="วาง TLE, OMM JSON หรือ Gpredict satdb.json" onChange={e => setText(e.target.value)} />
    </>}
    <label><input type="checkbox" checked={addToScenario} disabled={busy} onChange={e => setAddToScenario(e.target.checked)} />เพิ่มดาวลง Scenario ทันที</label>
    {format === "gpredict_local" && <label><input type="checkbox" checked={replaceUnselected} disabled={busy} onChange={e => setReplaceUnselected(e.target.checked)} />แทนที่รายการนำเข้าเดิมที่ยังไม่ได้ใช้ใน Scenario นี้</label>}
    <p>รองรับดาวนำเข้า 999 ดวงต่อชุดข้อมูล คำนวณรวม GNSS ได้สูงสุด 999 ดวงต่อ Scenario ไฟล์ไม่เกิน 5 MB เก็บ snapshot เดิมไว้ นำเข้าซ้ำเพื่ออัปเดตข้อมูล</p>
    <button disabled={busy || !active} onClick={() => void importNow()}>{busy ? "กำลังนำเข้า…" : "นำเข้าและเพิ่มลง Scenario"}</button>
    {error && <p role="alert" className="field-error">{error}</p>}
    {done && <p role="status">{done}</p>}
  </details>;
}
