"""ค่าคงที่และ path ของ Gpredict Web (ที่มาของค่าอยู่ในหัวข้อ 5.1 และ 7.1 ของ spec)"""

import os
import re
from dataclasses import dataclass
from pathlib import Path

from gnss_predict import config as engine_config

PORT = 8740

# ช่วงคำนวณของ GMAT (หัวข้อ 5.1)
STEP_S = 30
WINDOW_BACK_H = 2
WINDOW_SPAN_H = 16
REFRESH_MARGIN_H = 3
MAX_SATS = 200
GMAT_TIMEOUT_S = 600

# block ephemeris รายวันสำหรับ pass (spec §3.1 ของงานย่อย 2)
DAY_LRU_BLOCKS = 400                  # block ที่เก็บในหน่วยความจำ (ราว 55 MB) ที่เหลืออ่านจากดิสก์
DAY_KEEP_DAYS = 7                     # prune ลบโฟลเดอร์วันที่เก่ากว่าวันนี้เท่านี้วัน
PASS_MEMO_SIZE = 2 * MAX_SATS         # (ของเรา) ผลของ find_passes ที่จำไว้ (ดาว × ช่วงวัน × สถานี ราว 20 KB ต่อรายการ)
                                      # ไม่น้อยกว่า MAX_SATS: Sky at a glance ของ module เต็มวนครบทุกดวงโดยไม่ไล่ของตัวเองออก

TLE_OLD_DAYS = 7                      # TLE เก่ากว่า T เท่านี้ขึ้นคำเตือน TLE_OLD

# ชื่อ QTH และ module (กติกาเดียวกับ Gpredict) ใช้ fullmatch เพราะ $ ยอมให้มี \n ต่อท้าย
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,25}$")

# กลุ่ม CelesTrak ใน TLE source ตั้งต้นของ Gpredict
TLE_GROUPS = ("amateur", "cubesat", "galileo", "glo-ops", "gps-ops",
              "iridium-NEXT", "science", "last-30-days", "visual", "weather")

APP_ROOT = Path(__file__).resolve().parents[2]       # api-interop/gpredict-web
DATA_ENV = "GPREDICT_WEB_DATA"


@dataclass(frozen=True)
class Config:
    data_dir: Path
    web_dist: Path
    omm_cache_dir: Path

    @property
    def state_file(self) -> Path:
        """celestrak_state.json ที่ใช้ร่วมกับ GNSS Studio (กติกา 1 ครั้งต่อกลุ่มต่อ 2 ชม. นับต่อ IP)"""
        return self.omm_cache_dir / engine_config.CELESTRAK_STATE_FILE

    @classmethod
    def from_env(cls, data_dir: Path | None = None) -> "Config":
        """data_dir: ค่าที่ส่งมา -> GPREDICT_WEB_DATA -> api-interop/gpredict-web/data"""
        if data_dir is None:
            env = os.environ.get(DATA_ENV)
            data_dir = Path(env) if env else APP_ROOT / "data"
        return cls(data_dir=Path(data_dir), web_dist=APP_ROOT / "web" / "dist",
                   omm_cache_dir=engine_config.OMM_CACHE_DIR)
