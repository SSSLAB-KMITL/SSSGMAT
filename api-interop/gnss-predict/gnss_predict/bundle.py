"""hash ของอินพุต การเขียนโฟลเดอร์ผลลัพธ์แบบ atomic และ manifest (หัวข้อ 5.12 และ 8.1 ของ spec engine)

- `input_hash` ให้ 12 ตัวแรกของ SHA-256 ของ JSON ที่เรียง key ใช้เป็นชื่อโฟลเดอร์ผลลัพธ์
- `write_bundle` เขียนลงโฟลเดอร์ชั่วคราวข้างโฟลเดอร์ปลายทางแล้ว `os.replace` ถ้ามีผลเดิมอยู่แล้วจะคงผลเดิมไว้
- `build_manifest` สร้าง dict ที่ `json.dumps` ได้ทันที (ไม่มี datetime หรือ frozenset เหลืออยู่)
"""

import hashlib
import json
import os
import shutil
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from .catalog import Catalog, CatalogSatellite
from .config import ENGINE_VERSION
from .errors import Message

_TIME_FMT = "%Y-%m-%dT%H:%M:%SZ"
_READ_CHUNK = 1 << 20


def input_hash(parts: dict) -> str:
    """12 ตัวแรกของ SHA-256 ของ JSON ที่เรียง key (ค่าที่ JSON ไม่รู้จักแปลงด้วย str)"""
    text = json.dumps(parts, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(_READ_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_relative(name: str) -> PurePosixPath:
    """path สัมพัทธ์แบบ POSIX ที่อยู่ใต้โฟลเดอร์ผลลัพธ์เท่านั้น ไม่เช่นนั้น ValueError"""
    rel = PurePosixPath(name)
    if not rel.parts or rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"ชื่อไฟล์ในผลลัพธ์ไม่ปลอดภัย: {name!r}")
    return rel


def write_bundle(final_dir: Path, files: Mapping[str, bytes]) -> Path:
    """เขียน files (path สัมพัทธ์ -> เนื้อหา) ลง final_dir แบบ atomic แล้วคืน final_dir

    ถ้า final_dir มีอยู่แล้วถือว่าเป็นผลเดิมของอินพุตเดียวกัน คงไว้ไม่แก้ไขและลบโฟลเดอร์ชั่วคราว
    เกิดข้อผิดพลาดใดก็ลบโฟลเดอร์ชั่วคราวแล้วโยน exception เดิมต่อ
    """
    final_dir = Path(final_dir)
    tmp_dir = final_dir.with_name(final_dir.name + f".tmp-{os.getpid()}")
    final_dir.parent.mkdir(parents=True, exist_ok=True)
    if tmp_dir.exists():                      # เศษจากการรันก่อนหน้าที่ใช้ pid เดียวกัน
        shutil.rmtree(tmp_dir)
    try:
        tmp_dir.mkdir()
        for name, data in files.items():
            target = tmp_dir / _safe_relative(name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        if final_dir.exists():
            return final_dir
        try:
            os.replace(tmp_dir, final_dir)
        except OSError:
            if not final_dir.is_dir():        # ถ้าโฟลเดอร์ปลายทางเกิดขึ้นระหว่างนี้ (process อื่นเขียนก่อน) ถือเป็นผลเดิม
                raise
        return final_dir
    finally:
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)


def _iso_z(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime(_TIME_FMT)


def _satellite_entry(sat: CatalogSatellite, propagated: frozenset[str]) -> dict:
    return {
        "prn": sat.prn,
        "system": sat.system,
        "svn": sat.svn,
        "norad": sat.norad,
        "block": sat.block,
        "celestrak_name": sat.celestrak_name,
        "omm_epoch": _iso_z(sat.omm_epoch),
        "age_days": sat.age_days,
        "flags": sorted(sat.flags),
        "propagated": sat.prn in propagated,
    }


def build_manifest(kind: str, inputs: dict, catalog: Catalog | None, messages: list[Message],
                   extra: dict, propagated: frozenset[str] = frozenset(),
                   now: datetime | None = None) -> dict:
    """manifest.json ตามหัวข้อ 8.1 ของ spec

    ดาวมาจาก catalog.satellites ทุกดวง (ไม่รวม tle_lines) และ propagated = PRN อยู่ใน propagated
    ไม่มี catalog -> satellites และ unmapped เป็น list ว่าง extra ถูก merge เข้าระดับบนสุด
    """
    created = now if now is not None else datetime.now(timezone.utc)
    manifest = {
        "kind": kind,
        "engine_version": ENGINE_VERSION,
        "created_utc": _iso_z(created),
        "inputs": inputs,
        "satellites": [_satellite_entry(s, propagated) for s in catalog.satellites] if catalog is not None else [],
        "unmapped": [dict(u) for u in catalog.unmapped] if catalog is not None else [],
        "messages": [m.to_dict() for m in messages],
    }
    manifest.update(extra)
    return manifest
