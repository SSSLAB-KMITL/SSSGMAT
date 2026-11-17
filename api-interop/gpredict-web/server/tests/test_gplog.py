"""Logger รูปแบบ Gpredict (sat-log.c, ref-D §7.2): บรรทัด, ระดับ, session เริ่มและจบ, หมุนไฟล์และลบไฟล์เก่า
ทุก test ใช้โฟลเดอร์ชั่วคราวและถอด handler ออกจาก logger "gpredict_web" เมื่อจบ (handler ค้างจะทำให้ test อื่นเขียนลงไฟล์นี้)"""

import contextlib
import io
import logging
import os
import re
import time
import unittest
from pathlib import Path
from unittest import mock

from gpredict_web import gplog
from gpredict_web.errors import ApiError
from gpredict_web.gplog import LEVEL_OF, LOG_FILE, GpredictLogHandler, end_session, start_session
from gpredict_web.prefs import Prefs
from tests.helpers import temp_config

LOGGER = logging.getLogger("gpredict_web")
NOW = 1_700_000_000.5                          # 2023-11-14 22:13:20 UTC
LINE = r"\d{4}/\d\d/\d\d \d\d:\d\d:\d\d"


def log_from_f(message: str = "abc", level: int = logging.WARNING, name: str = "gpredict_web.x", **kw) -> None:
    def f():
        logging.getLogger(name).log(level, message, **kw)
    f()


class GplogTestBase(unittest.TestCase):
    def setUp(self):
        self.cfg = temp_config(self)
        self.dir = self.cfg.data_dir / "logs"
        self.handlers_before = list(LOGGER.handlers)
        self.level_before = LOGGER.level
        self.effective_before = LOGGER.getEffectiveLevel()
        self.addCleanup(self._no_leak)

    def _no_leak(self) -> None:
        leaked = [h for h in LOGGER.handlers if h not in self.handlers_before]
        for h in leaked:
            LOGGER.removeHandler(h)
            h.close()
        level = LOGGER.level
        LOGGER.setLevel(self.level_before)
        self.assertEqual(leaked, [], "handler ค้างอยู่ใน logger gpredict_web")
        self.assertEqual(level, self.level_before, "ระดับของ logger gpredict_web ไม่ถูกคืน")

    def start(self, level: int) -> GpredictLogHandler:
        self.handler = start_session(self.dir, level)
        return self.handler

    @property
    def log_path(self) -> Path:
        return self.dir / LOG_FILE

    def lines(self) -> list[str]:
        return self.log_path.read_text(encoding="utf-8").split("\n")[:-1]        # ทุกบรรทัดลงท้าย \n

    def touch_rotated(self, ts: int) -> Path:
        self.dir.mkdir(parents=True, exist_ok=True)
        path = self.dir / f"gpredict-{ts}.log"
        path.write_text("old\n", encoding="utf-8")
        return path


