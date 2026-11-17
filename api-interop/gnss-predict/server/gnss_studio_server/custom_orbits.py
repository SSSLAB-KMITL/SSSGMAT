"""Import into a new snapshot and scenario without modifying the original source."""
import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

from gnss_predict import custom_satellites as custom
from gnss_predict.config import CELESTRAK_STATE_FILE
from gnss_predict.omm import fetch_group
from gnss_predict.sp3 import MAX_SATELLITES as MAX_SCENARIO_SATELLITES
from . import gpredict_catalog, objects, templates
from .errors import ApiError

_LOOKUP_LOCK = threading.Lock()


def import_objects(doc, body, data_dir, opener=None, now=None, gpredict_data=None):
    allowed = {'class', 'method', 'format', 'text', 'norad', 'group', 'batch', 'batch_size', 'replace_unselected', 'add_to_scenario'}
    if set(body) - allowed:
        raise ApiError(422, 'ORBIT_IMPORT_INVALID', 'มีช่องนำเข้าที่ไม่รู้จัก')
    now = now or datetime.now(timezone.utc)
    import_format = body.get('format')
    add_to_scenario = body.get('add_to_scenario', True)
    replace_unselected = body.get('replace_unselected', False)
    source = Path(data_dir) / templates.ORBITS_DIR / templates.resolve_snapshot(data_dir, doc['orbit_snapshot'])
    try:
        if type(add_to_scenario) is not bool or type(replace_unselected) is not bool:
            raise ValueError('add_to_scenario และ replace_unselected ต้องเป็น true หรือ false')
        if import_format in ('norad', 'group'):
            if import_format == 'norad':
                norad = body.get('norad')
                if type(norad) is not int or not 1 <= norad <= 339999:
                    raise ValueError('NORAD ต้องเป็นจำนวนเต็ม 1–339999')
                key, query = f'catnr-{norad}', f'CATNR={norad}'
            else:
                key = body.get('group')
                if not isinstance(key, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,39}', key):
                    raise ValueError('ชื่อกลุ่ม CelesTrak ต้องเป็น a-z, 0-9 หรือ - ยาวไม่เกิน 40 ตัว')
                query = f'GROUP={key}'
            cache = Path(data_dir) / templates.ORBITS_DIR / '_cache'
            kw = {'opener': opener} if opener is not None else {}
            with _LOOKUP_LOCK:
                path, _messages = fetch_group(key, cache, cache / CELESTRAK_STATE_FILE, now,
                    url=f'https://celestrak.org/NORAD/elements/gp.php?{query}&FORMAT=json', **kw)
            records = custom.parse_import(path.read_text(), 'omm', 'celestrak_catalog' if import_format == 'norad' else f'celestrak_group:{key}')
            if import_format == 'norad' and (len(records) != 1 or records[0].norad != norad):
                raise ValueError('แหล่งข้อมูลตอบกลับ NORAD ไม่ตรงกับที่ขอ')
        elif import_format == 'gpredict_local':
            text = gpredict_catalog.import_text(gpredict_data, body.get('group'), body.get('batch'), body.get('batch_size', custom.MAX_SATELLITES))
            records = custom.parse_import(text, 'gpredict')
        else:
            records = custom.parse_import(body.get('text'), import_format)
        present = {o['norad'] for o in doc['objects'] if o['class'] == 'Satellite'}
        if add_to_scenario and len(present | {r.norad for r in records}) > MAX_SCENARIO_SATELLITES:
            raise ValueError(f'Scenario รองรับสูงสุด {MAX_SCENARIO_SATELLITES} ดวง เลือกนำเข้าเฉพาะ Catalog แล้วเลือกดาวที่ต้องการ')
        period = doc['analysis_period']
        catalog = templates.load_catalog(data_dir, doc['orbit_snapshot'],
            templates.parse_utc(period['start'], 'start'), templates.parse_utc(period['stop'], 'stop'))
        native = {s.norad for s in catalog.satellites if s.system != 'U'}
        existing_rows = custom.read_registry(source)
        if replace_unselected:
            keep = present | {r.norad for r in records}
            existing_rows = [r for r in existing_rows if r['norad'] in keep]
        payload, _skipped = custom.merged_registry(existing_rows, records, native)
    except ValueError as exc:
        field = {'norad': 'norad', 'group': 'group', 'gpredict_local': 'format'}.get(import_format, 'text')
        raise ApiError(422, 'ORBIT_IMPORT_INVALID', str(exc), field) from exc
    raw = (json.dumps(payload, ensure_ascii=False, indent=2) + '\n').encode()
    existing = source / custom.FILE
    # Re-importing identical elements reuses the immutable snapshot.
    if payload['satellites'] and (not existing.is_file() or existing.read_bytes() != raw):
        digest = hashlib.sha256(doc['orbit_snapshot'].encode() + raw).hexdigest()[:8]
        name = now.astimezone(timezone.utc).strftime('%Y%m%dT%H%MZ') + '_' + digest
        final = source.parent / name
        if final.exists():
            if (final / custom.FILE).read_bytes() != raw:
                raise ApiError(409, 'SNAPSHOT_CONFLICT', 'ชื่อ snapshot ซ้ำกับข้อมูลอีกชุด')
        else:
            with tempfile.TemporaryDirectory(prefix='_import-', dir=source.parent) as work:
                stage = Path(work) / 'snapshot'
                shutil.copytree(source, stage)
                (stage / custom.FILE).write_bytes(raw)
                files = sorted(p for p in stage.rglob('*') if p.is_file() and p.name != 'SHA256SUMS')
                (stage / 'SHA256SUMS').write_text(''.join(
                    f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(stage).as_posix()}\n' for p in files))
                try:
                    os.rename(stage, final)
                except OSError:
                    if not final.is_dir() or (final / custom.FILE).read_bytes() != raw:
                        raise
        doc['orbit_snapshot'] = name
    if not add_to_scenario:
        return []
    names = {o['name'].casefold() for o in doc['objects']}
    created = []
    for rec in records:
        if rec.norad in present:
            continue
        base = re.sub(r'[^A-Za-z0-9_-]', '_', rec.name).strip('_')[:32] or f'Sat_{rec.norad}'
        name = base
        for i in range(2, len(names) + 3):
            if name.casefold() not in names:
                break
            suffix = f'_{i}'
            name = base[:32-len(suffix)] + suffix
        created.extend(objects.insert(doc, {'class': 'Satellite', 'method': objects.METHOD_DEFINE,
                                           'name': name, 'norad': rec.norad}, lambda: catalog))
        names.add(name.casefold())
        present.add(rec.norad)
    return created
