from __future__ import annotations

import asyncio
import csv
import io
import json
import os
import signal
import subprocess
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator
from eo_engine.catalog import ROOT, DATA, SITES, scenes, scene, scene_dir, save_json
from eo_engine.process import SpawnedWorker

LOCK = threading.RLock()
POOL = ThreadPoolExecutor(max_workers=1)
PROCESSES = {}
WORKER_PYTHON = (
    str(ROOT / ".venv/bin/python")
    if (ROOT / ".venv/bin/python").exists()
    else sys.executable
)


def now():
    return datetime.now(timezone.utc).isoformat()


def get_job(job_id):
    try:
        uuid.UUID(job_id)
        return json.loads((DATA / "jobs" / f"{job_id}.json").read_text())
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, "Unknown job")


def update(job_id, **fields):
    with LOCK:
        job = get_job(job_id)
        if job["state"] == "cancelled":
            return job
        job.update(fields, updated_utc=now())
        save_json(DATA / "jobs" / f"{job_id}.json", job)
        return job


def run_job(job_id):
    with LOCK:
        if get_job(job_id)["state"] == "cancelled":
            return
        update(job_id, state="running", progress=1, message="Starting worker")
        log = (DATA / "jobs" / f"{job_id}.log").open("w")
        try:
            optical = get_job(job_id)["kind"] == "sample_detect"
            python = str(ROOT / ".venv-detection/bin/python") if optical else WORKER_PYTHON
            entry = "optical_worker_entry.py" if optical else "worker_entry.py"
            process = SpawnedWorker(
                [python, "-u", str(ROOT / entry), job_id],
                stderr=log,
                env={**os.environ, "EO_DATA": str(DATA)},
            )
        except Exception as exc:
            log.write(f"Unable to start worker: {exc}\n")
            log.close()
            update(
                job_id,
                state="failed",
                error=str(exc),
                message=f"Unable to start worker: {exc}",
                finished_utc=now(),
            )
            return
        PROCESSES[job_id] = process
    try:
        for line in process.stdout:
            try:
                update(job_id, **json.loads(line))
            except (ValueError, TypeError):
                pass
        code = process.wait()
        job = get_job(job_id)
        if job["state"] != "cancelled":
            update(
                job_id,
                state="completed" if code == 0 else "failed",
                progress=100 if code == 0 else job["progress"],
                message="Complete"
                if code == 0
                else job.get("error", f"Worker exited ({code}); inspect log"),
                finished_utc=now(),
            )
    finally:
        process.stdout.close()
        log.close()
        with LOCK:
            PROCESSES.pop(job_id, None)


@asynccontextmanager
async def lifespan(app):
    (DATA / "jobs").mkdir(parents=True, exist_ok=True)
    for p in (DATA / "jobs").glob("*.json"):
        if p.name.endswith(".result.json"):
            continue
        job = json.loads(p.read_text())
        if job["state"] in ("queued", "running"):
            job.update(state="interrupted", message="Server stopped before completion")
            save_json(p, job)
    yield
    with LOCK:
        for process in list(PROCESSES.values()):
            if process.poll() is None:
                process.signal_group(signal.SIGTERM)


app = FastAPI(title="Earth Observation Studio", lifespan=lifespan)


@app.post("/api/eo/client-errors", status_code=204)
async def client_errors(request: Request):
    raw = (await request.body())[:12000].decode("utf-8", errors="replace")
    (DATA / "logs").mkdir(parents=True, exist_ok=True)
    with (DATA / "logs/client-errors.log").open("a") as f:
        f.write(now() + " " + raw + "\n")
    return Response(status_code=204)


