from __future__ import annotations

import csv
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get("EO_DATA", str(ROOT / "data"))).resolve()
SITES = [
    dict(
        id="suvarnabhumi",
        name="Suvarnabhumi",
        subtitle="Airport · Thailand",
        timezone="Asia/Bangkok",
        crs="EPSG:32647",
        lon=100.7500,
        lat=13.6907,
        color="#197b9b",
    ),
    dict(
        id="rotterdam",
        name="Rotterdam",
        subtitle="Botlek–Pernis · Netherlands",
        timezone="Europe/Amsterdam",
        crs="EPSG:32631",
        lon=4.2867,
        lat=51.8849,
        color="#b56a27",
    ),
    dict(
        id="singapore",
        name="Singapore",
        subtitle="Keppel–Brani · Singapore",
        timezone="Asia/Singapore",
        crs="EPSG:32648",
        lon=103.8381,
        lat=1.2640,
        color="#617eb0",
    ),
]
FOOTPRINTS = json.loads((ROOT / "research/footprints.geojson").read_text())
GEOMETRIES = {f["properties"]["stac_id"]: f["geometry"] for f in FOOTPRINTS["features"]}


def scenes():
    with (ROOT / "research/catalog-scenes.csv").open() as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        for k in (
            "duration_s",
            "incidence_deg",
            "view_azimuth_deg_raw",
            "slant_range_m",
            "azimuth_resolution_m",
            "range_resolution_m",
        ):
            r[k] = float(r[k]) if r[k] else None
        r["id"] = r["stac_id"]
        r["footprint"] = GEOMETRIES[r["id"]]
        r["products"] = [
            k.upper() for k in ("gec", "sicd", "cphd", "csi") if r[k + "_public_url"]
        ]
        r["ready"] = (DATA / "scenes" / r["id"] / "preview.json").exists()
    return rows


def scene(scene_id):
    for r in scenes():
        if r["id"] == scene_id:
            return r
    raise ValueError("Unknown acquisition")


def site(site_id):
    return next(s for s in SITES if s["id"] == site_id)


def scene_dir(scene_id):
    scene(scene_id)  # validate against fixed catalog before using as a path
    p = DATA / "scenes" / scene_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    )
    tmp.replace(path)
