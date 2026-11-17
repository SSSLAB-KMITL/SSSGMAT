import json
import os
import re
import stat
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import BaseModel

from conftest import make_client
from gnss_predict.errors import GmatNotFoundError, ScenarioError, TleUnavailableError
from gnss_studio_server.app import create_app
from gnss_studio_server.config import Config
from gnss_studio_server.errors import HTTP_ERROR_TEXT, ApiError

ERROR_KEYS = {"code", "text", "field", "detail"}


def _read_log(data_dir: Path) -> str:
    return (data_dir / "logs" / "server.log").read_text()


# ---------- health / openapi ----------

def test_health(client, data_dir):
    r = client.get("/api/health"); assert r.status_code == 200
    j = r.json()
    assert j["engine_version"] == "0.2.0" and j["data_dir"] == str(data_dir) and j["writable"] is True
    assert set(j) >= {"gmat_found", "free_bytes", "daily"}


def test_health_values(client):
    j = client.get("/api/health").json()
    assert isinstance(j["gmat_found"], bool)
    assert isinstance(j["free_bytes"], int) and j["free_bytes"] > 0
    assert set(j["daily"]) == {"state", "last_run_utc", "next_run_utc", "for_date"}       # สถานะงานประจำวัน (หัวข้อ 8)
    assert j["daily"]["state"] == "idle"


def test_health_gmat_found_follows_config(data_dir, tmp_path, no_web_dist):
    fake = tmp_path / "GmatConsole"
    fake.write_text("#!/bin/sh\n")
    fake.chmod(fake.stat().st_mode | stat.S_IXUSR)
    found = make_client(create_app(Config(data_dir=data_dir, web_dist=no_web_dist, gmat_bin=str(fake)), start_background=False))
    assert found.get("/api/health").json()["gmat_found"] is True
    missing = make_client(create_app(Config(data_dir=data_dir, web_dist=no_web_dist, gmat_bin=str(tmp_path / "nope")), start_background=False))
    assert missing.get("/api/health").json()["gmat_found"] is False


@pytest.mark.skipif(os.name == "nt" or os.geteuid() == 0, reason="ต้องเป็น user ธรรมดาบน POSIX จึงจะสร้างโฟลเดอร์อ่านอย่างเดียวได้")
def test_health_reports_unwritable_data_dir(client, data_dir):
    data_dir.chmod(0o500)
    try:
        j = client.get("/api/health").json()
    finally:
        data_dir.chmod(0o700)
    assert j["writable"] is False


def test_openapi_served(client): assert client.get("/api/openapi.json").status_code == 200


def test_docs_served_under_api(client):
    assert client.get("/api/docs").status_code == 200
    paths = client.get("/api/openapi.json").json()["paths"]
    assert "/api/health" in paths and all(p.startswith("/api/") for p in paths)


# ---------- ข้อผิดพลาด ----------

def test_unknown_api_path_is_json_404(client):
    r = client.get("/api/nope"); assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND"


def test_unknown_api_path_body_shape(client):
    r = client.get("/api/nope")
    j = r.json()
    assert set(j) == ERROR_KEYS and j["field"] is None and j["detail"] is None
    assert re.search("[฀-๿]", j["text"])             # ข้อความถึงผู้ใช้เป็นภาษาไทย
    assert r.headers["content-type"].startswith("application/json")


def test_wrong_method_is_json_405(client):
    r = client.post("/api/health")
    assert r.status_code == 405 and r.json()["code"] == "METHOD_NOT_ALLOWED"


def test_unknown_path_without_web_dist_is_json_404(client):
    assert not client.app.state.config.web_dist.exists()        # fixture ไม่ชี้ไปที่ web/dist จริงของเครื่อง
    r = client.get("/scenarios/x"); assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND"


def test_internal_error_has_reference(client_with_boom_route, data_dir):
    r = client_with_boom_route.get("/api/_boom"); assert r.status_code == 500
    ref = r.json()["detail"]; assert ref in (data_dir / "logs" / "server.log").read_text()


