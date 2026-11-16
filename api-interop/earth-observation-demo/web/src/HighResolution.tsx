import { useEffect, useRef, useState } from "react";
import { Download, Maximize2, Minimize2, Satellite } from "lucide-react";
import { request, useStudio } from "./state";
import SampleOrbit from "./SampleOrbit";
import {
  DetectionToolbar,
  DetectionOverlay,
  DetectionResults,
  useOpticalDetection,
} from "./OpticalDetection";

export type Sample = {
  id: string;
  title: string;
  description: string;
  platform: string;
  provider: string;
  acquired_utc: string;
  date_precision: string;
  gsd_m: number;
  source_url: string;
  source_page: string;
  license: string;
  license_url: string;
  license_note: string;
  attribution: string;
  lon: number;
  lat: number;
  ready: boolean;
  orbit_solution?: any;
  viewing_geometry?: {
    satellite_position_available: boolean;
    satellite_position: null;
    status: string;
    source: string;
    source_url: string;
    note: string;
    angle_note?: string;
    view_azimuth_deg?: number;
    elevation_deg?: number;
    off_nadir_deg?: number;
    incidence_deg?: number;
  };
  product: null | {
    generated_utc: string;
    views: Record<
      string,
      {
        url: string;
        width_m: number;
        size: number;
        grid_m: number;
        bbox: number[];
        valid_fraction: number;
      }
    >;
  };
};

