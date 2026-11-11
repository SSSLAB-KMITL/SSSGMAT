"""เปิด server: python -m gnss_studio_server (รันจากโฟลเดอร์ server/)"""

import os
import sys
from collections.abc import Mapping
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))    # api-interop/gnss-predict: ที่อยู่ของ gnss_predict

import uvicorn                                                   # noqa: E402

from .app import create_app                                      # noqa: E402
from .config import Config                                       # noqa: E402
from .guard import NOT_LOOPBACK_TEXT, is_loopback                 # noqa: E402


GRACEFUL_SHUTDOWN_S = 2


def main(environ: Mapping[str, str] = os.environ) -> None:
    config = Config.from_env(environ)
    app = create_app(config)
    print(f"GNSS Studio: http://{config.host}:{config.port}/", flush=True)
    if not is_loopback(config.host):                             # create_app เขียนคำเตือนเดียวกันลง server.log แล้ว
        print("คำเตือน: " + NOT_LOOPBACK_TEXT % config.host, file=sys.stderr, flush=True)
    # SSE (/api/events) ค้างเชื่อมต่อตลอด: ถ้าไม่ตั้ง timeout uvicorn จะรอให้แท็บที่เปิดอยู่ปิดเองก่อนจึงจะหยุด (Ctrl-C ไม่ทำงาน)
    uvicorn.run(app, host=config.host, port=config.port, timeout_graceful_shutdown=GRACEFUL_SHUTDOWN_S)


if __name__ == "__main__":
    main()