class LineFormatTest(GplogTestBase):
    def test_level_table(self):
        self.assertEqual(LEVEL_OF, {logging.CRITICAL: 1, logging.ERROR: 1, logging.WARNING: 2, logging.INFO: 3,
                                    logging.DEBUG: 4})
        self.assertEqual(LOG_FILE, "gpredict.log")
        self.assertIsInstance(self.start(2), logging.Handler)
        end_session(self.handler, 0, NOW)

    def test_line_format(self):
        self.start(2)
        log_from_f("abc")
        self.assertRegex(self.lines()[-1], rf"^{LINE}\|2\|f: abc$")
        end_session(self.handler, 0, NOW)

    def test_time_is_local_time(self):
        """เวลาเป็นเวลาท้องถิ่นของเครื่องตามรูปแบบคงที่ ไม่ขึ้นกับ Preferences (record.created ที่ 2023-11-14 22:13:20 UTC)"""
        old = os.environ.get("TZ")

        def restore():
            if old is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = old
            time.tzset()

        self.addCleanup(restore)
        os.environ["TZ"] = "Asia/Bangkok"
        time.tzset()
        self.start(2)
        record = logging.LogRecord("gpredict_web.x", logging.WARNING, __file__, 1, "msg", None, None, func="g")
        record.created = NOW
        self.handler.handle(record)
        self.assertEqual(self.lines()[-1], "2023/11/15 05:13:20|2|g: msg")
        end_session(self.handler, 0, NOW)

    def test_first_line_session_started_even_at_level_0(self):
        self.start(0)
        log_from_f("ไม่ถูกเขียน", logging.ERROR)
        lines = self.lines()
        self.assertEqual(len(lines), 1)
        self.assertRegex(lines[0], rf"^{LINE}\|3\|sat_log_init: Session started$")      # ระดับ 3 เสมอ (sat-log.c:136)
        end_session(self.handler, 0, NOW)

    def test_level_filter(self):
        order = ("debug", "info", "warning", "error", "critical")
        number = {"critical": 1, "error": 1, "warning": 2, "info": 3, "debug": 4}
        written = {0: (), 1: ("error", "critical"), 2: ("warning", "error", "critical"),
                   3: ("info", "warning", "error", "critical"), 4: order}
        for level, names in written.items():
            with self.subTest(level=level):
                self.start(level)
                for name in order:
                    getattr(logging.getLogger("gpredict_web.x"), name)("m-%s", name)
                got = [l.split("|", 2)[1:] for l in self.lines()[1:]]                  # ตัด Session started
                self.assertEqual(got, [[str(number[n]), f"test_level_filter: m-{n}"] for n in order if n in names])
                end_session(self.handler, 0, NOW)

    def test_filter_applies_to_records_sent_straight_to_the_handler(self):
        """ตัวกรองอยู่ที่ handler เอง ไม่พึ่งระดับของ logger"""
        self.start(2)
        for levelno in (logging.INFO, logging.DEBUG, logging.NOTSET, 15, 25):
            self.handler.handle(logging.LogRecord("gpredict_web.x", levelno, __file__, 1, "m", None, None, func="g"))
        self.assertEqual(len(self.lines()), 1)                                           # มีแค่ Session started
        self.handler.handle(logging.LogRecord("gpredict_web.x", 35, __file__, 1, "m", None, None, func="g"))
        self.assertRegex(self.lines()[-1], r"\|2\|g: m$")                                # ระหว่าง WARNING กับ ERROR นับเป็น 2
        end_session(self.handler, 0, NOW)

    def test_level_applies_next_start(self):
        """เปลี่ยน LOG/LEVEL ระหว่าง session ไม่มีผล (ref-D §7.1): handler กรองที่ระดับตอนเริ่ม ระดับใหม่ใช้ครั้งถัดไป"""
        prefs = Prefs(self.cfg.data_dir)
        self.start(prefs.get("LOG/LEVEL"))                               # ตั้งต้น 2
        prefs.update({"LOG/LEVEL": 4}, [])
        log_from_f("ระหว่าง session", logging.INFO)
        self.assertEqual(len(self.lines()), 1)
        end_session(self.handler, prefs.get("LOG/CLEAN_AGE"), NOW)
        self.start(prefs.get("LOG/LEVEL"))
        log_from_f("session ถัดไป", logging.INFO)
        self.assertRegex(self.lines()[-1], r"\|3\|f: session ถัดไป$")
        end_session(self.handler, 0, NOW)

    def test_multiline_split(self):
        """ข้อความหลายบรรทัดแยกเป็นหลายบรรทัด (ตัดท้ายที่เป็น whitespace) บรรทัดว่างตรงกลางคงอยู่ \\r\\n และ \\r นับเป็นขึ้นบรรทัด"""
        self.start(2)
        log_from_f("a\nb\n\nc\r\nd\re  \n\n")
        got = [l.split("|", 2)[1:] for l in self.lines()[1:]]
        self.assertEqual(got, [["2", "f: a"], ["2", "f: b"], ["2", "f: "],
                               ["2", "f: c"], ["2", "f: d"], ["2", "f: e"]])
        end_session(self.handler, 0, NOW)

    def test_empty_message_is_one_line(self):
        self.start(2)
        log_from_f("")
        self.assertRegex(self.lines()[-1], rf"^{LINE}\|2\|f: $")
        end_session(self.handler, 0, NOW)

    def test_exception_traceback_is_split_into_lines(self):
        self.start(2)
        try:
            raise ValueError("เสียแล้ว")
        except ValueError:
            logging.getLogger("gpredict_web.x").exception("boom")
        lines = self.lines()[1:]
        self.assertGreater(len(lines), 2)
        self.assertTrue(all(re.fullmatch(rf"{LINE}\|1\|.*", l) for l in lines), lines)
        self.assertIn("|1|test_exception_traceback_is_split_into_lines: boom", lines[0])
        self.assertTrue(any("Traceback (most recent call last):" in l for l in lines))
        self.assertIn("ValueError: เสียแล้ว", lines[-1])
        end_session(self.handler, 0, NOW)

    def test_function_is_gp_function_else_func_name(self):
        self.start(3)
        log_from_f("x", logging.INFO, extra={"gp_function": "tle_update_from_files"})
        log_from_f("y", logging.INFO)
        self.assertRegex(self.lines()[-2], r"\|3\|tle_update_from_files: x$")
        self.assertRegex(self.lines()[-1], r"\|3\|f: y$")
        end_session(self.handler, 0, NOW)

    def test_message_already_starting_with_function_is_not_repeated(self):
        """ข้อความของ Gpredict ฝัง __func__ ไว้เอง ("%s: PRINT not implemented") ข้อความที่นำหน้าด้วย "<function>: " อยู่แล้วไม่ถูกเติมซ้ำ"""
        self.start(2)
        log_from_f("multi_pass_response: PRINT not implemented", logging.ERROR,
                   extra={"gp_function": "multi_pass_response"})
        log_from_f("multi_pass_response PRINT", logging.ERROR, extra={"gp_function": "multi_pass_response"})
        self.assertRegex(self.lines()[-2], r"\|1\|multi_pass_response: PRINT not implemented$")
        self.assertRegex(self.lines()[-1], r"\|1\|multi_pass_response: multi_pass_response PRINT$")
        end_session(self.handler, 0, NOW)

    def test_log_file_is_utf8(self):
        self.start(2)
        log_from_f("ข้อความไทย ✓")
        self.assertEqual(self.lines()[-1].split("|", 2)[2], "f: ข้อความไทย ✓")
        end_session(self.handler, 0, NOW)


