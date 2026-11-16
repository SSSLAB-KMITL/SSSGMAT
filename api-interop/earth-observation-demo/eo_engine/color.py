"""Color display products with explicit source/time and unchanged SAR analysis."""

from __future__ import annotations

import hashlib
import io
import json
import threading
import time
import fcntl
from functools import wraps
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.shutil import copy as copy_raster
from rasterio.transform import from_bounds
from rasterio.windows import Window
from rasterio.warp import reproject
from pyproj import Transformer
from PIL import Image

from .catalog import DATA, scene, scenes, scene_dir, save_json
from .pipeline import ENV, prepare

STAC = "https://earth-search.aws.element84.com/v1"
CATALOG_LOCK = threading.Lock()
PALETTES = ("viridis", "inferno")


def product_lock(kind):
    def decorate(function):
        @wraps(function)
        def locked(scene_id, *args, **kwargs):
            with (scene_dir(scene_id) / f".{kind}.lock").open("a") as handle:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                return function(scene_id, *args, **kwargs)

        return locked

    return decorate


def signature(meta):
    return hashlib.sha256(
        json.dumps(
            {
                "generated_utc": meta["generated_utc"],
                "roi": meta["roi"],
                "preview_bbox": meta["preview"]["bbox"],
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()


def products(scene_id):
    folder = scene_dir(scene_id)
    if not (folder / "preview.json").exists():
        return {"csi": None, "optical": None}
    sig = signature(json.loads((folder / "preview.json").read_text()))
    result = {}
    for kind in ("csi", "optical"):
        p = folder / f"{kind}.json"
        value = json.loads(p.read_text()) if p.exists() else None
        valid = value and value.get("roi_signature") == sig
        if kind == "optical" and value and value.get("selection_version") != 2:
            valid = False
        result[kind] = value if valid else None
    return result


def palette_png(scene_id, view, palette):
    if view not in ("preview", "roi") or palette not in PALETTES:
        raise ValueError("Unknown image view or palette")
    source = scene_dir(scene_id) / f"{view}.png"
    if not source.exists():
        raise ValueError("Prepare SAR imagery first")
    from matplotlib import colormaps

    with Image.open(source) as image:
        rgba = np.array(image.convert("RGBA"))
    lut = colormaps[palette](np.linspace(0, 1, 256), bytes=True)
    result = lut[rgba[:, :, 0]].copy()
    result[:, :, 3] = rgba[:, :, 3]
    stream = io.BytesIO()
    Image.fromarray(result).save(stream, format="PNG")
    return stream.getvalue()


def read_grid(src, bounds, crs, width, height, indexes):
    """Read only source pixels needed for a destination grid, using COG overviews."""
    dst_transform = from_bounds(*bounds, width, height)
    inverse = ~src.transform
    to_source = Transformer.from_crs(crs, src.crs, always_xy=True)
    corners = [
        inverse * to_source.transform(x, y)
        for x in (bounds[0], bounds[2])
        for y in (bounds[1], bounds[3])
    ]
    c0 = max(0, int(np.floor(min(p[0] for p in corners))) - 2)
    r0 = max(0, int(np.floor(min(p[1] for p in corners))) - 2)
    c1 = min(src.width, int(np.ceil(max(p[0] for p in corners))) + 2)
    r1 = min(src.height, int(np.ceil(max(p[1] for p in corners))) + 2)
    if c1 <= c0 or r1 <= r0:
        raise ValueError("Source image does not cover this area")
    window = Window(c0, r0, c1 - c0, r1 - r0)
    # A small buffer around the warped extent preserves edge interpolation.
    factor = max(1.0, min(window.width / width, window.height / height))
    out_h = max(1, int(np.ceil(window.height / factor)))
    out_w = max(1, int(np.ceil(window.width / factor)))
    data = src.read(
        indexes,
        window=window,
        out_shape=(len(indexes), out_h, out_w),
        masked=True,
        resampling=Resampling.bilinear,
    )
    from affine import Affine

    source_transform = src.window_transform(window) * Affine.scale(
        window.width / out_w, window.height / out_h
    )
    dest = np.zeros((len(indexes), height, width), dtype="float32")
    mask = np.zeros((height, width), dtype="uint8")
    for i in range(len(indexes)):
        reproject(
            data[i].filled(0),
            dest[i],
            src_transform=source_transform,
            src_crs=src.crs,
            dst_transform=dst_transform,
            dst_crs=crs,
            resampling=Resampling.bilinear,
        )
    # A valid red/green/blue pixel may have zero in the other two channels.
    valid = (~np.all(np.ma.getmaskarray(data), axis=0)).astype("uint8")
    reproject(
        valid,
        mask,
        src_transform=source_transform,
        src_crs=src.crs,
        dst_transform=dst_transform,
        dst_crs=crs,
        resampling=Resampling.nearest,
    )
    return dest, mask > 0


def roi_grid(meta):
    from .catalog import site

    roi = meta["roi"]
    s = site(meta["site_id"])
    project = Transformer.from_crs("EPSG:4326", s["crs"], always_xy=True)
    x, y = project.transform(roi["lon"], roi["lat"])
    h = roi["width_m"] / 2
    return [x - h, y - h, x + h, y + h], s["crs"], roi["size"]


def save_rgb(folder, kind, rgb, valid, view):
    rgba = np.concatenate(
        [
            np.clip(rgb.transpose(1, 2, 0), 0, 255).astype("uint8"),
            (valid.astype("uint8") * 255)[:, :, None],
        ],
        axis=2,
    )
    path = folder / f"{kind}-{view}.png"
    tmp = path.with_suffix(".tmp")
    Image.fromarray(rgba).save(tmp, format="PNG")
    tmp.replace(path)
    return f"/api/eo/scenes/{folder.name}/files/{path.name}"


def render_rgb_asset(url, meta, kind):
    folder = scene_dir(meta["scene_id"])
    with rasterio.Env(**ENV):
        with rasterio.open(url) as src:
            if src.count < 3:
                raise ValueError("Expected a three-band RGB product")
            rgb, valid = read_grid(
                src, meta["preview"]["bbox"], "EPSG:4326", 1024, 1024, [1, 2, 3]
            )
            minimum = 0.3 if kind == "csi" else 0.9
            if valid.mean() < minimum:
                raise ValueError(
                    "Optical/CSI product does not cover enough of the SAR scene"
                )
            bounds, crs, size = roi_grid(meta)
            roi_rgb, roi_valid = read_grid(src, bounds, crs, size, size, [1, 2, 3])
            if roi_valid.mean() < 0.9:
                raise ValueError("Optical/CSI product does not cover the analysis ROI")
            preview = save_rgb(folder, kind, rgb, valid, "preview")
            roi = save_rgb(folder, kind, roi_rgb, roi_valid, "roi")
            return dict(
                preview_url=preview,
                roi_url=roi,
                preview_bbox=meta["preview"]["bbox"],
                roi_bbox=meta["roi"]["bbox"],
                source_shape=[src.height, src.width],
                source_dtype=src.dtypes[0],
                source_crs=str(src.crs),
                valid_fraction=float(valid.mean()),
            )


@product_lock("csi")
def prepare_csi(scene_id, progress=lambda *_: None):
    row = scene(scene_id)
    if not row["csi_public_url"]:
        raise ValueError(
            "No public CSI asset for this acquisition. Select a CSI acquisition in this site."
        )
    folder = scene_dir(scene_id)
    if not (folder / "preview.json").exists():
        prepare(scene_id, progress=progress)
    cached = products(scene_id)["csi"]
    if cached:
        return cached
    meta = json.loads((folder / "preview.json").read_text())
    source = cache_csi(row, progress)
    progress("Rendering CSI color overview and native ROI", 85)
    result = render_rgb_asset(str(source), meta, "csi")
    result.update(
        kind="csi",
        roi_signature=signature(meta),
        source_url=row["csi_public_url"],
        acquired_utc=row["center_utc"],
        platform=row["platform"],
        resolution_m=row["range_resolution_m"],
        attribution="© Umbra · CC BY 4.0",
        note="Color Subaperture Image: radar magnitude combined into RGB. Colors are not natural surface colors and are not proof of motion.",
        generated_utc=datetime.now(timezone.utc).isoformat(),
    )
    save_json(folder / "csi.json", result)
    progress("CSI color image ready", 100)
    return result


def cache_csi(row, progress):
    """CSI lacks source overviews: cache once and build real multiresolution RGB."""
    folder = DATA / "raw-csi"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{row['id']}.tif"
    marker = path.with_suffix(".ready.json")
    if path.exists() and marker.exists():
        try:
            with rasterio.open(path) as src:
                src.read(1, out_shape=(8, 8))
            return path
        except rasterio.errors.RasterioError:
            # A pre-BigTIFF cache may have overflowed the 4 GiB TIFF limit.
            marker.unlink(missing_ok=True)
            path.unlink()
    expected = int(row["csi_bytes"])
    source = path.with_suffix(".source.tif")
    if not source.exists() and path.exists():
        path.replace(source)
    if not source.exists():
        partial = path.with_suffix(".part")
        offset = partial.stat().st_size if partial.exists() else 0
        request = urllib.request.Request(
            row["csi_public_url"],
            headers={"Range": f"bytes={offset}-"} if offset else {},
        )
        with urllib.request.urlopen(request, timeout=90) as response:
            if offset and response.status != 206:
                offset = 0
            mode = "ab" if offset else "wb"
            received = offset
            last = 0
            with partial.open(mode) as stream:
                while True:
                    chunk = response.read(8 * 1024**2)
                    if not chunk:
                        break
                    stream.write(chunk)
                    received += len(chunk)
                    if time.monotonic() - last > 2:
                        progress(
                            f"Downloading CSI RGB {received / 1e6:.0f}/{expected / 1e6:.0f} MB (one-time cache)",
                            10 + int(received / max(expected, 1) * 60),
                        )
                        last = time.monotonic()
        if partial.stat().st_size != expected:
            raise ValueError("Incomplete CSI download; retry to resume")
        partial.replace(source)
    # CSI can cross 4 GiB when overviews are appended. Always derive BigTIFF;
    # leave the resumable source intact until the complete cache is validated.
    progress("Converting CSI source to reusable BigTIFF cache", 75)
    building = path.with_suffix(".building.tif")
    with rasterio.Env(GDAL_CACHEMAX=128 * 1024**2):
        copy_raster(
            source,
            building,
            driver="GTiff",
            BIGTIFF="YES",
            TILED="YES",
            COMPRESS="LZW",
            BLOCKXSIZE=512,
            BLOCKYSIZE=512,
        )
        progress("Building reusable CSI color overviews", 80)
        with rasterio.open(building, "r+") as src:
            src.build_overviews([2, 4, 8, 16, 32, 64], Resampling.average)
            src.update_tags(ns="rio_overview", resampling="average")
        with rasterio.open(building) as src:
            src.read(1, out_shape=(8, 8))
    building.replace(path)
    save_json(
        marker,
        dict(
            source_url=row["csi_public_url"],
            original_bytes=expected,
            cached_bytes=path.stat().st_size,
        ),
    )
    source.unlink(missing_ok=True)
    return path


def get_optical_catalog(site_id):
    path = DATA / "optical-catalog" / f"{site_id}.json"
    with CATALOG_LOCK:
        if path.exists():
            return json.loads(path.read_text())
        rows = [r for r in scenes() if r["site_id"] == site_id]
        points = [p for r in rows for p in r["footprint"]["coordinates"][0]]
        bounds = [
            min(p[0] for p in points),
            min(p[1] for p in points),
            max(p[0] for p in points),
            max(p[1] for p in points),
        ]
        first = datetime.fromisoformat(
            rows[0]["center_utc"].replace("Z", "+00:00")
        ) - timedelta(days=45)
        last = datetime.fromisoformat(
            rows[-1]["center_utc"].replace("Z", "+00:00")
        ) + timedelta(days=45)
        query = dict(
            collections="sentinel-2-l2a",
            bbox=",".join(map(str, bounds)),
            datetime=first.isoformat() + "/" + last.isoformat(),
            limit=100,
        )
        url = STAC + "/search?" + urllib.parse.urlencode(query)
        items = []
        for _ in range(20):
            with urllib.request.urlopen(url, timeout=45) as response:
                doc = json.load(response)
            items.extend(doc.get("features", []))
            next_link = next(
                (link for link in doc.get("links", []) if link["rel"] == "next"), None
            )
            if not next_link:
                break
            url = next_link["href"]
            if not url.startswith(STAC + "/search"):
                raise ValueError("Unexpected catalog pagination host")
        else:
            raise ValueError("Optical catalog exceeds bounded pagination")
        save_json(path, items)
        return items


def optical_candidates(scene_id):
    row = scene(scene_id)
    target = datetime.fromisoformat(row["center_utc"].replace("Z", "+00:00"))
    result = []
    for item in get_optical_catalog(row["site_id"]):
        p = item["properties"]
        time = datetime.fromisoformat(p["datetime"].replace("Z", "+00:00"))
        delta = abs((time - target).total_seconds()) / 86400
        if delta > 45 or "visual" not in item["assets"]:
            continue
        url = item["assets"]["visual"]["href"]
        if not url.startswith(
            (
                "https://sentinel-cogs.s3.us-west-2.amazonaws.com/",
                "https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/",
            )
        ):
            continue
        # Prefer less cloudy dates nearby; ROI cloud fraction is measured after selection.
        cloud = float(p.get("eo:cloud_cover", 100))
        score = delta + max(0, cloud - 20) * 0.6
        result.append((score, delta, item))
    return sorted(result, key=lambda entry: (entry[0], entry[1]))


@product_lock("optical")
def prepare_optical(scene_id, progress=lambda *_: None):
    row = scene(scene_id)
    folder = scene_dir(scene_id)
    if not (folder / "preview.json").exists():
        prepare(scene_id, progress=progress)
    cached = products(scene_id)["optical"]
    if cached:
        return cached
    meta = json.loads((folder / "preview.json").read_text())
    progress("Searching dated Sentinel-2 acquisitions near the SAR date", 10)
    candidates = optical_candidates(scene_id)
    if not candidates:
        raise ValueError("No dated Sentinel-2 RGB product found within 45 days")
    failures = []
    evaluated = []
    best = None
    # Inspect cheap categorical cloud grids before downloading RGB. If no clear
    # date exists, pick the least obscured one and disclose its measured coverage.
    for index, (_, delta, item) in enumerate(candidates[:24]):
        progress(
            f"Checking local Sentinel-2 cloud/shadow coverage {index + 1}",
            15 + min(index * 2, 45),
        )
        cloud_roi = None
        scl = item["assets"].get("scl", {}).get("href")
        if scl and scl.startswith("https://sentinel-cogs.s3.us-west-2.amazonaws.com/"):
            try:
                with rasterio.Env(**ENV), rasterio.open(scl) as src:
                    from rasterio.vrt import WarpedVRT

                    with WarpedVRT(
                        src,
                        crs="EPSG:4326",
                        transform=from_bounds(*meta["preview"]["bbox"], 256, 256),
                        width=256,
                        height=256,
                        resampling=Resampling.nearest,
                    ) as vrt:
                        classes = vrt.read(1)
                    usable = ~np.isin(classes, [0, 1])
                    cloud_roi = (
                        float(np.mean(np.isin(classes[usable], [3, 8, 9, 10])) * 100)
                        if usable.mean() > 0.9
                        else 100.0
                    )
            except Exception:
                pass
        evaluated.append((cloud_roi, delta, item))
        if cloud_roi is not None and cloud_roi <= 15:
            break
    evaluated.sort(
        key=lambda x: (
            0 if x[0] is not None and x[0] <= 15 else 1,
            x[1]
            if x[0] is not None and x[0] <= 15
            else (x[0] if x[0] is not None else 100),
            x[1],
        )
    )
    for cloud_roi, delta, item in evaluated:
        try:
            progress("Rendering dated Sentinel-2 RGB overview and ROI", 80)
            result = render_rgb_asset(item["assets"]["visual"]["href"], meta, "optical")
            best = (result, item, delta, cloud_roi)
            break
        except Exception as exc:
            failures.append(f"{item['id']}: {exc}")
    if best is None:
        raise ValueError(
            "Unable to read Sentinel-2 imagery: " + "; ".join(failures[:3])
        )
    result, item, delta, cloud_roi = best
    p = item["properties"]
    result.update(
        kind="optical",
        selection_version=2,
        roi_signature=signature(meta),
        source_url=item["assets"]["visual"]["href"],
        stac_url=f"{STAC}/collections/sentinel-2-l2a/items/{item['id']}",
        item_id=item["id"],
        acquired_utc=p["datetime"],
        sar_acquired_utc=row["center_utc"],
        days_from_sar=delta,
        platform=p.get("platform", "Sentinel-2"),
        resolution_m=10,
        scene_cloud_percent=p.get("eo:cloud_cover"),
        aoi_cloud_shadow_percent=cloud_roi,
        attribution="Contains modified Copernicus Sentinel data · Earth Search / Element 84",
        note="Natural-color Sentinel-2 RGB, 10 m source resolution. Separate optical acquisition; date differs from SAR. Resampling does not add detail.",
        generated_utc=datetime.now(timezone.utc).isoformat(),
    )
    save_json(folder / "optical.json", result)
    progress("Dated natural-color image ready", 100)
    return result
