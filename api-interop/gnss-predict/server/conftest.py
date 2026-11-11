"""fixture ที่ test ของ server ใช้ร่วมกัน ทุก fixture ใช้ data/ ชั่วคราว ไม่แตะ data/ จริง และไม่ใช้เน็ต"""

import shutil
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[1]      # api-interop/gnss-predict (ที่อยู่ของ gnss_predict)
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

import pytest                                           # noqa: E402
from fastapi.testclient import TestClient               # noqa: E402

from gnss_studio_server.app import create_app           # noqa: E402
from gnss_studio_server.config import Config            # noqa: E402

SNAPSHOT_SRC = ENGINE_ROOT / "tests" / "fixtures" / "studio" / "snapshot"
SNAPSHOT_ID = "20261110T0000Z"


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
    return TestClient(create_app(Config(data_dir=data_dir, web_dist=no_web_dist), start_background=False))


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


@pytest.fixture
def boom_client_factory(no_web_dist):
    """สร้าง client ที่มี GET /api/_boom ซึ่ง raise exception ธรรมดา (ไว้ตรวจ handler 500) ต่อ data_dir ที่ส่งให้"""
    def make(data_dir):
        app = create_app(Config(data_dir=data_dir, web_dist=no_web_dist), start_background=False)

        @app.get("/api/_boom")
        def boom():
            raise RuntimeError("boom")

        return TestClient(app, raise_server_exceptions=False)
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
    return TestClient(create_app(Config(data_dir=data_dir, web_dist=dist), start_background=False))


@pytest.fixture
def client_inline(data_dir, no_web_dist):
    """client ที่ JobManager ใช้ InlineRunner (รัน job ใน thread ของคิวเอง ไม่สร้าง process) เริ่มคิวเองตอนสร้าง หยุดตอนจบ test"""
    from gnss_studio_server.jobs import InlineRunner, JobManager
    app = create_app(Config(data_dir=data_dir, web_dist=no_web_dist), start_background=False)
    app.state.jobs = JobManager(data_dir, app.state.bus, runner=InlineRunner(), logger=app.state.logger)
    app.state.jobs.start()
    try:
        yield TestClient(app)
    finally:
        app.state.jobs.stop()