class SessionTest(GplogTestBase):
    def test_start_replaces_previous_log_and_creates_directory(self):
        self.assertFalse(self.dir.exists())
        self.start(2)
        log_from_f("รอบแรก")
        end_session(self.handler, 0, NOW)
        self.assertIn("รอบแรก", self.log_path.read_text(encoding="utf-8"))
        self.start(2)
        self.assertEqual(len(self.lines()), 1)                                           # ไฟล์ของรอบก่อนถูกลบ
        end_session(self.handler, 0, NOW)

    def test_start_leaves_rotated_logs(self):
        old = self.touch_rotated(1)
        self.start(2)
        self.assertTrue(old.exists())
        end_session(self.handler, 0, NOW)

    def test_session_ended_is_info_so_needs_level_3(self):
        for level, ended in ((0, False), (1, False), (2, False), (3, True), (4, True)):
            with self.subTest(level=level):
                self.start(level)
                end_session(self.handler, 0, NOW)
                last = self.lines()[-1]
                self.assertEqual("Session ended" in last, ended, last)
                if ended:
                    self.assertRegex(last, r"^2023/11/1[45] \d\d:\d\d:\d\d\|3\|sat_log_close: Session ended$")

    def test_end_session_rotates_and_cleans(self):
        now = int(NOW)
        old, recent = self.touch_rotated(now - 90000), self.touch_rotated(now - 100)
        edge_gone, edge_kept = self.touch_rotated(now - 86400), self.touch_rotated(now - 86399)
        other = self.dir / "notes.log"
        other.write_text("x", encoding="utf-8")
        not_ours = self.dir / "gpredict-abc.log"
        not_ours.write_text("x", encoding="utf-8")
        self.start(3)
        log_from_f("ก่อนจบ")
        end_session(self.handler, 86400, NOW)
        rotated = self.dir / f"gpredict-{now}.log"
        self.assertFalse(self.log_path.exists())
        self.assertTrue(rotated.exists())
        text = rotated.read_text(encoding="utf-8")
        self.assertIn("ก่อนจบ", text)
        self.assertTrue(text.endswith("sat_log_close: Session ended\n"))
        self.assertFalse(old.exists())
        self.assertFalse(edge_gone.exists())                                            # timestamp ≤ now − clean_age ถูกลบ
        self.assertTrue(recent.exists())
        self.assertTrue(edge_kept.exists())
        self.assertTrue(other.exists() and not_ours.exists())                           # ไฟล์ที่ไม่ใช่ gpredict-<ตัวเลข>.log ไม่แตะ

    def test_always_delete_keeps_current(self):
        now = int(NOW)
        old, recent = self.touch_rotated(now - 90000), self.touch_rotated(now - 100)
        self.start(3)
        end_session(self.handler, 0, NOW)                                               # Always delete
        self.assertTrue(self.log_path.exists())                                         # คงอยู่จนเริ่มครั้งถัดไป
        self.assertFalse(old.exists() or recent.exists())
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), [LOG_FILE])

    def test_rotation_keeps_log_of_the_session_for_the_next_one(self):
        self.start(3)
        end_session(self.handler, 604800, NOW)
        self.start(3)                                                                   # เริ่มใหม่ไม่แตะไฟล์ที่หมุนแล้ว
        end_session(self.handler, 604800, NOW + 5)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()),
                         [f"gpredict-{int(NOW)}.log", f"gpredict-{int(NOW) + 5}.log"])

    def test_end_session_detaches_the_handler_and_restores_the_logger(self):
        propagate = LOGGER.propagate
        self.start(4)
        self.assertIn(self.handler, LOGGER.handlers)
        end_session(self.handler, 0, NOW)
        self.assertEqual(LOGGER.handlers, self.handlers_before)
        self.assertEqual((LOGGER.level, LOGGER.propagate), (self.level_before, propagate))
        with self.assertLogs("gpredict_web.x", "ERROR"):                                # ไม่มี handler แล้ว: ไม่เขียนลงไฟล์ที่ปิดแล้ว
            log_from_f("หลังจบ", logging.ERROR)
        self.assertNotIn("หลังจบ", self.log_path.read_text(encoding="utf-8"))

    def test_end_session_twice_is_harmless(self):
        self.start(3)
        end_session(self.handler, 0, NOW)
        end_session(self.handler, 0, NOW)
        self.assertEqual(self.log_path.read_text(encoding="utf-8").count("Session ended"), 1)

    def test_info_and_debug_reach_the_handler_only_when_the_level_allows(self):
        """ระดับ 3 และ 4 ลดระดับของ logger ลงชั่วคราวให้ INFO และ DEBUG ผ่านถึง handler ระดับ ≤ 2 ไม่แตะระดับของ logger"""
        for level, expected in ((0, self.effective_before), (2, min(self.effective_before, logging.WARNING)),
                                (3, logging.INFO), (4, logging.DEBUG)):
            with self.subTest(level=level):
                self.start(level)
                self.assertEqual(LOGGER.getEffectiveLevel(), expected)
                end_session(self.handler, 0, NOW)
                self.assertEqual(LOGGER.getEffectiveLevel(), self.effective_before)

    def test_does_not_swallow_records(self):
        """handler ไม่เปลี่ยน propagation: handler ของ logger แม่ (root) ยังได้ record ครบ"""
        seen: list[logging.LogRecord] = []

        class Collect(logging.Handler):
            def emit(self, record):
                seen.append(record)

        root = logging.getLogger()
        collector = Collect()
        root.addHandler(collector)
        self.addCleanup(root.removeHandler, collector)
        self.start(2)
        log_from_f("ถึง root", logging.WARNING)
        self.assertEqual([r.getMessage() for r in seen], ["ถึง root"])
        self.assertRegex(self.lines()[-1], r"\|2\|f: ถึง root$")
        end_session(self.handler, 0, NOW)

    def test_assert_logs_still_captures_with_a_session_open(self):
        self.start(2)
        with self.assertLogs("gpredict_web.x", "WARNING") as captured:
            log_from_f("จับได้", logging.WARNING)
        self.assertEqual(captured.output, ["WARNING:gpredict_web.x:จับได้"])
        end_session(self.handler, 0, NOW)

    def test_records_from_other_loggers_are_not_written(self):
        self.start(4)
        for name in ("not_gpredict_web", "gpredict_webby"):
            with self.assertLogs(name, "ERROR"):
                logging.getLogger(name).error("ของคนอื่น")
        self.assertEqual(len(self.lines()), 1)
        end_session(self.handler, 0, NOW)


