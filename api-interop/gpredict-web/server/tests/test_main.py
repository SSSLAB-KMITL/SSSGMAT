"""python -m gpredict_web: ค่าตั้งต้น, คำเตือนเมื่อ --host ไม่ใช่เครื่องตัวเอง และ POST /api/quit ตั้ง server.should_exit
(ไม่รัน server จริง ไม่เปิด lifespan จึงไม่ bootstrap และไม่ใช้เน็ต)"""

import io
import os
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from gpredict_web.__main__ import build_server, parse_args
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
        self.assertEqual(client.get("/api/meta", headers={"host": "192.168.1.5:8740"}).status_code, 403)
        server, err = self.build("--host", "192.168.1.5")
        self.assertIn("192.168.1.5", server.config.app.state.allowed_hosts)
        client = TestClient(server.config.app)
        self.assertEqual(client.get("/api/meta", headers={"host": "192.168.1.5:8740"}).status_code, 200)
        self.assertEqual(client.post("/api/quit", headers={"origin": "http://192.168.1.5:8740"}).status_code, 204)
        self.assertEqual(client.get("/api/meta", headers={"host": "localhost:8740"}).status_code, 200)
        self.assertEqual(client.get("/api/meta", headers={"host": "evil.example"}).status_code, 403)

    def test_wildcard_host_warns_that_other_machines_need_a_specific_address(self):
        _, err = self.build("--host", "0.0.0.0")
        self.assertIn("Host", err)
        self.assertIn("--host", err)

    def test_quit_sets_should_exit(self):
        server, _ = self.build()
        self.assertFalse(server.should_exit)
        r = TestClient(server.config.app).post("/api/quit")                # ไม่ใช้ with: ไม่เปิด lifespan
        self.assertEqual(r.status_code, 204)
        self.assertTrue(server.should_exit)


if __name__ == "__main__":
    unittest.main()
