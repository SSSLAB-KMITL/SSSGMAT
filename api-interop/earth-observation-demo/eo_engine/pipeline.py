"""Small, real raster products. GEC is display intensity, never labelled sigma0."""

from __future__ import annotations

import json
import hashlib
import shutil
from datetime import datetime, timezone
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.vrt import WarpedVRT
from rasterio.transform import from_bounds, xy
from rasterio.warp import reproject
from rasterio.windows import Window
from affine import Affine
from pyproj import Transformer
from PIL import Image
from scipy import ndimage
from .catalog import scene, site, scene_dir, save_json
from .geometry import extract_geometry

ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
    GDAL_HTTP_TIMEOUT="45",
    GDAL_HTTP_MAX_RETRY="2",
    VSI_CACHE="TRUE",
    GDAL_CACHEMAX=128 * 1024**2,
)


def archive(folder, names):
    existing = [folder / name for name in names if (folder / name).exists()]
    if not existing:
        return
    destination = (
        folder / "history" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    )
    destination.mkdir(parents=True, exist_ok=True)
    for path in existing:
        shutil.copy2(path, destination / path.name)


def display_image(values, valid):
    data = values.astype(float)
    good = data[valid]
    lo, hi = np.percentile(good, [1, 99.5]) if len(good) else (0, 1)
    gray = np.uint8(np.clip((data - lo) / max(hi - lo, 1e-6), 0, 1) * 255)
    return np.stack([gray, gray, gray, np.uint8(valid) * 255], axis=-1), [
        float(lo),
        float(hi),
    ]


