"""ภาพถ่ายออนไลน์ NASA GIBS ผ่าน server ในเครื่อง (spec ภาพออนไลน์ §3, §4, §6)

ไม่มี test ใดต่อเน็ตจริง: ตัวดึงใช้ opener ปลอมที่ฉีดเข้าไป (บันทึกทุกครั้งที่ถูกเรียก) และ fixture `no_real_network` (autouse)
ทำให้ urlopen, OpenerDirector.open และ socket.create_connection ล้มทันทีถ้ามีอะไรหลุดไปถึง
"""

import io
import os
import re
import socket
import threading
import urllib.request
from datetime import datetime, timedelta, timezone
from email.message import Message
from http.client import IncompleteRead
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest

from conftest import make_client
from gnss_studio_server import imagery, settings
from gnss_studio_server.app import create_app
from gnss_studio_server.config import Config
from gnss_studio_server.imagery import (CATALOG, SOURCES, TileCache, TileFetcher, is_settled, layer_by_id, make_opener,
                                        upstream_url, valid_time)

ERROR_KEYS = {"code", "text", "field", "detail"}
THAI = re.compile("[฀-๿]")

# ตาราง catalog ของ Global Constraints (คัดลอกตรงตัว: test นี้ล็อกค่าที่ B0 จะมาแก้ทีหลังที่เดียว) คอลัมน์สุดท้ายคือแหล่ง
TABLE = [
    ("BlueMarble_NextGeneration", "Blue Marble", "static", "GoogleMapsCompatible_Level8", 8, "jpg", "NASA GIBS / EOSDIS", "gibs"),
    ("VIIRS_NOAA20_CorrectedReflectance_TrueColor", "VIIRS NOAA-20 True Color", "daily", "GoogleMapsCompatible_Level9", 9, "jpg",
     "NASA GIBS / EOSDIS", "gibs"),
    ("VIIRS_SNPP_CorrectedReflectance_TrueColor", "VIIRS Suomi NPP True Color", "daily", "GoogleMapsCompatible_Level9", 9, "jpg",
     "NASA GIBS / EOSDIS", "gibs"),
    ("MODIS_Terra_CorrectedReflectance_TrueColor", "MODIS Terra True Color", "daily", "GoogleMapsCompatible_Level9", 9, "jpg",
     "NASA GIBS / EOSDIS", "gibs"),
    ("Himawari_AHI_Band3_Red_Visible_1km", "Himawari-9 Red Visible", "10min", "GoogleMapsCompatible_Level7", 7, "png",
     "NASA GIBS / EOSDIS, JMA", "gibs"),
    ("Himawari_AHI_Band13_Clean_Infrared", "Himawari-9 Clean Infrared", "10min", "GoogleMapsCompatible_Level6", 6, "png",
     "NASA GIBS / EOSDIS, JMA", "gibs"),
    ("GOES-East_ABI_GeoColor", "GOES-East GeoColor", "10min", "GoogleMapsCompatible_Level7", 7, "jpg", "NASA GIBS / EOSDIS, NOAA",
     "gibs"),
    ("GOES-West_ABI_GeoColor", "GOES-West GeoColor", "10min", "GoogleMapsCompatible_Level7", 7, "jpg", "NASA GIBS / EOSDIS, NOAA",
     "gibs"),
    ("s2cloudless-2024_3857", "Sentinel-2 cloudless 2024", "static", "g", 15, "jpg",
     "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)", "eox"),
]

BM = "BlueMarble_NextGeneration"                         # static, ระดับสูงสุด 8, jpg
VI = "VIIRS_NOAA20_CorrectedReflectance_TrueColor"      # daily, ระดับสูงสุด 9, jpg
HW = "Himawari_AHI_Band3_Red_Visible_1km"               # 10min, ระดับสูงสุด 7, png
EO = "s2cloudless-2024_3857"                            # EOX Sentinel-2 cloudless: static, ระดับสูงสุด 15, jpg
DAY = "2026-11-11"
SLOT = "2026-11-11T00:10:00Z"

# ภาพปลอมที่ผ่านการตรวจ magic bytes ยาว 100 ไบต์พอดี (test เพดาน cache นับเป็นก้อนละ 100)
JPEG = b"\xff\xd8\xff\xe0" + b"j" * 96
PNG = b"\x89PNG\r\n\x1a\n" + b"p" * 92
MAX_BODY = 2 * 1024 * 1024


# ---------- opener ปลอมและนาฬิกาปลอม ----------

class Call:
    def __init__(self, url, user_agent, timeout):
        self.url, self.user_agent, self.timeout = url, user_agent, timeout


class FakeResponse:
    """ผลของ opener: `.status`, `.headers`, `.read(n)` (ไม่ได้ context manager: ตัวดึงต้องไม่พึ่ง `with`) และ `.close()`"""

    def __init__(self, body=JPEG, status=200, headers=None):
        self.status = status
        self.headers = headers if headers is not None else {}
        self.stream = io.BytesIO(body)
        self.read_sizes: list[int] = []
        self.closed = False

    def read(self, n=-1):
        self.read_sizes.append(n)
        return self.stream.read(n)

    def close(self):
        self.closed = True


def _default_response(request):
    return FakeResponse(PNG if request.full_url.endswith(".png") else JPEG)


class FakeOpener:
    """เรียก script ก่อน (ทีละรายการ) หมดแล้วใช้ default: แต่ละรายการเป็น response, exception (ถูก raise) หรือ callable(request)"""

    def __init__(self):
        self.calls: list[Call] = []
        self.responses: list[FakeResponse] = []
        self.script: list = []
        self.default = _default_response

    def __call__(self, request, timeout=None):
        self.calls.append(Call(request.full_url, request.get_header("User-agent"), timeout))
        item = self.script.pop(0) if self.script else self.default
        if callable(item):
            item = item(request)
        if isinstance(item, BaseException):
            raise item
        self.responses.append(item)
        return item


class Clock:
    def __init__(self):
        self.t = 10_000.0

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)       # "ตอนนี้" ของ test (นาฬิกาเวลาจริงที่ฉีดเข้าตัวดึง ไม่ขยับเอง)


class Wall:
    """นาฬิกา UTC ปลอม (วันที่/เวลาจริง ใช้ตัดสินว่าชิ้นภาพนิ่งหรือยัง) แยกจาก `Clock` ที่เป็น monotonic ของการพักและ memo"""

    def __init__(self):
        self.t = NOW

    def __call__(self):
        return self.t

    def advance(self, **kwargs):
        self.t += timedelta(**kwargs)


def http_error(code):
    return HTTPError("https://gibs.earthdata.nasa.gov/x", code, f"HTTP {code}", Message(), io.BytesIO(b""))


class Env:
    def __init__(self, data_dir, no_web_dist):
        self.data_dir = data_dir
        self.app = create_app(Config(data_dir=data_dir, web_dist=no_web_dist), start_background=False)
        self.opener, self.clock, self.wall = FakeOpener(), Clock(), Wall()
        logger = self.app.state.logger
        self.fetcher = TileFetcher(data_dir, opener=self.opener, now=self.clock, logger=logger, utcnow=self.wall,
                                   enabled=lambda source: getattr(settings.load(data_dir, logger).online_imagery,
                                                                  SOURCES[source].switch))
        self.app.state.imagery = self.fetcher
        self.client = make_client(self.app)

    def enable(self, on=True, *, eox=False, osm=False, ion=False):
        """เขียน settings.json: `on` = สวิตช์ GIBS (`online_imagery.enabled`); eox/osm/ion เป็นสวิตช์ของแหล่งนั้น (ตั้งต้นปิดทั้งหมด)"""
        settings.save(self.data_dir, settings.Settings(daily=settings.Daily(enabled=False),
                                                       online_imagery=settings.OnlineImagery(enabled=on, eox=eox, osm=osm, ion=ion)))

    def tile(self, layer, time, z, y, x):
        return self.client.get(f"/api/imagery/tiles/{layer}/{time}/{z}/{y}/{x}")

    def path(self, layer, time, z, y, x, ext="jpg"):
        return self.data_dir / "imagery" / "tiles" / layer / time.replace(":", "-") / str(z) / str(y) / f"{x}.{ext}"

    def log(self):
        return (self.data_dir / "logs" / "server.log").read_text(encoding="utf-8")