def test_internal_error_body_and_log(client_with_boom_route, data_dir):
    r = client_with_boom_route.get("/api/_boom")
    j = r.json()
    assert set(j) == ERROR_KEYS and j["code"] == "INTERNAL" and j["field"] is None
    assert re.fullmatch(r"[0-9a-f]{8}", j["detail"]) and j["detail"] in j["text"]
    log = _read_log(data_dir)
    assert "RuntimeError: boom" in log and "Traceback" in log   # มี stack trace ไว้ตามรอย


def test_each_app_logs_to_its_own_data_dir(boom_client_factory, tmp_path):
    dir_a, dir_b = tmp_path / "a", tmp_path / "b"
    dir_a.mkdir(); dir_b.mkdir()
    client_a, client_b = boom_client_factory(dir_a), boom_client_factory(dir_b)   # สร้างหลายแอปในรอบเดียว
    ref_a = client_a.get("/api/_boom").json()["detail"]
    ref_b = client_b.get("/api/_boom").json()["detail"]
    assert ref_a != ref_b
    assert ref_a in _read_log(dir_a) and ref_b not in _read_log(dir_a)
    assert ref_b in _read_log(dir_b) and ref_a not in _read_log(dir_b)


def test_log_handler_rotates_at_10mb_keeping_5(client, data_dir):
    handler = client.app.state.log_handler
    assert Path(handler.baseFilename) == data_dir / "logs" / "server.log"
    assert handler.maxBytes == 10_000_000 and handler.backupCount == 5


class _Body(BaseModel):
    name: str
    count: int


@pytest.fixture
def client_with_error_routes(data_dir, no_web_dist):
    app = create_app(Config(data_dir=data_dir, web_dist=no_web_dist), start_background=False)

    @app.get("/api/_api_error")
    def api_error():
        raise ApiError(409, "NAME_EXISTS", "ชื่อนี้ถูกใช้แล้ว", field="name", detail="THBK")

    @app.get("/api/_scenario_error")
    def scenario_error():
        raise ScenarioError("ค่า step_s ต้องมากกว่า 0", "step_s")

    @app.get("/api/_engine_error")
    def engine_error():
        raise TleUnavailableError("ดึง TLE ไม่ได้")

    @app.get("/api/_gmat_error")
    def gmat_error():
        raise GmatNotFoundError("ไม่พบ GmatConsole")

    @app.post("/api/_body")
    def body(b: _Body):
        return b

    @app.get("/api/_teapot")
    def teapot():
        raise HTTPException(418, detail="teapot")

    @app.get("/api/_dict_detail")
    def dict_detail():
        raise HTTPException(400, detail={"reason": "ผิด", "n": 1})

    return make_client(app, raise_server_exceptions=False)


def test_api_error_is_translated(client_with_error_routes):
    r = client_with_error_routes.get("/api/_api_error")
    assert r.status_code == 409
    assert r.json() == {"code": "NAME_EXISTS", "text": "ชื่อนี้ถูกใช้แล้ว", "field": "name", "detail": "THBK"}


def test_scenario_error_is_422_with_field(client_with_error_routes):
    r = client_with_error_routes.get("/api/_scenario_error")
    assert r.status_code == 422
    assert r.json() == {"code": "SCENARIO_INVALID", "text": "ค่า step_s ต้องมากกว่า 0", "field": "step_s", "detail": None}


def test_other_engine_errors_are_422_with_their_code(client_with_error_routes):
    r = client_with_error_routes.get("/api/_engine_error")
    assert r.status_code == 422
    assert r.json() == {"code": "ORBIT_SOURCE_UNAVAILABLE", "text": "ดึง TLE ไม่ได้", "field": None, "detail": None}
    r = client_with_error_routes.get("/api/_gmat_error")
    assert r.status_code == 422 and r.json()["code"] == "GMAT_NOT_FOUND"


