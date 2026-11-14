"""ตรวจอายุ TLE ทุก 10 นาที (ref-D §5.1, main.c): tle_due, TleAgeChecker และ task ใน lifespan ของ app
test ห้ามดึงจากเน็ต: checker ใช้ run_update ปลอม ส่วน test ของ app ใช้ opener ปลอม (GroupOpener) และช่วงตรวจสั้นๆ"""

import inspect
import json
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from gpredict_web.app import create_app
from gpredict_web.ephem import EphemManager
from gpredict_web.module import module_from_dict
from gpredict_web.prefs import Prefs
from gpredict_web.store import Store
from gpredict_web.tleage import TLE_AGE_S, TLE_CHECK_INTERVAL_S, TLE_OLD_TEXT, TleAgeChecker, tle_due
from tests.helpers import TEST_HOSTS, FakeNow, temp_config, ws_receive_json
from tests.test_api import GroupOpener, wait_until
from tests.test_runtime import NORADS, ORIGIN, T0, OrbitPropagate, iso, record
from tests.test_tlesources import NASABARE, NASABARE_NORADS, NASABARE_URL

UTC = timezone.utc
NOW = datetime(2026, 11, 14, 12, 0, tzinfo=UTC)
INTERVAL = 0.05                                  # ช่วงตรวจที่สั้นลงของ test ของ app (ของจริง 600 วินาที)


def values(freq=2, action=1, last=0) -> dict:
    """ค่า Preferences ที่ checker อ่าน: ตั้งต้นของ Gpredict คือ Weekly + Notify me"""
    return {"TLE/AUTO_UPDATE_FREQ": freq, "TLE/AUTO_UPDATE_ACTION": action, "TLE/LAST_UPDATE": last}


def aged(seconds: int) -> int:
    """TLE/LAST_UPDATE ที่ทำให้อายุ ณ NOW เท่ากับ seconds"""
    return int(NOW.timestamp()) - seconds


class TleDueTest(unittest.TestCase):
    def test_constants(self):
        self.assertEqual(TLE_CHECK_INTERVAL_S, 600)
        self.assertEqual(TLE_AGE_S, {1: 2592000, 2: 604800, 3: 86400})

    def test_due_thresholds(self):
        """อายุต้องมากกว่าเกณฑ์ (ไม่ใช่เท่ากับ) Monthly 30 วัน, Weekly 7 วัน, Daily 1 วัน"""
        for freq, limit in ((1, 2592000), (2, 604800), (3, 86400)):
            with self.subTest(freq=freq):
                self.assertTrue(tle_due(values(freq, last=aged(limit + 1)), NOW))
                self.assertFalse(tle_due(values(freq, last=aged(limit)), NOW))
                self.assertFalse(tle_due(values(freq, last=aged(limit - 1)), NOW))
        self.assertTrue(tle_due(values(2, last=NOW.timestamp() - 604801), NOW))
        self.assertFalse(tle_due(values(2, last=NOW.timestamp() - 604799), NOW))

    def test_never_is_never_due(self):
        for last in (0, aged(10 * 365 * 86400), aged(0)):
            self.assertFalse(tle_due(values(0, last=last), NOW))

    def test_fresh_install_is_due(self):
        """LAST_UPDATE 0 (ยังไม่เคย Update): ทุกความถี่ยกเว้น Never ถือว่าเก่าเกินแล้ว (ref-D §5.1)"""
        for freq in (1, 2, 3):
            self.assertTrue(tle_due(values(freq, last=0), NOW))

    def test_age_follows_the_clock_given(self):
        last = aged(86400 - 1)
        self.assertFalse(tle_due(values(3, last=last), NOW))
        self.assertTrue(tle_due(values(3, last=last), NOW + timedelta(seconds=2)))


