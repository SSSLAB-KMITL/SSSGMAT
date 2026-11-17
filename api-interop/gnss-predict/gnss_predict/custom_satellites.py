"""User-supplied SGP4 satellites in immutable orbit snapshots.

U01..U99 are internal SP3 identifiers, not navigation PRNs. These satellites do
not enter GNSS DOP, IPP or health calculations. The original GNSS catalog wins
on a duplicate NORAD so importing a file cannot overwrite navigation data.
"""
import calendar
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .catalog import Catalog, CatalogSatellite, _flagged_message
from .config import AGE_OK_DAYS, AGE_SHOWN_MAX_DAYS
from .errors import OrbitUnavailableError
from .omm import _parse_records, to_tle_lines

FILE = 'custom_satellites.json'
SYSTEM = 'U'
MAX_SATELLITES = 99
MAX_BYTES = 5 * 1024 * 1024
UTC = timezone.utc


@dataclass(frozen=True)
class ImportedOrbit:
    norad: int
    name: str
    epoch: datetime
    tle: tuple[str, str]
    source: str


def _catalog_number(field):
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    if len(field) != 5:
        raise ValueError('ช่อง NORAD ต้องยาว 5 ตัวอักษร')
    if field[0] in alphabet and field[1:].isascii() and field[1:].isdigit():
        return (alphabet.index(field[0])+10)*10000+int(field[1:])
    if field.strip().isascii() and field.strip().isdigit() and int(field)>0:
        return int(field)
    raise ValueError('หมายเลข NORAD ใน TLE ไม่ถูกต้อง')


def validate_tle(name, lines, source='local_tle'):
    a,b = (line.rstrip('\r\n') for line in lines)
    if len(a)!=69 or len(b)!=69 or not a.startswith('1 ') or not b.startswith('2 '):
        raise ValueError('TLE ต้องมีบรรทัด 1 และ 2 ยาวบรรทัดละ 69 ตัวอักษร')
    for line in (a,b):
        if not line.isascii() or not line[-1].isdigit():
            raise ValueError('TLE ต้องเป็น ASCII และมี checksum')
        total=sum(int(c) if c.isdigit() else 1 if c=='-' else 0 for c in line[:68])
        if total%10 != int(line[68]):
            raise ValueError('checksum ของ TLE ไม่ตรง')
    norad=_catalog_number(a[2:7])
    if norad!=_catalog_number(b[2:7]):
        raise ValueError('NORAD ของ TLE สองบรรทัดไม่ตรงกัน')
    yy,doy=int(a[18:20]),float(a[20:32]);year=1900+yy if yy>=57 else 2000+yy
    if not math.isfinite(doy) or not 1 <= doy < (367 if calendar.isleap(year) else 366):
        raise ValueError('epoch ของ TLE ไม่ถูกต้อง')
    epoch=datetime(year,1,1,tzinfo=UTC)+timedelta(days=doy-1)
    inc,raan,ecc,argp,anomaly,motion=(float(b[8:16]),float(b[17:25]),float('0.'+b[26:33]),
                                    float(b[34:42]),float(b[43:51]),float(b[52:63]))
    if not all(math.isfinite(x) for x in (inc,raan,ecc,argp,anomaly,motion)) or not (0<=inc<=180 and 0<=ecc<1 and motion>0):
        raise ValueError('ค่าองค์ประกอบวงโคจรใน TLE ไม่ถูกต้อง')
    if any(not 0<=angle<360 for angle in (raan,argp,anomaly)):
        raise ValueError('มุมใน TLE ต้องอยู่ในช่วง 0–360 องศา')
    if any(not re.fullmatch(r'[ +\-]\d{5}[+\-]\d',field) for field in (a[44:52],a[53:61])) or not math.isfinite(float(a[33:43])):
        raise ValueError('ค่า drag ใน TLE ไม่ถูกต้อง')
    if a[62]!='0':
        raise ValueError('รองรับ TLE แบบ SGP4 (ephemeris type 0) เท่านั้น')
    clean=''.join(c for c in str(name) if c.isprintable()).strip()[:128]
    return ImportedOrbit(norad,clean or f'NORAD {norad}',epoch,(a,b),source)