def test_request_validation_error_is_scenario_invalid(client_with_error_routes):
    r = client_with_error_routes.post("/api/_body", json={"name": "THBK", "count": "many"})
    assert r.status_code == 422
    j = r.json()
    assert set(j) == ERROR_KEYS
    assert j["code"] == "SCENARIO_INVALID" and j["field"] == "count" and j["detail"]
    assert client_with_error_routes.post("/api/_body", json={"name": "x"}).json()["field"] == "count"


def test_other_http_errors_have_thai_text_and_original_detail(client_with_error_routes):
    r = client_with_error_routes.get("/api/_teapot")
    assert r.status_code == 418
    assert r.json() == {"code": "HTTP_ERROR", "text": HTTP_ERROR_TEXT, "field": None, "detail": "teapot"}
    assert re.search("[\u0e00-\u0e7f]", HTTP_ERROR_TEXT) and "teapot" not in r.json()["text"]


def test_non_string_http_error_detail_is_stringified(client_with_error_routes):
    r = client_with_error_routes.get("/api/_dict_detail")
    j = r.json()
    assert r.status_code == 400 and j["code"] == "HTTP_ERROR" and j["text"] == HTTP_ERROR_TEXT
    assert isinstance(j["detail"], str) and json.loads(j["detail"]) == {"reason": "ผิด", "n": 1}


# ---------- ไฟล์เว็บ ----------

def test_spa_fallback(client_with_web_dist):
    assert "<div id=\"root\">" in client_with_web_dist.get("/scenarios/x").text


def test_spa_root_and_real_files(client_with_web_dist):
    r = client_with_web_dist.get("/")
    assert r.status_code == 200 and "<div id=\"root\">" in r.text
    r = client_with_web_dist.get("/assets/app.js")
    assert r.status_code == 200 and r.text == "console.log('studio');"


def test_spa_fallback_never_applies_to_api(client_with_web_dist):
    for path in ("/api/nope", "/api", "/api/"):
        r = client_with_web_dist.get(path)
        assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND", path
    assert client_with_web_dist.get("/api/health").json()["engine_version"] == "0.2.0"


def test_spa_fallback_only_for_get(client_with_web_dist):
    r = client_with_web_dist.post("/scenarios/x")
    assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND"


def test_static_files_cannot_escape_web_dist(client_with_web_dist, tmp_path):
    (tmp_path / "secret.txt").write_text("TOP-SECRET")
    for path in ("/..%2Fsecret.txt", "/%2e%2e/secret.txt", "/assets/..%2F..%2Fsecret.txt"):
        r = client_with_web_dist.get(path)
        assert "TOP-SECRET" not in r.text, path


# ---------- config / __main__ ----------

def test_config_from_env():
    cfg = Config.from_env({"GNSS_STUDIO_DATA": "/srv/gnss-data", "GNSS_STUDIO_PORT": "8123"})
    assert cfg.data_dir == Path("/srv/gnss-data")
    assert cfg.port == 8123 and isinstance(cfg.port, int)
    assert cfg.host == "127.0.0.1"
    assert cfg.gmat_bin is None and cfg.cesium_ion_token == ""


def test_config_from_env_all_values():
    cfg = Config.from_env({"GNSS_STUDIO_DATA": "/d", "GNSS_STUDIO_HOST": "0.0.0.0", "GNSS_STUDIO_PORT": "9000",
                           "GMAT_BIN": "/opt/gmat/GmatConsole", "CESIUM_ION_TOKEN": "tok"})
    assert (cfg.host, cfg.port, cfg.gmat_bin, cfg.cesium_ion_token) == ("0.0.0.0", 9000, "/opt/gmat/GmatConsole", "tok")


