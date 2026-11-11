"""fixture ที่ test ของ server ใช้ร่วมกัน ทุก fixture ใช้ data/ ชั่วคราว ไม่แตะ data/ จริง และไม่ใช้เน็ต"""

import math
import shutil
import sys
from datetime import timedelta
from pathlib import Path
from unittest import mock

ENGINE_ROOT = Path(__file__).resolve().parents[1]      # api-interop/gnss-predict (ที่อยู่ของ gnss_predict)
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

import pytest                                           # noqa: E402
from fastapi.testclient import TestClient               # noqa: E402

from gnss_predict import studio                         # noqa: E402
from gnss_predict.propagate import Ephemeris            # noqa: E402
from gnss_studio_server.app import create_app           # noqa: E402
from gnss_studio_server.config import Config            # noqa: E402

SNAPSHOT_SRC = ENGINE_ROOT / "tests" / "fixtures" / "studio" / "snapshot"
SNAPSHOT_ID = "20261110T0000Z"
# server รับเฉพาะ Host ของตัวเอง (guard.py): ชื่อตั้งต้นของ TestClient ("testserver") ถูกปฏิเสธ 400 จึงใช้ 127.0.0.1
API_BASE_URL = "http://127.0.0.1"


def make_client(app, **kw) -> TestClient:
    """TestClient ที่ส่ง Host เป็น 127.0.0.1 (ทุก test ที่สร้าง client เองต้องใช้ตัวนี้)"""
    return TestClient(app, base_url=API_BASE_URL, **kw)


@pytest.fixture
def data_dir(tmp_path):
    d = tmp_path / "data"
    d.mkdir()
    return d


@pytest.fixture
def no_web_dist(tmp_path):
    """web_dist ที่ไม่มีอยู่จริง: test ที่ไม่เกี่ยวกับหน้าเว็บต้องไม่ขึ้นกับ <gnss-predict>/web/dist ที่ build ไว้ในเครื่อง"""
    path = tmp_path / "no-web-dist"
    assert not path.exists()
    return path


@pytest.fixture
def client(data_dir, no_web_dist):
    return make_client(create_app(Config(data_dir=data_dir, web_dist=no_web_dist), start_background=False))


@pytest.fixture
def snapshot(data_dir):
    """copy snapshot วงโคจรของ test ไปไว้ที่ data/orbits/20261110T0000Z แล้วคืน path นั้น"""
    dest = data_dir / "orbits" / SNAPSHOT_ID
    shutil.copytree(SNAPSHOT_SRC, dest)
    return dest


NEW_SCENARIO = {"name": "S1", "start": "2026-11-10T00:00:00Z", "stop": "2026-11-10T06:00:00Z", "snapshot": SNAPSHOT_ID}


def _new_scenario(client, template):
    r = client.post("/api/scenarios", json={**NEW_SCENARIO, "template": template})
    assert r.status_code == 201, r.text
    return r.json(), r.headers["ETag"].strip('"')


@pytest.fixture
def s1(client, snapshot):
    """scenario "S1" จากแม่แบบ thbk-gnss (2026-11-10 00:00Z ถึง 06:00Z, snapshot 20261110T0000Z): (เอกสาร, ETag เปล่า)"""
    return _new_scenario(client, "thbk-gnss")


@pytest.fixture
def s_empty(client, snapshot):
    """scenario ชื่อ "S1" เหมือน s1 แต่จากแม่แบบ empty (ไม่มี object): (เอกสาร, ETag เปล่า) อย่าใช้คู่กับ s1 ในเทสต์เดียว"""
    return _new_scenario(client, "empty")


# ---------- GMAT ปลอมและผลลัพธ์ที่คำนวณแล้ว ----------

EARTH_MU_KM3_S2 = 398600.4418
EARTH_ROTATION_RAD_S = 7.2921151467e-5
# ระบบ -> (รัศมีวงโคจร กม., ความเอียง องศา) ของวงโคจรวงกลมที่ใกล้ของจริงที่สุดในแต่ละกลุ่ม
GNSS_ORBITS = {"G": (26560.0, 55.0), "R": (25508.0, 64.8), "E": (29600.0, 56.0), "C": (27906.0, 55.0)}


