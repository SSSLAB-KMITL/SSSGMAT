"""ตัวช่วย test: data dir, web dist และ OMM cache ชั่วคราวเสมอ (test ห้ามแตะ data จริงหรือใช้เน็ต)"""

import atexit
import shutil
import tempfile
from pathlib import Path
from unittest import TestCase

from gpredict_web.config import Config


def temp_config(testcase: TestCase | None = None) -> Config:
    """Config ที่ทุก path ชี้ไปใต้ temp dir เดียว ลบทิ้งเมื่อ test จบ (ส่ง testcase มา) หรือเมื่อโปรแกรมจบ"""
    root = Path(tempfile.mkdtemp(prefix="gpredict_web_test_"))
    if testcase is not None:
        testcase.addCleanup(shutil.rmtree, root, ignore_errors=True)
    else:
        atexit.register(shutil.rmtree, root, ignore_errors=True)
    return Config(data_dir=root / "data", web_dist=root / "web_dist", omm_cache_dir=root / "omm_cache")