def test_config_defaults():
    cfg = Config.from_env({})
    assert (cfg.host, cfg.port, cfg.gmat_bin, cfg.cesium_ion_token) == ("127.0.0.1", 8000, None, "")
    assert cfg.data_dir.name == "data" and cfg.data_dir.parent.name == "gnss-predict"
    assert cfg.web_dist.parts[-2:] == ("web", "dist") and cfg.web_dist.parent.parent == cfg.data_dir.parent
    assert Config(data_dir=Path("/x")).web_dist == cfg.web_dist


def test_config_is_frozen_and_rejects_bad_port():
    cfg = Config(data_dir=Path("/x"))
    with pytest.raises(Exception):
        cfg.port = 1
    for bad in ("abc", "0", "70000"):
        with pytest.raises(ValueError):
            Config.from_env({"GNSS_STUDIO_PORT": bad})


def test_main_runs_uvicorn_with_config(monkeypatch, tmp_path, capsys):
    import uvicorn
    from gnss_studio_server import __main__ as entry
    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: calls.append((app, kw)))
    entry.main({"GNSS_STUDIO_DATA": str(tmp_path / "d"), "GNSS_STUDIO_PORT": "8765"})
    (app, kw), = calls
    assert kw["host"] == "127.0.0.1" and kw["port"] == 8765
    assert "http://127.0.0.1:8765/" in capsys.readouterr().out
    assert app.openapi_url == "/api/openapi.json" and (tmp_path / "d" / "logs" / "server.log").exists()


# ---------- กันคำขอข้ามเว็บไซต์และ DNS rebinding ----------

FOREIGN_ORIGIN = "http://evil.example"


def _settings_doc(enabled: bool) -> dict:
    return {"daily": {"enabled": enabled, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30,
                      "validation_retry_hours": 3, "validation_give_up_days": 14}, "cesium_ion_token": "secret",
            "online_imagery": {"enabled": False, "eox": False, "osm": False, "ion": False}}


@pytest.mark.parametrize("host", ["rebind.evil.example", "rebind.evil.example:8000", "testserver", "127.0.0.2:8000",
                                  "localhost.evil.example:8000"])
def test_foreign_host_is_rejected_on_every_route(client, data_dir, host):
    for method, path, kw in (("get", "/api/settings", {}), ("get", "/api/health", {}),
                             ("put", "/api/settings", {"json": _settings_doc(True)}),
                             ("post", "/api/orbits/fetch", {}), ("delete", "/api/scenarios/S1", {})):
        r = getattr(client, method)(path, headers={"Host": host}, **kw)
        assert r.status_code == 400, (method, path, host)
        assert "secret" not in r.text
    assert client.app.state.jobs.list() == []
    assert not (data_dir / "settings.json").exists()


@pytest.mark.parametrize("host", ["127.0.0.1:8000", "127.0.0.1", "localhost:8000", "LOCALHOST:8000", "[::1]:8000"])
def test_loopback_hosts_are_accepted(client, host):
    assert client.get("/api/health", headers={"Host": host}).status_code == 200


@pytest.mark.parametrize("origin", [FOREIGN_ORIGIN, "null", "http://127.0.0.1:9999", "https://127.0.0.1:8000",
                                    "http://rebind.evil.example:8000"])
def test_cross_site_write_is_forbidden_and_submits_nothing(client, data_dir, s1, origin):
    before = (data_dir / "scenarios" / "S1" / "scenario.json").read_bytes()
    hdr = {"Origin": origin}
    form = client.post("/api/orbits/fetch", data={"systems": "G"}, headers=hdr)       # ฟอร์ม HTML ธรรมดา (ไม่มี preflight)
    for r in (form, client.post("/api/orbits/fetch", headers=hdr),
              client.put("/api/settings", json=_settings_doc(True), headers=hdr),
              client.delete("/api/scenarios/S1", headers=hdr),
              client.patch("/api/scenarios/S1/objects/Facility/THBK", json={}, headers=hdr)):
        assert r.status_code == 403, (r.request.method, r.request.url)
        j = r.json()
        assert set(j) == ERROR_KEYS and j["code"] == "FORBIDDEN_ORIGIN" and j["field"] is None
        assert re.search("[฀-๿]", j["text"]) and j["detail"] == origin
    assert client.app.state.jobs.list() == []
    assert not (data_dir / "settings.json").exists()
    assert (data_dir / "scenarios" / "S1" / "scenario.json").read_bytes() == before


