import hashlib
import json
import pytest
from PIL import Image
from fastapi.testclient import TestClient
import server
from eo_engine import optical_detection as detector
from eo_engine.samples import catalog, signature


@pytest.fixture
def prepared(tmp_path, monkeypatch):
    row = catalog()[0]
    monkeypatch.setattr(detector, "DATA", tmp_path)
    monkeypatch.setattr(server, "DATA", tmp_path)
    monkeypatch.setattr(server, "ROOT", tmp_path)
    monkeypatch.setattr(server.POOL, "submit", lambda *_: None)
    folder = tmp_path / "highres-samples" / row["id"]
    folder.mkdir(parents=True)
    (folder / "product.json").write_text(json.dumps({"source_signature": signature(row)}))
    for name in detector.VIEWS:
        Image.new("RGBA", (8, 8), (50, 100, 150, 255)).save(folder / f"{name}.png")
    meta = {"name": "fixture", "weights": "fixture.pt", "sha256": "fixture-sha"}
    (tmp_path / "models").mkdir()
    (tmp_path / "models/yolo11s-obb.json").write_text(json.dumps(meta))
    runtime = tmp_path / ".venv-detection/bin/python"
    runtime.parent.mkdir(parents=True)
    runtime.touch()
    return row, folder, meta


def test_cache_binds_to_exact_rgb_model_and_pipeline(prepared):
    row, folder, meta = prepared
    image = folder / "detail.png"
    assert detector.cached(row["id"], "detail") is None
    result = {"input_signature": detector.signature(image, meta), "objects": []}
    (folder / "detections-detail.json").write_text(json.dumps(result))
    assert detector.cached(row["id"], "detail") == result
    Image.new("RGB", (8, 8), (200, 10, 20)).save(image)
    assert detector.cached(row["id"], "detail") is None
    for view in ("../source", "private", "DETAIL"):
        with pytest.raises(ValueError):
            detector.inputs(row["id"], view)


def test_api_queues_exact_view_deduplicates_and_exports_only_allowed_files(prepared):
    row, folder, _ = prepared
    with TestClient(server.app) as client:
        url = f"/api/eo/samples/{row['id']}"
        assert client.get(url + "/detections?view=detail").json()["ready"] is False
        a = client.post(url + "/detect", json={"view": "detail"})
        assert a.status_code == 202
        assert a.json()["kind"] == "sample_detect"
        b = client.post(url + "/detect", json={"view": "detail"})
        assert a.json()["id"] == b.json()["id"]
        assert client.get(url + "/detections").json()["job"]["id"] == a.json()["id"]
        c = client.post(url + "/detect", json={"view": "area"})
        assert c.json()["id"] != a.json()["id"]
        assert c.json()["parameters"] == {"view": "area"}
        assert client.get("/api/eo/jobs/" + a.json()["id"]).status_code == 200
        assert client.post("/api/eo/jobs/" + a.json()["id"] + "/cancel").json()["state"] == "cancelled"
        assert client.post(url + "/detect", json={"view": "../secret"}).status_code == 422
        assert client.get(url + "/detections?view=invalid").status_code == 422
        assert client.post("/api/eo/samples/unknown/detect", json={}).status_code == 404
        assert client.get(url + "/files/model.pt").status_code == 404


def test_changed_source_or_missing_runtime_does_not_launch(prepared):
    row, folder, _ = prepared
    with TestClient(server.app) as client:
        url = f"/api/eo/samples/{row['id']}/detect"
        (folder / "product.json").write_text('{}')
        assert client.post(url, json={}).status_code == 409
        (folder / "product.json").write_text(json.dumps({"source_signature": signature(row)}))
        (server.ROOT / ".venv-detection/bin/python").unlink()
        assert client.post(url, json={}).status_code == 409
        assert server.jobs() == []
