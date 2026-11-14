"""เปิด server: python -m gpredict_web [--host H] [--port P] [--data DIR] (รันจากโฟลเดอร์ server/)

process เดียวเสิร์ฟทั้ง API และ web/dist (หัวข้อ 3.2 ของ spec) POST /api/quit (File → Quit) หยุด server อย่างเรียบร้อย
ตอนเริ่มพิมพ์ที่อยู่ของหน้าเว็บและที่อยู่ของ gpredict.log (ของเรา) เพราะระหว่างรัน log ของ server ตามปกติไปที่ไฟล์นั้น ไม่ใช่ terminal
(ถ้าเปิดไฟล์ไม่ได้ gplog เขียนลง stderr แทน)
"""

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

import uvicorn

from .app import LOCAL_HOSTS, create_app, host_allow_list, log_file
from .config import PORT, Config

DEFAULT_HOST = "127.0.0.1"
WILDCARD_HOSTS = ("0.0.0.0", "::")
NO_LOGIN_WARNING = ("คำเตือน: Gpredict Web ไม่มีระบบ login เมื่อฟังที่ {host} เครื่องอื่นในเครือข่ายเปิดหน้าเว็บ "
                    "แก้ module และ QTH และสั่งปิด server ได้ ถ้าไม่ตั้งใจให้ใช้ --host 127.0.0.1")
WILDCARD_NOTE = ("หมายเหตุ: server รับเฉพาะคำขอที่ Host เป็น 127.0.0.1, localhost หรือค่าของ --host "
                 "เครื่องอื่นที่เปิดด้วย IP ของเครื่องนี้จะถูกปฏิเสธ ถ้าต้องการให้เครื่องอื่นใช้ ให้ตั้ง --host เป็น IP นั้นแทน {host}")
LOG_FILE_NOTE = ("ไฟล์ log: {path} (ตามปกติคำเตือนและข้อผิดพลาดของ server ระหว่างรันเขียนลงไฟล์นี้ ไม่แสดงที่ terminal "
                 "ถ้าเปิดไฟล์ไม่ได้จะแสดงที่ terminal แทน)")   # (ของเรา)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="python -m gpredict_web", description="Gpredict Web: server ที่คำนวณวงโคจรด้วย GMAT")
    p.add_argument("--host", default=DEFAULT_HOST, help=f"ที่อยู่ที่ฟัง (ตั้งต้น {DEFAULT_HOST})")
    p.add_argument("--port", type=int, default=PORT, help=f"port (ตั้งต้น {PORT})")
    p.add_argument("--data", type=Path, default=None,
                   help="โฟลเดอร์ข้อมูล (ตั้งต้น: GPREDICT_WEB_DATA หรือ api-interop/gpredict-web/data)")
    return p.parse_args(argv)


def build_server(argv: Sequence[str] | None = None, stderr=None) -> uvicorn.Server:
    """สร้าง uvicorn.Server ที่ POST /api/quit ตั้ง should_exit (ยังไม่รัน) --host ที่ไม่ใช่เครื่องตัวเองพิมพ์คำเตือนลง stderr"""
    args = parse_args(argv)
    if args.host.strip("[]") not in LOCAL_HOSTS:
        print(NO_LOGIN_WARNING.format(host=args.host), file=stderr or sys.stderr, flush=True)
        if args.host in WILDCARD_HOSTS:
            print(WILDCARD_NOTE.format(host=args.host), file=stderr or sys.stderr, flush=True)
    server: uvicorn.Server | None = None

    def quit_server() -> None:
        server.should_exit = True

    app = create_app(Config.from_env(args.data), on_quit=quit_server, allowed_hosts=host_allow_list(args.host))
    server = uvicorn.Server(uvicorn.Config(app, host=args.host, port=args.port))
    return server


def main(argv: Sequence[str] | None = None) -> None:
    server = build_server(argv)
    host = server.config.host
    shown = f"[{host}]" if ":" in host else host
    print(f"Gpredict Web: http://{shown}:{server.config.port}/", flush=True)
    print(LOG_FILE_NOTE.format(path=log_file(server.config.app.state.config).absolute()), flush=True)
    server.run()


if __name__ == "__main__":
    main()