def prepare(scene_id, lon=None, lat=None, width_m=500, progress=lambda *_: None):
    row = scene(scene_id)
    s = site(row["site_id"])
    folder = scene_dir(scene_id)
    lon = s["lon"] if lon is None else lon
    lat = s["lat"] if lat is None else lat
    archive(
        folder,
        [
            "preview.json",
            "preview.png",
            "roi.png",
            "roi.tif",
            "detections.json",
            "change.json",
            "change.png",
        ],
    )
    progress("Reading GEC overviews and a bounded ROI", 15)
    with rasterio.Env(**ENV):
        with rasterio.open(row["gec_public_url"]) as src:
            bounds = list(src.bounds)
            preview_transform = from_bounds(*bounds, 1024, 1024)
            # Read overviews explicitly before warping. A full-source WarpedVRT on
            # these rotated GeoTIFFs can otherwise fetch native data for the whole scene.
            overview = src.read(
                1, out_shape=(1024, 1024), masked=True, resampling=Resampling.bilinear
            )
            overview_transform = src.transform * Affine.scale(
                src.width / 1024, src.height / 1024
            )
            preview = np.zeros((1024, 1024), dtype="float32")
            preview_valid = np.zeros((1024, 1024), dtype="uint8")
            reproject(
                overview.filled(0),
                preview,
                src_transform=overview_transform,
                src_crs=src.crs,
                dst_transform=preview_transform,
                dst_crs="EPSG:4326",
                resampling=Resampling.bilinear,
            )
            reproject(
                (~np.ma.getmaskarray(overview)).astype("uint8"),
                preview_valid,
                src_transform=overview_transform,
                src_crs=src.crs,
                dst_transform=preview_transform,
                dst_crs="EPSG:4326",
                resampling=Resampling.nearest,
            )
            rgba, stretch = display_image(preview, preview_valid > 0)
            Image.fromarray(rgba).save(folder / "preview.png")
            progress("Reading native-resolution ROI", 40)
            forward = Transformer.from_crs("EPSG:4326", s["crs"], always_xy=True)
            backward = Transformer.from_crs(s["crs"], "EPSG:4326", always_xy=True)
            x, y = forward.transform(lon, lat)
            pixel = float(row["range_resolution_m"])
            size = min(2048, max(256, int(round(width_m / pixel))))
            transform = from_bounds(
                x - width_m / 2,
                y - width_m / 2,
                x + width_m / 2,
                y + width_m / 2,
                size,
                size,
            )
            to_source = Transformer.from_crs(s["crs"], src.crs, always_xy=True)
            source_corners = [
                (~src.transform) * to_source.transform(xx, yy)
                for xx in (x - width_m / 2, x + width_m / 2)
                for yy in (y - width_m / 2, y + width_m / 2)
            ]
            c0 = max(0, int(np.floor(min(p[0] for p in source_corners))) - 2)
            r0 = max(0, int(np.floor(min(p[1] for p in source_corners))) - 2)
            c1 = min(src.width, int(np.ceil(max(p[0] for p in source_corners))) + 2)
            r1 = min(src.height, int(np.ceil(max(p[1] for p in source_corners))) + 2)
            if c1 <= c0 or r1 <= r0:
                raise ValueError("ROI is outside the acquisition")
            window = Window(c0, r0, c1 - c0, r1 - r0)
            raw = src.read(1, window=window, masked=True)
            values = np.zeros((size, size), dtype="float32")
            valid_grid = np.zeros((size, size), dtype="uint8")
            reproject(
                raw.filled(0),
                values,
                src_transform=src.window_transform(window),
                src_crs=src.crs,
                dst_transform=transform,
                dst_crs=s["crs"],
                resampling=Resampling.bilinear,
            )
            reproject(
                (~np.ma.getmaskarray(raw)).astype("uint8"),
                valid_grid,
                src_transform=src.window_transform(window),
                src_crs=src.crs,
                dst_transform=transform,
                dst_crs=s["crs"],
                resampling=Resampling.nearest,
            )
            valid = valid_grid > 0
            if valid.mean() < 0.05:
                raise ValueError(
                    "ROI lies outside valid imagery; choose a point inside the footprint"
                )
            rgba, roi_stretch = display_image(values, valid)
            Image.fromarray(rgba).save(folder / "roi.png")
            # Float32 + explicit validity mask avoids treating genuine intensity zero as nodata.
            with rasterio.open(
                folder / "roi.tif",
                "w",
                driver="GTiff",
                height=size,
                width=size,
                count=1,
                dtype="float32",
                crs=s["crs"],
                transform=transform,
                tiled=True,
                compress="deflate",
            ) as dst:
                dst.write(values.astype("float32"), 1)
                dst.write_mask(valid.astype("uint8") * 255)
            corners = [
                backward.transform(*v)
                for v in [
                    (x - width_m / 2, y - width_m / 2),
                    (x + width_m / 2, y + width_m / 2),
                ]
            ]
            result = dict(
                scene_id=scene_id,
                site_id=s["id"],
                generated_utc=datetime.now(timezone.utc).isoformat(),
                source_url=row["gec_public_url"],
                source_dtype=src.dtypes[0],
                source_shape=[src.height, src.width],
                source_transform=list(src.transform)[:6],
                source_tags=src.tags(),
                overviews=src.overviews(1),
                preview=dict(
                    url=f"/api/eo/scenes/{scene_id}/files/preview.png",
                    bbox=bounds,
                    width=1024,
                    height=1024,
                    stretch=stretch,
                ),
                roi=dict(
                    url=f"/api/eo/scenes/{scene_id}/files/roi.png",
                    lon=lon,
                    lat=lat,
                    width_m=width_m,
                    size=size,
                    pixel_m=width_m / size,
                    crs=s["crs"],
                    bbox=[*corners[0], *corners[1]],
                    valid_fraction=float(valid.mean()),
                    stretch=roi_stretch,
                ),
                radiometry="GEC display intensity. Uncalibrated; no sigma0 or physical dB claim.",
                attribution="© Umbra · CC BY 4.0 · processed ROI",
            )
    progress("Reading producer trajectory metadata", 75)
    try:
        if not (folder / "geometry.json").exists():
            extract_geometry(scene_id)
        result["geometry_available"] = True
    except Exception as exc:
        result["geometry_available"] = False
        result["geometry_error"] = str(exc)
    save_json(folder / "preview.json", result)
    # Old detections/sequence refer to a different ROI after recropping.
    for name in ("detections.json", "change.json"):
        (folder / name).unlink(missing_ok=True)
    progress("Image and ROI ready", 100)
    return result