class UnwritableDirTest(GplogTestBase):
    def test_unwritable_log_dir_falls_back_to_stderr(self):
        """โฟลเดอร์ log สร้างไม่ได้: บอกที่ stderr แล้ว record ลง stderr ในรูปแบบเดียวกัน (ไม่ล้ม ไม่มีไฟล์)
        ไม่มีไฟล์จึงไม่มี Session started/ended และไม่หมุนไฟล์ (sat-log.c: initialised เป็นเท็จ)"""
        blocker = self.cfg.data_dir / "not_a_dir"
        blocker.parent.mkdir(parents=True)
        blocker.write_text("x", encoding="utf-8")
        self.dir = blocker / "logs"
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.start(2)
            log_from_f("ลง stderr")
            log_from_f("ไม่ถึงเพราะระดับ", logging.INFO)
            end_session(self.handler, 86400, NOW)
        out = err.getvalue()
        self.assertIn("ERROR: Failed to create", out)
        self.assertIn(str(self.dir), out)
        written = [l for l in out.split("\n") if re.match(rf"^{LINE}\|", l)]
        self.assertEqual(len(written), 1, out)
        self.assertRegex(written[0], r"^\d{4}/\d\d/\d\d \d\d:\d\d:\d\d\|2\|f: ลง stderr$")
        self.assertFalse(self.dir.exists())

    def test_log_file_that_cannot_be_replaced_falls_back_to_stderr(self):
        """gpredict.log เป็นโฟลเดอร์ (ลบและเปิดเขียนไม่ได้): เหมือนกัน"""
        (self.dir / LOG_FILE).mkdir(parents=True)
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.start(2)
            log_from_f("ลง stderr")
            end_session(self.handler, 0, NOW)
        self.assertIn("ERROR: Failed to create", err.getvalue())
        self.assertRegex(err.getvalue(), r"\|2\|f: ลง stderr\n")
        self.assertTrue((self.dir / LOG_FILE).is_dir())

    def test_write_failure_after_start_goes_to_stderr_not_to_the_caller(self):
        """ดิสก์เต็มหรือไฟล์ถูกปิดกลางทาง: การ log ไม่ทำให้โค้ดที่ log พัง (logging.Handler.handleError พิมพ์ที่ stderr)"""
        self.start(2)
        self.handler._file.close()
        err = io.StringIO()
        with contextlib.redirect_stderr(err), mock.patch.object(logging, "raiseExceptions", True):
            log_from_f("ไม่พัง")                                                         # ไม่ raise
        self.assertIn("Logging error", err.getvalue())
        end_session(self.handler, 0, NOW)


