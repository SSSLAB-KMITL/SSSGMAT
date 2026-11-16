import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { request, Studio, useStudio, type Scene } from "./state";
import type { Sample } from "./HighResolution";
import type { GroundTarget } from "./viewingGeometry";

const Globe = lazy(() => import("./Globe"));

export default function SampleOrbit({ row }: { row: Sample }) {
  const parent = useStudio();
  const [solution, setSolution] = useState(row.orbit_solution);
  const [time, setTime] = useState(row.date_precision === "day" ? "" : row.acquired_utc.slice(11, 19));
  const [target, setTarget] = useState<GroundTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);
  useEffect(() => () => { version.current++; }, []);
  const orbitPath = `/samples/${row.id}/orbit`;
  const query = solution?.time_basis === "selected_time" && solution?.position
    ? `?at_utc=${encodeURIComponent(solution.position.time)}` : "";
  const p = solution?.position;
  const geometry = solution?.geometry || {
    samples: [], target: { lat: row.lat, lon: row.lon },
    render_source_label: "Historical TLE / SGP4 · estimated",
    time_label: "ยังไม่ทราบเวลาถ่าย · เลือกเวลา UTC เพื่อดูวงโคจร",
    graphics_note: "กรอบบนพื้นคือภาพครอป 500 ม. · ยังไม่ระบุตำแหน่งดาวเทียม",
    empty_note: "เลือกเวลา UTC ด้านบนเพื่อแสดงพิกัดประมาณ ณ เวลาที่เลือก",
  };
  // A dedicated context keeps this optical platform, RGB crop and target
  // together. The main Umbra workspace selection is never used as its orbit.
  const scene = useMemo(() => {
    const b = row.product?.views.area.bbox;
    const ring = b ? [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]] : [];
    return { id: row.id, site_id: row.id, platform: row.platform,
      footprint: { coordinates: [ring] } } as Scene;
  }, [row]);
  const detail = useMemo(() => ({ id: row.id, geometry,
    preview: row.product ? {
      generated_utc: row.product.generated_utc,
      roi: { lat: row.lat, lon: row.lon, width_m: 500 },
      preview: row.product.views.area, attribution: row.attribution,
    } : null,
  }), [row, solution]);
  async function calculate(e: React.FormEvent) {
    e.preventDefault();
    const token = ++version.current;
    setBusy(true); setError(""); setSolution(null);
    try {
      const result = await request(orbitPath + "?at_utc=" + encodeURIComponent(`${row.acquired_utc.slice(0, 10)}T${time}Z`));
      if (token === version.current) setSolution(result);
    } catch (e) {
      if (token === version.current) setError(String(e));
    } finally {
      if (token === version.current) setBusy(false);
    }
  }
  return <section className="sample-orbit" aria-label="High-resolution satellite coordinates">
    <div className="sample-satellite-info">
      <div>
        <h2>พิกัดดาวเทียม · {row.platform}</h2>
        <strong>{p ? "ตำแหน่งประมาณจาก TLE ย้อนหลัง / SGP4" : "เลือกเวลาเพื่อแสดงตำแหน่งดาวเทียม"}</strong>
        <p>{row.orbit_solution?.note || "ตำแหน่งประมาณจากข้อมูลวงโคจร ไม่ใช่ ephemeris จากผู้ผลิตภาพ"}</p>
        {row.date_precision === "day" && <p>ภาพนี้ยืนยันได้เฉพาะวันที่ {row.acquired_utc} · เวลาที่เลือกใช้ดูวงโคจร ยังไม่ใช่เวลาถ่ายที่ยืนยันแล้ว</p>}
        <form onSubmit={calculate} className="sample-orbit-time">
          <label>เวลา UTC · {row.acquired_utc.slice(0, 10)}
            <input type="time" step="1" aria-label="Sample orbit UTC time" required value={time}
              onChange={e => { version.current++; setTime(e.target.value); setSolution(null); setBusy(false); setError(""); }} />
          </label>
          <button type="submit" disabled={busy}>{busy ? "กำลังคำนวณ…" : "คำนวณพิกัดดาวเทียม"}</button>
          {row.date_precision !== "day" && <button type="button" onClick={() => {
            version.current++; setTime(row.acquired_utc.slice(11, 19)); setSolution(row.orbit_solution); setBusy(false); setError("");
          }}>ใช้เวลาตาม metadata ภาพ</button>}
        </form>
        {error && <p role="alert">{error}</p>}
        <p>จุดบนพื้นในภาพ: Lat {row.lat.toFixed(6)}° · Lon {row.lon.toFixed(6)}°</p>
        {solution?.source_url && <a href={solution.source_url} target="_blank" rel="noreferrer">แหล่ง TLE ย้อนหลัง ↗</a>}
      </div>
      <div aria-live="polite">
        {p ? <>
          <p className="sample-orbit-basis">{solution.time_basis === "image_metadata" ? "ประมาณ ณ เวลาตาม metadata ภาพ" : "เวลาที่เลือก · ยังไม่ยืนยันว่าเป็นเวลาถ่ายภาพ"}</p>
          <dl>
            <dt>Satellite latitude</dt><dd data-testid="sample-satellite-lat">{p.lat.toFixed(6)}°</dd>
            <dt>Satellite longitude</dt><dd>{p.lon.toFixed(6)}°</dd>
            <dt>ความสูงเหนือ WGS84</dt><dd>{(p.altitude_m / 1000).toFixed(3)} km</dd>
            <dt>Position UTC</dt><dd>{p.time}</dd>
            <dt>NORAD catalog ID</dt><dd>{solution.norad_id}</dd>
            <dt>TLE epoch UTC</dt><dd>{solution.tle_epoch_utc}</dd>
            <dt>ห่างจาก epoch</dt><dd>{Math.abs(solution.tle_age_hours).toFixed(2)} ชั่วโมง</dd>
          </dl>
          {solution.ground_look?.elevation_deg <= 0 && <p>เวลานี้ดาวเทียมอยู่พ้นขอบฟ้าของพื้นที่ · ไม่แสดงเส้นส่องทะลุโลก</p>}
          <a href={"/api/eo" + orbitPath + query} download={`${row.id}-estimated-orbit.json`}>ดาวน์โหลดพิกัด / TLE JSON</a>
        </> : <p>ยังไม่มีพิกัดดาวเทียมสำหรับเวลาที่เลือก</p>}
        <details>
          <summary>มุมถ่ายจาก metadata ต้นทาง</summary>
          <p>{row.viewing_geometry?.note}</p>
          <dl>
            {([ ["Viewing azimuth", row.viewing_geometry?.view_azimuth_deg],
                ["Mean satellite elevation", row.viewing_geometry?.elevation_deg],
                ["Off-nadir", row.viewing_geometry?.off_nadir_deg],
                ["view:incidence_angle (raw)", row.viewing_geometry?.incidence_deg] ] as [string, number | undefined][])
              .filter(([, v]) => v != null).map(([label, value]) => <span className="sample-angle" key={label}><dt>{label}</dt><dd>{value!.toFixed(2)}°</dd></span>)}
          </dl>
          {row.viewing_geometry?.source_url && <a href={row.viewing_geometry.source_url} target="_blank" rel="noreferrer">Metadata มุมถ่ายต้นทาง ↗</a>}
        </details>
      </div>
    </div>
    <Studio.Provider value={{ ...parent, selected: scene, detail,
      site: { id: row.id, name: row.title, subtitle: "High-resolution RGB imagery", lat: row.lat, lon: row.lon, timezone: "UTC", color: "#55ddee" },
      groundTarget: target, setGroundTarget: setTarget,
      imageMode: "grayscale", sample: 0, setSample: () => {},
    }}>
      <Suspense fallback={<p>กำลังโหลดกราฟิกดาวเทียม 3D…</p>}><Globe /></Suspense>
    </Studio.Provider>
  </section>;
}
