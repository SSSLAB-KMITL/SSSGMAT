import { useEffect, useState } from "react";
import { errorText, request } from "../api";
import { FloatingWindow } from "./FloatingWindow";

interface Stats { rms: number; max: number; p95: number }
interface Metrics { samples: number; visible_samples: number; position_m: Stats | null; az_deg: Stats | null; el_deg: Stats | null }
interface Result {
  norad: number; name: string; tle_key: string; tle_epoch: string; status: string; note: string; mode?: string; compared_tle_epoch?: string;
  metrics: Metrics | null;
  change: (Metrics & { previous_epoch: string }) | null;
  reference: { source: string; url: string; kind: string; start: string; stop: string; created_at: string | null } | null;
}
interface Quality {
  settings: { enabled: boolean; interval_hours: number; compare_after_update: boolean };
  job: { state?: string; stage?: string; error?: string | null; started_at?: string; finished_at?: string };
  next_update_at: string | null;
  summary: { total: number; older_than_48h: number; older_than_7d: number };
  satellites: { norad: number; name: string; tle_key: string; age_hours: number; epoch: string; freshness: string }[];
  report: { checked_at?: string; module?: string | null; gnss_day?: string; qth?: string | null; omitted_count?: number;
    warnings?: string[]; rows?: Result[]; refresh?: { updated: number; new: number; skipped: number; missing: number; messages: { text: string }[] } | null };
}
export const qualityTime = (value?: string | null) => value ? `${value.replace("T", " ").slice(0, 19)} UTC` : "ยังไม่มี";
export const referenceLabel = (row?: Result) => !row?.reference ? "ยังไม่มีอ้างอิง" :
  row.reference.kind === "observed_sp3" ? "IGS / MGEX observed" : "NASA ISS (ประมาณการ)";
export const qualityNumber = (value?: number | null, digits = 1) => value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits });

