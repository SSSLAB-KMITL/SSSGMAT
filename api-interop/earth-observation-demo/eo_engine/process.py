"""Start cancellable workers without running native at-fork handlers on macOS."""

from __future__ import annotations

import os
import signal
import subprocess
import threading


class SpawnedWorker:
    """A fresh session, streamed stdout, and one thread responsible for reaping."""

    def __init__(self, args, *, stderr, env=None):
        self.args = args
        self.returncode = None
        self._done = threading.Event()
        read_fd, write_fd = os.pipe()
        null_fd = os.open(os.devnull, os.O_RDONLY)
        try:
            # Popen's cwd/start_new_session path forks on this macOS runtime.
            # PROJ can crash in its child-side handlers before exec; use the
            # native spawn session flag instead of a pre-exec setsid callback.
            self.pid = os.posix_spawn(
                args[0],
                args,
                os.environ.copy() if env is None else env,
                file_actions=[
                    (os.POSIX_SPAWN_DUP2, null_fd, 0),
                    (os.POSIX_SPAWN_DUP2, write_fd, 1),
                    (os.POSIX_SPAWN_DUP2, stderr.fileno(), 2),
                    (os.POSIX_SPAWN_CLOSE, read_fd),
                    (os.POSIX_SPAWN_CLOSE, write_fd),
                    (os.POSIX_SPAWN_CLOSE, null_fd),
                ],
                setsid=True,
                setsigmask=(),
                setsigdef=(signal.SIGPIPE,),
            )
        except BaseException:
            os.close(read_fd)
            raise
        finally:
            os.close(write_fd)
            os.close(null_fd)
        self.stdout = os.fdopen(read_fd, "r", encoding="utf-8")
        threading.Thread(target=self._reap, daemon=True).start()

    def _reap(self):
        _, status = os.waitpid(self.pid, 0)
        self.returncode = os.waitstatus_to_exitcode(status)
        self._done.set()

    def poll(self):
        return self.returncode if self._done.is_set() else None

    def wait(self, timeout=None):
        if not self._done.wait(timeout):
            raise subprocess.TimeoutExpired(self.args, timeout)
        return self.returncode

    def signal_group(self, sig):
        if self.poll() is None:
            try:
                os.killpg(self.pid, sig)
            except ProcessLookupError:
                pass  # The worker may exit between poll() and killpg().