def bright_candidates(
    values, valid, pixel_m, ratio=3.5, min_area_m2=0.3, max_area_m2=500
):
    """Local contrast baseline on display intensity; not a calibrated CFAR probability."""
    v = np.asarray(values, dtype=float)
    if not np.any(valid):
        return []
    weights = valid.astype(float)
    outer = ndimage.uniform_filter(v * weights, 31) * 31**2
    inner = ndimage.uniform_filter(v * weights, 9) * 9**2
    n = (
        ndimage.uniform_filter(weights, 31) * 31**2
        - ndimage.uniform_filter(weights, 9) * 9**2
    )
    mean = (outer - inner) / np.maximum(n, 1)
    usable = valid & (n > 300)
    usable[:16, :] = False
    usable[-16:, :] = False
    usable[:, :16] = False
    usable[:, -16:] = False
    hot = usable & (v > np.maximum(mean, 1) * ratio) & (v > np.percentile(v[valid], 90))
    labels, count = ndimage.label(hot)
    result = []
    for label, sl in enumerate(ndimage.find_objects(labels), 1):
        if sl is None:
            continue
        mask = labels[sl] == label
        area = float(mask.sum()) * pixel_m**2
        if not min_area_m2 <= area <= max_area_m2:
            continue
        yy, xx = np.where(mask)
        result.append(
            dict(
                x=float(xx.mean() + sl[1].start),
                y=float(yy.mean() + sl[0].start),
                bbox=[sl[1].start, sl[0].start, sl[1].stop, sl[0].stop],
                area_m2=area,
                contrast=float(np.max(v[sl][mask] / np.maximum(mean[sl][mask], 1))),
            )
        )
    return sorted(result, key=lambda d: d["contrast"], reverse=True)[:2000]


def detect(scene_id, ratio=3.5, progress=lambda *_: None):
    folder = scene_dir(scene_id)
    if not (folder / "roi.tif").exists():
        prepare(scene_id, progress=progress)
    checksum = hashlib.sha256((folder / "roi.tif").read_bytes()).hexdigest()
    previous = (
        json.loads((folder / "detections.json").read_text())
        if (folder / "detections.json").exists()
        else None
    )
    if (
        previous
        and previous.get("input_sha256") == checksum
        and previous["parameters"]["ratio"] == ratio
    ):
        return previous
    archive(folder, ["detections.json"])
    progress("Computing local-contrast candidates", 30)
    with rasterio.open(folder / "roi.tif") as src:
        values = src.read(1)
        valid = src.dataset_mask() > 0
        pixel_m = abs(src.transform.a)
        candidates = bright_candidates(values, valid, pixel_m, ratio)
        backward = Transformer.from_crs(src.crs, "EPSG:4326", always_xy=True)
        features = []
        for i, c in enumerate(candidates):
            east, north = xy(src.transform, c["y"], c["x"])
            lon, lat = backward.transform(east, north)
            features.append(
                dict(
                    type="Feature",
                    id=i,
                    geometry=dict(type="Point", coordinates=[lon, lat]),
                    properties=dict(
                        **c, review="unreviewed", class_name="bright_candidate"
                    ),
                )
            )
    result = dict(
        type="FeatureCollection",
        scene_id=scene_id,
        input_sha256=checksum,
        engine_version="eo-baseline/1",
        method="Local-contrast baseline on GEC display intensity",
        parameters=dict(ratio=ratio, training=31, guard=9),
        not_validated=True,
        mask="valid imagery only; no road or water semantic mask",
        count=len(features),
        features=features,
    )
    save_json(folder / "detections.json", result)
    progress("Candidates ready for review", 100)
    return result


