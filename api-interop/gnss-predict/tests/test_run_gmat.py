import tempfile
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


class TestVersion(TmpCase):
    def test_version(self):
        c = fake_console(self.d, 'echo ""; echo "GMAT R2026a"; echo "Build Date: x"')
        self.assertEqual(gmat_version(c), "GMAT R2026a")

    def test_version_failure(self):
        self.assertEqual(gmat_version(fake_console(self.d, "exit 3")), "unknown")


if __name__ == "__main__":
    unittest.main()
