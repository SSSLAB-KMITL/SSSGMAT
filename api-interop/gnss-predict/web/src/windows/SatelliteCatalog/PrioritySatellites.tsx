import { useEffect, useMemo, useState } from "react";
import { apiGet, errorText } from "../../api/client";
import { useScenario } from "../../stores/scenario";

type Mission = { id: string; name: string; norad: number | null; aliases: string[]; mission_status: string; note: string; reference_url: string; orbit_available: boolean; orbit_epoch: string | null; catalog_name: string | null };
type Collection = { id: string; label: string; note: string; entries: Mission[] };
type Catalog = { checked_on: string; source_error: string | null; collections: Collection[] };

function status(row: Mission): string {
  if (row.mission_status === "launch_failed") return "นำส่งไม่สำเร็จ / ไม่มีวงโคจร";
  if (row.mission_status === "deorbited") return "กลับเข้าสู่บรรยากาศแล้ว";
  if (row.mission_status === "retired") return row.orbit_available ? "ยุติภารกิจ / มี TLE ติดตาม" : "ยุติภารกิจ / ไม่มี TLE ปัจจุบัน";
  return row.orbit_available ? "มีข้อมูลวงโคจร" : "ยังไม่มี TLE ในฐานข้อมูล";
}

export function PrioritySatellites({ initiallyOpen = false }: { initiallyOpen?: boolean } = {}) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [collectionId, setCollectionId] = useState("thai");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [addToScenario, setAddToScenario] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const active = useScenario(s => s.name !== null);
  useEffect(() => {
    if (!expanded || catalog !== null) return;
    const abort = new AbortController();
    apiGet<Catalog>("/satellite-collections", { signal: abort.signal }).then(({ data }) => {
      if (!Array.isArray(data.collections)) throw new Error("รายการดาวสำคัญไม่ถูกต้อง");
      setCatalog(data);
      const available = new Set(data.collections.flatMap(g => g.entries.filter(s => s.orbit_available && s.norad !== null).map(s => s.norad!)));
      setSelected(old => new Set([...old].filter(n => available.has(n))));
    }).catch(e => { if (!abort.signal.aborted) setError(errorText(e)); });
    return () => abort.abort();
  }, [expanded, catalog]);
  const collection = catalog?.collections.find(g => g.id === collectionId);
  const rows = useMemo(() => (collection?.entries ?? []).filter(s => {
    const needle = search.trim().toLowerCase();
    return !needle || [s.name, s.catalog_name ?? "", s.norad ?? "", ...s.aliases].join(" ").toLowerCase().includes(needle);
  }), [collection, search]);
  const toggle = (norad: number) => setSelected(old => {
    const next = new Set(old); if (next.has(norad)) next.delete(norad); else next.add(norad); return next;
  });
  const importNow = async () => {
    setBusy(true); setError(null); setDone(null);
    try {
      const created = await useScenario.getState().insert({ class: "Satellite", method: "Import Orbits", format: "priority", norads: [...selected], ...(!addToScenario ? { add_to_scenario: false } : {}) });
      setDone(`นำเข้ารายการสำคัญแล้ว เพิ่มดาวใหม่ ${created.length} ดวงลง Scenario รายการเดิมไม่ถูกสร้างซ้ำ`);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <details className="custom-orbit-import priority-satellites" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
    <summary>ดาวไทย / รายการสำคัญ</summary>
    {expanded && <>
      <p>เลือกติดตามวงโคจรและ Access ตามชื่อดาว รายการที่ไม่มีวงโคจรปัจจุบันแสดงไว้เพื่ออ้างอิง การเพิ่มดาวไม่ได้เพิ่มแหล่งภาพถ่ายเชิงพาณิชย์</p>
      <label>กลุ่มรายการสำคัญ <select aria-label="กลุ่มรายการสำคัญ" value={collectionId} disabled={busy || !catalog} onChange={e => { setCollectionId(e.target.value); setSearch(""); }}>
        {(catalog?.collections ?? []).map(g => <option key={g.id} value={g.id}>{g.label} ({g.entries.length})</option>)}
      </select></label>
      <label>ค้นชื่อ / ชื่ออื่น / NORAD <input aria-label="ค้นรายการสำคัญ" value={search} onChange={e => setSearch(e.target.value)} /></label>
      {!catalog && !error && <p role="status">กำลังโหลดรายการสำคัญ…</p>}
      {collection?.note && <p>{collection.note}</p>}
      {catalog?.source_error && <p role="alert">{catalog.source_error}</p>}
      {catalog && <>
        <div className="priority-scroll"><table className="catalog-table" aria-label="ทะเบียนดาวไทยและรายการสำคัญ"><thead><tr><th>เลือก</th><th>ดาวเทียม / ชื่ออื่น</th><th>NORAD</th><th>สถานะ</th><th>อ้างอิง</th></tr></thead><tbody>
          {rows.map(row => <tr key={row.id}>
            <td><input type="checkbox" aria-label={`เลือก ${row.name}`} disabled={busy || !row.orbit_available || row.norad === null} checked={row.norad !== null && selected.has(row.norad)} onChange={() => row.norad !== null && toggle(row.norad)} /></td>
            <td><strong>{row.name}</strong>{row.aliases.length > 0 && <div className="priority-note">{row.aliases.join(" · ")}</div>}</td>
            <td>{row.norad ?? "—"}</td><td>{status(row)}{row.note && <div className="priority-note">{row.note}</div>}{row.orbit_epoch && <div className="priority-note">TLE: {row.orbit_epoch}</div>}</td>
            <td><a href={row.reference_url} target="_blank" rel="noopener noreferrer">แหล่งข้อมูล</a></td>
          </tr>)}
        </tbody></table></div>
        {rows.length === 0 && <p>ไม่พบชื่อในกลุ่มนี้ ลองเปลี่ยนกลุ่มหรือค้นด้วยชื่ออื่น</p>}
        <button type="button" disabled={busy} onClick={() => setSelected(old => new Set([...old, ...rows.filter(s => s.orbit_available && s.norad !== null).map(s => s.norad!)]))}>เลือกทั้งหมดที่นำเข้าได้ในกลุ่มนี้</button>
        <button type="button" disabled={busy} onClick={() => setSelected(new Set())}>ล้างที่เลือก</button>
        <button type="button" disabled={busy} onClick={() => { setCatalog(null); setError(null); }}>โหลดสถานะล่าสุด</button>
        <label><input type="checkbox" checked={addToScenario} disabled={busy} onChange={e => setAddToScenario(e.target.checked)} />เพิ่มลง Scenario ทันที</label>
        <p>เลือกแล้ว {selected.size} ดวง · ตรวจทะเบียน {catalog.checked_on} · ใช้ TLE ล่าสุดจาก Gpredict เมื่อกดนำเข้า</p>
      </>}
      {!active && <p>สร้างหรือเปิด Scenario ก่อนนำเข้าดาวที่เลือก</p>}
      <button type="button" disabled={!active || busy || selected.size === 0} onClick={() => void importNow()}>{busy ? "กำลังนำเข้ารายการสำคัญ…" : "นำเข้าดาวที่เลือก"}</button>
      {error && <p role="alert" className="field-error">{error}</p>}
      {done && <p role="status">{done}</p>}
    </>}
  </details>;
}
