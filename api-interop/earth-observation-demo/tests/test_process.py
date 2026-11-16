import json
import os
import signal
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest
from pyproj import Transformer

from eo_engine.process import SpawnedWorker


def test_warm_geospatial_parent_can_spawn_repeatedly_from_threads(
    tmp_path, monkeypatch
):
    # This is the report's trigger: PROJ has opened its SQLite database in a
    # threaded server before the next acquisition starts another worker.
    transformer = Transformer.from_crs(4326, 4978, always_xy=True)
    transformer.transform(100.75, 13.69, 0)

    def forbid_fork(*a, **k):
        raise AssertionError("Launching from the geospatial server must never fork")

    monkeypatch.setattr(subprocess, "_fork_exec", forbid_fork)
    parent_cwd = os.getcwd()

    def launch(index):
        with (tmp_path / f"{index}.log").open("w") as log:
            p = SpawnedWorker(
                [
                    sys.executable,
                    "-c",
                    'import os,json;print(json.dumps([os.getpid(),os.getsid(0),os.environ["EO_SPAWN_TEST"]]),flush=True)',
                ],
                stderr=log,
                env={**os.environ, "EO_SPAWN_TEST": str(index)},
            )
            try:
                value = json.loads(p.stdout.readline())
                assert value == [p.pid, p.pid, str(index)]
                assert p.wait(timeout=10) == 0
                assert p.poll() == 0
            finally:
                p.stdout.close()

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(launch, range(12)))
    assert os.getcwd() == parent_cwd


def test_spawn_streams_stderr_and_reports_failure(tmp_path):
    log_path = tmp_path / "failure.log"
    with log_path.open("w") as log:
        p = SpawnedWorker(
            [
                sys.executable,
                "-c",
                'import sys;print("failed image",file=sys.stderr);sys.exit(7)',
            ],
            stderr=log,
        )
        assert p.wait(timeout=10) == 7
        p.stdout.close()
    assert "failed image" in log_path.read_text()


def test_spawn_can_timeout_and_cancel_its_session(tmp_path):
    with (tmp_path / "cancel.log").open("w") as log:
        p = SpawnedWorker(
            [
                sys.executable,
                "-u",
                "-c",
                'import time;print("ready",flush=True);time.sleep(30)',
            ],
            stderr=log,
        )
        try:
            assert p.stdout.readline().strip() == "ready"
            with pytest.raises(subprocess.TimeoutExpired):
                p.wait(timeout=0.01)
            p.signal_group(signal.SIGTERM)
            assert p.wait(timeout=5) == -signal.SIGTERM
            p.signal_group(signal.SIGTERM)  # A repeated cancellation is harmless.
        finally:
            p.signal_group(signal.SIGKILL)
            p.stdout.close()


def test_spawn_failure_closes_pipe_descriptors(tmp_path, monkeypatch):
    descriptors = []
    make_pipe = os.pipe

    def track_pipe():
        fds = make_pipe()
        descriptors.extend(fds)
        return fds

    monkeypatch.setattr(os, "pipe", track_pipe)
    with (tmp_path / "missing.log").open("w") as log:
        with pytest.raises(FileNotFoundError):
            SpawnedWorker(["/missing/eo-worker-python"], stderr=log)

    for fd in descriptors:
        with pytest.raises(OSError):
            os.fstat(fd)