@pytest.fixture
def env(data_dir, no_web_dist):
    return Env(data_dir, no_web_dist)


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """ทั้งโมดูล: ถ้ามีโค้ดไปแตะเน็ตจริง (นอกจาก opener ปลอมที่ฉีดเข้าไป) test ล้ม"""
    def refuse(*args, **kwargs):
        raise AssertionError("imagery tests must not touch the network")
    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(urllib.request.OpenerDirector, "open", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


def assert_error(r, status, code, field=None):
    assert r.status_code == status, r.text
    j = r.json()
    assert set(j) == ERROR_KEYS
    assert j["code"] == code
    assert j["field"] == field
    assert THAI.search(j["text"]), j["text"]
    return j


def tile_files(env):
    root = env.data_dir / "imagery" / "tiles"
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


# ---------- catalog และฟังก์ชันบริสุทธิ์ ----------

def test_catalog_matches_global_constraints_table():
    assert [(layer.id, layer.title, layer.period, layer.tms, layer.max_level, layer.ext, layer.credit, layer.source)
            for layer in CATALOG] == TABLE


def test_sources_table():
    assert set(SOURCES) == {"gibs", "eox"}
    assert {layer.source for layer in CATALOG} == set(SOURCES)
    assert (SOURCES["gibs"].switch, SOURCES["gibs"].concurrency) == ("enabled", 4)
    assert (SOURCES["eox"].switch, SOURCES["eox"].concurrency) == ("eox", 2)
    assert SOURCES["gibs"].url == imagery.GIBS_URL
    assert SOURCES["eox"].url == imagery.EOX_URL
    assert imagery.EOX_URL == "https://tiles.maps.eox.at/wmts/1.0.0/{layer}/default/{tms}/{z}/{y}/{x}.{ext}"
    for source in SOURCES.values():                               # ข้อความไทยของแต่ละแหล่งบอกชื่อแหล่ง
        assert all(THAI.search(t) for t in (source.disabled_text, source.failed_text, source.paused_text))
    assert SOURCES["gibs"].disabled_text == "ภาพออนไลน์ปิดอยู่ เปิดได้ที่ View → Globe Manager"
    assert SOURCES["gibs"].failed_text == "ดึงภาพจาก NASA GIBS ไม่สำเร็จ"
    assert SOURCES["gibs"].paused_text == "หยุดดึงภาพจาก NASA GIBS ชั่วคราว"
    assert SOURCES["eox"].disabled_text == "ภาพ Sentinel-2 (EOX) ปิดอยู่ เปิดได้ที่ View → Globe Manager"
    assert SOURCES["eox"].failed_text == "ดึงภาพจาก Sentinel-2 (EOX) ไม่สำเร็จ"
    assert SOURCES["eox"].paused_text == "หยุดดึงภาพจาก Sentinel-2 (EOX) ชั่วคราว"


def test_layer_by_id_is_exact_and_case_sensitive():
    assert layer_by_id(BM) is CATALOG[0]
    for wrong in (BM.lower(), BM.upper(), BM + " ", " " + BM, "", "bluemarble", "../" + BM):
        assert layer_by_id(wrong) is None


def test_limits_match_global_constraints():
    assert imagery.FETCH_TIMEOUT_S == 20
    assert imagery.MAX_CONCURRENT == 4
    assert imagery.EOX_MAX_CONCURRENT == 2
    assert imagery.QUEUE_WAIT_S == 15
    assert imagery.PAUSE_FORBIDDEN_S == 15 * 60
    assert imagery.FAILURE_LIMIT == 20
    assert imagery.PAUSE_FAILURES_S == 5 * 60
    assert imagery.MAX_BODY_BYTES == MAX_BODY
    assert imagery.CACHE_CAP_BYTES == 2 * 1024 ** 3
    assert imagery.CACHE_LOW_WATER == 0.9
    assert imagery.MEMO_TTL_S == 3600
    assert imagery.MEMO_UNSETTLED_TTL_S == 600
    assert imagery.MEMO_MAX_ENTRIES == 10_000


@pytest.mark.parametrize("layer_id, time, ok", [
    (BM, "default", True),
    (BM, "2026-11-11", False),
    (BM, "", False),
    (EO, "default", True),
    (EO, "2026-11-11", False),
    (EO, "", False),
    (VI, "2026-11-11", True),
    (VI, "2024-02-29", True),
    (VI, "2026-02-29", False),
    (VI, "2026-02-30", False),
    (VI, "2026-13-01", False),
    (VI, "2026-11-11x", False),
    (VI, "2026-11-11\n", False),
    (VI, "٢٠٢٦-١١-١١", False),                       # เลขอารบิก-อินเดีย: \d ของ regex รับ แต่ต้องไม่รับ
    (VI, "default", False),
    (VI, "2026-11-11T00:00:00Z", False),
    (HW, SLOT, True),
    (HW, "2026-11-11T00:00:00Z", True),
    (HW, "2026-11-11T23:50:00Z", True),
    (HW, "2026-11-11T00:05:00Z", False),
    (HW, "2026-11-11T00:10:01Z", False),
    (HW, "2026-11-11T24:00:00Z", False),
    (HW, "2026-11-11T00:60:00Z", False),
    (HW, "2026-02-30T00:00:00Z", False),
    (HW, "2026-11-11T00:10:00", False),
    (HW, "2026-11-11T00:10:00Z\n", False),
    (HW, "2026-11-11", False),
    (HW, "default", False),
])
def test_valid_time(layer_id, time, ok):
    assert valid_time(layer_by_id(layer_id), time) is ok


# today = 2026-11-14 12:00 UTC (NOW): daily ไม่นิ่งตั้งแต่เมื่อวาน (>= วันนี้ - 1 วัน) เป็นต้นไป; 10min ไม่นิ่งถ้าเวลาของ token >= ตอนนี้ - 3 ชั่วโมง
@pytest.mark.parametrize("layer_id, time, settled", [
    (BM, "default", True),
    (EO, "default", True),
    (VI, "2026-11-10", True),
    (VI, "2026-11-12", True),                         # 2 วันก่อน: นิ่ง
    (VI, "2026-11-13", False),                        # เมื่อวาน
    (VI, "2026-11-14", False),                        # วันนี้
    (VI, "2026-11-15", False),                        # พรุ่งนี้ (อนาคต)
    (VI, "2027-01-01", False),
    (HW, "2026-11-14T08:50:00Z", True),               # 3 ชม. 10 นาทีก่อน
    (HW, "2026-11-14T09:00:00Z", False),              # พอดี 3 ชม.: ยังไม่นิ่ง (>= ตอนนี้ - 3 ชม.)
    (HW, "2026-11-14T10:00:00Z", False),              # 2 ชม.ก่อน
    (HW, "2026-11-14T12:00:00Z", False),              # ตอนนี้
    (HW, "2026-11-14T12:10:00Z", False),              # อนาคต
    (HW, "2026-11-20T00:00:00Z", False),
    (HW, "2026-11-14T08:00:00Z", True),               # 4 ชม.ก่อน
    (HW, "2026-11-13T00:00:00Z", True),
])
def test_is_settled(layer_id, time, settled):
    assert is_settled(layer_by_id(layer_id), time, NOW) is settled


def test_is_settled_uses_utc_date_boundaries():
    layer = layer_by_id(VI)
    assert is_settled(layer, "2026-11-12", datetime(2026, 11, 14, 0, 0, 0, tzinfo=timezone.utc)) is True
    assert is_settled(layer, "2026-11-12", datetime(2026, 11, 13, 23, 59, 59, tzinfo=timezone.utc)) is False
    # เวลาท้องถิ่น +07:00 ที่ตรงกับ UTC วันที่ 11-13: ต้องนับตามวันที่ UTC ไม่ใช่วันที่ท้องถิ่น
    local = datetime(2026, 11, 14, 5, 0, tzinfo=timezone(timedelta(hours=7)))
    assert is_settled(layer, "2026-11-12", local) is False


def test_upstream_url_exact():
    assert upstream_url(layer_by_id(VI), DAY, 3, 2, 5) == (
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2026-11-11/"
        "GoogleMapsCompatible_Level9/3/2/5.jpg")
    assert upstream_url(layer_by_id(HW), SLOT, 7, 64, 100) == (
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band3_Red_Visible_1km/default/2026-11-11T00:10:00Z/"
        "GoogleMapsCompatible_Level7/7/64/100.png")
    assert upstream_url(layer_by_id(BM), "default", 0, 0, 0) == (
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/default/"
        "GoogleMapsCompatible_Level8/0/0/0.jpg")


def test_upstream_url_exact_eox():
    assert upstream_url(layer_by_id(EO), "default", 3, 2, 5) == (
        "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/3/2/5.jpg")
    assert upstream_url(layer_by_id(EO), "default", 15, 16383, 0) == (
        "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/15/16383/0.jpg")


# ---------- /api/imagery/layers ----------

EOX_CREDIT = "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)"


def test_layers_lists_catalog_in_order_and_enabled_flag(env):
    r = env.client.get("/api/imagery/layers")                     # ไม่มี settings.json: ปิดทุกแหล่ง
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["enabled"] is False
    assert [layer["id"] for layer in body["layers"]] == [row[0] for row in TABLE]
    assert body["layers"][0] == {"id": BM, "title": "Blue Marble", "period": "static", "max_level": 8, "format": "jpg",
                                 "credit": "NASA GIBS / EOSDIS", "source": "gibs"}
    assert body["layers"][4] == {"id": HW, "title": "Himawari-9 Red Visible", "period": "10min", "max_level": 7,
                                 "format": "png", "credit": "NASA GIBS / EOSDIS, JMA", "source": "gibs"}
    assert body["layers"][-1] == {"id": EO, "title": "Sentinel-2 cloudless 2024", "period": "static", "max_level": 15,
                                  "format": "jpg", "credit": EOX_CREDIT, "source": "eox"}
    assert all(set(layer) == {"id", "title", "period", "max_level", "format", "credit", "source"} for layer in body["layers"])
    env.enable()
    assert env.client.get("/api/imagery/layers").json()["enabled"] is True
    env.enable(False)
    assert env.client.get("/api/imagery/layers").json()["enabled"] is False
    assert env.opener.calls == []                                  # ไม่ต่อเน็ตเลย


def test_layers_payload_exact(env):
    expected_layers = [{"id": row[0], "title": row[1], "period": row[2], "max_level": row[4], "format": row[5], "credit": row[6],
                        "source": row[7]} for row in TABLE]
    off = {"gibs": False, "eox": False, "osm": False, "ion": False}
    assert env.client.get("/api/imagery/layers").json() == {"enabled": False, "sources": off, "layers": expected_layers}
    env.enable(True)
    assert env.client.get("/api/imagery/layers").json() == {"enabled": True, "sources": {**off, "gibs": True},
                                                            "layers": expected_layers}
    env.enable(False, eox=True)
    assert env.client.get("/api/imagery/layers").json() == {"enabled": False, "sources": {**off, "eox": True},
                                                            "layers": expected_layers}
    env.enable(False, osm=True)
    assert env.client.get("/api/imagery/layers").json()["sources"] == {**off, "osm": True}
    env.enable(False, ion=True)
    assert env.client.get("/api/imagery/layers").json()["sources"] == {**off, "ion": True}
    env.enable(True, eox=True, osm=True, ion=True)
    assert env.client.get("/api/imagery/layers").json() == {"enabled": True, "sources": {k: True for k in off},
                                                            "layers": expected_layers}
    assert env.opener.calls == []


def test_layers_openapi_declares_sources_and_layer_source(env):
    schemas = env.client.get("/api/openapi.json").json()["components"]["schemas"]
    assert "sources" in schemas["LayersOut"]["properties"]
    assert "source" in schemas["LayerOut"]["properties"]
    assert set(schemas["SourcesOut"]["properties"]) == {"gibs", "eox", "osm", "ion"}


def test_routes_are_in_openapi(env):
    paths = env.client.get("/api/openapi.json").json()["paths"]
    assert "get" in paths["/api/imagery/layers"]
    assert "get" in paths["/api/imagery/tiles/{layer}/{time}/{z}/{y}/{x}"]


# ---------- สวิตช์ ----------

@pytest.mark.parametrize("content", [None, '{"daily": {"enabled": false}}',
                                     '{"daily": {"enabled": false}, "online_imagery": {"enabled": false}}'],
                         ids=["no-file", "old-file-without-field", "explicit-false"])
def test_tile_disabled_returns_403_without_fetch(env, data_dir, content):
    if content is not None:
        (data_dir / "settings.json").write_text(content, encoding="utf-8")
    r = env.tile(VI, DAY, 3, 2, 5)
    j = assert_error(r, 403, "IMAGERY_DISABLED")
    assert j["text"] == "ภาพออนไลน์ปิดอยู่ เปิดได้ที่ View → Globe Manager"
    assert env.opener.calls == []
    assert not (data_dir / "imagery").exists()


def test_tile_disabled_even_when_cached(env):
    env.enable()
    assert env.tile(VI, DAY, 3, 2, 5).status_code == 200
    assert env.path(VI, DAY, 3, 2, 5).is_file()
    assert len(env.opener.calls) == 1
    env.enable(False)                                              # PUT /api/settings มีผลทันที: อ่านค่าทุกคำขอ
    assert_error(env.tile(VI, DAY, 3, 2, 5), 403, "IMAGERY_DISABLED")
    assert env.path(VI, DAY, 3, 2, 5).is_file()                    # ไฟล์ยังอยู่ แต่ไม่ส่ง
    assert len(env.opener.calls) == 1
    env.enable()
    assert env.tile(VI, DAY, 3, 2, 5).status_code == 200           # เปิดอีกที ส่งจาก cache
    assert len(env.opener.calls) == 1


def test_switch_is_checked_before_layer_time_and_coords(env):
    assert_error(env.tile("nope", "garbage", "-1", "x", "y"), 403, "IMAGERY_DISABLED")
    assert env.opener.calls == []


def test_checks_run_in_spec_order(env):
    env.enable()
    assert_error(env.tile("nope", "garbage", "-1", "9", "9"), 404, "IMAGERY_UNKNOWN_LAYER")
    assert_error(env.tile(VI, "garbage", "-1", "9", "9"), 422, "SCENARIO_INVALID", "time")
    assert_error(env.tile(VI, DAY, "10", "9", "9"), 422, "SCENARIO_INVALID", "z")
    assert_error(env.tile(VI, DAY, "3", "9", "9"), 422, "SCENARIO_INVALID", "y")
    assert_error(env.tile(VI, DAY, "3", "1", "9"), 422, "SCENARIO_INVALID", "x")
    assert env.opener.calls == []


# ---------- ตรวจค่าที่ส่งมา: ไม่ถึง opener ไม่เขียนไฟล์ ----------

def test_unknown_layer_404(env):
    env.enable()
    j = assert_error(env.tile("Nope_Layer", DAY, 3, 2, 5), 404, "IMAGERY_UNKNOWN_LAYER")
    assert j["text"] == "ไม่รู้จักชั้นภาพนี้"
    assert env.opener.calls == []


@pytest.mark.parametrize("layer_id", [VI.lower(), VI.upper(), "viirs_noaa20_correctedreflectance_truecolor", BM.swapcase()])
def test_layer_id_case_sensitive(env, layer_id):
    env.enable()
    assert_error(env.tile(layer_id, DAY, 3, 2, 5), 404, "IMAGERY_UNKNOWN_LAYER")
    assert env.opener.calls == []


@pytest.mark.parametrize("layer_id, time", [
    (HW, "2026-11-11T00:05:00Z"),
    (HW, "2026-11-11"),
    (VI, "2026-02-30"),
    (VI, "2026-11-11x"),
    (VI, "default"),
    (BM, "2026-11-11"),
    (HW, "2026-11-11T24:00:00Z"),
    (HW, "2026-11-11T00:10:00"),
    (VI, "2026-11-11%0A"),
    (VI, "٢٠٢٦-١١-١١"),
    (VI, "2026-13-01"),
])
def test_bad_time_422(env, layer_id, time):
    env.enable()
    assert_error(env.tile(layer_id, time, 3, 2, 5), 422, "SCENARIO_INVALID", "time")
    assert env.opener.calls == []
    assert not (env.data_dir / "imagery").exists()


@pytest.mark.parametrize("layer_id, z, y, x, field", [
    (VI, "-1", "0", "0", "z"),
    (VI, "10", "0", "0", "z"),                    # max_level + 1
    (BM, "9", "0", "0", "z"),                     # max_level ของ Blue Marble คือ 8
    (VI, "+1", "0", "0", "z"),
    (VI, "01x", "0", "0", "z"),
    (VI, "%201", "0", "0", "z"),                  # " 1": int() ของ Python รับ แต่ต้องไม่รับ
    (VI, "1.0", "0", "0", "z"),
    (VI, "1000", "0", "0", "z"),
    (VI, "٣", "0", "0", "z"),
    (VI, "3", "0", "8", "x"),                     # 2**z
    (VI, "9", "99999", "0", "y"),                 # 5 หลักยังเป็นตัวเลขที่ถูกรูปแบบ (EOX ระดับ 15 ต้องใช้) แต่เกินช่วงของ GIBS
    (VI, "9", "0", "32767", "x"),
    (VI, "3", "100000", "0", "y"),                # 6 หลัก: ผิดรูปแบบ
    (EO, "15", "0", "100000", "x"),
    (EO, "15", "32768", "0", "y"),
    (VI, "3", "8", "0", "y"),
    (VI, "3", "0", "+2", "x"),
    (VI, "3", "-1", "0", "y"),
    (VI, "0", "0", "1", "x"),
    (VI, "0", "1", "0", "y"),
    (VI, "3", "2", "%2e%2e", "x"),                # `..` ที่ถูกถอดรหัสแล้วมาถึง route เป็นค่าของ x
])
def test_bad_tile_coords_422(env, layer_id, z, y, x, field):
    env.enable(True, eox=True)
    assert_error(env.tile(layer_id, "default" if layer_id in (BM, EO) else DAY, z, y, x), 422, "SCENARIO_INVALID", field)
    assert env.opener.calls == []
    assert not (env.data_dir / "imagery").exists()


@pytest.mark.parametrize("tail", [
    f"{VI}/{DAY}/3/2/%2e%2e",
    f"{VI}/{DAY}/3/%2e%2e/2",
    f"{VI}/{DAY}/%2e%2e/3/2",
    f"{VI}/{DAY}/3/2/..",
    f"{VI}/{DAY}/3/2%2F5/1",
    f"{VI}/{DAY}/3/2/5%2F..%2F..%2Fescape",
    f"{VI}/{DAY}%2F..%2F..%2Fx/3/2/5",
    f"{VI}/..%2F..%2F{DAY}/3/2/5",
    f"{VI}%2F..%2F..%2Fetc/{DAY}/3/2/5",
    f"%2e%2e/{VI}/{DAY}/3/2/5",
    f"{VI}/{DAY}/3/2/5/extra",
    f"{VI}/{DAY}/3/2",
])
def test_dot_segments_and_encoded_slashes_never_reach_opener_or_disk(env, tmp_path, tail):
    env.enable()
    before = {p for p in tmp_path.rglob("*")}
    r = env.client.get(f"/api/imagery/tiles/{tail}")
    assert r.status_code in (404, 405, 422), (r.status_code, r.text)
    assert env.opener.calls == []
    assert {p for p in tmp_path.rglob("*")} - before <= set(), "no file or folder may be created"


def test_fetcher_rejects_bad_address_without_fetch(env):
    layer = layer_by_id(VI)
    for args in [("../../x", 3, 2, 5), (DAY + "/../..", 3, 2, 5), ("2026-11-11", 10, 0, 0), ("2026-11-11", 3, 8, 0),
                 ("2026-11-11", 3, 0, 8), ("2026-11-11", -1, 0, 0), ("2026-11-11", 3, -1, 0)]:
        with pytest.raises(ValueError):
            env.fetcher.get(layer, *args)
    assert env.opener.calls == []
    assert not (env.data_dir / "imagery").exists()


def test_cache_path_must_stay_under_tiles_root(env, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    tiles = env.data_dir / "imagery" / "tiles"
    tiles.mkdir(parents=True)
    (tiles / VI).symlink_to(outside, target_is_directory=True)     # ใครวาง symlink ใน cache ไว้: ห้ามตามออกนอก
    with pytest.raises(ValueError):
        env.fetcher.get(layer_by_id(VI), DAY, 3, 2, 5)
    assert env.opener.calls == []
    assert list(outside.rglob("*")) == []


# ---------- ดึง, cache, ส่งกลับ ----------

def test_fetch_then_cache_hit_no_second_fetch(env):
    env.enable()
    r1 = env.tile(VI, DAY, 3, 2, 5)
    assert r1.status_code == 200, r1.text
    assert r1.content == JPEG
    assert r1.headers["content-type"] == "image/jpeg"
    assert r1.headers["x-content-type-options"] == "nosniff"
    assert r1.headers["cache-control"] == "private, max-age=86400"
    assert len(env.opener.calls) == 1
    call = env.opener.calls[0]
    assert call.url == upstream_url(layer_by_id(VI), DAY, 3, 2, 5)
    assert call.user_agent == "gnss-studio/0.1"
    assert call.timeout == 20
    cached = env.data_dir / "imagery" / "tiles" / VI / DAY / "3" / "2" / "5.jpg"
    assert cached.read_bytes() == JPEG
    assert tile_files(env) == [cached]
    r2 = env.tile(VI, DAY, 3, 2, 5)
    assert r2.status_code == 200
    assert r2.content == r1.content
    for name in ("content-type", "x-content-type-options", "cache-control"):
        assert r2.headers[name] == r1.headers[name]
    assert len(env.opener.calls) == 1


def test_png_layer_cache_path_replaces_colons_and_sets_media_type(env):
    env.enable()
    r = env.tile(HW, SLOT, 7, 64, 100)
    assert r.status_code == 200, r.text
    assert r.content == PNG
    assert r.headers["content-type"] == "image/png"
    assert env.path(HW, SLOT, 7, 64, 100, "png").read_bytes() == PNG
    assert ":" not in str(env.path(HW, SLOT, 7, 64, 100, "png").relative_to(env.data_dir))
    assert env.tile(HW, SLOT, 7, 64, 100).content == PNG
    assert len(env.opener.calls) == 1


def test_static_layer_uses_default_time(env):
    env.enable()
    assert env.tile(BM, "default", 0, 0, 0).status_code == 200
    assert env.path(BM, "default", 0, 0, 0).is_file()
    assert env.opener.calls[0].url.endswith("/BlueMarble_NextGeneration/default/default/GoogleMapsCompatible_Level8/0/0/0.jpg")


def test_response_is_closed(env):
    env.enable()
    assert env.tile(VI, DAY, 3, 2, 5).status_code == 200
    assert env.opener.responses[0].closed is True


def test_cache_hit_touches_mtime(env):
    env.enable()
    env.tile(VI, DAY, 3, 2, 5)
    path = env.path(VI, DAY, 3, 2, 5)
    os.utime(path, (1_000_000, 1_000_000))
    assert env.tile(VI, DAY, 3, 2, 5).status_code == 200
    assert path.stat().st_mtime > 1_000_000 + 86400


def test_corrupt_cache_entry_is_dropped_and_refetched(env):
    env.enable()
    path = env.path(VI, DAY, 3, 2, 5)
    path.parent.mkdir(parents=True)
    path.write_bytes(b"<html>not an image</html>")
    r = env.tile(VI, DAY, 3, 2, 5)
    assert r.status_code == 200
    assert r.content == JPEG
    assert len(env.opener.calls) == 1
    assert path.read_bytes() == JPEG


def test_cache_write_failure_still_serves_the_tile(env):
    env.enable()
    (env.data_dir / "imagery").write_bytes(b"a file where the folder should be")
    r = env.tile(VI, DAY, 3, 2, 5)
    assert r.status_code == 200
    assert r.content == JPEG
    assert env.tile(VI, DAY, 3, 2, 6).status_code == 200
    assert len(env.opener.calls) == 2


# ---------- ชิ้นภาพที่ยังไม่นิ่ง: ไม่ cache ไม่ส่งจากดิสก์ ส่ง no-store ----------

SETTLED_CC = "private, max-age=86400"


def _unsettled_case(env, layer_id, time, z=3, y=2, x=5):
    env.enable()
    ext = "png" if layer_id == HW else "jpg"
    body = PNG if ext == "png" else JPEG
    r1, r2 = env.tile(layer_id, time, z, y, x), env.tile(layer_id, time, z, y, x)
    for r in (r1, r2):
        assert r.status_code == 200, r.text
        assert r.content == body
        assert r.headers["cache-control"] == "no-store"
        assert r.headers["x-content-type-options"] == "nosniff"
    assert len(env.opener.calls) == 2                              # ไม่เคยส่งจาก cache
    assert not env.path(layer_id, time, z, y, x, ext).exists()
    assert tile_files(env) == []


@pytest.mark.parametrize("layer_id, time", [
    (VI, "2026-11-14"),                                            # วันนี้
    (VI, "2026-11-13"),                                            # เมื่อวาน
    (VI, "2026-11-20"),                                            # อนาคต
    (HW, "2026-11-14T10:00:00Z"),                                  # 2 ชม.ก่อน
    (HW, "2026-11-14T09:00:00Z"),                                  # พอดี 3 ชม.
    (HW, "2026-11-14T13:00:00Z"),                                  # อนาคต
], ids=["daily-today", "daily-yesterday", "daily-future", "10min-2h", "10min-3h-exact", "10min-future"])
def test_unsettled_tile_is_not_cached_and_sends_no_store(env, layer_id, time):
    _unsettled_case(env, layer_id, time)


@pytest.mark.parametrize("layer_id, time, ext", [
    (VI, "2026-11-12", "jpg"),                                     # 2 วันก่อน
    (VI, DAY, "jpg"),
    (HW, "2026-11-14T08:00:00Z", "png"),                           # 4 ชม.ก่อน
    (HW, "2026-11-14T08:50:00Z", "png"),                           # 3 ชม. 10 นาทีก่อน
    (BM, "default", "jpg"),                                        # static นิ่งเสมอ
], ids=["daily-2d", "daily-3d", "10min-4h", "10min-3h10", "static"])
def test_settled_tile_is_cached_with_max_age(env, layer_id, time, ext):
    env.enable()
    z, y, x = (0, 0, 0) if layer_id == BM else (3, 2, 5)
    r1, r2 = env.tile(layer_id, time, z, y, x), env.tile(layer_id, time, z, y, x)
    for r in (r1, r2):
        assert r.status_code == 200, r.text
        assert r.headers["cache-control"] == SETTLED_CC
        assert r.headers["x-content-type-options"] == "nosniff"
    assert len(env.opener.calls) == 1
    assert env.path(layer_id, time, z, y, x, ext).is_file()


def test_old_file_for_unsettled_token_is_ignored_not_served_not_overwritten(env):
    env.enable()
    old = JPEG[:-1] + b"X"                                         # ผ่านการตรวจ magic bytes แต่ไม่เหมือนที่ GIBS ส่งมาตอนนี้
    path = env.path(VI, "2026-11-14", 3, 2, 5)
    path.parent.mkdir(parents=True)
    path.write_bytes(old)
    r = env.tile(VI, "2026-11-14", 3, 2, 5)
    assert r.status_code == 200
    assert r.content == JPEG
    assert r.headers["cache-control"] == "no-store"
    assert len(env.opener.calls) == 1
    assert path.read_bytes() == old                                # ไม่ถูกเขียนทับ


def test_tile_becomes_cacheable_once_it_settles(env):
    env.enable()
    assert env.tile(VI, "2026-11-13", 3, 2, 5).headers["cache-control"] == "no-store"
    assert env.tile(HW, "2026-11-14T10:00:00Z", 3, 2, 5).headers["cache-control"] == "no-store"
    assert tile_files(env) == []
    env.wall.advance(days=2)                                       # เมื่อวานกลายเป็น 3 วันก่อน; 10:00 เมื่อสองวันก่อน
    assert env.tile(VI, "2026-11-13", 3, 2, 5).headers["cache-control"] == SETTLED_CC
    assert env.tile(HW, "2026-11-14T10:00:00Z", 3, 2, 5).headers["cache-control"] == SETTLED_CC
    assert len(tile_files(env)) == 2
    assert len(env.opener.calls) == 4
    env.tile(VI, "2026-11-13", 3, 2, 5)
    assert len(env.opener.calls) == 4


def test_unsettled_not_available_memo_lasts_10_min(env):
    env.enable()
    env.opener.script = [http_error(404), http_error(404)]
    assert_error(env.tile(VI, "2026-11-14", 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert_error(env.tile(VI, "2026-11-14", 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 1
    env.clock.advance(599)
    assert_error(env.tile(VI, "2026-11-14", 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 1
    env.clock.advance(2)                                           # รวม 601 s: หมดอายุ
    assert_error(env.tile(VI, "2026-11-14", 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 2
    assert_error(env.tile(VI, "2026-11-14", 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")      # จำใหม่อีก 10 นาที
    assert len(env.opener.calls) == 2
    env.clock.advance(601)
    assert env.tile(VI, "2026-11-14", 3, 2, 5).status_code == 200
    assert len(env.opener.calls) == 3


def test_unsettled_10min_slot_not_available_memo_lasts_10_min(env):
    env.enable()
    env.opener.script = [http_error(404)]
    assert_error(env.tile(HW, "2026-11-14T11:50:00Z", 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    env.clock.advance(601)
    assert env.tile(HW, "2026-11-14T11:50:00Z", 3, 2, 5).status_code == 200
    assert len(env.opener.calls) == 2


def test_settled_not_available_memo_still_lasts_1_hour(env):
    env.enable()
    env.opener.script = [http_error(404)] * 2
    assert_error(env.tile(VI, "2026-11-12", 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    env.clock.advance(601)
    assert_error(env.tile(VI, "2026-11-12", 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 1                              # เกิน 10 นาทีแล้วแต่ยังจำอยู่
    env.clock.advance(3000)                                        # รวม 3601 s
    assert_error(env.tile(VI, "2026-11-12", 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 2


def test_unsettled_tile_failures_and_pause_behave_as_before(env):
    env.enable()
    env.opener.script = [http_error(403)]
    assert_error(env.tile(VI, "2026-11-14", 3, 2, 5), 502, "IMAGERY_FETCH_FAILED")
    assert_error(env.tile(VI, "2026-11-14", 3, 2, 6), 503, "IMAGERY_PAUSED")
    assert len(env.opener.calls) == 1


# ---------- ไม่มีภาพ: จำไว้ ----------

@pytest.mark.parametrize("code", [404, 400])
def test_upstream_404_memoized(env, code):
    env.enable()
    env.opener.script = [http_error(code), http_error(code)]
    j = assert_error(env.tile(VI, DAY, 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert j["text"] == "ไม่มีภาพของชั้นนี้ ณ เวลานี้"
    assert_error(env.tile(VI, DAY, 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 1
    assert tile_files(env) == []
    env.clock.advance(3599)
    assert_error(env.tile(VI, DAY, 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 1
    env.clock.advance(2)                                           # รวม 3601 s: หมดอายุ
    assert_error(env.tile(VI, DAY, 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 2
    assert_error(env.tile(VI, DAY, 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")      # จำใหม่อีก 1 ชั่วโมง
    assert len(env.opener.calls) == 2


def test_not_available_memo_is_per_tile_and_does_not_count_as_failure(env):
    env.enable()
    env.opener.script = [http_error(404)] * 25
    for x in range(25):                                            # 404 ไม่นับเป็นความล้มเหลวของเครือข่าย (ไม่เข้าเกณฑ์ 20 ติด)
        assert_error(env.tile(VI, DAY, 9, 0, x), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 25
    assert env.tile(VI, DAY, 9, 0, 25).status_code == 200


def test_not_available_memo_is_bounded(env, monkeypatch):
    monkeypatch.setattr(imagery, "MEMO_MAX_ENTRIES", 3)
    env.enable()
    env.opener.script = [http_error(404)] * 6
    for x in range(5):
        assert_error(env.tile(VI, DAY, 9, 0, x), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 5
    for x in (2, 3, 4):                                            # ล่าสุด 3 รายการยังจำอยู่
        assert_error(env.tile(VI, DAY, 9, 0, x), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 5
    assert_error(env.tile(VI, DAY, 9, 0, 0), 404, "IMAGERY_NOT_AVAILABLE")     # เก่าสุดถูกทิ้งไปแล้ว: ถามใหม่
    assert len(env.opener.calls) == 6


# ---------- พักการดึง ----------

def _resume_time(j):
    return datetime.strptime(j["detail"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


@pytest.mark.parametrize("code", [403, 429])
def test_upstream_403_pauses_15_min(env, code):
    env.enable()
    assert env.tile(VI, DAY, 9, 0, 0).status_code == 200            # ชิ้นนี้อยู่ใน cache แล้ว
    env.opener.script = [http_error(code)]
    started = env.wall()
    j = assert_error(env.tile(VI, DAY, 9, 0, 1), 502, "IMAGERY_FETCH_FAILED")
    assert j["text"] == "ดึงภาพจาก NASA GIBS ไม่สำเร็จ"
    assert str(code) in j["detail"]
    assert len(env.opener.calls) == 2
    for x in (2, 1):                                               # 403/429 ไม่ถูกจำเป็น "ไม่มีภาพ": ระหว่างพักตอบ PAUSED ทุกชิ้นที่ไม่มีใน cache
        j = assert_error(env.tile(VI, DAY, 9, 0, x), 503, "IMAGERY_PAUSED")
        assert j["text"] == "หยุดดึงภาพจาก NASA GIBS ชั่วคราว"
        resume = _resume_time(j)
        assert timedelta(minutes=14) < resume - started < timedelta(minutes=16)
    assert len(env.opener.calls) == 2                              # ไม่ถึง opener
    assert env.tile(VI, DAY, 9, 0, 0).status_code == 200            # ชิ้นใน cache ยังส่งได้ระหว่างพัก
    assert len(env.opener.calls) == 2
    env.clock.advance(899)
    assert_error(env.tile(VI, DAY, 9, 0, 3), 503, "IMAGERY_PAUSED")
    env.clock.advance(2)                                           # รวม 901 s: ครบ 15 นาที
    assert env.tile(VI, DAY, 9, 0, 3).status_code == 200
    assert len(env.opener.calls) == 3
    assert env.log().count("หยุดดึงภาพจาก NASA GIBS") == 1         # log ครั้งเดียวต่อการพัก


def test_20_consecutive_failures_pause_5_min(env):
    env.enable()
    env.opener.default = lambda request: URLError("connection refused")
    for x in range(20):
        j = assert_error(env.tile(VI, DAY, 9, 0, x), 502, "IMAGERY_FETCH_FAILED")
        assert j["detail"]
    assert len(env.opener.calls) == 20
    started = env.wall()
    j = assert_error(env.tile(VI, DAY, 9, 0, 20), 503, "IMAGERY_PAUSED")
    assert timedelta(minutes=4) < _resume_time(j) - started < timedelta(minutes=6)
    assert len(env.opener.calls) == 20
    env.clock.advance(299)
    assert_error(env.tile(VI, DAY, 9, 0, 20), 503, "IMAGERY_PAUSED")
    assert len(env.opener.calls) == 20
    env.clock.advance(2)                                           # รวม 301 s
    assert_error(env.tile(VI, DAY, 9, 0, 20), 502, "IMAGERY_FETCH_FAILED")      # ถามอีกครั้ง (ตัวนับเริ่มนับใหม่)
    assert len(env.opener.calls) == 21
    assert_error(env.tile(VI, DAY, 9, 0, 21), 502, "IMAGERY_FETCH_FAILED")
    assert len(env.opener.calls) == 22


def test_success_resets_failure_count(env):
    env.enable()
    fail = lambda request: TimeoutError("timed out")
    env.opener.default = fail
    for x in range(19):
        assert_error(env.tile(VI, DAY, 9, 0, x), 502, "IMAGERY_FETCH_FAILED")
    env.opener.default = _default_response
    assert env.tile(VI, DAY, 9, 1, 0).status_code == 200            # สำเร็จหนึ่งครั้ง: ตัวนับกลับเป็น 0
    env.opener.default = fail
    for x in range(19):
        assert_error(env.tile(VI, DAY, 9, 2, x), 502, "IMAGERY_FETCH_FAILED")
    assert len(env.opener.calls) == 39                              # ไม่มีการพักเกิดขึ้น
    assert_error(env.tile(VI, DAY, 9, 3, 0), 502, "IMAGERY_FETCH_FAILED")      # ติดกันครบ 20: ครั้งนี้ยังถึง opener
    assert_error(env.tile(VI, DAY, 9, 3, 1), 503, "IMAGERY_PAUSED")
    assert len(env.opener.calls) == 40


# ---------- ผลที่ใช้ไม่ได้: 502 ไม่เขียน cache ----------

@pytest.mark.parametrize("outcome", [
    URLError("name resolution failed"),
    TimeoutError("timed out"),
    ConnectionResetError("reset"),
    OSError("network down"),
    http_error(500),
    http_error(503),
    http_error(302),                                            # ตัว redirect handler ของเรา: ไม่ตาม แล้ว urllib ยก HTTPError 3xx
    http_error(401),
    IncompleteRead(b"ab"),
    FakeResponse(JPEG, status=204),
    FakeResponse(JPEG, headers={"Content-Length": str(len(JPEG) + 10)}),       # ถูกตัดกลางทาง: ห้ามเก็บเป็นภาพ
], ids=lambda o: type(o).__name__ + (f"-{getattr(o, 'code', getattr(o, 'status', ''))}" if hasattr(o, "code") or hasattr(o, "status") else ""))
def test_unusable_upstream_results_return_502_and_cache_nothing(env, outcome):
    env.enable()
    env.opener.script = [outcome]
    j = assert_error(env.tile(VI, DAY, 3, 2, 5), 502, "IMAGERY_FETCH_FAILED")
    assert j["text"] == "ดึงภาพจาก NASA GIBS ไม่สำเร็จ"
    assert j["detail"] and isinstance(j["detail"], str)
    assert tile_files(env) == []
    assert len(env.opener.calls) == 1


def test_html_body_rejected_not_cached(env):
    env.enable()
    env.opener.script = [FakeResponse(b"<!doctype html><html><body>Access denied</body></html>")]
    assert_error(env.tile(VI, DAY, 3, 2, 5), 502, "IMAGERY_FETCH_FAILED")
    assert tile_files(env) == []
    assert not env.path(VI, DAY, 3, 2, 5).exists()


@pytest.mark.parametrize("layer_id, time, body", [
    (VI, DAY, PNG),                                             # ชั้น jpg ได้ PNG
    (HW, SLOT, JPEG),                                           # ชั้น png ได้ JPEG
    (VI, DAY, b"\xff\xd8"),                                     # magic ไม่ครบ
    (HW, SLOT, b"\x89PNG\r\n"),
    (VI, DAY, b""),
    (VI, DAY, b"GIF89a" + b"x" * 90),
])
def test_png_for_jpg_layer_rejected(env, layer_id, time, body):
    env.enable()
    env.opener.script = [FakeResponse(body)]
    assert_error(env.tile(layer_id, time, 3, 2, 5), 502, "IMAGERY_FETCH_FAILED")
    assert tile_files(env) == []


def test_body_over_2mb_rejected(env):
    env.enable()
    exact = JPEG + b"x" * (MAX_BODY - len(JPEG))
    over = JPEG + b"x" * (MAX_BODY - len(JPEG) + 1)
    huge = FakeResponse(JPEG + b"x" * (5 * MAX_BODY))
    env.opener.script = [FakeResponse(exact), FakeResponse(over), huge]
    r = env.tile(VI, DAY, 3, 2, 5)
    assert r.status_code == 200                                    # 2 MB พอดียังรับ
    assert len(r.content) == MAX_BODY
    assert env.opener.responses[0].read_sizes == [MAX_BODY + 1]    # อ่านไม่เกิน 2 MB + 1 ไบต์
    assert_error(env.tile(VI, DAY, 3, 2, 6), 502, "IMAGERY_FETCH_FAILED")
    assert not env.path(VI, DAY, 3, 2, 6).exists()
    assert_error(env.tile(VI, DAY, 3, 2, 7), 502, "IMAGERY_FETCH_FAILED")
    assert huge.stream.tell() == MAX_BODY + 1                      # ไม่อ่านเกินที่ขอ
    assert tile_files(env) == [env.path(VI, DAY, 3, 2, 5)]


def test_redirect_refused():
    """opener ตั้งต้นของตัวดึงไม่ตาม redirect เลย (ไม่ใช่แค่ข้ามโฮสต์): 3xx กลายเป็น HTTPError ไม่ใช่การไปโฮสต์ใหม่"""
    opener = make_opener()
    assert any(isinstance(h, imagery.NoRedirect) for h in opener.handlers)
    assert not any(type(h) is urllib.request.HTTPRedirectHandler for h in opener.handlers)
    for code in (301, 302, 303, 307, 308):
        headers = Message()
        headers["Location"] = "https://evil.example/tile.jpg"
        request = urllib.request.Request("https://gibs.earthdata.nasa.gov/wmts/x.jpg")
        with pytest.raises(HTTPError) as exc:
            opener.error("http", request, io.BytesIO(b""), code, "Redirect", headers)
        assert exc.value.code == code
        exc.value.close()


# ---------- ดึงพร้อมกัน ----------

def test_concurrency_limit_busy(env, monkeypatch):
    env.enable()
    monkeypatch.setattr(imagery, "QUEUE_WAIT_S", 0.05)
    gate, entered = threading.Event(), threading.Semaphore(0)

    def blocking(request):
        entered.release()
        assert gate.wait(10)
        return FakeResponse(JPEG)

    env.opener.default = blocking
    layer, results = layer_by_id(VI), []
    threads = [threading.Thread(target=lambda x=x: results.append(env.fetcher.get(layer, DAY, 9, 0, x))) for x in range(4)]
    for t in threads:
        t.start()
    try:
        for _ in range(4):
            assert entered.acquire(timeout=10)                     # ทั้ง 4 อยู่ใน opener พร้อมกัน
        j = assert_error(env.tile(VI, DAY, 9, 0, 4), 503, "IMAGERY_BUSY")       # ที่ 5 รอคิวเกินเวลา
        assert j["text"] == "มีคำขอภาพค้างอยู่มาก ลองใหม่อีกครั้ง"
        assert len(env.opener.calls) == 4
    finally:
        gate.set()
        for t in threads:
            t.join(10)
    assert [r[1] for r in results] == ["image/jpeg"] * 4
    assert env.tile(VI, DAY, 9, 0, 5).status_code == 200            # ที่ว่างคืนแล้ว


# ---------- สวิตช์ปิดระหว่างรอคิว ----------

class SpySlots:
    """ห่อ semaphore ของตัวดึง: บอกเมื่อมีคำขอที่หาที่ว่างไม่ได้ทันทีและกำลังจะรอคิว"""

    def __init__(self, inner):
        self.inner, self.queued = inner, threading.Event()

    def acquire(self, timeout=None):
        if self.inner.acquire(blocking=False):
            return True
        self.queued.set()
        return self.inner.acquire(timeout=timeout)

    def release(self):
        self.inner.release()


def test_switch_is_rechecked_after_waiting_for_a_slot(env, monkeypatch):
    env.enable()
    slots = env.fetcher._slots["gibs"] = SpySlots(env.fetcher._slots["gibs"])
    gate, entered = threading.Event(), threading.Semaphore(0)

    def blocking(request):
        entered.release()
        assert gate.wait(10)
        return FakeResponse(JPEG)

    env.opener.default = blocking
    layer, results = layer_by_id(VI), []
    threads = [threading.Thread(target=lambda x=x: results.append(env.fetcher.get(layer, DAY, 9, 0, x))) for x in range(4)]
    fifth = []
    queued_request = threading.Thread(target=lambda: fifth.append(env.tile(VI, DAY, 9, 0, 4)))
    for t in threads:
        t.start()
    try:
        for _ in range(4):
            assert entered.acquire(timeout=10)                     # 4 ชิ้นอยู่ใน opener: ที่ว่างหมด
        queued_request.start()                                     # คำขอที่ 5 ผ่านสวิตช์ของ route (เปิดอยู่) แล้วรอคิว
        assert slots.queued.wait(10)
        assert len(env.opener.calls) == 4
        env.enable(False)                                          # ผู้ใช้ปิดสวิตช์ระหว่างที่คำขอที่ 5 ยังรออยู่
    finally:
        gate.set()
        for t in threads + [queued_request]:
            t.join(10)
    assert len(fifth) == 1
    j = assert_error(fifth[0], 403, "IMAGERY_DISABLED")
    assert j["text"] == "ภาพออนไลน์ปิดอยู่ เปิดได้ที่ View → Globe Manager"
    assert len(env.opener.calls) == 4                              # ที่ 5 ไม่ถึง opener
    assert not env.path(VI, DAY, 9, 0, 4).exists()
    assert [r[1] for r in results] == ["image/jpeg"] * 4


def test_switch_recheck_error_is_not_counted_or_remembered(env):
    env.enable()
    env.fetcher.enabled = lambda source: False
    with pytest.raises(imagery.ApiError) as exc:
        env.fetcher.get(layer_by_id(VI), DAY, 9, 0, 0)
    assert (exc.value.status, exc.value.code) == (403, "IMAGERY_DISABLED")
    assert env.opener.calls == []
    env.fetcher.enabled = lambda source: True
    assert env.fetcher.get(layer_by_id(VI), DAY, 9, 0, 0)[1] == "image/jpeg"     # ไม่ถูกจำ ไม่พัก
    assert len(env.opener.calls) == 1


def test_fetcher_without_enabled_callable_is_always_enabled(tmp_path):
    fetcher = TileFetcher(tmp_path, opener=FakeOpener())
    assert fetcher.enabled("gibs") is True
    assert fetcher.enabled("eox") is True


def test_app_wires_fetcher_enabled_to_the_settings_switch(tmp_path):
    app = create_app(Config(data_dir=tmp_path / "data", web_dist=tmp_path / "no-dist"), start_background=False)
    fetcher = app.state.imagery
    assert (fetcher.enabled("gibs"), fetcher.enabled("eox")) == (False, False)      # ไม่มี settings.json
    data = tmp_path / "data"
    daily = settings.Daily(enabled=False)
    settings.save(data, settings.Settings(daily=daily, online_imagery=settings.OnlineImagery(enabled=True)))
    assert (fetcher.enabled("gibs"), fetcher.enabled("eox")) == (True, False)       # เปิด GIBS ไม่เปิด EOX
    settings.save(data, settings.Settings(daily=daily, online_imagery=settings.OnlineImagery(eox=True)))
    assert (fetcher.enabled("gibs"), fetcher.enabled("eox")) == (False, True)       # เปิด EOX ไม่เปิด GIBS
    settings.save(data, settings.Settings(daily=daily, online_imagery=settings.OnlineImagery(osm=True, ion=True)))
    assert (fetcher.enabled("gibs"), fetcher.enabled("eox")) == (False, False)      # osm/ion ไม่ผ่าน server
    settings.save(data, settings.Settings(daily=daily, online_imagery=settings.OnlineImagery(enabled=True, eox=True)))
    assert (fetcher.enabled("gibs"), fetcher.enabled("eox")) == (True, True)


# ---------- Sentinel-2 cloudless (EOX): สวิตช์ ตัวนับ และคิวแยกต่อแหล่ง ----------

GIBS_DISABLED = "ภาพออนไลน์ปิดอยู่ เปิดได้ที่ View → Globe Manager"
EOX_DISABLED = "ภาพ Sentinel-2 (EOX) ปิดอยู่ เปิดได้ที่ View → Globe Manager"
EOX_FAILED = "ดึงภาพจาก Sentinel-2 (EOX) ไม่สำเร็จ"
EOX_PAUSED = "หยุดดึงภาพจาก Sentinel-2 (EOX) ชั่วคราว"
EOX_URL_353 = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/3/2/5.jpg"


def _fail(request):
    return URLError("connection refused")


def test_eox_tile_is_fetched_cached_and_sent_as_settled(env):
    env.enable(False, eox=True)
    r1 = env.tile(EO, "default", 3, 2, 5)
    assert r1.status_code == 200, r1.text
    assert r1.content == JPEG
    assert r1.headers["content-type"] == "image/jpeg"
    assert r1.headers["x-content-type-options"] == "nosniff"
    assert r1.headers["cache-control"] == SETTLED_CC               # static: นิ่งเสมอ
    assert len(env.opener.calls) == 1
    call = env.opener.calls[0]
    assert call.url == EOX_URL_353
    assert call.user_agent == "gnss-studio/0.1"
    assert call.timeout == 20
    cached = env.data_dir / "imagery" / "tiles" / EO / "default" / "3" / "2" / "5.jpg"
    assert cached.read_bytes() == JPEG
    assert tile_files(env) == [cached]
    r2 = env.tile(EO, "default", 3, 2, 5)
    assert (r2.status_code, r2.content, r2.headers["cache-control"]) == (200, JPEG, SETTLED_CC)
    assert len(env.opener.calls) == 1                              # ครั้งที่สองส่งจาก cache


def test_eox_deepest_level_is_15(env):
    env.enable(False, eox=True)
    assert env.tile(EO, "default", 15, 32767, 32767).status_code == 200
    assert env.opener.calls[0].url == "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/15/32767/32767.jpg"
    assert_error(env.tile(EO, "default", 16, 0, 0), 422, "SCENARIO_INVALID", "z")
    assert_error(env.tile(EO, "default", 15, 32768, 0), 422, "SCENARIO_INVALID", "y")
    assert_error(env.tile(EO, "default", 15, 0, 32768), 422, "SCENARIO_INVALID", "x")
    assert len(env.opener.calls) == 1


def test_eox_checks_run_in_spec_order(env):
    env.enable(False, eox=True)
    assert_error(env.tile(EO, "2026-11-11", "-1", "9", "9"), 422, "SCENARIO_INVALID", "time")      # EOX ใช้เวลา default เท่านั้น
    assert_error(env.tile(EO, "latest", 3, 2, 5), 422, "SCENARIO_INVALID", "time")
    assert_error(env.tile(EO, "default", "16", "9", "9"), 422, "SCENARIO_INVALID", "z")
    assert_error(env.tile(EO, "default", "3", "9", "9"), 422, "SCENARIO_INVALID", "y")
    assert_error(env.tile(EO, "default", "3", "1", "9"), 422, "SCENARIO_INVALID", "x")
    assert env.opener.calls == []


def test_eox_tile_with_eox_off_is_403_even_when_gibs_is_on(env):
    env.enable(True, eox=False)
    j = assert_error(env.tile(EO, "default", 3, 2, 5), 403, "IMAGERY_DISABLED")
    assert j["text"] == EOX_DISABLED
    assert env.opener.calls == []
    assert not (env.data_dir / "imagery").exists()


def test_gibs_tile_with_gibs_off_is_403_even_when_eox_is_on(env):
    env.enable(False, eox=True)
    j = assert_error(env.tile(VI, DAY, 3, 2, 5), 403, "IMAGERY_DISABLED")
    assert j["text"] == GIBS_DISABLED                              # ข้อความ GIBS ไม่เปลี่ยน
    assert env.opener.calls == []
    assert not (env.data_dir / "imagery").exists()
    assert env.tile(EO, "default", 3, 2, 5).status_code == 200     # ในขณะที่ EOX ยังใช้ได้
    assert [c.url for c in env.opener.calls] == [EOX_URL_353]


def test_osm_and_ion_switches_never_enable_a_server_source(env):
    env.enable(False, osm=True, ion=True)
    assert_error(env.tile(VI, DAY, 3, 2, 5), 403, "IMAGERY_DISABLED")
    assert_error(env.tile(EO, "default", 3, 2, 5), 403, "IMAGERY_DISABLED")
    assert env.opener.calls == []


def test_eox_tile_disabled_even_when_cached(env):
    env.enable(False, eox=True)
    assert env.tile(EO, "default", 3, 2, 5).status_code == 200
    assert env.path(EO, "default", 3, 2, 5).is_file()
    env.enable(True, eox=False)                                    # ปิด EOX (GIBS เปิดอยู่): มีผลทันที
    assert_error(env.tile(EO, "default", 3, 2, 5), 403, "IMAGERY_DISABLED")
    assert env.path(EO, "default", 3, 2, 5).is_file()
    env.enable(False, eox=True)
    assert env.tile(EO, "default", 3, 2, 5).status_code == 200
    assert len(env.opener.calls) == 1


def test_unknown_layer_is_403_only_when_every_proxied_source_is_off(env):
    j = assert_error(env.tile("nope", "garbage", "-1", "x", "y"), 403, "IMAGERY_DISABLED")
    assert j["text"] == GIBS_DISABLED                              # ปิดหมด: เหมือนเดิมทุกประการ
    env.enable(False, osm=True, ion=True)
    assert_error(env.tile("nope", "garbage", "-1", "x", "y"), 403, "IMAGERY_DISABLED")
    env.enable(False, eox=True)
    assert_error(env.tile("nope", DAY, 3, 2, 5), 404, "IMAGERY_UNKNOWN_LAYER")
    env.enable(True)
    assert_error(env.tile("nope", DAY, 3, 2, 5), 404, "IMAGERY_UNKNOWN_LAYER")
    assert env.opener.calls == []


def test_eox_rejects_png_body(env):
    env.enable(False, eox=True)
    env.opener.script = [FakeResponse(PNG)]
    j = assert_error(env.tile(EO, "default", 3, 2, 5), 502, "IMAGERY_FETCH_FAILED")
    assert j["text"] == EOX_FAILED
    assert tile_files(env) == []


def test_eox_not_available_is_memoized_for_an_hour_and_per_layer(env):
    env.enable(True, eox=True)
    env.opener.script = [http_error(404)]
    j = assert_error(env.tile(EO, "default", 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert j["text"] == "ไม่มีภาพของชั้นนี้ ณ เวลานี้"
    assert_error(env.tile(EO, "default", 3, 2, 5), 404, "IMAGERY_NOT_AVAILABLE")
    assert len(env.opener.calls) == 1
    assert env.tile(BM, "default", 3, 2, 5).status_code == 200      # ตำแหน่งเดียวกันของชั้นอื่น: ไม่เกี่ยวกัน
    env.clock.advance(3601)
    assert env.tile(EO, "default", 3, 2, 5).status_code == 200
    assert len(env.opener.calls) == 3


@pytest.mark.parametrize("code", [403, 429])
def test_eox_pause_does_not_pause_gibs(env, code):
    env.enable(True, eox=True)
    assert env.tile(EO, "default", 9, 0, 0).status_code == 200      # อยู่ใน cache แล้ว
    env.opener.script = [http_error(code)]
    started = env.wall()
    j = assert_error(env.tile(EO, "default", 9, 0, 1), 502, "IMAGERY_FETCH_FAILED")
    assert j["text"] == EOX_FAILED and str(code) in j["detail"]
    j = assert_error(env.tile(EO, "default", 9, 0, 2), 503, "IMAGERY_PAUSED")
    assert j["text"] == EOX_PAUSED
    assert timedelta(minutes=14) < _resume_time(j) - started < timedelta(minutes=16)
    assert len(env.opener.calls) == 2
    assert env.tile(EO, "default", 9, 0, 0).status_code == 200      # ชิ้นใน cache ส่งได้ระหว่างพัก
    assert env.tile(VI, DAY, 9, 0, 0).status_code == 200            # GIBS ยังดึงได้ตามปกติ
    assert len(env.opener.calls) == 3
    env.clock.advance(899)
    assert_error(env.tile(EO, "default", 9, 0, 2), 503, "IMAGERY_PAUSED")
    env.clock.advance(2)
    assert env.tile(EO, "default", 9, 0, 2).status_code == 200
    log = env.log()
    assert log.count("หยุดดึงภาพจาก Sentinel-2 (EOX)") == 1
    assert "หยุดดึงภาพจาก NASA GIBS" not in log


@pytest.mark.parametrize("code", [403, 429])
def test_gibs_pause_does_not_pause_eox(env, code):
    env.enable(True, eox=True)
    env.opener.script = [http_error(code)]
    j = assert_error(env.tile(VI, DAY, 9, 0, 1), 502, "IMAGERY_FETCH_FAILED")
    assert j["text"] == "ดึงภาพจาก NASA GIBS ไม่สำเร็จ"
    j = assert_error(env.tile(VI, DAY, 9, 0, 2), 503, "IMAGERY_PAUSED")
    assert j["text"] == "หยุดดึงภาพจาก NASA GIBS ชั่วคราว"
    assert env.tile(EO, "default", 9, 0, 1).status_code == 200      # EOX ยังดึงได้
    assert len(env.opener.calls) == 2
    log = env.log()
    assert log.count("หยุดดึงภาพจาก NASA GIBS") == 1
    assert "หยุดดึงภาพจาก Sentinel-2 (EOX)" not in log


def test_failure_counters_are_separate_per_source(env):
    env.enable(True, eox=True)
    env.opener.default = _fail
    for x in range(19):                                              # 19 + 19 = 38 > 20: ถ้านับรวมกันต้องพักไปแล้ว
        assert_error(env.tile(VI, DAY, 9, 0, x), 502, "IMAGERY_FETCH_FAILED")
        assert_error(env.tile(EO, "default", 9, 0, x), 502, "IMAGERY_FETCH_FAILED")
    assert len(env.opener.calls) == 38
    env.opener.default = _default_response
    assert env.tile(VI, DAY, 9, 1, 0).status_code == 200            # สำเร็จของ GIBS ล้างตัวนับของ GIBS เท่านั้น
    env.opener.default = _fail
    assert_error(env.tile(EO, "default", 9, 1, 0), 502, "IMAGERY_FETCH_FAILED")     # ครั้งที่ 20 ของ EOX: ยังถึง opener
    j = assert_error(env.tile(EO, "default", 9, 1, 1), 503, "IMAGERY_PAUSED")       # EOX พัก 5 นาที
    assert j["text"] == EOX_PAUSED
    assert len(env.opener.calls) == 40
    env.opener.default = _default_response
    assert env.tile(VI, DAY, 9, 1, 1).status_code == 200            # GIBS ไม่ถูกพักตาม
    assert len(env.opener.calls) == 41
    env.clock.advance(301)
    assert env.tile(EO, "default", 9, 1, 1).status_code == 200


def _blocking_for(env, host_marker, entered, gate):
    """opener ที่ค้างเฉพาะคำขอที่ URL มี host_marker (คำขอแหล่งอื่นตอบทันที)"""
    def opener(request):
        if host_marker in request.full_url:
            entered.release()
            assert gate.wait(10)
        return _default_response(request)
    env.opener.default = opener


def test_eox_concurrency_limit_is_2_and_gibs_has_its_own_slots(env, monkeypatch):
    env.enable(True, eox=True)
    monkeypatch.setattr(imagery, "QUEUE_WAIT_S", 0.05)
    gate, entered = threading.Event(), threading.Semaphore(0)
    _blocking_for(env, "tiles.maps.eox.at", entered, gate)
    layer, results = layer_by_id(EO), []
    threads = [threading.Thread(target=lambda x=x: results.append(env.fetcher.get(layer, "default", 9, 0, x))) for x in range(2)]
    for t in threads:
        t.start()
    try:
        for _ in range(2):
            assert entered.acquire(timeout=10)                       # EOX ทั้ง 2 อยู่ใน opener พร้อมกัน
        j = assert_error(env.tile(EO, "default", 9, 0, 2), 503, "IMAGERY_BUSY")      # ที่ 3 รอคิวเกินเวลา
        assert j["text"] == "มีคำขอภาพค้างอยู่มาก ลองใหม่อีกครั้ง"
        assert len(env.opener.calls) == 2
        assert env.tile(VI, DAY, 9, 0, 0).status_code == 200         # GIBS มีที่ว่างของตัวเอง ไม่ต้องรอ EOX
        assert len(env.opener.calls) == 3
    finally:
        gate.set()
        for t in threads:
            t.join(10)
    assert [r[1] for r in results] == ["image/jpeg"] * 2
    assert env.tile(EO, "default", 9, 0, 3).status_code == 200      # ที่ว่างคืนแล้ว


def test_gibs_slots_are_not_used_by_eox(env, monkeypatch):
    env.enable(True, eox=True)
    monkeypatch.setattr(imagery, "QUEUE_WAIT_S", 0.05)
    gate, entered = threading.Event(), threading.Semaphore(0)
    _blocking_for(env, "gibs.earthdata.nasa.gov", entered, gate)
    layer, results = layer_by_id(VI), []
    threads = [threading.Thread(target=lambda x=x: results.append(env.fetcher.get(layer, DAY, 9, 0, x))) for x in range(4)]
    for t in threads:
        t.start()
    try:
        for _ in range(4):
            assert entered.acquire(timeout=10)
        assert_error(env.tile(VI, DAY, 9, 0, 4), 503, "IMAGERY_BUSY")
        assert env.tile(EO, "default", 9, 0, 0).status_code == 200   # GIBS เต็ม 4 แต่ EOX ไม่ต้องรอ
    finally:
        gate.set()
        for t in threads:
            t.join(10)
    assert len(results) == 4


def test_eox_switch_is_rechecked_after_waiting_for_a_slot(env, monkeypatch):
    env.enable(True, eox=True)
    slots = env.fetcher._slots["eox"] = SpySlots(env.fetcher._slots["eox"])
    gate, entered = threading.Event(), threading.Semaphore(0)
    _blocking_for(env, "tiles.maps.eox.at", entered, gate)
    layer, results = layer_by_id(EO), []
    threads = [threading.Thread(target=lambda x=x: results.append(env.fetcher.get(layer, "default", 9, 0, x))) for x in range(2)]
    third = []
    queued_request = threading.Thread(target=lambda: third.append(env.tile(EO, "default", 9, 0, 2)))
    for t in threads:
        t.start()
    try:
        for _ in range(2):
            assert entered.acquire(timeout=10)
        queued_request.start()                                       # ผ่านสวิตช์ของ route (เปิดอยู่) แล้วรอคิว
        assert slots.queued.wait(10)
        assert len(env.opener.calls) == 2
        env.enable(True, eox=False)                                  # ปิด EOX (GIBS ยังเปิด) ระหว่างที่คำขอที่ 3 รออยู่
    finally:
        gate.set()
        for t in threads + [queued_request]:
            t.join(10)
    assert len(third) == 1
    j = assert_error(third[0], 403, "IMAGERY_DISABLED")
    assert j["text"] == EOX_DISABLED
    assert len(env.opener.calls) == 2                                # ที่ 3 ไม่ถึง opener
    assert not env.path(EO, "default", 9, 0, 2).exists()
    assert [r[1] for r in results] == ["image/jpeg"] * 2


def test_switch_recheck_is_asked_about_the_layers_own_source(env):
    asked = []

    def only_gibs(source):
        asked.append(source)
        return source == "gibs"

    env.fetcher.enabled = only_gibs
    with pytest.raises(imagery.ApiError) as exc:
        env.fetcher.get(layer_by_id(EO), "default", 3, 2, 5)
    assert (exc.value.status, exc.value.code, exc.value.text) == (403, "IMAGERY_DISABLED", EOX_DISABLED)
    assert env.opener.calls == []
    assert env.fetcher.get(layer_by_id(VI), DAY, 3, 2, 5)[1] == "image/jpeg"
    assert asked == ["eox", "gibs"]
    env.fetcher.enabled = lambda source: source == "eox"
    with pytest.raises(imagery.ApiError) as exc:
        env.fetcher.get(layer_by_id(BM), "default", 3, 2, 5)
    assert (exc.value.status, exc.value.code, exc.value.text) == (403, "IMAGERY_DISABLED", GIBS_DISABLED)
    assert env.fetcher.get(layer_by_id(EO), "default", 3, 2, 5)[1] == "image/jpeg"
    assert [c.url for c in env.opener.calls] == [upstream_url(layer_by_id(VI), DAY, 3, 2, 5), EOX_URL_353]


# ---------- เพดาน cache ----------

def test_cache_eviction_to_90_percent(env, monkeypatch):
    monkeypatch.setattr(imagery, "CACHE_CAP_BYTES", 1000)
    env.enable()
    paths = [env.path(VI, DAY, 9, 0, x) for x in range(11)]
    for x in range(10):
        assert env.tile(VI, DAY, 9, 0, x).status_code == 200       # 10 ก้อน x 100 = 1000: เท่าเพดาน ยังไม่เกิน
    assert all(p.exists() for p in paths[:10])
    for i, p in enumerate(paths[:10]):
        os.utime(p, (1_000_000 + i * 10, 1_000_000 + i * 10))      # tile 0 เก่าสุด
    assert env.tile(VI, DAY, 9, 0, 0).status_code == 200            # ส่งจาก cache = แตะ mtime: tile 0 กลายเป็นใหม่สุด
    assert len(env.opener.calls) == 10
    assert env.tile(VI, DAY, 9, 0, 10).status_code == 200           # 1100 > 1000 -> ลบ mtime เก่าสุดจนเหลือไม่เกิน 900
    assert [p.exists() for p in paths] == [True, False, False] + [True] * 8
    assert env.fetcher.cache.size_bytes == 900
    assert sum(p.stat().st_size for p in tile_files(env)) == 900


def test_cache_size_includes_files_from_earlier_runs(env, monkeypatch):
    monkeypatch.setattr(imagery, "CACHE_CAP_BYTES", 1000)
    env.enable()
    old = []
    for x in range(9):                                              # cache ที่รอบก่อนทิ้งไว้ 900 ไบต์
        p = env.path(VI, "2026-11-01", 9, 0, x)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(JPEG)
        os.utime(p, (2_000_000 + x, 2_000_000 + x))
        old.append(p)
    assert env.tile(VI, DAY, 9, 0, 0).status_code == 200            # 1000: ยังไม่เกิน (นับจากไฟล์เดิมด้วย)
    assert all(p.exists() for p in old)
    assert env.tile(VI, DAY, 9, 0, 1).status_code == 200            # 1100: ลบเก่าสุดสองไฟล์
    assert [p.exists() for p in old] == [False, False] + [True] * 7
    assert env.fetcher.cache.size_bytes == 900


def test_tile_cache_scan_counts_each_file_once(tmp_path):
    root = tmp_path / "tiles"
    (root / "a" / "b").mkdir(parents=True)
    (root / "a" / "b" / "1.jpg").write_bytes(b"x" * 10)
    (root / "a" / "2.png").write_bytes(b"x" * 5)
    cache = TileCache(root)
    assert cache.size_bytes == 15
    assert cache.size_bytes == 15
    assert TileCache(tmp_path / "missing").size_bytes == 0


# ---------- ไม่ต่อเน็ตจริง ----------

def test_no_real_network(env, tmp_path):
    with pytest.raises(AssertionError, match="network"):
        urllib.request.urlopen("https://gibs.earthdata.nasa.gov/")
    with pytest.raises(AssertionError, match="network"):
        urllib.request.build_opener().open("https://gibs.earthdata.nasa.gov/")
    with pytest.raises(AssertionError, match="network"):
        socket.create_connection(("gibs.earthdata.nasa.gov", 443))
    default = TileFetcher(tmp_path)                                 # ไม่ฉีด opener: ตัวตั้งต้นจริง ถูก fixture กันไว้
    with pytest.raises(AssertionError, match="network"):
        default.opener(urllib.request.Request("https://gibs.earthdata.nasa.gov/"), timeout=1)
    fresh = create_app(Config(data_dir=tmp_path / "other", web_dist=tmp_path / "no-dist"), start_background=False)
    assert isinstance(fresh.state.imagery, TileFetcher)
    with pytest.raises(AssertionError, match="network"):
        fresh.state.imagery.opener(urllib.request.Request("https://gibs.earthdata.nasa.gov/"), timeout=1)
    assert env.opener.calls == []