def _fake_ecef_km(system, slot, slots, t_s):
    """ตำแหน่ง ECEF (กม.) ที่ t_s วินาทีหลังต้นช่วง ของดาวช่องที่ slot จาก slots ดวงในระบบเดียวกัน (วงกลม กระจายสามระนาบ)"""
    radius, inclination = GNSS_ORBITS[system]
    inc = math.radians(inclination)
    rate = math.sqrt(EARTH_MU_KM3_S2 / radius ** 3)
    u = 2 * math.pi * slot / slots + rate * t_s                    # argument of latitude
    raan = 2 * math.pi * (slot % 3) / 3
    x = radius * (math.cos(raan) * math.cos(u) - math.sin(raan) * math.sin(u) * math.cos(inc))
    y = radius * (math.sin(raan) * math.cos(u) + math.cos(raan) * math.sin(u) * math.cos(inc))
    z = radius * math.sin(u) * math.sin(inc)
    theta = EARTH_ROTATION_RAD_S * t_s                               # หมุนจากกรอบเฉื่อยเป็น EarthFixed
    return (x * math.cos(theta) + y * math.sin(theta), -x * math.sin(theta) + y * math.cos(theta), z)


def fake_propagate(sats, start, stop, step_s, work_dir, console, timeout_s=900, **_):
    """แทน gnss_predict.studio.propagate (GMAT): วางดาวทุกดวงบนวงโคจรวงกลมของระบบตัวเอง ไม่รัน GMAT ไม่ใช้เน็ต"""
    n = int((stop - start).total_seconds()) // step_s
    times = [start + timedelta(seconds=k * step_s) for k in range(n + 1)]
    by_system: dict[str, list[str]] = {}
    for sat in sorted(sats, key=lambda s: s.prn):
        by_system.setdefault(sat.system, []).append(sat.prn)
    positions = {prn: [_fake_ecef_km(system, slot, len(prns), k * step_s) for k in range(n + 1)]
                 for system, prns in by_system.items() for slot, prn in enumerate(prns)}
    return Ephemeris(times, positions), []


@pytest.fixture
def fake_gmat():
    """ตลอด test นี้ engine ใช้ GMAT ปลอม (`fake_propagate`) ทั้งในตัว test และใน job ที่รันแบบ InlineRunner"""
    with (mock.patch.object(studio, "propagate", side_effect=fake_propagate),
          mock.patch.object(studio, "find_gmat_console", return_value=Path("/fake/GmatConsole")),
          mock.patch.object(studio, "gmat_version", return_value="FakeGmat")):
        yield


@pytest.fixture
def s1_computed(s1, data_dir, fake_gmat):
    """s1 ที่ engine propagate และ analyze Facility THBK แล้ว (ในโปรเซสนี้ ด้วย GMAT ปลอม ซึ่งยังใช้งานได้ตลอด test)

    คืน {"ephem_hash", "access_hash", "facility", "ephem_dir", "access_dir"} (hash 12 ตัว, dir เป็น Path บนดิสก์)"""
    scenario_dir = data_dir / "scenarios" / "S1"
    studio.run_propagate(scenario_dir, data_dir)
    access_dir, _ = studio.run_analyze(scenario_dir, "THBK", data_dir)
    ephem_dir = scenario_dir / "ephem" / studio.plan_propagate(scenario_dir, data_dir).hash
    return {"ephem_hash": ephem_dir.name, "access_hash": access_dir.name, "facility": "THBK",
            "ephem_dir": ephem_dir, "access_dir": access_dir}


@pytest.fixture
def boom_client_factory(no_web_dist):
    """สร้าง client ที่มี GET /api/_boom ซึ่ง raise exception ธรรมดา (ไว้ตรวจ handler 500) ต่อ data_dir ที่ส่งให้"""
    def make(data_dir):
        app = create_app(Config(data_dir=data_dir, web_dist=no_web_dist), start_background=False)

        @app.get("/api/_boom")
        def boom():
            raise RuntimeError("boom")

        return make_client(app, raise_server_exceptions=False)
    return make


@pytest.fixture
def client_with_boom_route(boom_client_factory, data_dir):
    return boom_client_factory(data_dir)


@pytest.fixture
def client_with_web_dist(tmp_path, data_dir):
    """client ที่ web_dist ชี้ไปที่โฟลเดอร์ชั่วคราวซึ่งมี index.html และ assets/app.js"""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text('<!doctype html><html><body><div id="root"></div></body></html>')
    (dist / "assets" / "app.js").write_text("console.log('studio');")
    return make_client(create_app(Config(data_dir=data_dir, web_dist=dist), start_background=False))


@pytest.fixture
def client_inline(data_dir, no_web_dist):
    """client ที่ JobManager ใช้ InlineRunner (รัน job ใน thread ของคิวเอง ไม่สร้าง process) เริ่มคิวเองตอนสร้าง หยุดตอนจบ test"""
    from gnss_studio_server.jobs import InlineRunner, JobManager
    app = create_app(Config(data_dir=data_dir, web_dist=no_web_dist), start_background=False)
    app.state.jobs = JobManager(data_dir, app.state.bus, runner=InlineRunner(), logger=app.state.logger)
    app.state.jobs.start()
    try:
        yield make_client(app)
    finally:
        app.state.jobs.stop()
