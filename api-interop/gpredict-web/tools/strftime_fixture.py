"""สร้าง web/src/strftime.fixture.json: ผลของ `time.strftime` ใน locale C ของทุกรหัสใน spec งานย่อย 4 §3.2

    LC_ALL=C python3 -I tools/strftime_fixture.py > web/src/strftime.fixture.json

test ของ web (`web/src/format.test.ts`) เทียบ `formatTime` ของ TypeScript กับไฟล์นี้ทุกแถว
เวลาท้องถิ่นต้องได้ผลเดิมทุกครั้ง จึงตรึง time zone ไว้ที่ TZ ด้านล่าง (ชื่อ zone ย่อของ Python กับ Intl ตรงกันที่ EST/EDT)
ไฟล์ JSON เขียนทีละแถวเพื่อให้ diff อ่านง่าย
"""

import json
import locale
import os
import sys
import time
from calendar import timegm
from datetime import datetime

TZ = "America/New_York"

# เวลา (UTC) ที่ใช้: สี่เวลาตามแผน + ขอบสัปดาห์ของ ISO 8601 (ปี 53 สัปดาห์, สัปดาห์ 1 ของปีถัดไป) + ช่วง EDT
TIMES = (
    "2026-01-01T00:00:00Z",
    "2026-11-12T05:06:07Z",
    "2024-02-29T23:59:59Z",
    "2027-01-03T12:00:00Z",
    "2021-01-01T00:00:00Z",
    "2024-12-30T12:00:00Z",
    "2026-07-04T15:30:45Z",
)

# รหัสของ spec §3.2 ทีละตัว
CODES = (
    "%a %A %b %B %c %C %d %D %e %F %H %I %j %k %l %m %M %n %p %r %R %S %t %T "
    "%u %U %V %w %W %g %G %y %Y %x %X %z %Z %%"
).split(" ")

# รหัสหลายตัวรวมกัน และข้อความที่มีตัวอักษรอื่นปน
COMBOS = (
    "%Y/%m/%d %H:%M:%S",
    "%a %b %e %H:%M:%S %Y",
    "%Y-%j %H:%M:%S",
    "%%Y=%Y",
    "%H%%",
    "[%n%t]",
    "%G-W%V-%u",
    "%I:%M %p %Z (%z)",
    "no codes",
    "",
)

FORMATS = tuple(CODES) + COMBOS


def epoch_of(iso: str) -> int:
    return timegm(datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").timetuple())


def set_tz(name: str) -> None:
    os.environ["TZ"] = name
    time.tzset()


def build() -> dict:
    cases = []
    for local, zone in ((False, "UTC"), (True, TZ)):
        set_tz(zone)    # %z ของเวลา gmtime() ในบางระบบใช้ zone ของ process: ตรึงเป็น UTC สำหรับแถว UTC
        for iso in TIMES:
            epoch = epoch_of(iso)
            moment = time.localtime(epoch) if local else time.gmtime(epoch)
            for fmt in FORMATS:
                cases.append({"iso": iso, "fmt": fmt, "local": local, "out": time.strftime(fmt, moment)})
    return {"tz": TZ, "cases": cases}


def main() -> None:
    locale.setlocale(locale.LC_TIME, "C")
    data = build()
    out = sys.stdout
    out.write('{"tz": ' + json.dumps(data["tz"]) + ', "cases": [\n')
    out.write(",\n".join("  " + json.dumps(c, ensure_ascii=False) for c in data["cases"]))
    out.write("\n]}\n")


if __name__ == "__main__":
    main()
