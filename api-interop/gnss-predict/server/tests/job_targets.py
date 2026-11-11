"""target ของ ProcessRunner สำหรับ test เท่านั้น: อยู่ในไฟล์แยก (ไม่ใช่ test_*.py) เพื่อให้ process ลูกแบบ spawn import ได้
ผ่าน sys.path ที่ส่งต่อจาก pytest (โฟลเดอร์ tests/ อยู่ใน sys.path ของ process แม่)"""

import os
import struct


def exit_3(kind, scenario, params, data_dir, gmat_bin, out) -> None:
    """process ลูกตายทันทีโดยไม่ส่งอะไรเข้าคิว (จำลองการ crash)"""
    os._exit(3)


def partial_message_then_exit(kind, scenario, params, data_dir, gmat_bin, out) -> None:
    """ส่งข้อความจริงหนึ่งข้อความ แล้วเขียนกรอบข้อความที่ขาดกลาง (หัวบอก 4096 ไบต์ ส่งจริง 9 ไบต์) ลงท่อตรง ๆ แล้วตาย
    (จำลอง process ลูกที่ถูก SIGKILL ระหว่างเขียนข้อความ)"""
    out.put(("progress", "gmat", 0.1))
    os.write(out.conn.fileno(), struct.pack("!i", 4096) + b"truncated")
    os._exit(5)


def daily_offline(kind, scenario, params, data_dir, gmat_bin, out) -> None:
    """worker.run_job ใน process ลูกจริง แต่ studio.fetch_snapshot ถูกแทนด้วยการคัดลอก snapshot ของ test (ห้ามใช้เน็ต)"""
    import shutil
    from pathlib import Path

    from gnss_predict import studio
    from gnss_studio_server import worker

    source = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "studio" / "snapshot"

    def fetch(data_dir, now, systems="GREC", progress=None, **kw):
        dest = Path(data_dir) / "orbits" / now.strftime("%Y%m%dT%H%MZ")
        shutil.copytree(source, dest, dirs_exist_ok=True)
        return dest, []

    studio.fetch_snapshot = fetch
    worker.run_job(kind, scenario, params, data_dir, gmat_bin, out)