/** Persisted server-side schedule and residuals. A residual is never presented as a guarantee of absolute accuracy. */
export function OrbitQuality({ module, satellites, onClose }: { module: string | null; satellites: number[]; onClose: () => void }) {
  const [data, setData] = useState<Quality | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let live = true;
    let pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try { const next = await request<Quality>("GET", "/api/quality"); if (live) { setData(next); setError(null); } }
      catch (e) { if (live) setError(errorText(e)); }
      finally { pending = false; }
    };
    void read();
    const timer = setInterval(() => void read(), 2500);
    return () => { live = false; clearInterval(timer); };
  }, []);
  const run = async (action: string) => {
    setSending(true); setError(null);
    try {
      await request("POST", "/api/quality/run", { action, module: all ? null : module });
      setData(await request<Quality>("GET", "/api/quality"));
    } catch (e) { setError(errorText(e)); }
    finally { setSending(false); }
  };
  const configure = async (settings: Partial<Quality["settings"]>) => {
    setSending(true);
    try { setData(await request<Quality>("PUT", "/api/quality/settings", settings)); setError(null); }
    catch (e) { setError(errorText(e)); }
    finally { setSending(false); }
  };
  const busy = sending || data?.job.state === "running";
  const results = new Map(data?.report.rows?.map(row => [row.norad, row]));
  const ids = new Set(satellites);
  const rows = data?.satellites.filter(row => (all || module === null || ids.has(row.norad)) &&
    `${row.name} ${row.norad}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const detail = selected === null ? undefined : results.get(selected);
  const exportReport = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "gpredict-orbit-quality.json"; a.click(); URL.revokeObjectURL(url);
  };
  return <FloatingWindow title="คุณภาพวงโคจรและการตรวจเทียบ" onClose={onClose} width={1000}>
    <div className="dialog orbit-quality">
      <p>อัปเดตวงโคจรจากแหล่งข้อมูล และตรวจเทียบกับข้อมูลอ้างอิงที่มีสำหรับดาวแต่ละดวง</p>
      {error && <p role="alert" className="dialog-error">{error}</p>}
      {data && <>
        <div className="quality-summary">
          <span>ดาวในฐานข้อมูล <b>{data.summary.total}</b></span>
          <span>อายุเกิน 48 ชม. <b>{data.summary.older_than_48h}</b></span>
          <span>อายุเกิน 7 วัน <b>{data.summary.older_than_7d}</b></span>
        </div>
        <fieldset className="quality-settings"><legend>อัปเดตอัตโนมัติขณะ server เปิดอยู่</legend>
          <label><input type="checkbox" checked={data.settings.enabled} disabled={sending} onChange={e => void configure({ enabled: e.target.checked })} /> เปิดการอัปเดตวงโคจร</label>
          <label> ทุก <select value={data.settings.interval_hours} disabled={sending} onChange={e => void configure({ interval_hours: Number(e.target.value) })}>
            {[...new Set([2, 6, 12, 24, data.settings.interval_hours])].sort((a,b) => a-b).map(n => <option key={n} value={n}>{n} ชั่วโมง</option>)}
          </select></label>
          <label><input type="checkbox" checked={data.settings.compare_after_update} disabled={sending} onChange={e => void configure({ compare_after_update: e.target.checked })} /> ตรวจเทียบหลังอัปเดต</label>
        </fieldset>
        <div className="quality-controls">
          <button className="button" disabled={busy} onClick={() => void run("cycle")}>อัปเดตและตรวจเทียบตอนนี้</button>
          <button className="button" disabled={busy} onClick={() => void run("compare")}>ตรวจเทียบข้อมูลที่ใช้อยู่</button>
          <button className="button" onClick={exportReport}>ดาวน์โหลดผล JSON</button>
        </div>
        <p className="quality-job" role="status">{data.job.state === "running" ? `กำลัง${data.job.stage === "updating" ? "อัปเดตวงโคจร" : data.job.stage === "comparing" ? "ตรวจเทียบอ้างอิง" : "เตรียมข้อมูล"}…` :
          data.job.state === "failed" || data.job.state === "interrupted" ? `งานล่าสุดไม่สำเร็จ: ${data.job.error}` :
          data.job.state === "succeeded" ? "งานล่าสุดเสร็จแล้ว — ตรวจสถานะแหล่งอ้างอิงรายดวงด้านล่าง" : "ยังไม่ได้ตรวจเทียบ"}
          <br />เริ่มงานล่าสุด: {qualityTime(data.job.started_at)} · รอบถัดไป: {data.settings.enabled ? data.next_update_at ? qualityTime(data.next_update_at) : "ภายใน 1 นาทีหลังเปิด server" : "ปิดอยู่"}
        </p>
        {data.report.refresh && <p>รอบอัปเดตล่าสุด: เปลี่ยนข้อมูล {data.report.refresh.updated} ดวง · เพิ่มใหม่ {data.report.refresh.new} ดวง · คงเดิม {data.report.refresh.skipped} ดวง · ไม่พบใน source {data.report.refresh.missing} ดวง</p>}
        {data.report.refresh?.messages.map((m,i) => <p key={`fetch-${i}`} className="notice-warning">{m.text}</p>)}
        {data.report.warnings?.map((m,i) => <p key={i} className="notice-warning">{m}</p>)}
        <div className="quality-controls">
          <input aria-label="ค้นหาดาวในผลตรวจ" placeholder="ค้นหาชื่อดาว / NORAD" value={search} onChange={e => setSearch(e.target.value)} />
          <label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> แสดงฐานข้อมูลทั้งหมด</label>
          <span>{all ? "ตรวจเทียบดาวใน module ที่เปิดอยู่" : module ? `Module: ${module}` : "ตรวจเทียบดาวใน module ที่เปิดอยู่"}</span>
        </div>
        <p>ผลตรวจ: {qualityTime(data.report.checked_at)} · สถานี: {data.report.qth ?? "ไม่มี"} · GNSS ตรวจย้อนหลังวันที่ {data.report.gnss_day ?? "—"} UTC</p>
        {!!data.report.omitted_count && <p className="notice-warning">รอบนี้ตรวจได้สูงสุด 200 ดวง ยังเหลือ {data.report.omitted_count} ดวง ให้เลือก module ที่ต้องการตรวจ</p>}
        <div className="quality-table"><table>
          <thead><tr><th>ดาว / NORAD</th><th>Epoch TLE (UTC)</th><th>อายุ (ชม.)</th><th>อ้างอิง</th><th>Δ3D RMS / Max (ม.)</th><th>ΔTLE เดิม Max (กม.)</th></tr></thead>
          <tbody>{rows.map(sat => { const r = results.get(sat.norad); return <tr key={sat.norad} className={sat.freshness === "stale" ? "quality-stale" : ""}>
            <td><button className="quality-sat" onClick={() => setSelected(sat.norad)}>{sat.name}</button><br />{sat.norad}</td>
            <td>{qualityTime(sat.epoch)}</td><td>{qualityNumber(sat.age_hours)}</td>
            <td>{referenceLabel(r)}{r && r.tle_key !== sat.tle_key && <small> · ผลตรวจจาก TLE ชุดก่อน</small>}{r?.status === "insufficient_data" && <small> · คู่ข้อมูลไม่พอ</small>}{r?.mode === "hindcast" && <small> · ย้อนหลัง</small>}</td>
            <td>{qualityNumber(r?.metrics?.position_m?.rms)} / {qualityNumber(r?.metrics?.position_m?.max)}</td>
            <td>{r?.change?.position_m ? qualityNumber(r.change.position_m.max / 1000, 3) : "ยังไม่มี TLE ชุดก่อน"}</td>
          </tr>; })}</tbody>
        </table></div>
        {detail && <div className="quality-detail">
          <b>{detail.name} ({detail.norad})</b><p>{detail.note}</p>
          {detail.reference && <p>แหล่งอ้างอิง: <a href={detail.reference.url} target="_blank" rel="noreferrer">{detail.reference.source}</a><br />ครอบคลุม {qualityTime(detail.reference.start)} ถึง {qualityTime(detail.reference.stop)}<br />{detail.reference.created_at && <>จัดทำเมื่อ {qualityTime(detail.reference.created_at)}<br /></>}TLE ที่นำมาเทียบ: {qualityTime(detail.compared_tle_epoch ?? detail.tle_epoch)}</p>}
          {detail.metrics && detail.reference?.kind === "operator_ephemeris" && <p>เทียบ {detail.metrics.samples} จุด · ISS แสดงผลต่างตำแหน่งสามมิติเท่านั้น</p>}
          {detail.metrics && detail.reference?.kind !== "operator_ephemeris" && <p>เทียบ {detail.metrics.samples} จุด · ΔAz สูงสุด {qualityNumber(detail.metrics.az_deg?.max, 4)}° · ΔEl สูงสุด {qualityNumber(detail.metrics.el_deg?.max, 4)}° (เฉพาะอ้างอิง El ≥ 10°, Az ใช้ El &lt; 80°)</p>}
        </div>}
      </>}
      {!data && !error && <p role="status">กำลังอ่านสถานะ…</p>}
      <p className="quality-explanation">ΔTLE เดิมคือความเปลี่ยนแปลงระหว่างข้อมูลสองชุด ไม่ใช่ความคลาดจากตำแหน่งจริง · IGS ใช้ตำแหน่ง observed SP3 ที่เผยแพร่ย้อนหลัง ส่วน NASA ISS เป็นประมาณการจากผู้ควบคุม · ดาวที่ไม่มีอ้างอิงยังไม่ได้ยืนยันความแม่นยำ</p>
      <div className="dialog-buttons"><button className="button" onClick={onClose}>ปิด</button></div>
    </div>
  </FloatingWindow>;
}
