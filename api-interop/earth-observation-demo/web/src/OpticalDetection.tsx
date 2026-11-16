import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ScanSearch, X } from "lucide-react";
import { request } from "./state";
import "./optical-detection.css";

export type OpticalObject = {
  id: number;
  class_name: string;
  label: string;
  score: number;
  polygon_px: number[][];
  center_px: number[];
  ground_point: { lat: number; lon: number };
  review: string;
};
type Result = {
  sample_id: string;
  view: string;
  objects: OpticalObject[];
  image: {
    width: number;
    height: number;
    width_m: number;
    acquired_utc: string;
  };
  model: { name: string; source_url: string };
  note: string;
  supported_classes: { name: string; label: string }[];
  generated_utc: string;
};
const COLORS: Record<string, string> = {
  plane: "#ffe272",
  ship: "#67e8f9",
  "small vehicle": "#95f59b",
  "large vehicle": "#ffb98d",
  "swimming pool": "#c8a9ff",
};
const color = (name: string) => COLORS[name] || "#ffb0d8";

export function useOpticalDetection(
  sampleId: string,
  view: string,
  imageVersion?: string,
) {
  const key = `${sampleId}:${view}:${imageVersion}`;
  const [record, setRecord] = useState<{
    key: string;
    result: Result | null;
    job: any;
    error: string;
  }>({ key: "", result: null, job: null, error: "" });
  const [reload, setReload] = useState(0);
  const [threshold, setThreshold] = useState(0.25);
  const [show, setShow] = useState(true);
  const [classFilter, setClassFilter] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const currentKey = useRef(key);
  currentKey.current = key;
  const generation = useRef(0);
  const state = record.key === key ? record : null;
  const result = state?.result || null;
  const job = state?.job;
  const busy = starting || job?.state === "queued" || job?.state === "running";
  const path = `/samples/${sampleId}/detections?view=${view}`;
  useEffect(() => {
    const controller = new AbortController();
    const token = ++generation.current;
    setStarting(false);
    setClassFilter("");
    setSelected(null);
    if (!sampleId || !imageVersion) return;
    request(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted && token === generation.current)
          setRecord({ key, result: data.result, job: data.job, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted && token === generation.current)
          setRecord({ key, result: null, job: null, error: String(e) });
      });
    return () => controller.abort();
  }, [key, reload]);
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.state)) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const next = await request(`/jobs/${job.id}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (next.state === "completed") {
          const data = await request(path, { signal: controller.signal });
          if (!controller.signal.aborted)
            setRecord({ key, result: data.result, job: next, error: "" });
        } else {
          setRecord((old) =>
            old.key !== key
              ? old
              : {
                  ...old,
                  job: next,
                  error:
                    next.state === "failed" || next.state === "interrupted"
                      ? next.error || next.message
                      : "",
                },
          );
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setRecord((old) =>
            old.key !== key ? old : { ...old, job: null, error: String(e) },
          );
      }
    }, 800);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, job]);
  async function run() {
    generation.current++;
    const runKey = key;
    setStarting(true);
    setRecord((old) => ({
      key,
      result: old.key === key ? old.result : null,
      job: null,
      error: "",
    }));
    try {
      const next = await request(`/samples/${sampleId}/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view }),
      });
      if (currentKey.current === runKey)
        setRecord((old) => ({ ...old, key, job: next }));
    } catch (e) {
      if (currentKey.current === runKey)
        setRecord((old) => ({ ...old, key, error: String(e) }));
    } finally {
      if (currentKey.current === runKey) setStarting(false);
    }
  }
  async function cancel() {
    if (!job) return;
    const runKey = key;
    try {
      const next = await request(`/jobs/${job.id}/cancel`, { method: "POST" });
      if (currentKey.current === runKey)
        setRecord((old) => ({ ...old, job: next }));
    } catch (e) {
      if (currentKey.current === runKey)
        setRecord((old) => ({ ...old, error: String(e) }));
    }
  }
  const scored = useMemo(
    () => result?.objects.filter((o) => o.score >= threshold) || [],
    [result, threshold],
  );
  const visible = scored.filter(
    (o) => !classFilter || o.class_name === classFilter,
  );
  const summary = [...new Set(scored.map((o) => o.class_name))].map((name) => ({
    name,
    label: scored.find((o) => o.class_name === name)!.label,
    count: scored.filter((o) => o.class_name === name).length,
  }));
  return {
    result,
    job,
    busy,
    error: state?.error || "",
    run,
    cancel,
    reload: () => setReload((v) => v + 1),
    threshold,
    setThreshold,
    show,
    setShow,
    classFilter,
    setClassFilter,
    selected,
    setSelected,
    scored,
    visible,
    summary,
    exportUrl: `/api/eo/samples/${sampleId}/files/detections-${view}.json`,
  };
}
export type DetectionState = ReturnType<typeof useOpticalDetection>;

