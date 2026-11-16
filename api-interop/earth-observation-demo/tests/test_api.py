import json
import pytest
from fastapi.testclient import TestClient
import server
import eo_engine.catalog as cat


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "DATA", tmp_path)
    monkeypatch.setattr(cat, "DATA", tmp_path)
    monkeypatch.setattr(server.POOL, "submit", lambda *args: None)
    with TestClient(server.app) as c:
        yield c


def test_catalog_has_three_sites_and_146_unique_acquisitions(client):
    doc = client.get("/api/eo/catalog").json()
    assert len(doc["sites"]) == 3
    assert len({r["id"] for r in doc["scenes"]}) == 146
    assert sum(r["site_id"] == "rotterdam" for r in doc["scenes"]) == 55


def test_job_validation_and_idempotent_queued_work(client):
    row = cat.scenes()[0]
    assert client.post("/api/eo/jobs", json={"scene_id": "unknown"}).status_code == 404
    assert (
        client.post("/api/eo/jobs", json={"scene_id": row["id"], "lon": 12}).status_code
        == 422
    )
    assert (
        client.post(
            "/api/eo/jobs", json={"scene_id": row["id"], "width_m": 1e9}
        ).status_code
        == 422
    )
    data = {"scene_id": row["id"], "kind": "prepare", "width_m": 250}
    a = client.post("/api/eo/jobs", json=data)
    b = client.post("/api/eo/jobs", json=data)
    assert a.status_code == 202 and a.json()["id"] == b.json()["id"]
    assert (
        client.post("/api/eo/jobs/" + a.json()["id"] + "/cancel").json()["state"]
        == "cancelled"
    )


def test_comparison_rejects_cross_site_and_same_scene(client):
    rows = cat.scenes()
    a = rows[0]
    b = next(r for r in rows if r["site_id"] != a["site_id"])
    for ref in [a["id"], b["id"]]:
        assert (
            client.post(
                "/api/eo/jobs",
                json={"scene_id": a["id"], "kind": "compare", "reference_id": ref},
            ).status_code
            == 422
        )


def test_review_persists_and_exports_coordinates(client):
    row = cat.scenes()[0]
    p = cat.scene_dir(row["id"]) / "detections.json"
    cat.save_json(
        p,
        dict(
            features=[
                dict(
                    id=0,
                    geometry=dict(coordinates=[100.75, 13.69]),
                    properties=dict(
                        area_m2=4,
                        contrast=5,
                        review="unreviewed",
                        class_name="bright_candidate",
                    ),
                )
            ]
        ),
    )
    response = client.put(
        "/api/eo/scenes/" + row["id"] + "/review",
        json={"feature_id": 0, "review": "accepted", "class_name": "car"},
    )
    assert response.status_code == 200
    assert (
        json.loads(p.read_text())["features"][0]["properties"]["review"] == "accepted"
    )
    exported = client.get("/api/eo/scenes/" + row["id"] + "/export.csv")
    assert "100.75,13.69" in exported.text and "accepted,car" in exported.text


def test_nonlocal_mutation_origin_is_rejected(client):
    assert (
        client.post(
            "/api/eo/jobs",
            headers={"Origin": "https://unrelated.example"},
            json={"scene_id": cat.scenes()[0]["id"]},
        ).status_code
        == 403
    )


def test_file_access_is_restricted_to_generated_products(client):
    assert (
        client.get(
            "/api/eo/scenes/" + cat.scenes()[0]["id"] + "/files/private.env"
        ).status_code
        == 404
    )


def test_color_endpoints_validate_palette_and_csi_availability(client):
    from PIL import Image
    import io

    row = cat.scenes()[0]
    folder = cat.scene_dir(row["id"])
    Image.new("RGBA", (4, 4), (120, 120, 120, 255)).save(folder / "roi.png")
    response = client.get(
        "/api/eo/scenes/" + row["id"] + "/render/roi.png?palette=viridis"
    )
    assert response.status_code == 200
    assert Image.open(io.BytesIO(response.content)).mode == "RGBA"
    assert (
        client.get(
            "/api/eo/scenes/" + row["id"] + "/render/roi.png?palette=unknown"
        ).status_code
        == 422
    )
    missing = next(r for r in cat.scenes() if not r["csi_public_url"])
    assert (
        client.post(
            "/api/eo/jobs", json={"scene_id": missing["id"], "kind": "csi"}
        ).status_code
        == 422
    )
    job = client.post("/api/eo/jobs", json={"scene_id": row["id"], "kind": "optical"})
    assert job.status_code == 202 and job.json()["kind"] == "optical"


def test_worker_launch_failure_is_reported_instead_of_staying_running(
    client, monkeypatch
):
    job = client.post("/api/eo/jobs", json={"scene_id": cat.scenes()[0]["id"]}).json()

    def unavailable(*a, **k):
        raise OSError("worker interpreter unavailable")

    monkeypatch.setattr(server, "SpawnedWorker", unavailable)
    server.run_job(job["id"])
    result = server.get_job(job["id"])
    assert result["state"] == "failed"
    assert "worker interpreter unavailable" in result["message"]
    assert job["id"] not in server.PROCESSES


def test_running_spawned_worker_can_be_cancelled_from_api(
    client, tmp_path, monkeypatch
):
    import sys
    import threading
    import time

    # A real process, with the same stdout protocol and session as an EO worker.
    (tmp_path / "worker_entry.py").write_text(
        'import time\nprint(\'{"message":"ready","progress":20}\',flush=True)\ntime.sleep(30)\n'
    )
    monkeypatch.setattr(server, "ROOT", tmp_path)
    monkeypatch.setattr(server, "WORKER_PYTHON", sys.executable)
    job = client.post("/api/eo/jobs", json={"scene_id": cat.scenes()[0]["id"]}).json()
    thread = threading.Thread(target=server.run_job, args=(job["id"],))
    thread.start()
    try:
        deadline = time.monotonic() + 5
        while server.get_job(job["id"])["message"] != "ready":
            assert time.monotonic() < deadline
            time.sleep(0.01)
        result = client.post("/api/eo/jobs/" + job["id"] + "/cancel")
        assert result.json()["state"] == "cancelled"
        thread.join(timeout=5)
        assert not thread.is_alive()
        assert server.get_job(job["id"])["state"] == "cancelled"
        assert job["id"] not in server.PROCESSES
    finally:
        process = server.PROCESSES.get(job["id"])
        if process:
            process.signal_group(server.signal.SIGKILL)
        thread.join(timeout=5)


def test_highres_catalog_and_file_allowlist(client, tmp_path, monkeypatch):
    from eo_engine import samples
    from PIL import Image
    import io

    monkeypatch.setattr(samples, "DATA", tmp_path)
    response = client.get("/api/eo/samples")
    assert response.status_code == 200 and len(response.json()["samples"]) == 4
    sid = response.json()["samples"][0]["id"]
    folder = samples.folder(sid)
    folder.mkdir(parents=True)
    Image.new("RGB", (4, 4), (10, 80, 150)).save(folder / "detail.png")
    image = client.get(f"/api/eo/samples/{sid}/files/detail.png")
    assert image.status_code == 200 and Image.open(io.BytesIO(image.content)).size == (
        4,
        4,
    )
    assert client.get(f"/api/eo/samples/{sid}/files/private.env").status_code == 404
    assert client.get("/api/eo/samples/unknown/files/detail.png").status_code == 404
