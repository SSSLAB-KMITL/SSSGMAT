import os
import signal
import tempfile
import time
import unittest
from pathlib import Path

from gnss_predict.errors import GmatNotFoundError, GmatRunError
from gnss_predict.run_gmat import find_gmat_console, gmat_version, run_script


def fake_console(d: Path, body: str) -> Path:
    p = d / "GmatConsole"
    p.write_text("#!/bin/sh\n" + body + "\n")
    p.chmod(0o755)
    return p


class TmpCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.d = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()


class TestFind(TmpCase):
    def test_env_var(self):
        c = fake_console(self.d, "exit 0")
        self.assertEqual(find_gmat_console(environ={"GMAT_BIN": str(c)}, repo_root=self.d / "repo"), c)

    def test_env_var_missing_file(self):
        with self.assertRaises(GmatNotFoundError):
            find_gmat_console(environ={"GMAT_BIN": str(self.d / "nope")}, repo_root=self.d)

    def test_repo_default(self):
        bin_dir = self.d / "application" / "bin"
        bin_dir.mkdir(parents=True)
        c = fake_console(bin_dir, "exit 0")
        self.assertEqual(find_gmat_console(environ={}, repo_root=self.d), c)

    def test_not_found_mentions_env(self):
        with self.assertRaises(GmatNotFoundError) as cm:
            find_gmat_console(environ={}, repo_root=self.d)
        self.assertIn("GMAT_BIN", str(cm.exception))


class TestRun(TmpCase):
    def setUp(self):
        super().setUp()
        self.script = self.d / "s.script"
        self.script.write_text("% empty\n")
        self.log = self.d / "gmat.log"

    def run_with(self, body: str, timeout_s: float = 10) -> None:
        run_script(fake_console(self.d, body), self.script, self.log, timeout_s=timeout_s)

    def test_success_runs_in_console_dir(self):
        self.run_with('pwd -P > "$4"')
        self.assertEqual(Path(self.log.read_text().strip()), self.d.resolve())

    def test_symlinked_console_runs_in_real_bin_dir(self):
        # GMAT_BIN อาจเป็น symlink ที่อยู่นอกโฟลเดอร์ bin เช่น /usr/local/bin/GmatConsole
        # GMAT ต้องรันในโฟลเดอร์ของไฟล์จริง ไม่อย่างนั้นจะหา startup file ไม่เจอ
        bin_dir = self.d / "gmat" / "bin"
        bin_dir.mkdir(parents=True)
        real = fake_console(bin_dir, 'pwd -P > "$4"')
        link_dir = self.d / "elsewhere"
        link_dir.mkdir()
        (link_dir / "GmatConsole").symlink_to(real)
        run_script(link_dir / "GmatConsole", self.script, self.log)
        self.assertEqual(Path(self.log.read_text().strip()), bin_dir.resolve())

    def test_nonzero_exit(self):
        with self.assertRaises(GmatRunError) as cm:
            self.run_with('echo boom > "$4"; exit 1')
        self.assertIn("boom", str(cm.exception))

    def test_error_in_log_with_zero_exit(self):
        with self.assertRaises(GmatRunError):
            self.run_with('echo "**** ERROR **** Interpreter Exception" > "$4"')

    def test_timeout(self):
        with self.assertRaises(GmatRunError):
            self.run_with("sleep 5", timeout_s=0.5)

    def test_on_start_receives_process_group(self):
        got = []
        run_script(fake_console(self.d, "sleep 0.2"), self.script, self.log, on_start=got.append)
        self.assertEqual(len(got), 1)
        self.assertGreater(got[0], 1)

    def test_on_start_group_can_be_killed(self):
        # server ใช้ process group ที่ได้รับนี้ยกเลิก GMAT: ต้องฆ่าได้ทั้งกลุ่มระหว่างที่ run_script รออยู่
        def kill(pgid: int) -> None:
            os.killpg(pgid, signal.SIGTERM)

        with self.assertRaises(GmatRunError):
            run_script(fake_console(self.d, "sleep 30"), self.script, self.log, timeout_s=10, on_start=kill)

    def test_on_start_failure_does_not_leave_gmat_running(self):
        pids = []

        def boom(pgid: int) -> None:
            pids.append(pgid)
            raise RuntimeError("on_start failed")

        with self.assertRaises(RuntimeError):
            run_script(fake_console(self.d, "sleep 30"), self.script, self.log, on_start=boom)
        with self.assertRaises(ProcessLookupError):
            os.killpg(pids[0], 0)

    def test_on_start_failure_after_gmat_already_exited(self):
        def boom(pgid: int) -> None:
            time.sleep(0.2)                       # GMAT จบ (zombie) ก่อนที่ on_start จะ raise
            raise RuntimeError("on_start failed")

        with self.assertRaises(RuntimeError):
            run_script(fake_console(self.d, "exit 0"), self.script, self.log, on_start=boom)

    def test_on_start_optional(self):
        self.run_with("exit 0")


class TestVersion(TmpCase):
    # GmatConsole --version จริงพิมพ์ banner ดอกจันก่อน และไม่มีเลขรุ่น มีแค่ "Build Date:"
    BANNER = ('echo "********************"; echo "***  GMAT Console Application"; echo ""; '
              'echo "Build Date: Nov 10 2026  04:09:15"')

    def test_version(self):
        c = fake_console(self.d, self.BANNER)
        self.assertEqual(gmat_version(c), "GmatConsole (Build Date: Nov 10 2026 04:09:15)")

    def test_version_uses_symlink_target_name(self):
        real = fake_console(self.d, self.BANNER).rename(self.d / "GmatConsole-R2026a")
        (self.d / "GmatConsole").symlink_to(real.name)
        self.assertEqual(gmat_version(self.d / "GmatConsole"), "GmatConsole-R2026a (Build Date: Nov 10 2026 04:09:15)")

    def test_version_failure(self):
        self.assertEqual(gmat_version(fake_console(self.d, "exit 3")), "unknown")


if __name__ == "__main__":
    unittest.main()
