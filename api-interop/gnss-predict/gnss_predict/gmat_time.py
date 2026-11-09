"""แปลงเวลาเป็นและจากรูปแบบ UTCGregorian ของ GMAT เช่น '10 Nov 2026 00:00:00.000'

ไม่ใช้ %b ของ strftime/strptime เพราะชื่อเดือนขึ้นกับ locale ของเครื่อง
"""

from datetime import datetime, timedelta, timezone

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def format_gmat_epoch(t: datetime) -> str:
    """ปัดเป็นมิลลิวินาทีแล้วจัดรูปแบบเป็น 'DD Mon YYYY HH:MM:SS.mmm' (UTC)"""
    t = t.astimezone(timezone.utc)
    t = t.replace(microsecond=0) + timedelta(milliseconds=round(t.microsecond / 1000))
    return (f"{t.day:02d} {_MONTHS[t.month - 1]} {t.year:04d} "
            f"{t.hour:02d}:{t.minute:02d}:{t.second:02d}.{t.microsecond // 1000:03d}")


def parse_gmat_epoch(text: str) -> datetime:
    """'DD Mon YYYY HH:MM:SS.mmm' → datetime UTC โดยไม่ปัดเศษ"""
    day, mon, year, clock = text.split()
    hh, mm, ss = clock.split(":")
    whole, _, frac = ss.partition(".")
    return datetime(int(year), _MONTHS.index(mon) + 1, int(day), int(hh), int(mm), int(whole),
                    int((frac + "000000")[:6]), tzinfo=timezone.utc)
