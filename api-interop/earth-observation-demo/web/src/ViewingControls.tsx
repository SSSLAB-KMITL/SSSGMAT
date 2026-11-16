import { useEffect, useState } from "react";
import { useStudio } from "./state";
import {
  inFootprint,
  selectedGround,
  targetLook,
  validGroundPoint,
} from "./viewingGeometry";

export default function ViewingControls({
  onFocus,
  onPick,
  picking,
  showBeam,
  setShowBeam,
}: {
  onFocus: (mode: "link" | "ground" | "satellite" | "earth") => void;
  onPick: () => void;
  picking: boolean;
  showBeam: boolean;
  setShowBeam: (value: boolean) => void;
}) {
  const s = useStudio();
  const ground = selectedGround(s);
  const g = s.detail?.id === s.selected?.id ? s.detail?.geometry : null;
  const p = g?.samples?.[Math.min(s.sample, g.samples.length - 1)];
  const look = p ? targetLook(p.ecef_m, ground) : null;
  const inside = inFootprint(
    ground,
    s.selected?.footprint.coordinates[0] || [],
  );
  const [lat, setLat] = useState(String(ground.lat));
  const [lon, setLon] = useState(String(ground.lon));
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setLat(ground.lat.toFixed(7));
    setLon(ground.lon.toFixed(7));
    setError("");
  }, [ground.lat, ground.lon]);
  useEffect(() => {
    setPlaying(false);
  }, [s.selected?.id]);
  useEffect(() => {
    if (!playing || (g?.samples?.length ?? 0) <= 1) return;
    const timer = setTimeout(
      () => s.setSample((s.sample + 1) % g.samples.length),
      200,
    );
    return () => clearTimeout(timer);
  }, [playing, s.sample, g]);
  function apply(e: React.FormEvent) {
    e.preventDefault();
    const point = { lon: +lon, lat: +lat, height_m: 0 };
    if (!lat.trim() || !lon.trim() || !validGroundPoint(point)) {
      setError(
        "ละติจูดต้องอยู่ระหว่าง −90 ถึง 90 และลองจิจูดระหว่าง −180 ถึง 180",
      );
      return;
    }
    s.setGroundTarget(point);
    setError("");
  }
  return (
    <div className="viewing-controls">
      <div className="viewing-heading">
        <strong>เลือกจุดบนพื้น</strong>
        <span>{g?.time_label || "ตำแหน่งขณะถ่ายภาพ"}</span>
      </div>
      <form onSubmit={apply} className="viewing-coordinate-form">
        <label>
          Latitude
          <input
            aria-label="Viewing target latitude"
            type="number"
            step="any"
            min="-90"
            max="90"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            required
          />
        </label>
        <label>
          Longitude
          <input
            aria-label="Viewing target longitude"
            type="number"
            step="any"
            min="-180"
            max="180"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            required
          />
        </label>
        <button type="submit">แสดงพิกัด</button>
        <button
          type="button"
          className={picking ? "pressed" : ""}
          onClick={onPick}
        >
          {picking ? "คลิกจุดบนโลก…" : "เลือกจุดบนโลก"}
        </button>
        <button type="button" onClick={() => s.setGroundTarget(null)}>
          กลับจุดกลางภาพ
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      <div className="viewing-camera-buttons">
        <button onClick={() => onFocus("earth")}>ดูโลกทั้งใบ</button>
        <button onClick={() => onFocus("link")} disabled={!p}>
          ดูแนวเล็ง
        </button>
        <button onClick={() => onFocus("ground")}>ดูพื้นโลก</button>
        <button onClick={() => onFocus("satellite")} disabled={!p}>
          ดูดาวเทียม
        </button>
        <label>
          <input
            type="checkbox"
            checked={showBeam}
            onChange={(e) => setShowBeam(e.target.checked)}
          />{" "}
          แสดงกรอบแนวเล็ง
        </label>
      </div>
      {p && look ? (
        <>
          <div className="viewing-readout">
            <span>
              {s.selected?.platform} ·{" "}
              {p.time.replace("T", " ").replace("Z", " UTC")}
            </span>
            <strong className={inside ? "inside" : "outside"}>
              {inside ? "จุดอยู่ในขอบเขตภาพ" : "จุดอยู่นอกขอบเขตภาพ"}
            </strong>
            <span>
              Lat {ground.lat.toFixed(6)}° · Lon {ground.lon.toFixed(6)}°
            </span>
            <span>
              Az {look.azimuth_deg.toFixed(2)}° · El{" "}
              {look.elevation_deg.toFixed(2)}° · Range{" "}
              {(look.range_m / 1000).toFixed(3)} km
            </span>
            {look.elevation_deg <= 0 && (
              <strong className="outside">
                จุดนี้พ้นขอบฟ้าของดาวเทียม · ไม่แสดงเส้นผ่านโลก
              </strong>
            )}
          </div>
          {g.samples.length > 1 && (
            <div className="viewing-time">
              <button onClick={() => setPlaying(!playing)}>
                {playing ? "หยุดช่วงถ่าย" : "เล่นช่วงถ่าย"}
              </button>
              <input
                aria-label="Viewing collect time"
                type="range"
                min="0"
                max={g.samples.length - 1}
                value={s.sample}
                onChange={(e) => {
                  setPlaying(false);
                  s.setSample(+e.target.value);
                }}
              />
              <span>
                {p.t_s.toFixed(2)} / {g.duration_s?.toFixed(2) ?? "—"} s
              </span>
            </div>
          )}
          <LookDiagram
            platform={s.selected!.platform}
            heightKm={p.altitude_m / 1000}
            rangeKm={look.range_m / 1000}
            elevation={look.elevation_deg}
            inside={inside}
          />
        </>
      ) : (
        <p>
          {g?.empty_note ||
            "โหลด geometry ของภาพที่เลือกเพื่อแสดงตำแหน่งดาวเทียมและแนวเล็ง"}
        </p>
      )}
      <p className="viewing-method">
        {g?.graphics_note ||
          "เส้นแสดงกรอบแนวเล็งรวมเป็นกราฟิกประกอบจากตำแหน่ง SICD และ footprint · จุดบนพื้นใช้ผิว WGS84 สูง 0 ม. · เลือกจุดในภาพ 2D ด้วยการดับเบิลคลิกได้"}
      </p>
      {s.imageMode === "optical" && (
        <p className="viewing-method">
          ตำแหน่งดาวเทียมเป็นของ Umbra ที่เลือก ส่วนภาพ Sentinel-2
          มีวันถ่ายของตัวเอง
        </p>
      )}
    </div>
  );
}

