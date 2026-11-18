"""Gpredict Web: server ของ Gpredict-style web app ที่ใช้วงโคจรจาก GMAT ผ่าน engine `gnss_predict`

engine อยู่ที่ api-interop/gnss-predict (stdlib ล้วน ไม่ได้ติดตั้งเป็น package) จึงใส่ path ของมันจากตำแหน่งไฟล์นี้
ก่อนโมดูลอื่นใน package นี้ import `gnss_predict`
"""

import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[3] / "gnss-predict"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))
