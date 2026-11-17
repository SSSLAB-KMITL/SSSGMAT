"""Independent orbital references. NASA OEM is an operator prediction, not measured telemetry.

GNSS SP3 times are GPST and are converted to UTC exactly once. Predicted SP3
positions are excluded. Missing coverage is never extrapolated or called verified.
"""
import gzip
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from gnss_predict.igs_meta import fetch_metadata, read_metadata
from gnss_predict.sp3 import fetch_mgx_sp3, gps_week, lagrange_at, read_sp3_all, _parse_epoch
from .store import write_json_atomic

UTC = timezone.utc
ISS_URL = 'https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt'
BKG_ROOT = 'https://igs.bkg.bund.de/root_ftp/IGS/products'
MAX_DOWNLOAD = 32 * 1024 * 1024


def stamp(t: datetime) -> str:
    return t.astimezone(UTC).isoformat().replace('+00:00', 'Z')


def parse_time(s: str) -> datetime:
    t = datetime.fromisoformat(s.replace('Z', '+00:00'))
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t.astimezone(UTC)


@dataclass
class Track:
    positions: dict
    source: str
    url: str
    kind: str
    frame: str
    created: str | None = None

    def __post_init__(self):
        self.times = sorted(self.positions)

    def at(self, t):
        return lagrange_at(self.positions, t, times=self.times)


def read_oem(path: Path) -> Track:
    text = path.read_text(encoding='ascii')
    meta = dict(re.findall(r'^([A-Z_]+)\s*=\s*(.+?)\s*$', text, re.M))
    if (meta.get('REF_FRAME') != 'EME2000' or meta.get('TIME_SYSTEM') != 'UTC'
            or meta.get('CENTER_NAME', '').upper() != 'EARTH' or meta.get('OBJECT_ID') != '1998-067-A'):
        raise ValueError('NASA OEM ต้องเป็น ISS, Earth, EME2000 และ UTC')
    start = parse_time(meta.get('USEABLE_START_TIME', meta['START_TIME']))
    stop = parse_time(meta.get('USEABLE_STOP_TIME', meta['STOP_TIME']))
    positions = {}
    for line in text.splitlines():
        if not re.match(r'^\d{4}-\d\d-\d\dT', line):
            continue
        parts = line.split()
        t, values = parse_time(parts[0]), [float(v) for v in parts[1:]]
        if len(values) != 6 or not all(math.isfinite(v) for v in values):
            raise ValueError('NASA OEM มี state vector ที่อ่านไม่ได้')
        if start <= t <= stop:
            positions[t] = tuple(values[:3])
    if len(positions) < 10:
        raise ValueError('NASA OEM มีข้อมูลไม่พอ')
    return Track(positions, path.name, ISS_URL, 'operator_ephemeris', 'EME2000', meta.get('CREATION_DATE'))


def read_observed_sp3(path: Path) -> dict[str, Track]:
    series = read_sp3_all(path)
    opener = gzip.open if path.name.endswith('.gz') else open
    with opener(path, 'rt', encoding='ascii') as f:
        epoch = None
        for line in f:
            if line.startswith('*'):
                epoch = _parse_epoch(line)
            elif line.startswith('P') and epoch is not None and len(line.rstrip('\r\n')) >= 80 and line[79] == 'P':
                series.get(line[1:4], {}).pop(epoch, None)
    if not series or any(not all(math.isfinite(v) for v in xyz) for values in series.values() for xyz in values.values()):
        raise ValueError('SP3 ไม่มีข้อมูลหรือมีตำแหน่งที่ไม่เป็นจำนวนจริง')
    # GPST-UTC = 18 s for supported dates (2017+); API rejects earlier dates.
    return {prn: Track({t - timedelta(seconds=18): p for t, p in values.items()}, path.name,
                       '', 'observed_sp3', 'ITRF') for prn, values in series.items() if values}


