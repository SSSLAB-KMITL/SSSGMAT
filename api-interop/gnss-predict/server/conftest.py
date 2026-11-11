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