class SessionWriteFailureTest(GplogTestBase):
    """เขียน "Session started" / "Session ended" ไม่ได้ (ดิสก์เต็ม, ไฟล์ถูกปิด): ไม่ทำให้ server เริ่มไม่ได้ และ end_session ยังถอด handler
    (final review triage Task 8)"""

    def test_full_disk_at_session_started_does_not_stop_the_start(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), \
                mock.patch.object(GpredictLogHandler, "write", side_effect=OSError(28, "No space left on device")):
            handler = self.start(4)                                                      # ไม่ raise
        self.assertIn(handler, LOGGER.handlers)
        self.assertEqual((handler.gp_level, LOGGER.getEffectiveLevel()), (4, logging.DEBUG))
        self.assertIn("No space left on device", err.getvalue())
        self.assertIn(str(self.log_path), err.getvalue())
        end_session(handler, 0, NOW)

    def test_write_failure_at_session_ended_still_detaches_closes_and_rotates(self):
        for exc in (OSError(28, "No space left on device"), ValueError("I/O operation on closed file.")):
            with self.subTest(exc=exc):
                self.start(3)
                err = io.StringIO()
                with contextlib.redirect_stderr(err), mock.patch.object(GpredictLogHandler, "write", side_effect=exc):
                    end_session(self.handler, 86400, NOW)                                # ไม่ raise
                self.assertEqual(LOGGER.handlers, self.handlers_before)
                self.assertEqual(LOGGER.level, self.level_before)
                self.assertTrue(self.handler.closed)
                self.assertTrue((self.dir / f"gpredict-{int(NOW)}.log").is_file())       # หมุนไฟล์ตามปกติ
                self.assertIn(str(exc), err.getvalue())
                (self.dir / f"gpredict-{int(NOW)}.log").unlink()


class ParseEntryTest(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(gplog.parse_entry({"level": 1, "function": "multi_pass_response", "text": "x"}),
                         (1, "multi_pass_response", "x"))
        self.assertEqual(gplog.parse_entry({"level": 4, "function": "_a1", "text": "x" * gplog.LOG_TEXT_MAX}),
                         (4, "_a1", "x" * 500))

    def test_invalid(self):
        good = {"level": 2, "function": "f", "text": "t"}
        bad = [{**good, "level": 0}, {**good, "level": 5}, {**good, "level": True}, {**good, "level": "1"},
               {**good, "level": 1.0}, {**good, "function": "a b"}, {**good, "function": "1a"}, {**good, "function": ""},
               {**good, "function": "f" * 65}, {**good, "function": 1}, {**good, "text": ""},
               {**good, "text": "x" * 501}, {**good, "text": 5}, {**good, "extra": 1},
               {"level": 1, "function": "f"}, {"function": "f", "text": "t"}, {"level": 1, "text": "t"}]
        for body in bad:
            with self.subTest(body=body):
                with self.assertRaises(ApiError) as ctx:
                    gplog.parse_entry(body)
                self.assertEqual((ctx.exception.code, ctx.exception.status), ("LOG_INVALID", 422))
                self.assertRegex(ctx.exception.text, r"[ก-๙]")


if __name__ == "__main__":
    unittest.main()