def compare(scene_id, reference_id, progress=lambda *_: None):
    current = scene(scene_id)
    reference = scene(reference_id)
    if current["site_id"] != reference["site_id"]:
        raise ValueError("Comparison requires the same site")
    a_dir = scene_dir(scene_id)
    b_dir = scene_dir(reference_id)
    if not (a_dir / "preview.json").exists():
        prepare(scene_id, progress=progress)
    info = json.loads((a_dir / "preview.json").read_text())["roi"]
    # Use exactly the same analysis grid / ROI centre for the reference.
    b_info = (
        json.loads((b_dir / "preview.json").read_text())["roi"]
        if (b_dir / "preview.json").exists()
        else {}
    )
    if any(b_info.get(k) != info[k] for k in ("lon", "lat", "width_m")):
        prepare(reference_id, info["lon"], info["lat"], info["width_m"], progress)
    with rasterio.open(a_dir / "roi.tif") as src:
        a = src.read(1)
        ma = src.dataset_mask() > 0
    with rasterio.open(b_dir / "roi.tif") as src:
        b = src.read(1)
        mb = src.dataset_mask() > 0
    progress("Estimating image translation", 60)
    valid = ma & mb
    if valid.mean() < 0.05:
        raise ValueError("Insufficient valid overlap for comparison")
    aa = np.log1p(a) * valid
    bb = np.log1p(b) * valid
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    cross = np.fft.fft2((aa - aa[valid].mean()) * win) * np.conj(
        np.fft.fft2((bb - bb[valid].mean()) * win)
    )
    corr = np.abs(np.fft.ifft2(cross / np.maximum(np.abs(cross), 1e-12)))
    shift = np.array(np.unravel_index(np.argmax(corr), corr.shape), dtype=float)
    shift = np.where(shift > np.array(a.shape) // 2, shift - np.array(a.shape), shift)
    azdiff = abs(current["view_azimuth_deg_raw"] - reference["view_azimuth_deg_raw"])
    azdiff = min(azdiff, 360 - azdiff)
    comparable = (
        current["polarization"] == reference["polarization"]
        and abs(current["incidence_deg"] - reference["incidence_deg"]) <= 1
        and azdiff <= 2
    )
    shifted = ndimage.shift(b, shift, order=1, mode="constant", cval=0)
    mask = valid & (
        ndimage.shift(mb.astype(float), shift, order=0, mode="constant", cval=0) > 0
    )
    # Display-intensity change is not backscatter change in physical dB.
    delta = np.clip(
        (a.astype(float) - shifted) / max(float(np.percentile(a[ma], 99)), 1), -1, 1
    )
    image = np.zeros((*a.shape, 4), dtype="uint8")
    image[:, :, 0] = np.uint8(np.maximum(delta, 0) * 255)
    image[:, :, 2] = np.uint8(np.maximum(-delta, 0) * 255)
    image[:, :, 1] = np.uint8((1 - abs(delta)) * 70)
    image[:, :, 3] = mask.astype("uint8") * 255
    Image.fromarray(image).save(a_dir / "change.png")
    result = dict(
        scene_id=scene_id,
        reference_id=reference_id,
        shift_pixels=shift.tolist(),
        translation_m=(shift * info["pixel_m"]).tolist(),
        geometry_matched=comparable,
        incidence_difference_deg=abs(
            current["incidence_deg"] - reference["incidence_deg"]
        ),
        azimuth_difference_deg=azdiff,
        quality="Unvalidated translation estimate; requires independent tie points. Display-intensity change only.",
        url=f"/api/eo/scenes/{scene_id}/files/change.png",
        mean_absolute_intensity_change=float(np.mean(np.abs(delta[mask])))
        if mask.any()
        else None,
    )
    save_json(a_dir / "change.json", result)
    progress("Comparison ready", 100)
    return result