class TleAgeCheckerTest(unittest.TestCase):
    def setUp(self):
        self.vals = values()
        self.updates = 0
        self.events: list[dict] = []
        self.now = NOW
        self.checker = TleAgeChecker(lambda: self.vals, self.run_update, self.events.append, lambda: self.now)

    def run_update(self) -> None:
        self.updates += 1

    def test_not_due_does_nothing(self):
        self.vals = values(2, 1, aged(100))
        for _ in range(3):
            self.assertEqual(self.checker.check(), "none")
        self.vals = values(2, 2, aged(100))
        self.assertEqual(self.checker.check(), "none")
        self.assertEqual((self.updates, self.events), (0, []))

    def test_never_does_nothing_even_when_ancient(self):
        for action in (1, 2):
            self.vals = values(0, action, 0)
            self.assertEqual(self.checker.check(), "none")
        self.assertEqual((self.updates, self.events), (0, []))

    def test_notify_once_per_run(self):
        """action 1 (Notify me): แจ้งครั้งเดียวต่อ checker (ต่อการเปิด server) ครั้งต่อไปทุกครั้งเป็น none"""
        self.assertEqual(self.checker.check(), "notified")
        for _ in range(5):
            self.assertEqual(self.checker.check(), "none")
        self.assertEqual(self.events, [{"type": "tle_old", "text": TLE_OLD_TEXT}])
        self.assertEqual(self.updates, 0)

    def test_notice_text_is_gpredicts(self):
        self.assertEqual(TLE_OLD_TEXT, "Your TLE files are getting out of date.\nYou can update them by selecting\n"
                                       "<b>Edit -> Update TLE</b>\nin the menubar.")

    def test_notify_waits_until_due(self):
        self.vals = values(2, 1, aged(100))
        self.assertEqual(self.checker.check(), "none")
        self.vals = values(2, 1, aged(604801))
        self.assertEqual(self.checker.check(), "notified")
        self.assertEqual(len(self.events), 1)

    def test_background_runs_update(self):
        """action 2: run_update ทุกครั้งที่ due ไม่แจ้ง (กติกา 2 ชม. ต่อ source อยู่ในตัวดึง ไม่ใช่ที่นี่)"""
        self.vals = values(2, 2, 0)
        for n in range(1, 4):
            self.assertEqual(self.checker.check(), "updated")
            self.assertEqual(self.updates, n)
        self.assertEqual(self.events, [])

    def test_background_stops_once_the_update_refreshed_last_update(self):
        self.vals = values(2, 2, 0)
        self.assertEqual(self.checker.check(), "updated")
        self.vals = values(2, 2, int(NOW.timestamp()))                 # update สำเร็จ: LAST_UPDATE ใหม่
        self.assertEqual(self.checker.check(), "none")
        self.now = NOW + timedelta(seconds=604801)                     # ผ่านไปอีกหนึ่งสัปดาห์
        self.assertEqual(self.checker.check(), "updated")
        self.assertEqual(self.updates, 2)

    def test_preferences_are_read_on_every_check(self):
        """เปลี่ยน Check the age / If TLEs are too old ใน Preferences มีผลรอบถัดไปโดยไม่ต้องเปิด server ใหม่"""
        self.vals = values(0, 1, 0)
        self.assertEqual(self.checker.check(), "none")
        self.vals = values(3, 2, 0)
        self.assertEqual(self.checker.check(), "updated")
        self.vals = values(3, 1, 0)
        self.assertEqual(self.checker.check(), "notified")

    def test_notified_flag_does_not_block_background_updates(self):
        self.assertEqual(self.checker.check(), "notified")
        self.vals = values(2, 2, 0)
        self.assertEqual(self.checker.check(), "updated")

    def test_update_failure_propagates_and_next_check_retries(self):
        def boom():
            self.updates += 1
            if self.updates == 1:
                raise OSError("เขียนไฟล์ไม่ได้")
        checker = TleAgeChecker(lambda: values(2, 2, 0), boom, self.events.append, lambda: NOW)
        with self.assertRaisesRegex(OSError, "เขียนไฟล์ไม่ได้"):
            checker.check()
        self.assertEqual(checker.check(), "updated")


