import io
import hashlib
import numpy as np
import rasterio
from rasterio.transform import from_bounds
from PIL import Image
from eo_engine import catalog
from eo_engine.color import (
    palette_png,
    products,
    signature,
    read_grid,
    optical_candidates,
)


def test_palette_preserves_alpha_and_never_changes_source(tmp_path, monkeypatch):
    monkeypatch.setattr(catalog, "DATA", tmp_path)
    sid = catalog.scenes()[0]["id"]
    folder = catalog.scene_dir(sid)
    pixels = np.array(
        [
            [[0, 0, 0, 0], [90, 90, 90, 255]],
            [[180, 180, 180, 255], [255, 255, 255, 100]],
        ],
        dtype="uint8",
    )
    Image.fromarray(pixels).save(folder / "roi.png")
    before = hashlib.sha256((folder / "roi.png").read_bytes()).hexdigest()
    for palette in ("viridis", "inferno"):
        result = np.array(Image.open(io.BytesIO(palette_png(sid, "roi", palette))))
        assert np.array_equal(result[:, :, 3], pixels[:, :, 3])
        assert not np.all(result[1, 0, :3] == result[1, 0, 0])
    assert hashlib.sha256((folder / "roi.png").read_bytes()).hexdigest() == before


def test_color_product_is_invalidated_by_roi_change(tmp_path, monkeypatch):
    monkeypatch.setattr(catalog, "DATA", tmp_path)
    sid = catalog.scenes()[0]["id"]
    folder = catalog.scene_dir(sid)
    meta = {
        "generated_utc": "2026-11-15T00:00:00Z",
        "roi": {"width_m": 250},
        "preview": {"bbox": [0, 0, 1, 1]},
    }
    catalog.save_json(folder / "preview.json", meta)
    catalog.save_json(
        folder / "csi.json", {"roi_signature": signature(meta), "kind": "csi"}
    )
    assert products(sid)["csi"]["kind"] == "csi"
    meta["roi"]["width_m"] = 500
    catalog.save_json(folder / "preview.json", meta)
    assert products(sid)["csi"] is None


def test_rgb_grid_keeps_pure_color_pixels_and_geolocation(tmp_path):
    path = tmp_path / "rgb.tif"
    data = np.zeros((3, 16, 16), dtype="uint8")
    data[0] = 200
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=16,
        height=16,
        count=3,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_bounds(100, 13, 101, 14, 16, 16),
        nodata=0,
    ) as dst:
        dst.write(data)
    with rasterio.open(path) as src:
        rgb, valid = read_grid(
            src, [100.25, 13.25, 100.75, 13.75], "EPSG:4326", 8, 8, [1, 2, 3]
        )
    assert valid.all()
    assert np.allclose(rgb[0], 200) and np.all(rgb[1:] == 0)


def test_optical_candidates_keep_date_window_and_allowlisted_assets(monkeypatch):
    from eo_engine import color

    sid = catalog.scenes()[0]["id"]

    def item(day, url, cloud=0):
        return {
            "id": day,
            "properties": {"datetime": day + "T03:00:00Z", "eo:cloud_cover": cloud},
            "assets": {"visual": {"href": url}},
        }

    base = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/a.tif"
    monkeypatch.setattr(
        color,
        "get_optical_catalog",
        lambda _: [
            item("2024-11-16", base),
            item("2026-11-16", base),
            item("2024-11-15", "http://127.0.0.1/private"),
        ],
    )
    result = optical_candidates(sid)
    assert len(result) == 1 and result[0][2]["id"] == "2024-11-16"


def test_csi_overview_cache_recovers_after_completed_download(tmp_path, monkeypatch):
    from eo_engine import color

    monkeypatch.setattr(color, "DATA", tmp_path)
    raw = tmp_path / "raw-csi"
    raw.mkdir()
    path = raw / "example.tif"
    with rasterio.open(
        path,
        "w",
        driver="COG",
        width=128,
        height=128,
        count=3,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_bounds(100, 13, 101, 14, 128, 128),
    ) as dst:
        dst.write(np.ones((3, 128, 128), dtype="uint8") * 120)
    row = {
        "id": "example",
        "csi_bytes": path.stat().st_size,
        "csi_public_url": "https://umbra-open-data-catalog.s3.us-west-2.amazonaws.com/example",
    }
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *a, **k: (_ for _ in ()).throw(
            AssertionError("Completed download must be reused")
        ),
    )
    result = color.cache_csi(row, lambda *_: None)
    # TIFF version 43 identifies BigTIFF, even when this fixture is small.
    assert result.read_bytes()[:4] in (b"II+\x00", b"MM\x00+")
    with rasterio.open(result) as src:
        assert len(src.overviews(1)) > 0
    assert result.with_suffix(".ready.json").exists()


def test_csi_recovers_an_unreadable_completed_cache(tmp_path, monkeypatch):
    from eo_engine import color

    monkeypatch.setattr(color, "DATA", tmp_path)
    raw = tmp_path / "raw-csi"
    raw.mkdir()
    fixture = tmp_path / "source.tif"
    with rasterio.open(
        fixture,
        "w",
        driver="GTiff",
        width=128,
        height=128,
        count=3,
        dtype="uint8",
        crs="EPSG:4326",
        transform=from_bounds(100, 13, 101, 14, 128, 128),
    ) as dst:
        dst.write(np.ones((3, 128, 128), dtype="uint8") * 120)
    body = fixture.read_bytes()
    path = raw / "broken.tif"
    path.write_bytes(b"incomplete TIFF directory")
    catalog.save_json(path.with_suffix(".ready.json"), {"cached_bytes": 24})
    response = io.BytesIO(body)
    response.status = 200
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: response)
    result = color.cache_csi(
        {
            "id": "broken",
            "csi_bytes": len(body),
            "csi_public_url": "https://umbra-open-data-catalog.s3.us-west-2.amazonaws.com/example",
        },
        lambda *_: None,
    )
    with rasterio.open(result) as src:
        assert src.overviews(1)
        assert (src.read(out_shape=(3, 8, 8)) == 120).all()
    assert not path.with_suffix(".source.tif").exists()
