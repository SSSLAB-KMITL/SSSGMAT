"""Read a large, connected Gpredict catalog without importing every orbit at once."""
import json
from collections import Counter
from pathlib import Path

from gnss_predict.custom_satellites import MAX_SATELLITES

MAX_DATABASE_BYTES = 64 * 1024 * 1024


def read_database(folder):
    if folder is None:
        raise ValueError('ยังไม่ได้เชื่อม Gpredict ในเครื่อง: ตั้ง GNSS_STUDIO_GPREDICT_DATA หรือเลือกไฟล์ satdb.json')
    try:
        with (Path(folder) / 'satdb.json').open('rb') as stream:
            raw = stream.read(MAX_DATABASE_BYTES + 1)
        if len(raw) > MAX_DATABASE_BYTES:
            raise ValueError('ฐานข้อมูล Gpredict ที่เชื่อมไว้ต้องไม่เกิน 64 MB')
        doc = json.loads(raw.decode('utf-8'))
    except (OSError, UnicodeError, RecursionError) as exc:
        raise ValueError('อ่านฐานข้อมูล Gpredict ที่เชื่อมไว้ไม่ได้') from exc
    if not isinstance(doc, dict) or doc.get('version') != 1 or not isinstance(doc.get('satellites'), dict):
        raise ValueError('ฐานข้อมูล Gpredict มีรูปแบบไม่ถูกต้อง')
    if len(doc['satellites']) > 100000:
        raise ValueError('ฐานข้อมูล Gpredict มีดาวเกิน 100000 ดวง')
    for key, row in doc['satellites'].items():
        if not key.isascii() or not key.isdigit() or not isinstance(row, dict):
            raise ValueError('ฐานข้อมูล Gpredict มีรายการดาวที่ไม่ถูกต้อง')
        groups = row.get('groups', [])
        if not isinstance(groups, list) or not all(isinstance(g, str) and 0 < len(g) <= 80 for g in groups):
            raise ValueError(f'รายชื่อกลุ่ม Gpredict ของ NORAD {key} ไม่ถูกต้อง')
    return doc


def group_summary(folder):
    doc = read_database(folder)
    counts = Counter(g for row in doc['satellites'].values() for g in set(row.get('groups', [])))
    return {'total': len(doc['satellites']), 'max_per_snapshot': MAX_SATELLITES,
            'groups': [{'name': name, 'count': count} for name, count in sorted(counts.items())]}


def import_text(folder, group=None, batch=None, batch_size=MAX_SATELLITES):
    doc = read_database(folder)
    if group is not None and (not isinstance(group, str) or len(group) > 80):
        raise ValueError('กลุ่ม Gpredict ไม่ถูกต้อง')
    if type(batch_size) is not int or not 1 <= batch_size <= MAX_SATELLITES:
        raise ValueError(f'จำนวนดาวต่อชุดต้องเป็น 1–{MAX_SATELLITES}')
    if batch is not None and (type(batch) is not int or batch < 0):
        raise ValueError('หมายเลขชุดต้องเป็นจำนวนเต็มตั้งแต่ 0')
    selected = {key: row for key, row in doc['satellites'].items() if not group or group in row.get('groups', [])}
    if not selected:
        raise ValueError('ไม่พบดาวในกลุ่ม Gpredict ที่เลือก')
    if batch is None and len(selected) > MAX_SATELLITES:
        raise ValueError(f'Gpredict มี {len(selected)} ดวงในรายการนี้ ให้เลือกกลุ่มหรือแบ่งชุดไม่เกิน {MAX_SATELLITES} ดวง')
    if batch is not None:
        keys = sorted(selected, key=int)
        start = batch * batch_size
        if start >= len(keys):
            raise ValueError('หมายเลขชุดเกินจำนวนดาวในกลุ่ม กรุณาโหลดรายชื่อกลุ่มใหม่')
        selected = {key: selected[key] for key in keys[start:start + batch_size]}
    return json.dumps({'version': 1, 'satellites': selected}, ensure_ascii=False)