@app.middleware("http")
async def local_mutations(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and origin not in (
            "http://127.0.0.1:8018",
            "http://localhost:8018",
            "http://127.0.0.1:5178",
            "http://localhost:5178",
        ):
            return JSONResponse(
                {"detail": "Origin is not this local app"}, status_code=403
            )
    return await call_next(request)


class JobRequest(BaseModel):
    scene_id: str
    kind: Literal[
        "prepare", "detect", "geometry", "compare", "sequence", "csi", "optical"
    ] = "prepare"
    lon: float | None = Field(None, ge=-180, le=180)
    lat: float | None = Field(None, ge=-90, le=90)
    width_m: float = Field(500, ge=50, le=2000)
    ratio: float = Field(3.5, ge=1.5, le=20)
    reference_id: str | None = None
    frames: int = Field(8, ge=4, le=16)

    @model_validator(mode="after")
    def paired_coordinates(self):
        if (self.lon is None) != (self.lat is None):
            raise ValueError("Supply both longitude and latitude")
        return self


@app.get("/api/eo/catalog")
def catalog():
    return dict(
        sites=SITES,
        scenes=scenes(),
        attribution="© Umbra · CC BY 4.0",
        catalog_date="2026-11-15",
    )


@app.get("/api/eo/summary")
def summary():
    all_scenes = scenes()
    result = []
    for s in SITES:
        rows = [r for r in all_scenes if r["site_id"] == s["id"]]
        prepared = []
        for r in rows:
            folder = DATA / "scenes" / r["id"]
            if not (folder / "preview.json").exists():
                continue
            meta = json.loads((folder / "preview.json").read_text())
            detections = (
                json.loads((folder / "detections.json").read_text())
                if (folder / "detections.json").exists()
                else None
            )
            prepared.append(
                dict(
                    id=r["id"],
                    time_utc=r["center_utc"],
                    platform=r["platform"],
                    incidence_deg=r["incidence_deg"],
                    polarization=r["polarization"],
                    roi_width_m=meta["roi"]["width_m"],
                    valid_fraction=meta["roi"]["valid_fraction"],
                    candidates=detections["count"] if detections else None,
                    accepted=sum(
                        f["properties"]["review"] == "accepted"
                        for f in detections["features"]
                    )
                    if detections
                    else 0,
                    geometry=meta.get("geometry_available", False),
                    image_url=f"/api/eo/scenes/{r['id']}/files/preview.png",
                )
            )
        result.append(
            dict(
                **s,
                total=len(rows),
                prepared=len(prepared),
                first_utc=rows[0]["center_utc"],
                last_utc=rows[-1]["center_utc"],
                incidence_range=[
                    min(r["incidence_deg"] for r in rows),
                    max(r["incidence_deg"] for r in rows),
                ],
                samples=prepared,
            )
        )
    return dict(
        sites=result,
        note="Candidate counts are an unvalidated brightness baseline. They are not vehicle or vessel counts; no cross-site accuracy claim is made.",
    )


@app.get("/api/eo/scenes/{scene_id}")
def details(scene_id: str):
    try:
        row = scene(scene_id)
        folder = scene_dir(scene_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    for key, name in [
        ("preview", "preview.json"),
        ("geometry", "geometry.json"),
        ("detections", "detections.json"),
        ("change", "change.json"),
        ("sequence", "sequence.json"),
    ]:
        row[key] = (
            json.loads((folder / name).read_text())
            if (folder / name).exists()
            else None
        )
    from eo_engine.color import products

    row["color_products"] = products(scene_id)
    return row


@app.get("/api/eo/samples")
def high_resolution_samples():
    from eo_engine.samples import catalog, details

    return {
        "samples": [details(row["id"]) for row in catalog()],
        "baseline_gsd_m": 10,
        "note": "Curated public optical samples with their own locations, dates and licences.",
    }


@app.get("/api/eo/samples/{sample_id}/orbit")
def sample_orbit(sample_id: str, at_utc: str | None = None):
    from eo_engine.samples import sample
    from eo_engine.sample_orbits import solve

    try:
        row = sample(sample_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    try:
        return solve(row, at_utc)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


class OpticalDetectionRequest(BaseModel):
    view: Literal["area", "detail", "close"] = "detail"


@app.get("/api/eo/samples/{sample_id}/detections")
def optical_detections(sample_id: str, view: Literal["area", "detail", "close"] = "detail"):
    from eo_engine.optical_detection import cached
    try:
        result = cached(sample_id, view)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(409, str(exc))
    active = next((j for j in jobs() if j["kind"] == "sample_detect" and j["scene_id"] == sample_id
                   and j["parameters"].get("view") == view and j["state"] in ("queued", "running")), None)
    return {"sample_id": sample_id, "view": view, "ready": result is not None, "result": result, "job": active}


@app.post("/api/eo/samples/{sample_id}/detect", status_code=202)
def start_optical_detection(sample_id: str, body: OpticalDetectionRequest):
    from eo_engine.optical_detection import inputs, model_info
    try:
        inputs(sample_id, body.view)
        model_info()
        if not (ROOT / ".venv-detection/bin/python").is_file():
            raise FileNotFoundError("Install the isolated detection runtime first")
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(409, str(exc))
    params = {"view": body.view}
    with LOCK:
        active = [j for j in jobs() if j["state"] in ("queued", "running")]
        for job in active:
            if job["kind"] == "sample_detect" and job["scene_id"] == sample_id and job["parameters"] == params:
                return job
        if len(active) >= 8:
            raise HTTPException(409, "Queue full; wait or cancel a job")
        jid = str(uuid.uuid4())
        job = dict(id=jid, kind="sample_detect", scene_id=sample_id, site_id=sample_id,
                   parameters=params, state="queued", progress=0, message="Queued aerial object detection",
                   created_utc=now(), updated_utc=now())
        save_json(DATA / "jobs" / f"{jid}.json", job)
        POOL.submit(run_job, jid)
    return job


@app.get("/api/eo/samples/{sample_id}/files/{name}")
def high_resolution_file(sample_id: str, name: str):
    from eo_engine.samples import folder

    if name not in {
        "area.png",
        "detail.png",
        "close.png",
        "product.json",
        "source.json",
        "detections-area.json",
        "detections-detail.json",
        "detections-close.json",
    }:
        raise HTTPException(404, "Unknown sample product")
    try:
        path = folder(sample_id) / name
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    if not path.is_file():
        raise HTTPException(404, "Sample imagery is not prepared yet")
    return FileResponse(path, headers={"Cache-Control": "no-cache"})


ALLOWED = {
    "preview.png",
    "roi.png",
    "roi.tif",
    "preview.json",
    "geometry.json",
    "detections.json",
    "change.png",
    "change.json",
    "sequence.gif",
    "sequence.mp4",
    "sequence.json",
    "labels.json",
    "csi-preview.png",
    "csi-roi.png",
    "csi.json",
    "optical-preview.png",
    "optical-roi.png",
    "optical.json",
}


@app.get("/api/eo/scenes/{scene_id}/render/{view}.png")
def color_render(
    scene_id: str,
    view: Literal["preview", "roi"],
    palette: Literal["viridis", "inferno"] = "viridis",
):
    from eo_engine.color import palette_png

    try:
        png = palette_png(scene_id, view, palette)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-cache"})


@app.api_route("/api/eo/scenes/{scene_id}/files/{filename}", methods=["GET", "HEAD"])
def files(scene_id: str, filename: str):
    if filename not in ALLOWED and not (
        filename.startswith("frame-")
        and filename.endswith(".png")
        and filename[6:-4].isdigit()
    ):
        raise HTTPException(404)
    try:
        p = scene_dir(scene_id) / filename
    except ValueError:
        raise HTTPException(404)
    if not p.exists():
        raise HTTPException(404, "Product is not prepared yet")
    return FileResponse(p, headers={"Cache-Control": "no-cache"})


@app.post("/api/eo/jobs", status_code=202)
def start_job(body: JobRequest):
    try:
        r = scene(body.scene_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    if body.kind == "csi" and not r["csi_public_url"]:
        raise HTTPException(
            422,
            "This acquisition has no public CSI asset. Choose a CSI acquisition in this site.",
        )
    if body.kind == "compare":
        if not body.reference_id:
            raise HTTPException(422, "Choose a reference acquisition")
        try:
            ref = scene(body.reference_id)
        except ValueError as exc:
            raise HTTPException(404, str(exc))
        if ref["site_id"] != r["site_id"] or ref["id"] == r["id"]:
            raise HTTPException(422, "Choose another acquisition in the same site")
    params = {}
    if body.kind == "prepare":
        params = dict(lon=body.lon, lat=body.lat, width_m=body.width_m)
    elif body.kind == "detect":
        params = dict(ratio=body.ratio)
    elif body.kind == "compare":
        params = dict(reference_id=body.reference_id)
    elif body.kind == "sequence":
        params = dict(frames=body.frames)
    with LOCK:
        running = [j for j in jobs() if j["state"] in ("queued", "running")]
        if len(running) >= 8:
            raise HTTPException(409, "Queue full; wait or cancel a job")
        # Do not schedule the same operation/ROI twice while one is active.
        for j in running:
            if (
                j["scene_id"] == body.scene_id
                and j["kind"] == body.kind
                and j["parameters"] == params
            ):
                return j
        jid = str(uuid.uuid4())
        job = dict(
            id=jid,
            kind=body.kind,
            scene_id=body.scene_id,
            site_id=r["site_id"],
            parameters=params,
            state="queued",
            progress=0,
            message="Queued",
            created_utc=now(),
            updated_utc=now(),
        )
        save_json(DATA / "jobs" / f"{jid}.json", job)
        POOL.submit(run_job, jid)
    return job


@app.get("/api/eo/jobs")
def jobs():
    folder = DATA / "jobs"
    folder.mkdir(parents=True, exist_ok=True)
    return sorted(
        [
            json.loads(p.read_text())
            for p in folder.glob("*.json")
            if not p.name.endswith(".result.json")
        ],
        key=lambda j: j["created_utc"],
        reverse=True,
    )


@app.get("/api/eo/jobs/{job_id}")
def job_status(job_id: str):
    return get_job(job_id)


@app.post("/api/eo/jobs/{job_id}/cancel")
def cancel(job_id: str):
    with LOCK:
        job = get_job(job_id)
        if job["state"] not in ("queued", "running"):
            return job
        update(job_id, state="cancelled", message="Cancelled", finished_utc=now())
        process = PROCESSES.get(job_id)
        if process is not None and process.poll() is None:
            process.signal_group(signal.SIGTERM)

            def force():
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.signal_group(signal.SIGKILL)

            threading.Thread(target=force, daemon=True).start()
        return get_job(job_id)


@app.get("/api/eo/events")
async def events(request: Request):
    async def stream():
        # Compatibility for already-open tabs. Release HTTP/1 connections after
        # one snapshot; long-lived streams can block Cesium module workers.
        yield "retry: 5000\n\n"
        if not await request.is_disconnected():
            yield "data: " + json.dumps(jobs()) + "\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class Review(BaseModel):
    feature_id: int = Field(ge=0)
    review: Literal["accepted", "rejected", "unreviewed"]
    class_name: Literal["bright_candidate", "car", "truck", "vessel", "other"] = (
        "bright_candidate"
    )


@app.put("/api/eo/scenes/{scene_id}/review")
def review(scene_id: str, body: Review):
    with LOCK:
        try:
            folder = scene_dir(scene_id)
        except ValueError:
            raise HTTPException(404)
        p = folder / "detections.json"
        if not p.exists():
            raise HTTPException(409, "Run detection first")
        data = json.loads(p.read_text())
        found = next((f for f in data["features"] if f["id"] == body.feature_id), None)
        if found is None:
            raise HTTPException(404, "Unknown candidate")
        found["properties"].update(review=body.review, class_name=body.class_name)
        save_json(p, data)
    return data


@app.get("/api/eo/export/catalog.csv")
def export_catalog():
    return FileResponse(
        ROOT / "research/catalog-scenes.csv", filename="eo-acquisitions.csv"
    )


@app.get("/api/eo/scenes/{scene_id}/export.csv")
def export_detections(scene_id: str):
    d = details(scene_id)
    if d["detections"] is None:
        raise HTTPException(409, "Run detection first")
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "scene_id",
            "time_utc",
            "platform",
            "candidate_id",
            "lon",
            "lat",
            "area_m2",
            "contrast",
            "review",
            "class",
        ]
    )
    for f in d["detections"]["features"]:
        p = f["properties"]
        writer.writerow(
            [
                scene_id,
                d["center_utc"],
                d["platform"],
                f["id"],
                *f["geometry"]["coordinates"],
                p["area_m2"],
                p["contrast"],
                p["review"],
                p["class_name"],
            ]
        )
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{scene_id}-candidates.csv"'
        },
    )


if (ROOT / "web/dist").exists():
    app.mount("/", StaticFiles(directory=ROOT / "web/dist", html=True), name="web")
