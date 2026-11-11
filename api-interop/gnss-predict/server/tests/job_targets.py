"""target ของ ProcessRunner สำหรับ test เท่านั้น: อยู่ในไฟล์แยก (ไม่ใช่ test_*.py) เพื่อให้ process ลูกแบบ spawn import ได้
ผ่าน sys.path ที่ส่งต่อจาก pytest (โฟลเดอร์ tests/ อยู่ใน sys.path ของ process แม่)"""

import os


def exit_3(kind, scenario, params, data_dir, gmat_bin, out) -> None:
    """process ลูกตายทันทีโดยไม่ส่งอะไรเข้าคิว (จำลองการ crash)"""
    os._exit(3)