def parse_import(text: str, format: str, source=None):
    if not isinstance(text,str) or len(text.encode('utf-8'))>MAX_BYTES:
        raise ValueError('ข้อมูลนำเข้าต้องไม่เกิน 5 MB')
    found=[]
    if format=='omm':
        try:
            parsed=json.loads(text.lstrip('\ufeff'))
        except RecursionError as exc:
            raise ValueError('ข้อมูล JSON ซ้อนลึกเกินไป') from exc
        normalized=json.dumps([parsed]) if isinstance(parsed,dict) else text.lstrip('\ufeff')
        for rec in _parse_records(normalized):
            raw=rec.raw
            if not 1957 <= rec.epoch.year <= 2056:
                raise ValueError('epoch อยู่นอกช่วงปี 1957–2056 ที่ TLE รองรับ')
            for field,expected in [('REF_FRAME','TEME'),('TIME_SYSTEM','UTC'),('MEAN_ELEMENT_THEORY','SGP4')]:
                if raw.get(field,expected)!=expected:
                    raise ValueError(f'OMM ต้องใช้ {field}={expected}')
            try:
                lines=to_tle_lines(rec)
            except OverflowError as exc:
                raise ValueError('องค์ประกอบวงโคจร OMM อยู่นอกช่วงที่รองรับ') from exc
            found.append(validate_tle(rec.name,lines,source or 'local_omm'))
    elif format=='tle':
        lines=[line.strip() for line in text.lstrip('\ufeff').splitlines() if line.strip()]
        i=0;name=''
        while i<len(lines):
            line=lines[i]
            if line.startswith('1 '):
                if i+1>=len(lines):raise ValueError('TLE ขาดบรรทัด 2')
                found.append(validate_tle(name,(line,lines[i+1]),source or 'local_tle'));name='';i+=2
            elif line.startswith('2 '):
                raise ValueError('พบ TLE บรรทัด 2 โดยไม่มีบรรทัด 1')
            else:
                if name:raise ValueError('พบชื่อดาวต่อกันโดยไม่มี TLE')
                name=line[2:] if line.startswith('0 ') else line;i+=1
        if name:raise ValueError('ชื่อดาวไม่มี TLE ตามหลัง')
    else:
        raise ValueError('format ต้องเป็น tle หรือ omm')
    best={}
    for row in found:
        if row.norad not in best or row.epoch>best[row.norad].epoch:best[row.norad]=row
    if not best:raise ValueError('ไม่พบข้อมูลวงโคจรที่นำเข้าได้')
    if len(best)>MAX_SATELLITES:raise ValueError('นำเข้าดาวทั่วไปได้สูงสุด 99 ดวงต่อ snapshot')
    return list(best.values())


def read_registry(snapshot: Path):
    path=snapshot/FILE
    if not path.is_file():return []
    try:
        doc=json.loads(path.read_text())
        if not isinstance(doc,dict) or doc.get('version')!=1 or not isinstance(doc.get('satellites'),list):
            raise ValueError('รูปแบบ registry ไม่ถูกต้อง')
        rows=doc['satellites'];seen=set();codes=set()
        if len(rows)>MAX_SATELLITES:raise ValueError('มีดาวทั่วไปเกิน 99 ดวง')
        for row in rows:
            orbit=validate_tle(row['name'],row['tle'],row['source'])
            if orbit.norad!=row['norad'] or not re.fullmatch(r'U(?:0[1-9]|[1-9]\d)',row['prn']):
                raise ValueError('NORAD หรือรหัสดาวทั่วไปไม่ถูกต้อง')
            if row['norad'] in seen or row['prn'] in codes:raise ValueError('มีดาวซ้ำใน registry')
            seen.add(row['norad']);codes.add(row['prn'])
        return rows
    except (OSError,ValueError,KeyError,TypeError) as exc:
        raise OrbitUnavailableError(f'อ่าน {FILE} ไม่ได้: {exc}') from exc


def merged_registry(existing, imported, native_norads):
    rows={r['norad']:dict(r) for r in existing};used={r['prn'] for r in existing}
    skipped=[]
    for orbit in imported:
        if orbit.norad in native_norads:
            skipped.append(orbit.norad);continue
        old=rows.get(orbit.norad)
        if old and validate_tle(old['name'],old['tle']).epoch>orbit.epoch:continue
        code=old['prn'] if old else next((f'U{i:02d}' for i in range(1,100) if f'U{i:02d}' not in used),None)
        if code is None:raise ValueError('snapshot นี้มีดาวทั่วไปครบ 99 ดวงแล้ว')
        used.add(code)
        rows[orbit.norad]={'prn':code,'norad':orbit.norad,'name':orbit.name,'epoch':orbit.epoch.isoformat().replace('+00:00','Z'),
                           'tle':list(orbit.tle),'source':orbit.source}
    return {'version':1,'satellites':sorted(rows.values(),key=lambda r:r['prn'])},skipped


def selected(snapshot, norads):
    return any(row['norad'] in norads for row in read_registry(snapshot))


def extend_catalog(catalog: Catalog, snapshot: Path, period):
    rows=read_registry(snapshot)
    if not rows:return catalog
    # Known GNSS/imaging satellites keep their identity, health and navigation semantics.
    known={s.norad for s in catalog.satellites}
    midpoint=period[0]+(period[1]-period[0])/2
    satellites=[];messages=[]
    for row in rows:
        if row['norad'] in known:continue
        orbit=validate_tle(row['name'],row['tle'],row['source'])
        age=abs((midpoint-orbit.epoch).total_seconds())/86400
        flags=frozenset({'too_old'} if age>AGE_SHOWN_MAX_DAYS else {'stale'} if age>AGE_OK_DAYS else set())
        sat=CatalogSatellite(row['prn'],SYSTEM,'',orbit.norad,'User imported',orbit.name,orbit.epoch,age,flags,orbit.tle)
        satellites.append(sat)
        if flags:messages.append(_flagged_message(sat))
    ids={s.norad for s in satellites}
    return Catalog(catalog.satellites+satellites,[u for u in catalog.unmapped if u['norad'] not in ids],catalog.messages+messages)