export function DetectionToolbar({
  d,
  ready,
}: {
  d: DetectionState;
  ready: boolean;
}) {
  return (
    <section
      className="optical-detection-controls"
      aria-label="Optical object detection"
    >
      <div className="detection-intro">
        <span className="eyebrow">AI OBJECT DETECTION</span>
        <h2>ในภาพนี้มีอะไรบ้าง</h2>
        <p>เลือกภาพ แล้วกดตรวจจับเพื่อดูชนิดและจำนวนวัตถุ</p>
      </div>
      <div className="detection-actions">
        <button
          className="primary"
          onClick={() => void d.run()}
          disabled={!ready || d.busy}
        >
          <ScanSearch size={18} aria-hidden="true" />
          {d.busy ? "กำลังตรวจจับ…" : "ตรวจจับวัตถุในภาพ"}
        </button>
        {d.busy && d.job && (
          <button onClick={() => void d.cancel()}>
            <X size={15} aria-hidden="true" />
            ยกเลิก
          </button>
        )}
        {d.result && (
          <label>
            <input
              type="checkbox"
              checked={d.show}
              onChange={(e) => d.setShow(e.target.checked)}
            />
            แสดงกรอบวัตถุ
          </label>
        )}
      </div>
      {d.busy && (
        <div className="detection-progress" role="status">
          <span>{d.job?.message || "กำลังส่งงานตรวจจับ…"}</span>
          <progress
            aria-label="Detection progress"
            max="100"
            value={d.job?.progress || 0}
          />
        </div>
      )}
      {d.error && (
        <div className="sample-error" role="alert">
          <p>{d.error}</p>
          <button onClick={d.reload}>โหลดสถานะอีกครั้ง</button>
        </div>
      )}
      {d.result && (
        <div className="detection-filters">
          <label>
            เกณฑ์คะแนนโมเดล <strong>{Math.round(d.threshold * 100)}%</strong>
            <input
              aria-label="Detection score threshold"
              type="range"
              min="0.10"
              max="0.90"
              step="0.05"
              value={d.threshold}
              onChange={(e) => {
                d.setThreshold(+e.target.value);
                d.setSelected(null);
              }}
            />
          </label>
          <div
            className="detection-class-chips"
            role="group"
            aria-label="Detected object categories"
          >
            <button
              aria-pressed={!d.classFilter}
              onClick={() => {
                d.setClassFilter("");
                d.setSelected(null);
              }}
            >
              ทั้งหมด <b>{d.scored.length}</b>
            </button>
            {d.summary.map((c) => (
              <button
                key={c.name}
                aria-pressed={d.classFilter === c.name}
                onClick={() => {
                  d.setClassFilter(c.name);
                  d.setSelected(null);
                }}
              >
                {c.label} <b>{c.count}</b>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="detection-method">
        ผลจาก AI ควรตรวจสอบกับภาพอีกครั้ง · รองรับวัตถุ 15 ประเภท
      </p>
    </section>
  );
}

export function DetectionOverlay({ d }: { d: DetectionState }) {
  if (!d.result || !d.show) return null;
  const { width, height } = d.result.image;
  return (
    <svg
      className="detection-overlay"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {d.visible.map((o) => (
        <g key={o.id}>
          <polygon
            points={o.polygon_px.map((p) => p.join(",")).join(" ")}
            fill={d.selected === o.id ? color(o.class_name) + "44" : "none"}
            stroke={color(o.class_name)}
            strokeWidth={d.selected === o.id ? 4 : 2}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={o.center_px[0]}
            y={o.center_px[1] - 10}
            fill={color(o.class_name)}
            stroke="#10212b"
            strokeWidth={3}
            paintOrder="stroke"
            fontSize={Math.max(12, width / 90)}
            textAnchor="middle"
          >
            {d.selected === o.id ? `${o.label} #${o.id}` : `#${o.id}`}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function DetectionResults({ d }: { d: DetectionState }) {
  if (!d.result) return null;
  return (
    <section
      className="detection-results"
      aria-label="Optical detection results"
    >
      <div className="detection-results-heading">
        <div>
          <p className="eyebrow">MODEL PREDICTIONS · NOT VERIFIED</p>
          <h2>
            ผลตรวจจับในภาพนี้ <span>{d.visible.length} วัตถุ</span>
          </h2>
        </div>
        <a href={d.exportUrl} download>
          <Download size={16} aria-hidden="true" />
          ผลตรวจจับ JSON
        </a>
      </div>
      {d.visible.length ? (
        <div className="detection-object-list">
          {d.visible.map((o) => (
            <button
              key={o.id}
              aria-label={`วัตถุ #${o.id} ${o.label} คะแนนโมเดล ${Math.round(o.score * 100)}%`}
              aria-pressed={d.selected === o.id}
              onClick={() => d.setSelected(d.selected === o.id ? null : o.id)}
            >
              <span className="detection-object-number">#{o.id}</span>
              <strong>
                {o.label}
                <small>{o.class_name}</small>
              </strong>
              <span className="detection-score">
                {Math.round(o.score * 100)}%<small>คะแนนโมเดล</small>
              </span>
              <span className="detection-location">
                {o.ground_point.lat.toFixed(6)}°,{" "}
                {o.ground_point.lon.toFixed(6)}°
                <small>พิกัดบนพื้นจากกริดภาพ</small>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="detection-empty">
          ไม่พบวัตถุในประเภทที่โมเดลรองรับซึ่งผ่านเกณฑ์นี้ ·
          ลองปรับคะแนนหรือเลือกพื้นที่ภาพ 500 ม.
        </p>
      )}
      <p className="detection-method">
        {d.result.note} · ไม่นับกรอบที่ถูกตัดตรงขอบภาพ · JSON รวมคะแนนตั้งแต่
        10% ส่วนรายการนี้แสดงตามเกณฑ์ที่เลือก
      </p>
      <details>
        <summary>ข้อมูลโมเดลและผลประมวลผล</summary>
        <p>
          {d.result.model.name} · พื้นที่กว้าง {d.result.image.width_m} ม. ·
          เวลาถ่าย {d.result.image.acquired_utc} · ประมวลผล{" "}
          {d.result.generated_utc}
        </p>
        <p>
          ประเภทที่รองรับ:{" "}
          {d.result.supported_classes.map((c) => c.label).join(" · ")}
        </p>
        <a href={d.result.model.source_url} target="_blank" rel="noreferrer">
          เอกสารโมเดล ↗
        </a>
      </details>
    </section>
  );
}
