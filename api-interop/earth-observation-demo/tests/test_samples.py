import hashlib
import io
import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from eo_engine import samples


def test_curated_sources_use_public_hosts_and_distinguish_source_gsd_from_grid():
    rows = samples.catalog()
    assert len(rows) == 5
    assert {r["platform"] for r in rows} == {"WorldView-2", "WorldView-3", "GeoEye-1", "Sentinel-2A"}
    assert min(r["gsd_m"] for r in rows) == 0.3
    for r in rows:
        assert samples.sample(r["id"])["license"] in (
            "CC BY-SA 4.0",
            "CC BY-NC 4.0",
            "Copernicus Sentinel Data Terms",
        )
        assert r["date_precision"] in ("day", "second")
        assert r["license_evidence_url"].startswith("https://")


def test_sample_pipeline_preserves_source_exports_licence_and_invalidates_cache(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(samples, "DATA", tmp_path)
    path = tmp_path / "original.tif"
    y, x = np.indices((320, 320))
    data = np.stack([x * 4 + y + 20, y * 5 + 30, (x + y) * 2 + 40]).astype("uint16")
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=320,
        height=320,
        count=3,
        dtype="uint16",
        crs=32631,
        transform=from_origin(499680, 5739320, 2, 2),
    ) as dst:
        dst.write(data)
    from pyproj import Transformer

    lon, lat = Transformer.from_crs(32631, 4326, always_xy=True).transform(
        500000, 5739000
    )
    row = {
        **samples.catalog()[0],
        "id": "fixture",
        "lon": lon,
        "lat": lat,
        "gsd_m": 2,
        "source_url": "https://spacenet-dataset.s3.amazonaws.com/test.tif",
    }
    monkeypatch.setattr(samples, "catalog", lambda: [row])
    real_open = rasterio.open
    monkeypatch.setattr(
        rasterio,
        "open",
        lambda url, *a, **k: real_open(
            path if url == row["source_url"] else url, *a, **k
        ),
    )
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    p = samples.prepare("fixture", lambda *_: None)
    assert samples.details("fixture")["ready"]
    assert p["source"]["dtype"] == "uint16"
    for name, view in p["views"].items():
        assert view["grid_m"] >= row["gsd_m"]
        with Image.open(samples.folder("fixture") / (name + ".png")) as img:
            assert img.size == (view["size"], view["size"])
            assert img.info["License"] == row["license_url"]
            assert img.info["Acquired"] == row["acquired_utc"]
            assert np.asarray(img)[:, :, 3].min() == 255
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    assert samples.prepare("fixture", lambda *_: None) == p
    row["lon"] += 0.001
    assert not samples.details("fixture")["ready"]


def test_public_optical_geometry_never_invents_satellite_coordinates():
    for row in samples.catalog():
        geometry = samples.details(row["id"])["viewing_geometry"]
        assert geometry["source_platform"] == row["platform"]
        assert geometry["satellite_position_available"] is False
        assert geometry["satellite_position"] is None
        assert geometry["ground_point"] == {"lat": row["lat"], "lon": row["lon"]}
        if row["id"] in ("bangkok-wv03", "mandalay-ge01", "nong-khai-s2a"):
            assert "elevation_deg" not in geometry
            assert geometry["view_azimuth_deg"] is not None
        if row["id"] == "vegas-wv3":
            assert geometry["elevation_deg"] == 71.3
            assert geometry["catalog_id"] == "10400100137F4900"