class References:
    def __init__(self, root: Path, opener=urlopen):
        self.root, self.opener = root, opener
        self.warnings = []

    def fetch(self, name, url, now, validate, max_age_s=7200):
        """Bounded download with persisted attempt throttling, including unsuccessful attempts."""
        self.root.mkdir(parents=True, exist_ok=True)
        path, state_file = self.root / name, self.root / 'requests.json'
        try:
            import json
            state = json.loads(state_file.read_text())
        except (OSError, ValueError):
            state = {}
        last = state.get(url)
        if last is not None and (now - parse_time(last)).total_seconds() < max_age_s:
            if path.is_file():
                validate(path)
                return path
            raise ValueError('แหล่งอ้างอิงยังไม่พร้อม จะลองใหม่ตามรอบที่ตั้งไว้')
        state[url] = stamp(now)
        write_json_atomic(state_file, state)
        part = path.with_suffix(path.suffix + '.part')
        try:
            with self.opener(Request(url, headers={'User-Agent': 'gpredict-web/quality'}), timeout=30) as response:
                data = response.read(MAX_DOWNLOAD + 1)
            if len(data) > MAX_DOWNLOAD:
                raise ValueError('ไฟล์อ้างอิงใหญ่เกิน 32 MB')
            part.write_bytes(data)
            # Keep gzip suffix so validators use the correct decoder.
            candidate = self.root / ('pending-' + name)
            part.replace(candidate)
            try:
                validate(candidate)
                candidate.replace(path)
            finally:
                candidate.unlink(missing_ok=True)
            return path
        except Exception as exc:
            part.unlink(missing_ok=True)
            if path.is_file():
                validate(path)
                self.warnings.append(f'{name}: ดาวน์โหลดใหม่ไม่ได้ ใช้ cache ({exc})')
                return path
            raise

    def iss(self, now):
        return read_oem(self.fetch('ISS.OEM_J2K_EPH.txt', ISS_URL, now, read_oem))

    def gnss(self, day: date, now):
        metadata_path, warnings = fetch_metadata(self.root / 'metadata', now, opener=self.opener, timeout_s=30)
        self.warnings.extend(m.text for m in warnings)
        metadata = read_metadata(metadata_path)
        # Existing engine supports multi-GNSS precise orbits from CDDIS. Cache the
        # unsuccessful attempt too; do not hammer a product that is not published yet.
        state_file = self.root / 'mgex-attempt.json'
        import json
        try:
            state = json.loads(state_file.read_text())
        except (OSError, ValueError):
            state = {}
        key = str(day)
        attempt = state.get(key)
        path = next(iter(sorted(self.root.glob(f'*_{day.year}{day.timetuple().tm_yday:03d}0000_01D_05M_ORB.SP3.gz'))), None)
        if path is None and (attempt is None or (now - parse_time(attempt)).total_seconds() >= 21600):
            state[key] = stamp(now)
            write_json_atomic(state_file, dict(sorted(state.items())[-30:]))
            try:
                path = fetch_mgx_sp3(day, self.root)
            except Exception as exc:
                self.warnings.append(f'MGEX ของ {day} ยังไม่พร้อม: {exc}')
        if path is not None:
            tracks = read_observed_sp3(path)
            for track in tracks.values():
                track.url = f'https://cddis.nasa.gov/archive/gnss/products/{gps_week(day)}/{path.name}'
            return metadata, tracks
        # Independent GPS rapid product over HTTPS if MGEX is not available.
        name = f'IGS0OPSRAP_{day.year}{day.timetuple().tm_yday:03d}0000_01D_15M_ORB.SP3.gz'
        url = f'{BKG_ROOT}/{gps_week(day)}/{name}'
        path = self.fetch(name, url, now, read_observed_sp3, max_age_s=21600)
        tracks = read_observed_sp3(path)
        for track in tracks.values():
            track.url = url
        return metadata, tracks
