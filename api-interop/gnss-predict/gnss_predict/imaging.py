"""ดาวถ่ายภาพ (ระบบ X): ตาราง preset และ catalog ที่จับคู่ด้วย NORAD จากไฟล์กลุ่ม CelesTrak ใน snapshot
(หัวข้อ 3.1 และ 3.2 ของ spec ดาวถ่ายภาพ ข2)

ไฟล์กลุ่มใน snapshot คือ <group>.json ของ IMAGING_GROUPS (weather, science, visual)
- จับคู่ด้วย NORAD_CAT_ID เท่านั้น ห้ามใช้ชื่อ (เช่น ROBUSTA-3A มีคำว่า TERRA ในชื่อเต็ม)
- ดวงเดียวกันอยู่หลายกลุ่ม: ใช้ record ที่ EPOCH ใหม่สุด
- ไม่พบใน snapshot หรือแปลงเป็น TLE ไม่ได้: unmapped เหตุผล TLE_UNAVAILABLE
- ไฟล์กลุ่มที่อ่านไม่ได้: ข้ามกลุ่มนั้น + Message IMAGING_GROUP_UNREADABLE (ไม่ raise)
- snapshot ที่ไม่มีไฟล์กลุ่ม imaging เลย: catalog ว่าง (ไม่มี unmapped ไม่มีข้อความ)
- scenario_catalog: catalog ของ GNSS (build_catalog เดิม) ตามด้วยดาวถ่ายภาพเมื่อ with_imaging เท่านั้น
"""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal

from .catalog import Catalog, CatalogSatellite, _flagged_message, _unmapped, build_catalog
from .config import AGE_OK_DAYS, AGE_SHOWN_MAX_DAYS
from .errors import Message
from .omm import OmmRecord, read_omm, to_tle_lines

IMAGING_LETTER = "X"
IMAGING_GROUPS = ("weather", "science", "visual")
GEO_MEAN_MOTION_MAX = 1.1        # rev/day: ต่ำกว่านี้ถือเป็น GEO
GEO_AGE_OK_DAYS = 7.0            # GEO: เกินนี้ stale
GEO_AGE_SHOWN_MAX_DAYS = 14.0    # GEO: เกินนี้ too_old (ซ่อน)


@dataclass(frozen=True)
class SensorPreset:
    type: Literal["Simple Conic", "Rectangular"]
    cone_half_angle: float | None = None
    vertical_half_angle: float | None = None       # ระนาบ YZ = cross-track (Ruling g)
    horizontal_half_angle: float | None = None     # ระนาบ XZ = along-track (Ruling g)

    def definition(self) -> dict:
        """SensorObj.definition ของ preset: type + เฉพาะช่องของชนิดนั้น"""
        if self.type == "Simple Conic":
            return {"type": self.type, "cone_half_angle": self.cone_half_angle}
        return {"type": self.type, "vertical_half_angle": self.vertical_half_angle,
                "horizontal_half_angle": self.horizontal_half_angle}


@dataclass(frozen=True)
class ImagingPreset:
    prn: str
    norad: int
    name: str
    block: str
    groups: tuple[str, ...]
    camera: str
    sensor: SensorPreset
    gibs_layer: str


_GEO = SensorPreset("Simple Conic", cone_half_angle=8.7)
_MODIS = SensorPreset("Rectangular", vertical_half_angle=55.0, horizontal_half_angle=0.41)
_VIIRS = SensorPreset("Rectangular", vertical_half_angle=56.28, horizontal_half_angle=0.42)

IMAGING_SATELLITES: tuple[ImagingPreset, ...] = (
    ImagingPreset("X01", 41836, "Himawari-9", "Himawari-8/9", ("weather",), "AHI", _GEO,
                  "Himawari_AHI_Band3_Red_Visible_1km"),
    ImagingPreset("X02", 51850, "GOES-18", "GOES-R", ("weather",), "ABI", _GEO, "GOES-West_ABI_GeoColor"),
    ImagingPreset("X03", 60133, "GOES-19", "GOES-R", ("weather",), "ABI", _GEO, "GOES-East_ABI_GeoColor"),
    ImagingPreset("X04", 25994, "Terra", "EOS AM-1", ("science", "visual"), "MODIS", _MODIS,
                  "MODIS_Terra_CorrectedReflectance_TrueColor"),
    ImagingPreset("X05", 27424, "Aqua", "EOS PM-1", ("visual",), "MODIS", _MODIS,
                  "MODIS_Aqua_CorrectedReflectance_TrueColor"),
    ImagingPreset("X06", 37849, "Suomi NPP", "JPSS", ("weather",), "VIIRS", _VIIRS,
                  "VIIRS_SNPP_CorrectedReflectance_TrueColor"),
    ImagingPreset("X07", 43013, "NOAA-20", "JPSS", ("weather",), "VIIRS", _VIIRS,
                  "VIIRS_NOAA20_CorrectedReflectance_TrueColor"),
    ImagingPreset("X08", 54234, "NOAA-21", "JPSS", ("weather",), "VIIRS", _VIIRS,
                  "VIIRS_NOAA21_CorrectedReflectance_TrueColor"),
)
IMAGING_NORADS: frozenset[int] = frozenset(p.norad for p in IMAGING_SATELLITES)
_BY_NORAD = {p.norad: p for p in IMAGING_SATELLITES}


