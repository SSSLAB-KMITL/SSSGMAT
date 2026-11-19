"""Curated, genuinely high-resolution optical examples from public releases."""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from urllib.parse import urlparse

import numpy as np
import rasterio
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from pyproj import Transformer

from .catalog import ROOT, DATA, save_json
from .color import read_grid
from .pipeline import ENV

VIEWS = {"area": 500, "detail": 250, "close": 100}
HOSTS = {"spacenet-dataset.s3.amazonaws.com", "maxar-opendata.s3.amazonaws.com", "sentinel-cogs.s3.us-west-2.amazonaws.com"}


def catalog():
    return json.loads((ROOT / "research/highres-samples.json").read_text())["samples"]


def sample(sample_id):
    row = next((r for r in catalog() if r["id"] == sample_id), None)
    if row is None:
        raise ValueError("Unknown high-resolution sample")
    parsed = urlparse(row["source_url"])
    if parsed.scheme != "https" or parsed.hostname not in HOSTS:
        raise ValueError("Sample source is not in the public release allowlist")
    return row


def folder(sample_id):
    sample(sample_id)
    return DATA / "highres-samples" / sample_id


def signature(row):
    return hashlib.sha256(
        json.dumps({"source": row, "render_version": 1}, sort_keys=True).encode()
    ).hexdigest()


def details(sample_id):
    from .sample_orbits import solve

    row = sample(sample_id)
    path = folder(sample_id) / "product.json"
    product = json.loads(path.read_text()) if path.exists() else None
    if product and product.get("source_signature") != signature(row):
        product = None
    geometries = json.loads(
        (ROOT / "research/highres-viewing-geometry.json").read_text()
    )["samples"]
    return {
        **row,
        "ready": bool(product),
        "product": product,
        "viewing_geometry": geometries.get(sample_id),
        "orbit_solution": solve(row),
    }


def display_rgb(rgb, valid, limits):
    """Stretch original RGB channels consistently; retain source color order."""
    result = np.zeros((*valid.shape, 4), dtype="uint8")
    for channel, (low, high) in enumerate(limits):
        result[:, :, channel] = np.clip(
            (rgb[channel] - low) / max(high - low, 1) * 255, 0, 255
        ).astype("uint8")
    result[:, :, 3] = valid.astype("uint8") * 255
    return result


def prepare(sample_id, progress=print):
    row = sample(sample_id)
    cached = details(sample_id)
    if cached["ready"]:
        return cached["product"]
    destination = folder(sample_id)
    destination.mkdir(parents=True, exist_ok=True)
    crs = f"EPSG:{(32600 if row['lat'] >= 0 else 32700) + int((row['lon'] + 180) // 6) + 1}"
    project = Transformer.from_crs(4326, crs, always_xy=True)
    unproject = Transformer.from_crs(crs, 4326, always_xy=True)
    x, y = project.transform(row["lon"], row["lat"])
    views = {}
    limits = None
    with rasterio.Env(**ENV), rasterio.open(row["source_url"]) as src:
        if src.count < 3:
            raise ValueError("Sample must have three original RGB channels")
        for name, width_m in VIEWS.items():
            progress(f"{sample_id}: reading {width_m} m RGB window")
            h = width_m / 2
            bounds = [x - h, y - h, x + h, y + h]
            # Overview may be reduced; close views never claim sub-source detail.
            size = min(1536, max(1, math.floor(width_m / row["gsd_m"])))
            rgb, valid = read_grid(src, bounds, crs, size, size, row["bands"])
            valid &= np.any(rgb != 0, axis=0)
            if valid.mean() < (0.5 if name == "area" else 0.9):
                raise ValueError(f"Insufficient valid source pixels in {name} window")
            if limits is None:
                limits = (
                    [[0, 255]] * 3
                    if src.dtypes[0] == "uint8"
                    else [
                        np.percentile(rgb[i][valid], [2, 98]).tolist() for i in range(3)
                    ]
                )
            pixels = display_rgb(rgb, valid, limits)
            metadata = PngInfo()
            for key, value in {
                "Source": row["source_url"],
                "Attribution": row["attribution"],
                "License": row["license_url"],
                "Acquired": row["acquired_utc"],
                "Processing": row["processing"],
            }.items():
                metadata.add_text(key, value)
            path = destination / f"{name}.png"
            temporary = path.with_suffix(".tmp")
            Image.fromarray(pixels).save(temporary, format="PNG", pnginfo=metadata)
            temporary.replace(path)
            west, south = unproject.transform(bounds[0], bounds[1])
            east, north = unproject.transform(bounds[2], bounds[3])
            views[name] = {
                "url": f"/api/eo/samples/{sample_id}/files/{name}.png",
                "width_m": width_m,
                "size": size,
                "grid_m": width_m / size,
                "bbox": [west, south, east, north],
                "crs": crs,
                "valid_fraction": float(valid.mean()),
            }
        source = {
            "shape": [src.height, src.width],
            "dtype": src.dtypes[0],
            "crs": str(src.crs),
            "pixel_size": list(src.res),
        }
    result = {
        "sample_id": sample_id,
        "source_signature": signature(row),
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "stretch_limits": limits,
        "views": views,
    }
    save_json(destination / "product.json", result)
    # Keep source, time, and licence next to downloadable PNGs as well.
    save_json(destination / "source.json", row)
    return result