class TleAgeLoopTest(unittest.TestCase):
    """task ใน lifespan (เฉพาะ start_background): sleep(interval) แล้วตรวจใน thread วนทุก interval ยกเลิกตอนปิด
    app ทุกตัวสร้างด้วย tle_check_interval_s สั้นๆ และ opener ปลอม (ห้ามใช้เน็ต)"""

    def setUp(self):
        self.cfg = temp_config(self)
        self.ephem = EphemManager(self.cfg, propagate_fn=OrbitPropagate(), find_console=lambda: Path("/fake/GmatConsole"),
                                  start_worker=False)
        self.addCleanup(self.ephem.close)
        self.wall = FakeNow(T0)
        self.opener = GroupOpener()
        store = Store(self.cfg.data_dir)                      # สถานี ORIGIN, ดาว NORADS และ module M ที่เปิดค้างใน session
        store.put_qth(ORIGIN)
        store.set_default_qth("ORIGIN")
        (self.cfg.data_dir / "satdb.json").write_text(json.dumps({"version": 1, "satellites": {
            str(r.norad): {"name": r.name, "groups": r.groups, "tle": list(r.tle_lines), "epoch": iso(r.epoch),
                           "updated": iso(r.updated)} for r in map(record, NORADS)}}), encoding="utf-8")
        store.put_module(module_from_dict({"name": "M", "qth": "ORIGIN", "satellites": list(NORADS)}, None, None))
        store.set_session(["M"])

    def make_app(self, interval=INTERVAL, start_background=True):
        return create_app(self.cfg, start_background=start_background, opener=self.opener, now=self.wall, ephem=self.ephem,
                          allowed_hosts=TEST_HOSTS, tle_check_interval_s=interval)

    def recording(self, app, results: list):
        """แทน checker.check ด้วยตัวที่จดเวลาและผลของแต่ละรอบ (ตัวจริงยังทำงาน)"""
        real = app.state.tle_age_checker.check

        def check():
            started = time.monotonic()
            result = real()
            results.append((started, result))
            return result
        return mock.patch.object(app.state.tle_age_checker, "check", check)

    def test_default_interval_is_ten_minutes(self):
        self.assertEqual(inspect.signature(create_app).parameters["tle_check_interval_s"].default, TLE_CHECK_INTERVAL_S)

    def test_first_check_after_interval(self):
        """ไม่ตรวจตอนเริ่ม: รอบแรกหลังครบช่วงแรก แล้วตรวจซ้ำทุกช่วง และหยุดเมื่อ server ปิด"""
        app = self.make_app()
        results: list = []
        with self.recording(app, results):
            entered = time.monotonic()
            with TestClient(app):
                self.assertTrue(wait_until(lambda: len(results) >= 3))
            stopped = len(results)
            time.sleep(INTERVAL * 4)
            self.assertEqual(len(results), stopped)                     # ปิดแล้วไม่ตรวจอีก
        times = [t for t, _ in results]
        self.assertGreaterEqual(times[0] - entered, INTERVAL)           # รอบแรกอยู่หลังช่วงแรกเสมอ (task เริ่มหลัง entered)
        for earlier, later in zip(times, times[1:]):
            self.assertGreaterEqual(later - earlier, INTERVAL * 0.9)
        self.assertTrue(app.state.tle_age_task.done())

    def test_no_check_without_start_background(self):
        app = self.make_app(interval=0.01, start_background=False)
        results: list = []
        with self.recording(app, results), TestClient(app):
            time.sleep(0.2)
        self.assertEqual(results, [])
        self.assertIsNone(app.state.tle_age_task)

    def test_notify_reaches_the_first_browser_once(self):
        """Notify me (ตั้งต้น): TLE เก่า (LAST_UPDATE 0) แจ้งครั้งเดียวต่อการเปิด server ตอนยังไม่มี browser ข้อความถูกเก็บไว้
        ส่งให้ socket แรกที่ต่อเข้ามา ไม่ดึงข้อมูลจากเน็ตเลย"""
        Prefs(self.cfg.data_dir).update({"TLE/AUTO_UPDATE_FREQ": 3}, [])
        app = self.make_app()
        results: list = []
        with self.recording(app, results), TestClient(app) as client:
            self.assertTrue(wait_until(lambda: len(results) >= 3))
            self.assertEqual([r for _, r in results[:3]], ["notified", "none", "none"])
            with client.websocket_connect("/ws/app") as first:
                self.assertEqual(ws_receive_json(first), {"type": "tle_old", "text": TLE_OLD_TEXT})
                self.assertTrue(wait_until(lambda: len(app.state.events.sockets()) == 1))
                app.state.events.publish({"type": "flush"})
                self.assertEqual(ws_receive_json(first), {"type": "flush"})           # ไม่มี tle_old ซ้ำค้างอยู่
            with client.websocket_connect("/ws/app") as second:                       # socket ถัดไปไม่ได้ข้อความที่ถูกเก็บไว้
                self.assertTrue(wait_until(lambda: len(app.state.events.sockets()) == 1))
                app.state.events.publish({"type": "flush"})
                self.assertEqual(ws_receive_json(second), {"type": "flush"})
        self.assertEqual(self.opener.urls, [])
        self.assertEqual({r for _, r in results[1:]}, {"none"})

    def test_notify_goes_to_every_open_browser(self):
        """มี browser เปิดอยู่: ทุก socket ได้ข้อความทันที (ไม่ถูกเก็บไว้) เรียก check จาก thread นอก event loop"""
        Prefs(self.cfg.data_dir).update({"TLE/AUTO_UPDATE_FREQ": 3}, [])
        app = self.make_app(interval=3600)
        with TestClient(app) as client:
            with client.websocket_connect("/ws/app") as one, client.websocket_connect("/ws/app") as two:
                self.assertTrue(wait_until(lambda: len(app.state.events.sockets()) == 2))
                self.assertEqual(app.state.tle_age_checker.check(), "notified")
                expected = {"type": "tle_old", "text": TLE_OLD_TEXT}
                self.assertEqual((ws_receive_json(one), ws_receive_json(two)), (expected, expected))

    def test_background_update_runs_the_real_update_path(self):
        """action 2: ตัวดึงจริงของ app (update_tle: tle_lock, TLE sources ของ Preferences, reload module) ผ่าน opener ปลอม
        หลัง update สำเร็จ LAST_UPDATE ใหม่ทำให้รอบต่อไปไม่ใช่ due"""
        Prefs(self.cfg.data_dir).update({"TLE/AUTO_UPDATE_FREQ": 3, "TLE/AUTO_UPDATE_ACTION": 2,
                                         "TLE/URLS": [NASABARE_URL]}, [])
        self.opener.bodies[NASABARE_URL] = NASABARE
        app = self.make_app()
        results: list = []
        with self.recording(app, results), mock.patch.object(app.state.hub, "reload", wraps=app.state.hub.reload) as reload:
            with TestClient(app) as client:
                self.assertTrue(wait_until(lambda: len(results) >= 3))
                self.assertEqual([r for _, r in results[:3]], ["updated", "none", "none"])
                found = client.get("/api/satellites", params={"group": "nasabare"}).json()["satellites"]
                self.assertEqual(sorted(s["norad"] for s in found), NASABARE_NORADS)
                self.assertEqual(client.get("/api/prefs").json()["values"]["TLE/LAST_UPDATE"], int(T0.timestamp()))
                self.assertFalse(app.state.tle_lock.locked())
        reload.assert_called_once_with("M")                                           # module ที่เปิดอยู่โหลดดาวใหม่
        self.assertEqual(self.opener.urls, [NASABARE_URL])

    def test_check_failure_is_logged_and_the_loop_continues(self):
        app = self.make_app()
        calls: list[int] = []

        def check():
            calls.append(1)
            if len(calls) == 1:
                raise OSError("เขียนไฟล์ไม่ได้")
            return "none"

        with mock.patch.object(app.state.tle_age_checker, "check", check), \
                self.assertLogs("gpredict_web.app", "ERROR") as logs:
            with TestClient(app):
                self.assertTrue(wait_until(lambda: len(calls) >= 3))
        self.assertEqual(len(logs.records), 1)
        self.assertIn("ตรวจอายุ TLE", logs.records[0].getMessage())
        self.assertIn("เขียนไฟล์ไม่ได้", "".join(logs.output))

    def test_shutdown_waits_for_a_running_check_before_closing_anything(self):
        """Gpredict รอ update ที่ค้างอยู่ก่อนปิดโปรแกรม: ขั้นปิดอื่น (controller, tick, module) เริ่มหลังตรวจรอบนั้นจบเท่านั้น
        ไม่งั้น update จะ reload module ที่กำลังถูกปิด"""
        app = self.make_app()
        started = threading.Event()
        steps: list[str] = []
        real_controllers = app.state.controllers.shutdown

        def check():
            started.set()
            time.sleep(0.3)
            steps.append("check finished")
            return "updated"

        async def controllers_shutdown():
            steps.append("controllers")
            await real_controllers()

        with mock.patch.object(app.state.tle_age_checker, "check", check), \
                mock.patch.object(app.state.controllers, "shutdown", controllers_shutdown):
            with TestClient(app):
                self.assertTrue(started.wait(5))
        self.assertEqual(steps, ["check finished", "controllers"])
        self.assertTrue(app.state.tle_age_task.done())

    def test_shutdown_while_sleeping_leaves_no_task(self):
        app = self.make_app(interval=60)
        with TestClient(app):
            self.assertFalse(app.state.tle_age_task.done())
        self.assertTrue(app.state.tle_age_task.done())


if __name__ == "__main__":
    unittest.main()