def preset_by_norad(norad: int) -> ImagingPreset | None:
    return _BY_NORAD.get(norad)


def imaging_group_files(snapshot_dir: Path) -> list[str]:
    """ชื่อไฟล์ <group>.json ของกลุ่ม imaging ที่มีใน snapshot เรียงตาม IMAGING_GROUPS"""
    snapshot_dir = Path(snapshot_dir)
    return [f"{g}.json" for g in IMAGING_GROUPS if (snapshot_dir / f"{g}.json").is_file()]


def _age_limits(rec: OmmRecord) -> tuple[float, float]:
    """(เกณฑ์ stale, เกณฑ์ too_old) ตามชนิดวงโคจร GEO ใช้เกณฑ์ 7/14 วัน LEO ใช้เกณฑ์เดิมของ GNSS"""
    if float(rec.raw["MEAN_MOTION"]) < GEO_MEAN_MOTION_MAX:
        return GEO_AGE_OK_DAYS, GEO_AGE_SHOWN_MAX_DAYS
    return AGE_OK_DAYS, AGE_SHOWN_MAX_DAYS


def build_imaging_catalog(snapshot_dir: Path, ref: tuple[datetime, datetime]) -> Catalog:
    """catalog ของดาวถ่ายภาพที่มีใน snapshot เรียงตามรหัส X01…X08 อายุวัดที่กึ่งกลางช่วง ref เหมือน build_catalog

    ธงมีเฉพาะ stale/too_old (ไม่มีธงของ GNSS เพราะไม่มี broadcast และ IGS metadata ของดาวเหล่านี้)
    """
    snapshot_dir = Path(snapshot_dir)
    files = imaging_group_files(snapshot_dir)
    if not files:
        return Catalog([], [], [])
    start, stop = ref
    midpoint = start + (stop - start) / 2

    messages: list[Message] = []
    found: dict[int, list[OmmRecord]] = {}
    for name in files:
        path = snapshot_dir / name
        try:
            records = read_omm(path)
        except (OSError, ValueError) as exc:             # อ่านไม่ได้หรือไม่ใช่ OMM: ข้ามกลุ่มนี้
            messages.append(Message("IMAGING_GROUP_UNREADABLE", "warning",
                                    f"อ่านข้อมูลวงโคจรของกลุ่มดาวถ่ายภาพ {path.stem} ไม่ได้ ({path}): {exc} จึงข้ามกลุ่มนี้"))
            continue
        for rec in records:
            if rec.norad in IMAGING_NORADS:
                found.setdefault(rec.norad, []).append(rec)

    satellites: list[CatalogSatellite] = []
    unmapped: list[dict] = []
    flagged: list[Message] = []
    for preset in IMAGING_SATELLITES:
        candidates = sorted(found.get(preset.norad, []), key=lambda r: r.epoch, reverse=True)
        if not candidates:
            unmapped.append({"norad": preset.norad, "celestrak_name": "", "object_id": "",
                             "reason": "TLE_UNAVAILABLE"})
            continue
        rec = candidates[0]                               # EPOCH ใหม่สุดเท่านั้น ไม่ถอยไปใช้ record เก่า
        try:
            tle = to_tle_lines(rec)
            ok, max_ = _age_limits(rec)
        except (ValueError, OverflowError):              # ช่องของ OMM ขาด ผิดรูป หรือเกินช่วงที่ TLE รองรับ
            unmapped.append(_unmapped(rec, "TLE_UNAVAILABLE"))
            continue
        age_days = abs((midpoint - rec.epoch).total_seconds()) / 86400
        flags = set()
        if age_days > max_:
            flags.add("too_old")
        elif age_days > ok:
            flags.add("stale")
        s = CatalogSatellite(preset.prn, IMAGING_LETTER, "", rec.norad, preset.block, rec.name, rec.epoch,
                             age_days, frozenset(flags), tle)
        satellites.append(s)
        if s.flags:
            flagged.append(_flagged_message(s, ok, max_))

    return Catalog(satellites, unmapped, messages + flagged)


def scenario_catalog(snapshot_dir: Path, period: tuple[datetime, datetime], systems: set[str],
                     with_imaging: bool, with_custom: bool = True) -> Catalog:
    """catalog รวมของฉาก: GNSS เดิม ตามด้วยดาวถ่ายภาพ X และดาวที่นำเข้า U ตามที่ขอ

    ไม่อ่านกลุ่ม imaging เมื่อ with_imaging เป็น False และไม่อ่าน registry เมื่อ with_custom เป็น False
    snapshot ที่ไม่มีดาวนำเข้าคืน catalog เดิมโดยไม่มีการเปลี่ยนข้อมูล GNSS
    """
    gnss = build_catalog(snapshot_dir, period, systems)
    if with_imaging:
        imaging = build_imaging_catalog(snapshot_dir, period)
        gnss = Catalog(gnss.satellites + imaging.satellites, gnss.unmapped + imaging.unmapped,
                       gnss.messages + imaging.messages)
    if with_custom:
        from .custom_satellites import extend_catalog
        return extend_catalog(gnss, snapshot_dir, period)
    return gnss