function LookDiagram({
  platform,
  heightKm,
  rangeKm,
  elevation,
  inside,
}: {
  platform: string;
  heightKm: number;
  rangeKm: number;
  elevation: number;
  inside: boolean;
}) {
  const angle = (elevation * Math.PI) / 180;
  const horizontal = rangeKm * Math.cos(angle),
    up = rangeKm * Math.sin(angle);
  const scale = Math.min(200 / Math.max(horizontal, 1), 85 / Math.max(up, 1));
  const sx = 330 - horizontal * scale,
    sy = 130 - up * scale;
  const visible = elevation > 0;
  return (
    <svg
      className="viewing-diagram"
      viewBox="0 0 460 190"
      role="img"
      aria-label="Satellite line of sight to selected ground point"
    >
      <defs>
        <marker
          id="look-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
        >
          <path d="M0 0L8 4L0 8Z" fill="#197e9a" />
        </marker>
      </defs>
      <path d="M35 140H425" stroke="#9db6c5" strokeWidth="2" />
      {visible && (
        <>
          <line
            data-testid="look-diagram-ray"
            x1={sx}
            y1={sy}
            x2="330"
            y2="130"
            stroke="#197e9a"
            strokeWidth="2.5"
            markerEnd="url(#look-arrow)"
          />
          <g transform={`translate(${sx},${sy})`}>
            <rect x="-8" y="-8" width="16" height="16" rx="2" fill="#e6b353" />
            <path d="M-13 -6H-28V6H-13M13 -6H28V6H13" fill="#35677c" />
          </g>
          <text x={Math.max(40, sx - 35)} y={Math.max(18, sy - 17)}>
            {platform} · {heightKm.toFixed(1)} km
          </text>
          <text x="45" y="95">
            Range {rangeKm.toFixed(2)} km
          </text>
        </>
      )}
      <circle cx="330" cy="136" r="5" fill={inside ? "#188d75" : "#c17829"} />
      <text x="230" y="159">
        Selected ground point
      </text>
      <text x="35" y="181">
        แผนภาพแนวเล็ง · ใช้มุมเงยจากข้อมูล · สัญลักษณ์ไม่ตามมาตราส่วน
      </text>
      {!visible && (
        <text x="80" y="70">
          จุดที่เลือกอยู่นอกขอบฟ้า
        </text>
      )}
    </svg>
  );
}
