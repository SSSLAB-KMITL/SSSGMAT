import io
import numpy as np
import pytest
from eo_engine.geometry import ECEF, angles
from eo_engine.pipeline import bright_candidates
from eo_engine.remote import HTTPRangeReader


def test_ecef_overhead_geometry_and_slant_range():
    target = np.array(ECEF.transform(100.75, 13.69, 0))
    high = np.array(ECEF.transform(100.75, 13.69, 500000))
    result = angles(high, 100.75, 13.69)
    assert result["elevation_deg"] == pytest.approx(90, abs=1e-8)
    assert result["slant_range_m"] == pytest.approx(500000, abs=1e-5)


def test_azimuth_is_from_target_towards_sensor():
    target = np.array(ECEF.transform(0, 0, 0))
    assert angles(target + np.array([0, 1000, 0]), 0, 0)[
        "azimuth_deg"
    ] == pytest.approx(90)
    assert angles(target + np.array([0, 0, 1000]), 0, 0)[
        "azimuth_deg"
    ] == pytest.approx(0)


def test_local_contrast_finds_target_without_counting_invalid_data():
    image = np.ones((128, 128)) * 10
    image[60:63, 70:73] = 180
    image[90:93, 90:93] = 200
    valid = np.ones(image.shape, dtype=bool)
    valid[85:100, 85:100] = False
    found = bright_candidates(image, valid, 0.25)
    assert len(found) == 1
    assert found[0]["x"] == pytest.approx(71)
    assert found[0]["y"] == pytest.approx(61)
    assert found[0]["area_m2"] == pytest.approx(9 * 0.25**2)


def test_empty_valid_mask_and_flat_surface_have_no_candidates():
    image = np.ones((100, 100)) * 10
    assert bright_candidates(image, np.zeros_like(image, dtype=bool), 0.25) == []
    assert bright_candidates(image, np.ones_like(image, dtype=bool), 0.25) == []


def test_range_reader_handles_seek_cache_and_enforces_budget(monkeypatch):
    payload = b"0123456789abcdef"

    class Reply(io.BytesIO):
        status = 206
        headers = {"Content-Length": str(len(payload))}

    calls = []

    def open_url(req, timeout):
        if req.get_method() == "HEAD":
            return Reply(b"")
        value = req.get_header("Range").removeprefix("bytes=")
        start, end = map(int, value.split("-"))
        calls.append((start, end))
        return Reply(payload[start : end + 1])

    monkeypatch.setattr("urllib.request.urlopen", open_url)
    r = HTTPRangeReader(
        "https://umbra-open-data-catalog.s3.us-west-2.amazonaws.com/test",
        budget=8,
        block_size=4,
    )
    assert r.read(6) == b"012345"
    r.seek(1)
    assert r.read(3) == b"123"
    assert calls == [(0, 7)]  # contiguous blocks are batched; backward read is cached
    r.seek(8)
    with pytest.raises(ValueError, match="budget"):
        r.read(1)
    with pytest.raises(ValueError):
        r.seek(-1)


def test_range_reader_rejects_full_file_response(monkeypatch):
    class Reply(io.BytesIO):
        status = 200
        headers = {"Content-Length": "10"}

    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: Reply(b"0123456789"))
    r = HTTPRangeReader(
        "https://umbra-open-data-catalog.s3.us-west-2.amazonaws.com/test", block_size=4
    )
    with pytest.raises(ValueError, match="Range"):
        r.read(1)


def test_repeated_detection_preserves_manual_review(tmp_path, monkeypatch):
    import json
    import rasterio
    import eo_engine.catalog as catalog
    from rasterio.transform import from_origin
    from eo_engine.pipeline import detect

    monkeypatch.setattr(catalog, "DATA", tmp_path)
    scene_id = catalog.scenes()[0]["id"]
    folder = catalog.scene_dir(scene_id)
    image = np.ones((128, 128), dtype="float32") * 10
    image[60:63, 70:73] = 180
    with rasterio.open(
        folder / "roi.tif",
        "w",
        driver="GTiff",
        width=128,
        height=128,
        count=1,
        dtype="float32",
        crs="EPSG:32647",
        transform=from_origin(500000, 1500000, 0.25, 0.25),
    ) as dst:
        dst.write(image, 1)
        dst.write_mask(np.ones((128, 128), dtype="uint8") * 255)
    result = detect(scene_id)
    assert len(result["features"]) == 1
    result["features"][0]["properties"].update(review="accepted", class_name="car")
    catalog.save_json(folder / "detections.json", result)
    again = detect(scene_id)
    assert again["features"][0]["properties"]["review"] == "accepted"