export default function HighResolution() {
  const studio = useStudio();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [selected, setSelected] = useState("");
  const [view, setView] = useState("detail");
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const viewer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    setError("");
    setLoading(true);
    request("/samples")
      .then((data) => {
        if (!active) return;
        setSamples(data.samples);
        setSelected(
          data.samples.find((r: Sample) => r.ready)?.id ||
            data.samples[0]?.id ||
            "",
        );
      })
      .catch((e) => active && setError(String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [reload]);
  useEffect(() => {
    const sync = () =>
      setFullscreen(document.fullscreenElement === viewer.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const row = samples.find((r) => r.id === selected);
  const image = row?.product?.views[view];
  const detection = useOpticalDetection(
    row?.id || "",
    view,
    row?.product?.generated_utc,
  );
  const date =
    row?.date_precision === "day"
      ? row.acquired_utc + " · ไม่ระบุเวลาถ่าย"
      : row?.acquired_utc.replace("T", " ").replace("Z", " UTC");
  return (
    <section className="highres-page">
      <div className="highres-heading">
        <div>
          <p className="eyebrow">HIGH-RESOLUTION IMAGERY</p>
          <h1>ภาพสีดาวเทียมละเอียดสูง</h1>
          <p>
            WorldView-2, WorldView-3 และ GeoEye-1 · ความละเอียดต้นทาง 30–50 ซม.
            · เลือกพื้นที่แล้วดูภาพใหญ่ได้เลย
          </p>
        </div>
        <div className="highres-heading-actions">
          {samples.length > 0 && (
            <span className="sample-count">
              {samples.length} พื้นที่ ·{" "}
              {new Set(samples.map((r) => r.platform)).size} ดาวเทียม
            </span>
          )}
          <button onClick={() => studio.setView("overview")}>
            กลับไปดูภาพเรดาร์
          </button>
        </div>
      </div>
      {error && (
        <div className="sample-error" role="alert">
          <p>{error}</p>
          <button onClick={() => setReload((v) => v + 1)}>
            ลองโหลดอีกครั้ง
          </button>
        </div>
      )}
      {!samples.length && !error && loading && (
        <div className="sample-loading" role="status">
          <p>กำลังโหลดภาพดาวเทียม…</p>
          <div className="sample-skeletons" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} />
            ))}
          </div>
        </div>
      )}
      {!samples.length && !error && !loading && (
        <div className="sample-error" role="status">
          <p>ยังไม่มีภาพที่พร้อมแสดง</p>
          <button onClick={() => setReload((v) => v + 1)}>
            โหลดรายการอีกครั้ง
          </button>
        </div>
      )}
      <div className="highres-cards">
        {samples.map((r) => (
          <button
            key={r.id}
            className={"highres-card " + (r.id === selected ? "selected" : "")}
            aria-label={`Open sample ${r.title}`}
            aria-pressed={r.id === selected}
            onClick={() => {
              setSelected(r.id);
              setZoom(1);
              setError("");
            }}
          >
            {r.product && (
              <img
                src={r.product.views.detail.url}
                alt={`${r.platform} sample in ${r.title}`}
                decoding="async"
              />
            )}
            <div>
              <span>
                <Satellite size={13} /> {r.platform}
                <b>{Math.round(r.gsd_m * 100)} cm</b>
              </span>
              <strong>{r.title}</strong>
              <small>
                {r.acquired_utc.slice(0, 10)} · {r.license}
              </small>
            </div>
          </button>
        ))}
      </div>
      {row && (
        <>
          <div className="highres-context">
            <strong>{row.description}</strong>
            <p>
              ภาพสีจากแสงที่มองเห็น · พิกเซลต้นทางเล็กกว่า Sentinel-2 10 ม.
              ประมาณ {(10 / row.gsd_m).toFixed(0)} เท่าต่อด้าน ·
              การซูมใช้ดูพิกเซลเดิม
            </p>
            <p>
              ภาพเหล่านี้มีพื้นที่และวันถ่ายของตัวเอง ·
              ภาพรอตเตอร์ดัมอยู่คนละบริเวณกับ Botlek ROI หลัก ส่วนภาพกรุงเทพฯ
              เป็นบริเวณบางซื่อ
            </p>
          </div>
          <DetectionToolbar d={detection} ready={Boolean(image)} />
          <div ref={viewer} className="highres-viewer">
            <div className="highres-controls">
              <div
                className="highres-view-buttons"
                role="group"
                aria-label="Sample area width"
              >
                {[
                  ["area", "ดูพื้นที่กว้าง 500 ม."],
                  ["detail", "ดูระยะกลาง 250 ม."],
                  ["close", "ดูระยะใกล้ 100 ม."],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={view === key ? "pressed" : ""}
                    aria-pressed={view === key}
                    onClick={() => {
                      setView(key);
                      setZoom(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label>
                ซูม{" "}
                <input
                  aria-label="Sample image zoom"
                  type="range"
                  min={1}
                  max={4}
                  step={0.25}
                  value={zoom}
                  onChange={(e) => setZoom(+e.target.value)}
                />
              </label>
              <output aria-label="Sample zoom level">
                {zoom.toFixed(2).replace(/\.00$/, "")}×
              </output>
              <button onClick={() => setZoom(1)}>พอดีจอ</button>
              <button
                onClick={() => {
                  const operation = document.fullscreenElement
                    ? document.exitFullscreen()
                    : viewer.current?.requestFullscreen();
                  void operation?.catch((e) => setError(String(e)));
                }}
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{" "}
                {fullscreen ? "ออกจากเต็มจอ" : "ขยายเต็มจอ"}
              </button>
              {image && (
                <a href={image.url} download>
                  <Download size={14} /> บันทึกภาพ
                </a>
              )}
              <a href={`/api/eo/samples/${row.id}/files/source.json`} download>
                ข้อมูลภาพและสิทธิ์ใช้
              </a>
            </div>
            <div className="highres-image-scroll">
              {image ? (
                <div
                  className="highres-image-stage"
                  style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
                >
                  <img
                    key={row.id + view}
                    src={image.url + "?v=" + row.product?.generated_utc}
                    alt={`${row.platform} ${row.title}, ${image.width_m} m wide, source GSD ${row.gsd_m} m`}
                    decoding="async"
                    onError={() =>
                      setError("โหลดภาพไม่สำเร็จ ลองเปิดตัวอย่างอีกครั้ง")
                    }
                  />
                  <DetectionOverlay d={detection} />
                </div>
              ) : (
                <p className="empty-small">ภาพนี้ยังไม่พร้อมแสดง</p>
              )}
            </div>
            <div className="highres-image-caption">
              <strong>
                {row.platform} · {Math.round(row.gsd_m * 100)} cm source GSD
              </strong>
              <span>{date}</span>
              {image && (
                <span>
                  กว้าง {image.width_m} ม. · {image.size} × {image.size} px ·
                  กริดแสดงผล {image.grid_m.toFixed(2)} m/px
                </span>
              )}
              <small>{row.attribution}</small>
            </div>
          </div>
          <DetectionResults d={detection} />
          <SampleOrbit key={row.id} row={row} />
          <div className="highres-source">
            <div>
              <h2>แหล่งที่มาและสิทธิ์ใช้ภาพ</h2>
              <p>{row.license_note}</p>
              <p>
                พิกัดจุดบนพื้นดินในภาพ {row.lat.toFixed(6)},{" "}
                {row.lon.toFixed(6)} · RGB แบบ pan-sharpened ·
                ภาพที่แสดงเป็นการครอป/ปรับแสดงผลของข้อมูลต้นทาง
              </p>
            </div>
            <div className="highres-links">
              <a href={row.source_page} target="_blank" rel="noreferrer">
                เว็บไซต์ชุดข้อมูล ↗
              </a>
              <a href={row.license_url} target="_blank" rel="noreferrer">
                {row.license} ↗
              </a>
              <a href={row.source_url} target="_blank" rel="noreferrer">
                GeoTIFF ต้นทาง ↗
              </a>
            </div>
          </div>
        </>
      )}
      <div className="highres-more">
        <h2>ภาพจากดาวเทียมอื่นที่เปิดดูเพิ่มเติมได้</h2>
        <p>
          ภาพชุดนี้มีเฉพาะพื้นที่และวันถ่ายที่ผู้ให้บริการเปิดเผย
          การสั่งถ่ายจุดที่เลือกใหม่ใช้บริการของผู้ให้บริการแต่ละราย
        </p>
        <a
          href="https://space-solutions.airbus.com/imagery/"
          target="_blank"
          rel="noreferrer"
        >
          Airbus · Pléiades Neo 30 ซม. · ภาพสำหรับประเมิน ↗
        </a>
        <a
          href="https://learn.planet.com/skysat-image-samples-ty.html"
          target="_blank"
          rel="noreferrer"
        >
          Planet · SkySat · ภาพสำหรับดาวน์โหลด ↗
        </a>
      </div>
    </section>
  );
}
