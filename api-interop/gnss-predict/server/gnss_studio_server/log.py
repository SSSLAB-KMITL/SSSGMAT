"""log ของ server: data/logs/server.log หมุนไฟล์ที่ 10 MB เก็บ 5 ไฟล์ (หัวข้อ 10)"""

import logging
import weakref
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_MAX_BYTES = 10_000_000
LOG_BACKUP_COUNT = 5


def make_logger(data_dir: Path) -> tuple[logging.Logger, RotatingFileHandler]:
    """สร้าง logger ของแอปหนึ่งตัวที่เขียนลง data_dir/logs/server.log ของแอปนั้นเท่านั้น

    ตั้งใจสร้าง Logger ตรง ๆ ไม่ผ่าน logging.getLogger: logger ที่ลงทะเบียนชื่อเป็นของส่วนกลาง
    แอปหลายตัวในโพรเซสเดียว (test สร้างแอปละ data_dir) จะสะสม handler ของกันและกัน
    handler ถูกปิดเมื่อ logger ถูกเก็บกวาด ไม่ต้องพึ่ง lifespan (TestClient ที่ไม่ใช้ with ไม่เรียก)
    """
    log_dir = Path(data_dir) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(log_dir / "server.log", maxBytes=LOG_MAX_BYTES,
                                  backupCount=LOG_BACKUP_COUNT, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger = logging.Logger("gnss_studio_server")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    weakref.finalize(logger, handler.close)
    return logger, handler
