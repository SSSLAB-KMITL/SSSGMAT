import React, { useEffect, useRef, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { DockviewReact, type DockviewReadyEvent } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import {
  Satellite,
  FolderOpen,
  Download,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Crosshair,
  ScanSearch,
  Layers,
  GitCompare,
  Film,
  Square,
  Globe2,
  Image as ImageIcon,
  Check,
  AlertCircle,
  Maximize2,
  Minimize2,
  Settings2,
  MapPin,
} from "lucide-react";
import {
  Studio,
  useStudio,
  request,
  localTime,
  type Scene,
  type Site,
  type Job,
  type StudioState,
} from "./state";
import "./theme.css";
import "./modern.css";
import AppNavigation from "./AppNavigation";
import { useJobUpdates } from "./useJobUpdates";
import CrossSite from "./CrossSite";
import HighResolution from "./HighResolution";
import type { GroundTarget } from "./viewingGeometry";
import { validGroundPoint } from "./viewingGeometry";
import "./dark.css";
const Globe = lazy(() => import("./Globe"));
const THEME = {
  name: "eo",
  className: "dockview-theme-eo",
  colorScheme: "light" as const,
};

export function App() {
  const [sites, setSites] = useState<Site[]>([]),
    [scenes, setScenes] = useState<Scene[]>([]),
    [siteId, setSiteId] = useState("suvarnabhumi"),
    [selectedId, setSelectedId] = useState(""),
    [detail, setDetail] = useState<any>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [error, message] = useState(""),
    [loading, setLoading] = useState(false),
    [filter, setFilter] = useState(""),
    [view, setView] = useState(() => {
      const requested = new URLSearchParams(window.location.search).get("view");
      return [
        "samples",
        "geometry",
        "sites",
        "roi",
        "compare",
        "sequence",
      ].includes(requested || "")
        ? requested!
        : "overview";
    }),
    [reference, setReference] = useState(""),
    [sample, setSample] = useState(32),
    [overlay, setOverlay] = useState(true),
    [candidate, setCandidate] = useState<number | null>(null),
    [playing, setPlaying] = useState(false),
    [api, setApi] = useState<any>(null),
    [scrollLayout, setScrollLayout] = useState(true),
    [imageMode, setImageMode] = useState("grayscale"),
    [groundTarget, setGroundTarget] = useState<GroundTarget | null>(null);
  const selected = scenes.find((s) => s.id === selectedId) || null,
    site = sites.find((s) => s.id === siteId) || sites[0];
  const selectedRef = useRef(selectedId);
  const toolsRef = useRef<HTMLDetailsElement>(null);
  selectedRef.current = selectedId;
  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === "overview") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    window.history.replaceState(null, "", url);
    const label =
      view === "samples"
        ? "ภาพสีละเอียดสูง"
        : view === "geometry"
          ? "โลก 3D"
          : "ดูภาพดาวเทียม";
    document.title = `${label} · Earth Observation Studio`;
  }, [view]);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (!toolsRef.current?.contains(event.target as Node) && toolsRef.current)
        toolsRef.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && toolsRef.current?.open) {
        toolsRef.current.open = false;
        toolsRef.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const refresh = async () => {
    try {
      const data = await request("/catalog");
      setSites(data.sites);
      setScenes(data.scenes);
      const id = selectedRef.current;
      if (id) {
        const detail = await request("/scenes/" + id);
        if (id === selectedRef.current) setDetail(detail);
      }
    } catch (e) {
      message(String(e));
    }
  };
  useEffect(() => {
    request("/catalog")
      .then((data) => {
        setSites(data.sites);
        setScenes(data.scenes);
        const first =
          data.scenes.find(
            (s: Scene) => s.site_id === "suvarnabhumi" && s.ready,
          ) || data.scenes[0];
        setSelectedId(first.id);
      })
      .catch((e) => message(String(e)));
  }, []);
  useJobUpdates(setJobs, refresh, view !== "samples");
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setLoading(true);
    setCandidate(null);
    request("/scenes/" + selectedId)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) message(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const list = scenes.filter((s) => s.site_id === siteId);
      setSelectedId(
        (id) =>
          list[(list.findIndex((s) => s.id === id) + 1) % list.length]?.id ||
          id,
      );
    }, 2200);
    return () => clearInterval(timer);
  }, [playing, scenes, siteId]);
  async function run(kind: string, params: any = {}) {
    if (!selected) return;
    message("");
    try {
      await request("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene_id: selected.id, kind, ...params }),
      });
      if (kind === "detect") setView("roi");
      if (kind === "sequence") setView("sequence");
      if (kind === "compare") setView("compare");
    } catch (e) {
      message(String(e));
    }
  }
  function select(id: string) {
    setPlaying(false);
    setSelectedId(id);
    setSample(32);
  }
  function setSite(id: string) {
    setGroundTarget(null);
    setSiteId(id);
    setFilter("");
    setReference("");
    setPlaying(false);
    setView((current) => (current === "geometry" ? "geometry" : "overview"));
    const list = scenes.filter((s) => s.site_id === id);
    setSelectedId((list.find((s) => s.ready) || list[0])?.id || "");
  }
  async function review(status: string, kind: string) {
    if (!selected || candidate === null) return;
    try {
      await request(`/scenes/${selected.id}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature_id: candidate,
          review: status,
          class_name: kind,
        }),
      });
      await refresh();
    } catch (e) {
      message(String(e));
    }
  }
  const state: StudioState = {
    groundTarget,
    setGroundTarget,
    imageMode,
    setImageMode,
    sites,
    scenes,
    site,
    selected,
    detail,
    jobs,
    loading,
    error,
    filter,
    setFilter,
    setSite,
    select,
    run,
    refresh,
    message,
    view,
    setView,
    reference,
    setReference,
    sample,
    setSample,
    overlay,
    setOverlay,
    candidate,
    setCandidate,
    review,
    playing,
    setPlaying,
    api,
    setApi,
  };
  const ready = (event: DockviewReadyEvent) => {
    const a = event.api;
    setApi(a);
    a.addPanel({
      id: "catalog",
      component: "catalog",
      title: "Object Browser",
      initialWidth: 260,
    });
    a.addPanel({
      id: "image",
      component: "image",
      title: "2D Image View",
      position: { referencePanel: "catalog", direction: "right" },
    });
    a.addPanel({
      id: "globe",
      component: "globe",
      title: "3D Geometry View",
      position: { referencePanel: "image", direction: "right" },
      initialWidth: 390,
    });
    a.addPanel({
      id: "properties",
      component: "properties",
      title: "Acquisition Properties",
      position: { referencePanel: "globe", direction: "below" },
      initialHeight: 250,
    });
    a.addPanel({
      id: "metrics",
      component: "metrics",
      title: "Analysis & Review",
      position: { referencePanel: "image", direction: "below" },
      initialHeight: 220,
    });
    a.addPanel({
      id: "jobs",
      component: "jobs",
      title: "Message Viewer / Jobs",
      position: { referencePanel: "catalog", direction: "below" },
      initialHeight: 200,
    });
    a.addPanel({
      id: "timeline",
      component: "timeline",
      title: "Timeline View",
      position: { direction: "below" },
      initialHeight: 114,
    });
    a.getPanel("catalog")?.api.setSize({ width: 220 });
    a.getPanel("globe")?.api.setSize({ width: 300 });
    a.getPanel("metrics")?.api.setSize({ height: 145 });
    a.getPanel("properties")?.api.setSize({ height: 240 });
    a.getPanel("jobs")?.api.setSize({ height: 155 });
    a.getPanel("timeline")?.api.setSize({ height: 80 });
    a.getPanel("image")?.api.setActive();
  };
  return (
    <Studio.Provider value={state}>
      <div className="app">
        <a className="skip-link" href="#main-content">
          ข้ามไปเนื้อหาหลัก
        </a>
        <header className="masthead">
          <div className="brand-lockup">
            <img
              className="brand-logo"
              src="/brand/sss-lab.png"
              alt="SSS Lab"
              width="48"
              height="47"
            />
            <img
              className="institution-logo"
              src="/brand/siet-kmitl.png"
              alt="SIET · School of Industrial Education and Technology · KMITL"
              width="260"
              height="48"
            />
          </div>
          <div className="header-actions">
            {view !== "samples" && (
              <details
                className="workspace-tools"
                ref={toolsRef}
                onClick={(e) => {
                  if (
                    (e.target as HTMLElement).closest("button, a") &&
                    toolsRef.current
                  )
                    toolsRef.current.open = false;
                }}
              >
                <summary>
                  <Settings2 size={17} aria-hidden="true" /> เครื่องมือ
                </summary>
                <nav className="menubar" aria-label="Workspace tools">
                  <details>
                    <summary>File</summary>
                    <div>
                      <a href="/api/eo/export/catalog.csv">
                        Export acquisition catalog
                      </a>
                      <button onClick={() => void refresh()}>
                        อัปเดตข้อมูล
                      </button>
                    </div>
                  </details>
                  <details>
                    <summary>View</summary>
                    <div>
                      {[
                        ["overview", "Full scene"],
                        ["roi", "ดูพื้นที่ใกล้"],
                        ["compare", "Compare images"],
                        ["sequence", "Aspect sequence"],
                      ].map(([v, l]) => (
                        <button key={v} onClick={() => setView(v)}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </details>
                  <details>
                    <summary>Analysis</summary>
                    <div>
                      <button onClick={() => void run("detect")}>
                        Find bright candidates
                      </button>
                      <button onClick={() => void run("sequence")}>
                        Create aspect sequence
                      </button>
                    </div>
                  </details>
                  <details>
                    <summary>Window</summary>
                    <div>
                      {[
                        "catalog",
                        "image",
                        "globe",
                        "properties",
                        "metrics",
                        "jobs",
                        "timeline",
                      ].map((id) => (
                        <button
                          key={id}
                          onClick={() => {
                            if (scrollLayout) {
                              document
                                .getElementById(`panel-${id}`)
                                ?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                });
                              return;
                            }
                            const panel = api?.getPanel(id);
                            if (panel) panel.api.setActive();
                            else
                              api?.addPanel({ id, component: id, title: id });
                          }}
                        >
                          {id}
                        </button>
                      ))}
                    </div>
                  </details>
                  <a href="/docs" target="_blank" rel="noreferrer">
                    API Reference
                  </a>
                  <span className="menu-caption">
                    Historical acquisitions · observed geometry
                  </span>
                </nav>
              </details>
            )}
            <a className="export-top" href="/api/eo/export/catalog.csv">
              <Download size={16} aria-hidden="true" /> ส่งออกข้อมูล
            </a>
          </div>
        </header>
        <AppNavigation
          view={view}
          onNavigate={(next) => {
            setPlaying(false);
            message("");
            setView(next);
          }}
        />

        {view !== "samples" && (
          <div className="sitebar" role="region" aria-label="Observation area">
            <span className="sitebar-label">
              <MapPin size={15} aria-hidden="true" /> พื้นที่สังเกตการณ์
            </span>
            <label className="mobile-site-picker">
              พื้นที่สังเกตการณ์
              <select
                aria-label="Observation area selector"
                value={siteId}
                onChange={(e) => setSite(e.target.value)}
              >
                {sites.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name} · {s.subtitle}
                  </option>
                ))}
              </select>
            </label>
            {sites.map((s) => (
              <button
                className={"site-tab " + (s.id === siteId ? "active" : "")}
                key={s.id}
                aria-pressed={s.id === siteId}
                onClick={() => setSite(s.id)}
              >
                <span className="site-dot" style={{ background: s.color }} />
                <span>
                  {s.name}
                  <small>{s.subtitle}</small>
                </span>
                <b>{scenes.filter((x) => x.site_id === s.id).length}</b>
              </button>
            ))}
            <div className="archive-badge">
              <span className="live-dot" />
              {scenes.length} acquisitions<span>2024–2025 archive</span>
            </div>
          </div>
        )}
        {view !== "samples" && (
          <div className="toolbar" role="region" aria-label="Imagery actions">
            <button
              className="image-size-button pressed"
              onClick={() => {
                setScrollLayout(!scrollLayout);
                setApi(null);
              }}
            >
              <Layers size={16} />
              {scrollLayout ? "จัดหน้าต่างเอง" : "เลื่อนดูทั้งหน้า"}
            </button>
            <i />
            <button
              onClick={() => {
                if (detail?.id === selected?.id && detail?.preview)
                  setView("overview");
                else void run("prepare");
              }}
              disabled={!selected}
            >
              <FolderOpen size={16} /> เปิดภาพ
            </button>
            <i />
            <button
              onClick={() => void run("detect")}
              disabled={!detail?.preview}
            >
              <ScanSearch size={16} /> หาจุดที่น่าสนใจ
            </button>
            <button
              onClick={() => {
                setView("compare");
                api?.getPanel("image")?.api.setActive();
                document
                  .getElementById("panel-image")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <GitCompare size={16} /> เปรียบเทียบภาพ
            </button>
            <button onClick={() => setView("sequence")}>
              <Film size={16} /> ดูภาพต่อเนื่อง
            </button>
            <i />
            <button
              className={overlay ? "pressed" : ""}
              aria-pressed={overlay}
              onClick={() => setOverlay(!overlay)}
            >
              <Layers size={16} /> แสดงชั้นข้อมูล
            </button>
            <button onClick={() => void refresh()} title="อัปเดตข้อมูล">
              <RefreshCw size={16} />
            </button>
            <span className="toolbar-right">
              {site?.timezone}{" "}
              <span className="muted">· all stored times UTC</span>
            </span>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={15} />
            {error}
            <button onClick={() => message("")}>Dismiss</button>
          </div>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className={
            scrollLayout || view === "samples" || view === "geometry"
              ? "scroll-main"
              : "docked-main"
          }
        >
          {view === "samples" ? (
            <HighResolution />
          ) : view === "geometry" ? (
            <div className="scroll-workspace viewing-page">
              <div className="viewing-page-heading">
                <h1>Satellite → Ground</h1>
                <button onClick={() => setView("overview")}>กลับไปดูภาพ</button>
              </div>
              <WorkspaceSection
                id="globe"
                title="Satellite → Ground / 3D Geometry"
                className="scroll-globe viewing-page-globe"
              >
                <GlobePanel />
              </WorkspaceSection>
              <WorkspaceSection
                id="timeline"
                title="Timeline View"
                className="scroll-timeline"
              >
                <Timeline />
              </WorkspaceSection>
              <WorkspaceSection
                id="properties"
                title="Acquisition Properties"
                className="scroll-properties"
              >
                <Properties />
              </WorkspaceSection>
            </div>
          ) : scrollLayout ? (
            <div className="scroll-workspace">
              <div className="workspace-page-heading">
                <div>
                  <p className="eyebrow">
                    {view === "sites"
                      ? "THREE-SITE OVERVIEW"
                      : "IMAGERY WORKSPACE"}
                  </p>
                  <h1>
                    {view === "sites"
                      ? "ภาพรวมพื้นที่สังเกตการณ์"
                      : `${site?.name || "Satellite"} observations`}
                  </h1>
                  <p>สำรวจภาพย้อนหลัง เลือกวันถ่าย และตรวจสอบข้อมูลต้นทาง</p>
                </div>
                <div className="workspace-summary">
                  <span>
                    <strong>
                      {scenes.filter((r) => r.site_id === siteId).length}
                    </strong>{" "}
                    ภาพในพื้นที่
                  </span>
                  <span>
                    <strong>{selected?.platform || "—"}</strong>{" "}
                    ดาวเทียมที่เลือก
                  </span>
                </div>
              </div>
              <WorkspaceSection
                id="image"
                title="2D Image View"
                className={
                  "scroll-image" +
                  (view === "sites" ? " site-overview-section" : "")
                }
              >
                <ImagePanel />
              </WorkspaceSection>
              <WorkspaceSection
                id="timeline"
                title="Timeline View"
                className="scroll-timeline"
              >
                <Timeline />
              </WorkspaceSection>
              <div className="analysis-sections">
                <WorkspaceSection
                  id="globe"
                  title="3D Geometry View"
                  className="scroll-globe"
                >
                  <GlobePanel />
                </WorkspaceSection>
                <WorkspaceSection
                  id="properties"
                  title="Acquisition Properties"
                  className="scroll-properties"
                >
                  <Properties />
                </WorkspaceSection>
                <WorkspaceSection
                  id="metrics"
                  title="Analysis & Review"
                  className="scroll-metrics"
                >
                  <Metrics />
                </WorkspaceSection>
                <WorkspaceSection
                  id="jobs"
                  title="Message Viewer / Jobs"
                  className="scroll-jobs"
                >
                  <Jobs />
                </WorkspaceSection>
              </div>
              <WorkspaceSection
                id="catalog"
                title="Acquisition Catalog"
                className="scroll-catalog"
              >
                <Catalog />
              </WorkspaceSection>
            </div>
          ) : (
            <DockviewReact
              theme={THEME}
              onReady={ready}
              components={COMPONENTS}
            />
          )}
        </main>
        <footer>
          <span className="live-dot" />{" "}
          {view === "samples" ? (
            "Public optical imagery · attribution and licence shown with each image"
          ) : (
            <>
              Local archive workspace{" "}
              <span className="footer-object">
                {selected?.platform || "—"} / {site?.name || "Loading"}
              </span>
              <span>
                {selected
                  ? localTime(selected.center_utc, "UTC") + " UTC"
                  : "Loading catalog…"}
              </span>
              <span>© Umbra · CC BY 4.0</span>
            </>
          )}
        </footer>
      </div>
    </Studio.Provider>
  );
}

function WorkspaceSection({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`panel-${id}`}
      aria-labelledby={`heading-${id}`}
      className={`workspace-section ${className}`}
    >
      <h2 id={`heading-${id}`}>{title}</h2>
      <div className="section-body">{children}</div>
    </section>
  );
}

function Catalog() {
  const s = useStudio();
  const [pol, setPol] = useState("all");
  const list = s.scenes.filter(
    (r) =>
      r.site_id === s.site?.id &&
      `${r.platform} ${r.center_utc}`
        .toLowerCase()
        .includes(s.filter.toLowerCase()) &&
      (pol === "all" || r.polarization === pol),
  );
  return (
    <div className="catalog">
      <div className="panel-heading">
        <Satellite size={16} />
        <strong>{s.site?.name || "Archive"}</strong>
        <span>{list.length} scenes</span>
      </div>
      <div className="catalog-filters">
        <input
          aria-label="Find acquisition"
          placeholder="Find satellite or date…"
          value={s.filter}
          onChange={(e) => s.setFilter(e.target.value)}
        />
        <select
          aria-label="Polarization"
          value={pol}
          onChange={(e) => setPol(e.target.value)}
        >
          <option value="all">All polarization</option>
          <option>VV</option>
          <option>HH</option>
        </select>
      </div>
      <div className="tree-caption">
        ACQUISITIONS <span>Date / satellite / incidence</span>
      </div>
      <div className="scene-list">
        {list.map((r) => (
          <button
            key={r.id}
            className={
              "scene-row " + (s.selected?.id === r.id ? "selected" : "")
            }
            aria-pressed={s.selected?.id === r.id}
            onClick={() => s.select(r.id)}
          >
            <span className={"scene-icon " + (r.ready ? "ready" : "")}>
              <ImageIcon size={15} />
            </span>
            <span className="scene-text">
              <strong>
                {localTime(r.center_utc, s.site.timezone).split(",")[0]}
              </strong>
              <small>
                {r.platform}{" "}
                <span>
                  · {r.polarization} · {r.incidence_deg.toFixed(1)}°
                </span>
              </small>
            </span>
            <span className="scene-time">
              {localTime(r.center_utc, s.site.timezone)
                .split(", ")[1]
                ?.slice(0, 5)}
              {r.ready && <Check size={11} />}
              <span className="sr-only">
                {r.ready ? " · พร้อมแสดงภาพ" : " · ยังไม่เตรียมภาพ"}
              </span>
            </span>
          </button>
        ))}
        {!list.length && <p className="empty-small">ไม่มีภาพตรงกับตัวกรอง</p>}
      </div>
      <div className="catalog-note">
        ชื่อดาวและเวลาจาก metadata
        <br />
        สีเขียว = มีภาพพร้อมเปิดในเครื่อง
      </div>
    </div>
  );
}

function ImagePanel() {
  const s = useStudio();
  const d = s.detail?.id === s.selected?.id ? s.detail : null;
  const requestedColors = useRef(new Set<string>());
  const product = d?.color_products?.[s.imageMode];
  const externalColor = s.imageMode === "csi" || s.imageMode === "optical";
  useEffect(() => {
    if (
      !externalColor ||
      !d?.preview ||
      product ||
      !s.selected ||
      (s.view !== "overview" && s.view !== "roi")
    )
      return;
    if (s.imageMode === "csi" && !s.selected.csi_public_url) return;
    const key = `${s.selected.id}:${s.imageMode}:${d.preview.generated_utc}`;
    if (requestedColors.current.has(key)) return;
    requestedColors.current.add(key);
    void s.run(s.imageMode);
  }, [s.imageMode, s.view, d?.id, d?.preview?.generated_utc, product]);
  const [zoom, setZoom] = useState(1),
    [swipe, setSwipe] = useState(50),
    [lon, setLon] = useState(""),
    [lat, setLat] = useState(""),
    [width, setWidth] = useState(500);
  const [frame, setFrame] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () =>
      setFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => {
    setZoom(1);
    setFrame(0);
    setWidth(d?.preview?.roi.width_m ?? 500);
    setLon(String(d?.preview?.roi.lon ?? s.site?.lon ?? ""));
    setLat(String(d?.preview?.roi.lat ?? s.site?.lat ?? ""));
  }, [d?.id, d?.preview?.roi.lon, d?.preview?.roi.lat, s.site?.id]);
  if (!s.selected)
    return <Empty title="Loading archive" text="กำลังอ่านแคตตาล็อก…" />;
  const roi = d?.preview?.roi,
    has = d?.id === s.selected.id && !!d?.preview;
  const tab = s.view;
  const baseImage = has
    ? tab === "roi"
      ? roi.url
      : d.preview.preview.url
    : "";
  const image = externalColor
    ? product
      ? tab === "roi"
        ? product.roi_url
        : product.preview_url
      : ""
    : s.imageMode === "grayscale"
      ? baseImage
      : `/api/eo/scenes/${s.selected.id}/render/${tab === "roi" ? "roi" : "preview"}.png?palette=${s.imageMode}`;
  const versionedImage =
    image +
    (image.includes("?") ? "&" : "?") +
    "v=" +
    (product?.generated_utc || d?.preview?.generated_utc || "");
  const size = tab === "roi" ? roi?.size : 1024;
  const features =
    tab === "roi" && s.overlay && !externalColor
      ? d?.detections?.features || []
      : [];
  if (tab === "sites") return <CrossSite />;
  function point(e: React.MouseEvent<SVGSVGElement>) {
    if (!has || tab !== "overview") return;
    const box = svg.current!.getBoundingClientRect(),
      scale = Math.min(box.width / 1024, box.height / 1024),
      ox = (box.width - 1024 * scale) / 2,
      oy = (box.height - 1024 * scale) / 2;
    const u = (e.clientX - box.left - ox) / (scale * 1024),
      v = (e.clientY - box.top - oy) / (scale * 1024);
    const b = d.preview.preview.bbox;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      const targetLon = b[0] + u * (b[2] - b[0]),
        targetLat = b[3] - v * (b[3] - b[1]);
      setLon(targetLon.toFixed(7));
      setLat(targetLat.toFixed(7));
      s.setGroundTarget({ lon: targetLon, lat: targetLat, height_m: 0 });
    }
  }
  return (
    <div className="image-panel" ref={panelRef}>
      <div className="acquisition-controls">
        <label htmlFor="image-acquisition">Acquisition</label>
        <select
          id="image-acquisition"
          aria-label="Image acquisition"
          value={s.selected.id}
          onChange={(e) => s.select(e.target.value)}
        >
          {s.scenes
            .filter((r) => r.site_id === s.site.id)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {localTime(r.center_utc, s.site.timezone)} · {r.platform} ·{" "}
                {r.polarization}
              </option>
            ))}
        </select>
      </div>
      <div className="color-controls">
        <label htmlFor="image-color">Image style</label>
        <select
          id="image-color"
          aria-label="Image style"
          disabled={tab !== "overview" && tab !== "roi"}
          value={s.imageMode}
          onChange={(e) => s.setImageMode(e.target.value)}
        >
          <option value="grayscale">SAR · Grayscale</option>
          <option value="viridis">SAR · Viridis false color</option>
          <option value="inferno">SAR · Inferno false color</option>
          <option value="csi">CSI · Radar RGB</option>
          <option value="optical">Sentinel-2 · Natural color</option>
        </select>
        {(tab === "overview" || tab === "roi") &&
          image &&
          (!externalColor || product) && (
            <a href={image} target="_blank" rel="noreferrer" download>
              Download displayed PNG
            </a>
          )}
      </div>
      {tab === "overview" || tab === "roi" ? (
        <div
          className={
            "color-explanation " + (externalColor ? "color-source" : "")
          }
        >
          {s.imageMode === "grayscale" &&
            "SAR ขาวดำ · ความสว่างจากการสะท้อนเรดาร์"}
          {(s.imageMode === "viridis" || s.imageMode === "inferno") && (
            <>
              <span className={"palette-gradient " + s.imageMode} />
              <span>
                0 → 255 · สีแทนความสว่างที่ปรับแสดงผล รายละเอียดเท่าเดิม
              </span>
            </>
          )}
          {s.imageMode === "csi" &&
            (product
              ? `CSI · ${product.platform} · ${product.acquired_utc} · ${(product.resolution_m * 100).toFixed(0)} cm · สีจาก sub-aperture ไม่ใช่สีธรรมชาติหรือหลักฐานยืนยันการเคลื่อนไหว`
              : "CSI มีเฉพาะบาง acquisition · เลือกภาพที่มีไฟล์ CSI สาธารณะ")}
          {s.imageMode === "optical" &&
            (product
              ? `Sentinel-2 · ${product.acquired_utc} · 10 m · ห่าง SAR ${product.days_from_sar.toFixed(1)} วัน · เมฆ/เงาในพื้นที่ ${product.aoi_cloud_shadow_percent?.toFixed(1) ?? "unknown"}% · การขยายกริดไม่เพิ่มรายละเอียด`
              : "กำลังเตรียมภาพสีธรรมชาติที่มีวันถ่ายระบุชัดเจนจาก Sentinel-2")}
        </div>
      ) : (
        <div className="color-explanation">
          {tab === "compare"
            ? "Compare · เปรียบเทียบความสว่าง GEC ของ SAR"
            : "Sequence · เฟรมทดลองจาก SICD ของ SAR"}
        </div>
      )}
      <div className="view-tabs">
        {[
          ["overview", "ภาพเต็ม"],
          ["roi", "ดูพื้นที่ใกล้"],
          ["compare", "Compare"],
          ["sequence", "Sequence"],
        ].map(([v, label]) => (
          <button
            key={v}
            className={tab === v ? "active" : ""}
            onClick={() => s.setView(v)}
          >
            {label}
          </button>
        ))}
        <span>
          {s.selected.platform} · {s.selected.polarization}
        </span>
        <button
          className="image-fullscreen-button"
          onClick={() => {
            const operation = document.fullscreenElement
              ? document.exitFullscreen()
              : panelRef.current?.requestFullscreen();
            void operation?.catch((e) => s.message(String(e)));
          }}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {fullscreen ? "ออกจากเต็มจอ" : "ขยายเต็มจอ"}
        </button>
      </div>
      {(tab === "overview" || tab === "roi") && (
        <div className="image-tools">
          <label>
            Zoom{" "}
            <input
              aria-label="Image zoom"
              type="range"
              min="1"
              max="5"
              step="0.25"
              value={zoom}
              onChange={(e) => setZoom(+e.target.value)}
            />
          </label>
          <button onClick={() => setZoom(1)}>
            <Crosshair size={13} /> พอดีจอ
          </button>
          <span>
            {tab === "roi" && roi
              ? `ROI = พื้นที่สนใจ ${roi.width_m} m · ${s.imageMode === "optical" ? "ต้นทาง Sentinel-2 10 m" : `กริด ${roi.pixel_m.toFixed(2)} m/px`}`
              : "Double-click to set ROI centre"}
          </span>
        </div>
      )}
      {externalColor &&
      !product &&
      has &&
      (tab === "overview" || tab === "roi") ? (
        <Empty
          title={
            s.imageMode === "csi"
              ? "CSI radar color"
              : "Sentinel-2 natural color"
          }
          text={
            s.imageMode === "csi" && !s.selected.csi_public_url
              ? "acquisition นี้ไม่มี CSI เลือกภาพ CSI ของพื้นที่เดียวกันได้ด้านล่าง"
              : "งานกำลังอ่านข้อมูลภาพสี ดูความคืบหน้าที่ Message Viewer / Jobs"
          }
          action={
            <div className="color-actions">
              {s.imageMode === "csi" && !s.selected.csi_public_url ? (
                <select
                  aria-label="CSI acquisition"
                  value=""
                  onChange={(e) => s.select(e.target.value)}
                >
                  <option value="">Choose a CSI acquisition…</option>
                  {s.scenes
                    .filter((r) => r.site_id === s.site.id && r.csi_public_url)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.center_utc.slice(0, 10)} · {r.platform}
                      </option>
                    ))}
                </select>
              ) : (
                <button
                  className="primary"
                  onClick={() => void s.run(s.imageMode)}
                >
                  Prepare / retry color image
                </button>
              )}
            </div>
          }
        />
      ) : !has ? (
        <Empty
          title={s.loading ? "Loading acquisition…" : "Open this acquisition"}
          text="อ่านภาพจริงจาก Umbra แล้วเก็บเฉพาะภาพย่อและ ROI ไว้ในเครื่อง"
          action={
            <button className="primary" onClick={() => void s.run("prepare")}>
              <FolderOpen size={16} /> Load real SAR imagery
            </button>
          }
        />
      ) : tab === "sequence" ? (
        <div className="sequence-view">
          {d.sequence ? (
            <>
              <img
                alt="Experimental SICD aspect sequence"
                src={d.sequence.gif_url + "?v=" + d.sequence.downloaded_bytes}
              />
              <div className="sequence-actions">
                <a href={d.sequence.gif_url} download>
                  Download GIF
                </a>
                {d.sequence.mp4_url && (
                  <a href={d.sequence.mp4_url} download>
                    Download MP4
                  </a>
                )}
                <button onClick={() => void s.run("sequence")}>
                  Regenerate
                </button>
              </div>
              <p>{d.sequence.warning}</p>
              <div className="metadata-strip">
                {d.sequence.frame_count} frames ·{" "}
                {(d.sequence.downloaded_bytes / 1e6).toFixed(1)} MB read ·{" "}
                {d.sequence.image_formation}
              </div>
            </>
          ) : (
            <Empty
              title="Experimental aspect sequence"
              text="ใช้ SICD และข้อมูลเรขาคณิตจริงสร้างเฟรมย่อยที่ทับซ้อนกัน ยังไม่ใช่วิดีโอที่ระบุเวลาและความเร็วรถได้"
              action={
                <button
                  className="primary"
                  onClick={() => void s.run("sequence")}
                >
                  <Film size={16} /> Create 8-frame sequence
                </button>
              }
            />
          )}
        </div>
      ) : tab === "compare" ? (
        <div className="compare-view">
          <div className="compare-controls">
            <select
              aria-label="Reference acquisition"
              value={s.reference}
              onChange={(e) => s.setReference(e.target.value)}
            >
              <option value="">Choose reference acquisition…</option>
              {s.scenes
                .filter(
                  (r) => r.site_id === s.site.id && r.id !== s.selected!.id,
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.center_utc.slice(0, 10)} · {r.platform} ·{" "}
                    {r.incidence_deg.toFixed(1)}° {r.polarization}
                  </option>
                ))}
            </select>
            <button
              disabled={!s.reference}
              onClick={() =>
                void s.run("compare", { reference_id: s.reference })
              }
            >
              Prepare & compare
            </button>
          </div>
          {d.change ? (
            <>
              <div className="swipe-image">
                <img alt="Current ROI" src={roi.url} />
                <img
                  alt="Reference ROI"
                  className="reference-image"
                  style={{ clipPath: `inset(0 ${100 - swipe}% 0 0)` }}
                  src={`/api/eo/scenes/${d.change.reference_id}/files/roi.png`}
                />
                <span className="swipe-line" style={{ left: swipe + "%" }} />
                <b>Reference</b>
                <b>Current</b>
              </div>
              <input
                aria-label="Comparison swipe"
                type="range"
                min="0"
                max="100"
                value={swipe}
                onChange={(e) => setSwipe(+e.target.value)}
              />
              <div className="compare-quality">
                <span
                  className={
                    "tag " + (d.change.geometry_matched ? "good" : "amber")
                  }
                >
                  {d.change.geometry_matched
                    ? "Matched geometry"
                    : "Different geometry"}
                </span>
                Estimated translation:{" "}
                {d.change.translation_m
                  .map((v: number) => v.toFixed(2))
                  .join(", ")}{" "}
                m{" "}
                <a href={d.change.url} target="_blank">
                  Change image ↗
                </a>
                <small>{d.change.quality}</small>
              </div>
            </>
          ) : (
            <Empty
              title="Compare the same location"
              text="เลือกภาพอ้างอิง ระบบจะตัด ROI เดียวกันและตรวจความใกล้เคียงของมุมถ่ายก่อนแสดงผล"
            />
          )}
        </div>
      ) : (
        <div className="image-scroll">
          <div
            className="image-stage"
            style={{ width: zoom * 100 + "%", height: zoom * 100 + "%" }}
          >
            <svg
              ref={svg}
              viewBox={`0 0 ${size} ${size}`}
              onDoubleClick={point}
              aria-label="SAR image with overlays"
            >
              <image href={versionedImage} width={size} height={size} />
              {tab === "overview" &&
                s.groundTarget &&
                (() => {
                  const b = d.preview.preview.bbox,
                    target = s.groundTarget;
                  const x = ((target.lon - b[0]) / (b[2] - b[0])) * 1024;
                  const y = ((b[3] - target.lat) / (b[3] - b[1])) * 1024;
                  if (x < 0 || x > 1024 || y < 0 || y > 1024) return null;
                  return (
                    <g role="img" aria-label="Selected viewing target in image">
                      <circle
                        cx={x}
                        cy={y}
                        r="8"
                        fill="#f5be54"
                        stroke="#fff"
                        strokeWidth="2"
                      />
                      <path
                        d={`M${x - 17} ${y}h9M${x + 8} ${y}h9M${x} ${y - 17}v9M${x} ${y + 8}v9`}
                        stroke="#f5be54"
                        strokeWidth="2"
                      />
                      <text
                        x={Math.min(x + 20, 820)}
                        y={Math.max(y - 18, 20)}
                        fill="#f5d888"
                        fontSize="15"
                      >
                        Selected ground point
                      </text>
                    </g>
                  );
                })()}
              {tab === "overview" &&
                s.overlay &&
                roi &&
                (() => {
                  const a = d.preview.preview.bbox,
                    b = roi.bbox,
                    x = ((b[0] - a[0]) / (a[2] - a[0])) * 1024,
                    y = ((a[3] - b[3]) / (a[3] - a[1])) * 1024,
                    w = ((b[2] - b[0]) / (a[2] - a[0])) * 1024,
                    h = ((b[3] - b[1]) / (a[3] - a[1])) * 1024;
                  return (
                    <g>
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        fill="#50d8bc15"
                        stroke="#50d8bc"
                        strokeWidth="2"
                      />
                      <text x={x + 4} y={y - 8} fill="#50d8bc" fontSize="16">
                        Analysis ROI
                      </text>
                    </g>
                  );
                })()}
              {features.map((f: any) => (
                <circle
                  role="button"
                  aria-label={`Candidate ${f.id}`}
                  key={f.id}
                  cx={f.properties.x}
                  cy={f.properties.y}
                  r={s.candidate === f.id ? 10 : 5}
                  strokeWidth={2}
                  stroke={
                    f.properties.review === "accepted"
                      ? "#5ed7ad"
                      : f.properties.review === "rejected"
                        ? "#cf6b6b"
                        : "#f9c65d"
                  }
                  fill="transparent"
                  onClick={() => s.setCandidate(f.id)}
                />
              ))}
            </svg>
            <div className="image-stamp">
              <span>
                {s.imageMode === "optical"
                  ? `OPTICAL / ${product?.platform || "Sentinel-2"}`
                  : `${s.imageMode === "csi" ? "CSI" : "SAR"} / ${s.selected.platform}`}
              </span>
              <strong>
                {(product?.acquired_utc || s.selected.center_utc)
                  .replace("T", " ")
                  .slice(0, 19)}{" "}
                UTC
              </strong>
              <small>{product?.attribution || "© Umbra · CC BY 4.0"}</small>
            </div>
            {tab === "roi" && roi && (
              <div className="scale-bar">
                ROI width {roi.width_m} m{" "}
                <small>· {roi.pixel_m.toFixed(2)} m grid</small>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="roi-controls">
        <label>
          Lon
          <input
            aria-label="ROI longitude"
            type="number"
            step="0.0001"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
          />
        </label>
        <label>
          Lat
          <input
            aria-label="ROI latitude"
            type="number"
            step="0.0001"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
        </label>
        <label>
          Width
          <select
            aria-label="ROI width"
            value={width}
            onChange={(e) => setWidth(+e.target.value)}
          >
            {[100, 250, 500, 1000].map((v) => (
              <option key={v} value={v}>
                {v} m
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!lon || !lat}
          onClick={() =>
            void s.run("prepare", { lon: +lon, lat: +lat, width_m: width })
          }
        >
          Apply ROI
        </button>
        <button
          onClick={() => {
            const point = { lon: +lon, lat: +lat, height_m: 0 };
            if (!lon.trim() || !lat.trim() || !validGroundPoint(point)) {
              s.message("กรอกพิกัดที่ถูกต้องก่อนแสดงแนวเล็ง");
              return;
            }
            s.setGroundTarget(point);
            s.setView("geometry");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          ดูแนวเล็ง 3D
        </button>
      </div>
      <div className="image-footnote">
        {has
          ? externalColor && (tab === "overview" || tab === "roi")
            ? product?.attribution || "Color product pending"
            : `${d.preview.source_dtype} GEC display intensity · uncalibrated · ${d.preview.source_shape.join(" × ")} source pixels`
          : "No raster loaded for this acquisition"}
      </div>
    </div>
  );
}

function Properties() {
  const s = useStudio(),
    d = s.detail?.id === s.selected?.id ? s.detail : null;
  if (!s.selected) return null;
  const r = s.selected,
    g = d?.geometry,
    m = g?.samples?.[Math.min(s.sample, g.samples.length - 1)];
  return (
    <div className="properties">
      <div className="property-title">
        <Satellite size={16} />
        {r.platform}
        <span className="tag">{r.products.join(" / ")}</span>
      </div>
      <dl>
        <dt>Acquired (local)</dt>
        <dd>{localTime(r.center_utc, s.site.timezone)}</dd>
        <dt>Incidence / duration</dt>
        <dd>
          {r.incidence_deg.toFixed(2)}° / {r.duration_s.toFixed(1)} s
        </dd>
        <dt>Range resolution</dt>
        <dd>
          {(r.range_resolution_m * 100).toFixed(0)} cm{" "}
          <span className="muted">metadata</span>
        </dd>
        <dt>Geometry source</dt>
        <dd>{g ? "SICD ARPPoly" : "Not loaded"}</dd>
        {m && (
          <>
            <dt>Satellite time (UTC)</dt>
            <dd>{m.time.replace("T", " ").replace("Z", " UTC")}</dd>
            <dt>Satellite latitude</dt>
            <dd>{m.lat.toFixed(6)}°</dd>
            <dt>Satellite longitude</dt>
            <dd>{m.lon.toFixed(6)}°</dd>
            <dt>Height above WGS84</dt>
            <dd>{(m.altitude_m / 1000).toFixed(3)} km</dd>
            <dt>Satellite ECEF (m)</dt>
            <dd>
              {m.ecef_m.map((value: number) => value.toFixed(1)).join(", ")}
            </dd>
            <dt>Altitude / range</dt>
            <dd>
              {(m.altitude_m / 1000).toFixed(2)} /{" "}
              {(m.slant_range_m / 1000).toFixed(2)} km
            </dd>
            <dt>Azimuth / elevation</dt>
            <dd>
              {m.azimuth_deg.toFixed(2)}° / {m.elevation_deg.toFixed(2)}°
            </dd>
          </>
        )}
      </dl>
      <div className="sources">
        <a href={r.stac_url} target="_blank" rel="noreferrer">
          STAC metadata ↗
        </a>
        <a href={`/api/eo/scenes/${r.id}/files/geometry.json`} target="_blank">
          Geometry JSON ↗
        </a>
      </div>
      {m && (
        <div className="collect-time">
          <label>
            Collect position <b>{m.t_s.toFixed(2)} s</b>
          </label>
          <input
            aria-label="Collect time"
            type="range"
            min="0"
            max={g.samples.length - 1}
            value={s.sample}
            onChange={(e) => s.setSample(+e.target.value)}
          />
          <small>
            Producer trajectory · {g.samples.length} samples · ตำแหน่งขณะถ่ายจาก
            SICD ARPPoly
          </small>
        </div>
      )}
    </div>
  );
}

function SkyPlot() {
  const s = useStudio(),
    g = s.detail?.id === s.selected?.id ? s.detail?.geometry : null;
  const sample = g?.samples?.[Math.min(s.sample, g.samples.length - 1)];
  const pos = (a: number, e: number) => [
    100 + ((75 * (90 - e)) / 90) * Math.sin((a * Math.PI) / 180),
    100 - ((75 * (90 - e)) / 90) * Math.cos((a * Math.PI) / 180),
  ];
  return (
    <svg
      viewBox="0 0 200 200"
      className="skyplot"
      aria-label="Target-to-satellite sky plot"
    >
      {[25, 50, 75].map((r) => (
        <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#d8e1e8" />
      ))}
      <path d="M25 100h150M100 25v150" stroke="#d8e1e8" />
      <text x="96" y="16">
        N
      </text>
      <text x="182" y="104">
        E
      </text>
      <text x="96" y="192">
        S
      </text>
      <text x="5" y="104">
        W
      </text>
      <text x="102" y="74" className="angle">
        60°
      </text>
      {g && (
        <polyline
          points={g.samples
            .map((p: any) => pos(p.azimuth_deg, p.elevation_deg).join(","))
            .join(" ")}
          fill="none"
          stroke="#239780"
          strokeWidth="3"
        />
      )}
      {sample && (
        <circle
          cx={pos(sample.azimuth_deg, sample.elevation_deg)[0]}
          cy={pos(sample.azimuth_deg, sample.elevation_deg)[1]}
          r="5"
          fill="#155f72"
          stroke="white"
          strokeWidth="2"
        />
      )}
      {!sample && (
        <text x="100" y="105" textAnchor="middle" className="angle">
          Load geometry
        </text>
      )}
    </svg>
  );
}

function Metrics() {
  const s = useStudio(),
    d = s.detail;
  const [kind, setKind] = useState("bright_candidate");
  const features = d?.detections?.features || [],
    chosen = features.find((f: any) => f.id === s.candidate);
  const accepted = features.filter(
    (f: any) => f.properties.review === "accepted",
  ).length;
  return (
    <div className="metrics">
      <div className="metrics-summary">
        <SkyPlot />
        <div className="stat">
          <small>BRIGHT CANDIDATES</small>
          <strong>{d?.detections ? features.length : "—"}</strong>
          <span>{accepted} manually accepted</span>
          <button disabled={!d?.preview} onClick={() => void s.run("detect")}>
            Run baseline
          </button>
        </div>
        <div className="quality-note">
          <span className="tag amber">Research baseline</span>
          <p>
            จุดสว่างยังไม่ใช่จำนวนรถหรือเรือที่ยืนยันแล้ว
            ตรวจด้วยมือและกำหนดประเภทก่อนส่งออก
          </p>
          {d?.detections && (
            <a href={`/api/eo/scenes/${s.selected?.id}/export.csv`}>
              <Download size={12} /> Export candidates
            </a>
          )}
        </div>
      </div>
      {features.length > 0 && (
        <div className="candidate-review">
          <select
            aria-label="Candidate"
            value={s.candidate ?? ""}
            onChange={(e) => s.setCandidate(+e.target.value)}
          >
            <option value="">Select candidate…</option>
            {features.map((f: any) => (
              <option key={f.id} value={f.id}>
                #{f.id} · {f.properties.area_m2.toFixed(1)} m² ·{" "}
                {f.properties.review}
              </option>
            ))}
          </select>
          <select
            aria-label="Candidate class"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {["bright_candidate", "car", "truck", "vessel", "other"].map(
              (k) => (
                <option key={k}>{k}</option>
              ),
            )}
          </select>
          <button
            disabled={!chosen}
            onClick={() => void s.review("accepted", kind)}
          >
            Accept
          </button>
          <button
            disabled={!chosen}
            onClick={() => void s.review("rejected", kind)}
          >
            Reject
          </button>
          {chosen && (
            <small>
              {chosen.geometry.coordinates
                .map((v: number) => v.toFixed(5))
                .join(", ")}
            </small>
          )}
        </div>
      )}
    </div>
  );
}

function Jobs() {
  const s = useStudio();
  return (
    <div className="jobs">
      <div className="job-head">
        <span className="live-dot" /> Worker queue{" "}
        <b>
          {s.jobs.filter((j) => ["running", "queued"].includes(j.state)).length}{" "}
          active
        </b>
      </div>
      {s.jobs.length ? (
        s.jobs.slice(0, 12).map((j) => (
          <div className={"job " + j.state} key={j.id}>
            <div>
              <strong>{j.kind}</strong>
              <span>{j.state}</span>
              {["queued", "running"].includes(j.state) && (
                <button
                  aria-label="Cancel job"
                  onClick={() =>
                    void request("/jobs/" + j.id + "/cancel", {
                      method: "POST",
                    }).catch((e) => s.message(String(e)))
                  }
                >
                  <Square size={10} />
                </button>
              )}
            </div>
            <p>{j.error || j.message}</p>
            {j.state === "running" && <progress max="100" value={j.progress} />}
          </div>
        ))
      ) : (
        <div className="empty-small">
          พร้อมอ่านภาพย้อนหลัง
          <br />
          เลือกภาพแล้วกด Open imagery
        </div>
      )}
    </div>
  );
}

function Timeline() {
  const s = useStudio();
  const list = s.scenes.filter((r) => r.site_id === s.site?.id),
    index = list.findIndex((r) => r.id === s.selected?.id),
    start = Date.parse(list[0]?.center_utc || ""),
    end = Date.parse(list.at(-1)?.center_utc || "");
  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button
          aria-label="Previous acquisition"
          disabled={index <= 0}
          onClick={() => s.select(list[index - 1].id)}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          aria-label={s.playing ? "Pause timeline" : "Play timeline"}
          onClick={() => s.setPlaying(!s.playing)}
        >
          {s.playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button
          aria-label="Next acquisition"
          disabled={index >= list.length - 1}
          onClick={() => s.select(list[index + 1].id)}
        >
          <ChevronRight size={15} />
        </button>
        <span>
          {s.selected ? localTime(s.selected.center_utc, s.site.timezone) : "—"}
        </span>
        <small>
          Acquisition {index + 1} / {list.length}
        </small>
      </div>
      <div className="timeline-track">
        <div className="timeline-axis" />
        {list.map((r) => (
          <button
            key={r.id}
            title={`${r.center_utc} ${r.platform}`}
            aria-label={`Select ${r.center_utc}`}
            className={
              "timeline-point " + (r.id === s.selected?.id ? "current" : "")
            }
            style={{
              left:
                ((Date.parse(r.center_utc) - start) / (end - start)) * 96 +
                2 +
                "%",
              background: r.ready ? "#259c89" : undefined,
            }}
            onClick={() => s.select(r.id)}
          />
        ))}
        <span>{list[0]?.center_utc.slice(0, 10)}</span>
        <span>{list.at(-1)?.center_utc.slice(0, 10)}</span>
      </div>
    </div>
  );
}

function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-orbit">
        <Satellite size={30} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}
function GlobePanel() {
  return (
    <Suspense
      fallback={<div className="empty-small">Loading 3D renderer…</div>}
    >
      <Globe />
    </Suspense>
  );
}
const COMPONENTS = {
  catalog: Catalog,
  image: ImagePanel,
  globe: GlobePanel,
  properties: Properties,
  metrics: Metrics,
  jobs: Jobs,
  timeline: Timeline,
};
window.addEventListener("error", (e) => {
  void fetch("/api/eo/client-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: e.message, stack: e.error?.stack }),
  });
});
export class AppBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  componentDidCatch(error: Error) {
    void fetch("/api/eo/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: error.message, stack: error.stack }),
    });
  }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message + "\n" + error.stack };
  }
  render() {
    return this.state.error ? (
      <pre role="alert" style={{ padding: 24, whiteSpace: "pre-wrap" }}>
        Workspace error: {this.state.error}
      </pre>
    ) : (
      this.props.children
    );
  }
}
if (import.meta.env.MODE !== "test") {
  createRoot(document.getElementById("root")!).render(
    <AppBoundary>
      <App />
    </AppBoundary>,
  );
}
