"""Estimated optical satellite positions from archived, time-matched TLEs.

These are independent orbit estimates, never vendor image ephemerides. All
inputs are pinned locally; displaying a sample does not make a network request.
"""
from datetime import datetime, timezone
from functools import lru_cache
import json
import math

from skyfield.api import EarthSatellite, load, wgs84
from skyfield.framelib import itrs

from .catalog import ROOT

NORAD = {"vegas-wv3": 40115, "rotterdam-wv2": 35946,
         "bangkok-wv03": 40115, "mandalay-ge01": 33331}
METHOD = "Historical TLE / SGP4 · estimated"
NOTE = ("พิกัดประมาณจาก TLE ย้อนหลัง ไม่ใช่ ephemeris จากผู้ผลิตภาพ "
        "เวลาใน metadata อาจต่างจากเวลาถ่ายแต่ละพิกเซล จึงไม่ใช้ชี้ตำแหน่งระดับเมตร")
GRAPHICS = ("เส้นเชื่อมเป็นกราฟิกประกอบจาก TLE ไปยังกรอบภาพครอป 500 ม. "
            "ไม่ใช่ขอบเขตเซนเซอร์จริง · จุดบนพื้นใช้ WGS84 สูง 0 ม.")


@lru_cache(maxsize=1)
def timescale():
    return load.timescale(builtin=True)


def clean_line(line, number, norad_id):
    # This one archived response has a trailing backslash. Preserve the
    # original response in research/orbits; accept only this documented repair.
    if len(line) == 70 and line.endswith("\\"):
        line = line[:-1]
    if (len(line) != 69 or not line.startswith(f"{number} ")
            or line[2:7].strip() != str(norad_id) or not line[68].isdigit()):
        raise ValueError("Invalid archived TLE satellite identity or length")
    checksum = sum(int(c) if c.isdigit() else 1 if c == "-" else 0
                   for c in line[:68]) % 10
    if checksum != int(line[68]):
        raise ValueError("Archived TLE checksum mismatch")
    return line


@lru_cache(maxsize=4)
def archive(sample_id):
    if sample_id not in NORAD:
        raise ValueError("No historical TLE for this sample")
    raw = json.loads((ROOT / "research/orbits" / f"{sample_id}-tle.json").read_text())
    record = raw["response"][0]["orbital_data"][0]
    norad_id = NORAD[sample_id]
    if record["satellite_id"] != norad_id:
        raise ValueError("Archived satellite ID mismatch")
    lines = [clean_line(record[f"tle_line{n}"], n, norad_id) for n in (1, 2)]
    satellite = EarthSatellite(*lines, str(norad_id), timescale())
    return satellite, record, raw["request_url"], lines


def solve(row, at_utc=None):
    sample_id = row["id"]
    if sample_id not in NORAD:
        return {"status": "unavailable", "position": None}
    sat, record, source_url, lines = archive(sample_id)
    base = {
        "status": "needs_time", "estimated": True, "position": None,
        "sample_id": sample_id, "platform": row["platform"],
        "norad_id": NORAD[sample_id], "method": METHOD,
        "source": "IAU CPS SatChecker / Space-Track archived TLE",
        "source_url": source_url, "source_record": record,
        "tle_lines": lines, "tle_epoch_utc": sat.epoch.utc_iso(places=3),
        "note": NOTE, "graphics_note": GRAPHICS,
        "image_datetime": row["acquired_utc"], "date_precision": row["date_precision"],
        "time_basis": "selected_time" if row["date_precision"] == "day" else "image_metadata",
    }
    if at_utc is None and row["date_precision"] == "day":
        return base
    value = at_utc if at_utc is not None else row["acquired_utc"]
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        raise ValueError("Use an ISO UTC date and time")
    if moment.tzinfo is None or moment.utcoffset().total_seconds() != 0:
        raise ValueError("Time must include UTC timezone (Z or +00:00)")
    moment = moment.astimezone(timezone.utc)
    if moment.date().isoformat() != row["acquired_utc"][:10]:
        raise ValueError("Select a UTC time on the image date")
    t = timescale().from_datetime(moment)
    age_hours = float(t - sat.epoch) * 24
    if abs(age_hours) > 48:
        raise ValueError("Selected time is more than 48 hours from the TLE epoch")
    if at_utc is not None and row["date_precision"] != "day":
        image_moment = datetime.fromisoformat(row["acquired_utc"].replace("Z", "+00:00"))
        if moment != image_moment:
            base["time_basis"] = "selected_time"
    state = sat.at(t)
    if state.message:
        raise ValueError(f"SGP4 propagation failed: {state.message}")
    sub = wgs84.subpoint(state)
    xyz = state.frame_xyz(itrs).m.tolist()
    height = float(sub.elevation.m)
    if not all(math.isfinite(v) for v in xyz) or not 100000 < height < 2000000:
        raise ValueError("Invalid propagated satellite state")
    elevation, azimuth, distance = (sat - wgs84.latlon(row["lat"], row["lon"])).at(t).altaz()
    position = {"time": moment.isoformat().replace("+00:00", "Z"), "t_s": 0,
                "lat": float(sub.latitude.degrees), "lon": float(sub.longitude.degrees),
                "altitude_m": height, "ecef_m": xyz}
    geometry = {"estimated": True, "samples": [position], "duration_s": 0,
                "target": {"lat": row["lat"], "lon": row["lon"]},
                "render_source_label": METHOD, "graphics_note": GRAPHICS,
                "time_label": ("พิกัดประมาณ ณ เวลาตาม metadata ภาพ" if base["time_basis"] == "image_metadata"
                               else "เวลาที่เลือก · ยังไม่ยืนยันว่าเป็นเวลาถ่ายภาพ"),
                "empty_note": "เลือกเวลา UTC เพื่อคำนวณตำแหน่งดาวเทียม"}
    return {**base, "status": "tle_estimate", "position": position,
            "tle_age_hours": age_hours, "geometry": geometry,
            "ground_look": {"azimuth_deg": float(azimuth.degrees),
                            "elevation_deg": float(elevation.degrees),
                            "range_m": float(distance.m)}}