@pytest.mark.parametrize("origin", ["http://127.0.0.1:8000", "http://localhost:8000", "http://[::1]:8000",
                                    "HTTP://LOCALHOST:8000"])
def test_same_origin_write_is_allowed(client, origin):
    r = client.post("/api/orbits/fetch", headers={"Origin": origin})
    assert r.status_code == 202 and r.json()["job"]


def test_write_without_origin_is_allowed(client):
    assert client.post("/api/orbits/fetch").status_code == 202               # curl และ TestClient ไม่ส่ง Origin


def test_cross_site_get_works_but_adds_no_cors_headers(client):
    r = client.get("/api/settings", headers={"Origin": FOREIGN_ORIGIN})
    assert r.status_code == 200
    assert not [h for h in r.headers if h.lower().startswith("access-control-")]
    pre = client.options("/api/settings", headers={"Origin": FOREIGN_ORIGIN, "Access-Control-Request-Method": "PUT"})
    assert not [h for h in pre.headers if h.lower().startswith("access-control-")]
    assert client.head("/api/health", headers={"Origin": FOREIGN_ORIGIN}).status_code in (200, 405)


def test_configured_host_and_port_are_trusted(data_dir, no_web_dist):
    app = create_app(Config(data_dir=data_dir, web_dist=no_web_dist, host="192.168.1.5", port=8123), start_background=False)
    c = make_client(app)
    assert c.get("/api/health", headers={"Host": "192.168.1.5:8123"}).status_code == 200
    assert c.post("/api/orbits/fetch", headers={"Host": "192.168.1.5:8123", "Origin": "http://192.168.1.5:8123"}).status_code == 202
    assert c.post("/api/orbits/fetch", headers={"Origin": "http://127.0.0.1:8123"}).status_code == 202
    assert c.post("/api/orbits/fetch", headers={"Origin": "http://127.0.0.1:8000"}).status_code == 403   # port อื่น
    assert c.get("/api/health", headers={"Host": "192.168.1.6:8123"}).status_code == 400


def test_ipv6_configured_host_is_bracketed(data_dir, no_web_dist):
    app = create_app(Config(data_dir=data_dir, web_dist=no_web_dist, host="::1", port=8123), start_background=False)
    c = make_client(app)
    assert c.get("/api/health", headers={"Host": "[::1]:8123"}).status_code == 200
    assert c.post("/api/orbits/fetch", headers={"Origin": "http://[::1]:8123"}).status_code == 202


@pytest.mark.parametrize("host, warns", [("0.0.0.0", True), ("192.168.1.5", True), ("example.org", True),
                                         ("127.0.0.1", False), ("localhost", False), ("::1", False), ("127.0.0.2", False)])
def test_non_loopback_host_warns_at_startup(data_dir, no_web_dist, host, warns):
    create_app(Config(data_dir=data_dir, web_dist=no_web_dist, host=host), start_background=False)
    log = _read_log(data_dir)
    assert ("WARNING" in log and host in log) is warns, log


def test_main_prints_a_warning_for_a_non_loopback_host(monkeypatch, tmp_path, capsys):
    import uvicorn
    from gnss_studio_server import __main__ as entry
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: None)
    entry.main({"GNSS_STUDIO_DATA": str(tmp_path / "a"), "GNSS_STUDIO_HOST": "0.0.0.0"})
    assert "0.0.0.0" in capsys.readouterr().err
    entry.main({"GNSS_STUDIO_DATA": str(tmp_path / "b")})
    assert capsys.readouterr().err == ""
