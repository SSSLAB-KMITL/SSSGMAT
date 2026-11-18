"""python -m gpredict_web: ค่าตั้งต้น, คำเตือนเมื่อ --host ไม่ใช่เครื่องตัวเอง และ POST /api/quit ตั้ง server.should_exit
(ไม่รัน server จริง ไม่เปิด lifespan จึงไม่ bootstrap และไม่ใช้เน็ต)"""

import importlib
import inspect
import io
import os
import pkgutil
import unittest
from contextlib import redirect_stdout
from unittest import mock

import uvicorn
from fastapi.testclient import TestClient

import gpredict_web
from gpredict_web.__main__ import build_server, main, parse_args
from gpredict_web.app import log_file
from gpredict_web.config import DATA_ENV, PORT
from tests.helpers import temp_config


class MainTest(unittest.TestCase):
    def setUp(self):
        self.data = temp_config(self).data_dir

    def build(self, *argv) -> tuple:
        err = io.StringIO()
        server = build_server(["--data", str(self.data), *argv], stderr=err)
        self.addCleanup(server.config.app.state.ephem.close)                # หยุด worker thread ของคิว GMAT
        return server, err.getvalue()

    def test_defaults(self):
        args = parse_args([])
        self.assertEqual((args.host, args.port, args.data), ("127.0.0.1", PORT, None))
        with mock.patch.dict(os.environ, {DATA_ENV: str(self.data)}):
            err = io.StringIO()
            server = build_server([], stderr=err)
            self.addCleanup(server.config.app.state.ephem.close)
        self.assertEqual((server.config.host, server.config.port), ("127.0.0.1", 8740))
        self.assertEqual(server.config.app.state.config.data_dir, self.data)
        self.assertEqual(err.getvalue(), "")

    def test_data_and_port_arguments(self):
        server, _ = self.build("--port", "8741")
        self.assertEqual(server.config.port, 8741)
        self.assertEqual(server.config.app.state.config.data_dir, self.data)

    def test_local_hosts_print_no_warning(self):
        for host in ("127.0.0.1", "localhost", "::1"):
            with self.subTest(host=host):
                _, err = self.build("--host", host)
                self.assertEqual(err, "")

    def test_other_host_prints_thai_no_login_warning(self):
        server, err = self.build("--host", "0.0.0.0")
        self.assertEqual(server.config.host, "0.0.0.0")
        self.assertIn("login", err)
        self.assertIn("0.0.0.0", err)
        self.assertRegex(err, r"[ก-๙]")

    def test_allowed_hosts_follow_host_argument(self):
        server, _ = self.build()
        client = TestClient(server.config.app)
        self.assertEqual(client.get("/api/meta", headers={"host": "127.0.0.1:8740"}).status_code, 200)
        self.assertEqual(client.get("/api/meta").status_code, 403)                          # testserver ไม่ใช่ชื่อของเครื่องจริง
        self.assertEqual(client.get("/api/meta", headers={"host": "192.168.1.5:8740"}).status_code, 403)
        server, err = self.build("--host", "192.168.1.5")
        self.assertIn("192.168.1.5", server.config.app.state.allowed_hosts)
        client = TestClient(server.config.app, base_url="http://192.168.1.5:8740")
        self.assertEqual(client.get("/api/meta").status_code, 200)
        self.assertEqual(client.post("/api/quit", headers={"origin": "http://192.168.1.5:8740"}).status_code, 204)
        self.assertEqual(client.get("/api/meta", headers={"host": "localhost:8740"}).status_code, 200)
        self.assertEqual(client.get("/api/meta", headers={"host": "evil.example"}).status_code, 403)

    def test_wildcard_host_warns_that_other_machines_need_a_specific_address(self):
        _, err = self.build("--host", "0.0.0.0")
        self.assertIn("Host", err)
        self.assertIn("--host", err)

    def test_main_prints_the_address_and_the_log_file(self):
        """คำเตือนของ server ระหว่างรันไปที่ gpredict.log ไม่ใช่ terminal ตอนเริ่มจึงบอกว่าไฟล์อยู่ไหน (ของเรา)"""
        servers = []
        out = io.StringIO()
        with mock.patch.object(uvicorn.Server, "run", autospec=True, side_effect=servers.append), redirect_stdout(out):
            main(["--data", str(self.data)])
        self.addCleanup(servers[0].config.app.state.ephem.close)
        lines = out.getvalue().splitlines()
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0], "Gpredict Web: http://127.0.0.1:8740/")
        self.assertIn(str((self.data / "logs" / "gpredict.log").absolute()), lines[1])
        self.assertRegex(lines[1], r"[ก-๙]")
        # "normally": a gpredict.log that cannot be opened sends the lines to the terminal instead (gplog.py)
        self.assertIn("ตามปกติ", lines[1])
        self.assertIn("ถ้าเปิดไฟล์ไม่ได้", lines[1])

    def test_log_file_is_the_one_path_of_gpredict_log(self):
        """ที่อยู่ของ gpredict.log สร้างที่เดียว (log_file) ทั้งตอนเริ่ม, /api/meta และ Log browser"""
        cfg = temp_config(self)
        self.assertEqual(log_file(cfg), cfg.data_dir / "logs" / "gpredict.log")

    def test_quit_sets_should_exit(self):
        server, _ = self.build()
        self.assertFalse(server.should_exit)
        r = TestClient(server.config.app, base_url="http://127.0.0.1:8740").post("/api/quit")   # ไม่ใช้ with: ไม่เปิด lifespan
        self.assertEqual(r.status_code, 204)
        self.assertTrue(server.should_exit)


class OlderPythonTest(unittest.TestCase):
    def test_every_annotation_resolves_at_import(self):
        """Python ก่อน 3.14 ประเมิน annotation ตอนนิยามฟังก์ชัน: ชื่อที่ import ไว้แค่ใต้ TYPE_CHECKING ทำให้ import ล้ม
        (server เปิดไม่ได้) ที่นี่อ่าน __annotations__ ของทุกฟังก์ชันและคลาสใน package ซึ่งประเมินแบบเดียวกัน"""
        for info in pkgutil.iter_modules(gpredict_web.__path__):
            mod = importlib.import_module(f"gpredict_web.{info.name}")
            for name, obj in vars(mod).items():
                if getattr(obj, "__module__", None) != mod.__name__:
                    continue
                members = {name: obj}
                if inspect.isclass(obj):
                    members |= {f"{name}.{k}": v for k, v in vars(obj).items() if inspect.isfunction(v)}
                for label, m in members.items():
                    if inspect.isfunction(m) or inspect.isclass(m):
                        with self.subTest(module=mod.__name__, name=label):
                            m.__annotations__                                       # NameError = Python เก่าเปิดไม่ได้


if __name__ == "__main__":
    unittest.main()
