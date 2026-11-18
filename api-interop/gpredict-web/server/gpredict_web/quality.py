"""Orbit freshness, scheduled refresh and independent reference comparisons.

A reference residual is diagnostic, never used as an empirical correction to TLEs.
Archived element sets are kept so hindsight cannot silently be called a forecast.
"""
import csv
import json
import math
import os
import signal
import tempfile
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from gnss_predict.geometry import ecef_to_aer, geodetic_to_ecef
from gnss_predict.propagate import (parse_ecef_report, render_ecef_script, write_tle_file)
from gnss_predict.run_gmat import find_gmat_console, run_script
from .ephem import SatSpec, tle_key
from .errors import ApiError
from .reference import References, parse_time, stamp
from .satdb import gmat_name
from .store import write_json_atomic

UTC = timezone.utc
MAX_COMPARE = 200
STEP = 300
DEFAULT_SETTINGS = {'enabled': True, 'interval_hours': 2, 'compare_after_update': True}


def load_json(path, default):
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, type(default)) else default
    except (OSError, ValueError):
        return default


def summary(values):
    if not values:
        return None
    values = sorted(values)
    return {'rms': math.sqrt(sum(v*v for v in values)/len(values)),
            'max': values[-1], 'p95': values[min(len(values)-1, math.ceil(len(values)*.95)-1)]}


def metrics(predicted, truth, times, qth=None):
    distances, azs, els = [], [], []
    q = geodetic_to_ecef(qth.lat_deg, qth.lon_deg, qth.alt_m) if qth else None
    for t, p in zip(times, predicted):
        r = truth(t)
        if r is None:
            continue
        distances.append(math.dist(p, r)*1000)
        if q is not None:
            a0, e0, _ = ecef_to_aer(p, q, qth.lat_deg, qth.lon_deg)
            a1, e1, _ = ecef_to_aer(r, q, qth.lat_deg, qth.lon_deg)
            if e1 >= 10:
                els.append(abs(e0-e1))
                if e1 < 80:
                    azs.append(abs((a0-a1+180) % 360 - 180))
    return {'samples': len(distances), 'visible_samples': len(els), 'position_m': summary(distances),
            'az_deg': summary(azs), 'el_deg': summary(els)}


class QualityService:
    def __init__(self, cfg, store, satdb, update, now, opener, publish=lambda event: None, references=None):
        self.cfg, self.store, self.satdb, self.update, self.now = cfg, store, satdb, update, now
        self.root = cfg.data_dir / 'quality'
        self.refs = references or References(self.root / 'references', opener)
        self.publish = publish
        self.lock = threading.RLock()
        self.archive = load_json(self.root / 'orbits.json', {})
        self.settings = {**DEFAULT_SETTINGS, **load_json(self.root / 'settings.json', {})}
        self.report = load_json(self.root / 'latest.json', {})
        self.job = load_json(self.root / 'job.json', {})
        if self.job.get('state') == 'running':
            self.job.update(state='interrupted', error='server หยุดก่อนงานเสร็จ กรุณาสั่งตรวจใหม่')
        self.refresh_attempt_at = self.job.get("refresh_attempt_at")
        self.thread = None
        self.closing = False
        self.pgid = None

    def records(self):
        return self.satdb.search(limit=1_000_000)

    def remember(self, records=None):
        """Archive the elements actually ingested by this app, before and after updates."""
        now = stamp(self.now())
        with self.lock:
            for r in self.records() if records is None else records:
                rows = self.archive.setdefault(str(r.norad), [])
                key = tle_key(r.tle_lines)
                if not any(row['key'] == key for row in rows):
                    rows.append({'key': key, 'tle': list(r.tle_lines), 'epoch': stamp(r.epoch), 'captured_at': now})
                    del rows[:-32]
            write_json_atomic(self.root / 'orbits.json', self.archive)

    def configure(self, body):
        if set(body) - set(DEFAULT_SETTINGS):
            raise ApiError('QUALITY_INVALID', 422, 'ค่าตั้งคุณภาพวงโคจรมีช่องที่ไม่รู้จัก')
        for key, value in body.items():
            if key == 'interval_hours':
                if isinstance(value, bool) or not isinstance(value, int) or not 2 <= value <= 168:
                    raise ApiError('QUALITY_INVALID', 422, 'รอบอัปเดตต้องเป็นจำนวนเต็ม 2–168 ชั่วโมง')
            elif not isinstance(value, bool):
                raise ApiError('QUALITY_INVALID', 422, f'{key} ต้องเป็น true หรือ false')
        with self.lock:
            merged = {**self.settings, **body}
            write_json_atomic(self.root / 'settings.json', merged)
            self.settings = merged
        return self.status()

    def selected(self, module=None):
        names = [module] if module else self.store.session()
        ids = set()
        for name in names:
            m = self.store.get_module(name)
            ids.update(m.satellites)
        return sorted((r for r in self.records() if r.norad in ids), key=lambda r: r.norad)

    def status(self):
        now = self.now()
        with self.lock:
            rows = []
            for r in self.records():
                age = (now-r.epoch).total_seconds()/3600
                rows.append({'norad': r.norad, 'name': r.name, 'epoch': stamp(r.epoch), 'ingested_at': stamp(r.updated),
                             'tle_key': tle_key(r.tle_lines), 'age_hours': round(age, 2), 'freshness': 'future' if age < -24 else
                             'fresh' if age <= 48 else 'aging' if age <= 168 else 'stale'})
            last = self.refresh_attempt_at
            next_at = stamp(parse_time(last)+timedelta(hours=self.settings['interval_hours'])) if last and self.settings['enabled'] else None
            return {'settings': dict(self.settings), 'job': dict(self.job), 'next_update_at': next_at,
                    'server_time': stamp(now), 'satellites': rows, 'report': self.report,
                    'summary': {'total': len(rows), 'older_than_48h': sum(r['age_hours']>48 for r in rows),
                                'older_than_7d': sum(r['age_hours']>168 for r in rows)}}

    def due(self):
        with self.lock:
            if not self.settings['enabled'] or self.closing or self.job.get('state') == 'running':
                return False
            last = self.refresh_attempt_at
            return last is None or (self.now()-parse_time(last)).total_seconds() >= self.settings['interval_hours']*3600

    def start(self, action='cycle', module=None):
        if action not in ('refresh', 'compare', 'cycle'):
            raise ApiError('QUALITY_INVALID', 422, 'action ต้องเป็น refresh, compare หรือ cycle')
        if module is not None:
            self.store.get_module(module)  # Validate before spawning any work.
        with self.lock:
            if self.closing or self.job.get('state') == 'running':
                raise ApiError('QUALITY_RUNNING', 409, 'มีงานอัปเดตหรือตรวจเทียบกำลังทำอยู่')
            if action != 'compare':
                self.refresh_attempt_at = stamp(self.now())
            self.job = {'refresh_attempt_at': self.refresh_attempt_at, 'id': uuid.uuid4().hex[:12], 'state': 'running', 'action': action,
                        'started_at': stamp(self.now()), 'finished_at': None, 'error': None, 'stage': 'starting'}
            write_json_atomic(self.root / 'job.json', self.job)
            self.thread = threading.Thread(target=self._run, args=(action, module), daemon=True, name='orbit-quality')
            self.thread.start()
            return dict(self.job)

    def stage(self, stage):
        with self.lock:
            self.job['stage'] = stage

    def _run(self, action, module):
        try:
            self.remember()
            refresh = None
            if action in ('refresh', 'cycle'):
                self.stage('updating')
                refresh = self.update()
                self.remember()
                if refresh.get('error'):
                    raise ValueError(refresh['error'])
            if action == 'compare' or (action == 'cycle' and self.settings['compare_after_update']):
                self.stage('comparing')
                report = self.compare(module)
            else:
                report = dict(self.report)
            report['refresh'] = refresh if refresh is not None else self.report.get('refresh')
            if refresh is None and self.report.get('refresh_checked_at'):
                report['refresh_checked_at'] = self.report['refresh_checked_at']
            if refresh is not None:
                report['refresh_checked_at'] = stamp(self.now())
            with self.lock:
                self.report = report
                write_json_atomic(self.root / 'latest.json', report)
                self.job.update(state='succeeded', stage='done')
        except Exception as exc:
            with self.lock:
                self.job.update(state='failed', error=str(exc), stage='failed')
        finally:
            with self.lock:
                self.job['finished_at'] = stamp(self.now())
                write_json_atomic(self.root / 'job.json', self.job)
            self.publish({'type': 'quality_changed'})

    def _on_start(self, pgid):
        with self.lock:
            if self.closing:
                raise RuntimeError('งานถูกยกเลิกเพราะ server กำลังปิด')
            self.pgid = pgid

    def propagate(self, specs, start, stop, iss_j2k=False):
        """Run GMAT with its standard EarthFixed report and optional EME2000 ISS columns."""
        if self.closing:
            raise RuntimeError('server กำลังปิด')
        with tempfile.TemporaryDirectory(prefix='quality-', dir=self.root) as work:
            work = Path(work)
            tle, report, script = work/'all.tle', work/'report.csv', work/'run.script'
            write_tle_file(specs, tle)
            text = render_ecef_script(specs, tle, start, stop, STEP, report)
            if iss_j2k:
                extra = ', '.join(f'S25544.EarthMJ2000Eq.{a}' for a in 'XYZ')
                text = '\n'.join(line.replace('};', ', '+extra+'};') if line.startswith('RF.Add =') else line
                                 for line in text.splitlines())+'\n'
            script.write_text(text)
            try:
                run_script(find_gmat_console(), script, work/'gmat.log', timeout_s=600, on_start=self._on_start)
            finally:
                with self.lock:
                    self.pgid = None
            eph, messages = parse_ecef_report(report, [s.prn for s in specs], start, stop, STEP)
            inertial = None
            if iss_j2k:
                with report.open() as f:
                    rows = list(csv.DictReader(f))
                inertial = [tuple(float(row[f'S25544.EarthMJ2000Eq.{a}']) for a in 'XYZ') for row in rows]
            return eph, inertial, [m.text for m in messages]

    def compare(self, module=None):
        records = self.selected(module)
        self.remember(records)
        with self.lock:
            archives = {str(r.norad): [dict(a) for a in self.archive[str(r.norad)]] for r in records}
        chosen = records[:MAX_COMPARE]
        now = self.now()
        start = now.replace(minute=0, second=0, microsecond=0)
        stop = start+timedelta(days=1)
        day = (now-timedelta(days=2)).date()
        rows, warnings = [], []
        self.refs.warnings = []
        try:
            metadata, gnss = self.refs.gnss(day, now) if any(set(r.groups)&{'gps-ops','galileo','glo-ops','beidou'} for r in chosen) else (None, {})
        except Exception as exc:
            metadata, gnss = None, {}
            warnings.append(f'วงโคจร GNSS อ้างอิงยังไม่พร้อม: {exc}')
        try:
            iss = self.refs.iss(now) if any(r.norad == 25544 for r in chosen) else None
        except Exception as exc:
            iss = None
            warnings.append(f'NASA ISS OEM ยังไม่พร้อม: {exc}')
        # Element changes compare at identical UTC epochs using the same GMAT model.
        specs, old_by_id = [], {}
        for r in chosen:
            archive = archives.get(str(r.norad), [])
            previous = next((a for a in reversed(archive) if a['key'] != tle_key(r.tle_lines)), None)
            if previous:
                specs.extend([SatSpec(r.norad, gmat_name(r.norad), r.tle_lines),
                              SatSpec(r.norad, 'O'+gmat_name(r.norad), tuple(previous['tle']))])
                old_by_id[r.norad] = previous
        if iss and not any(s.norad == 25544 and s.prn == 'S25544' for s in specs):
            r = next(r for r in chosen if r.norad == 25544)
            specs.append(SatSpec(25544, 'S25544', r.tle_lines))
        eph = inertial = None
        if specs:
            eph, inertial, m = self.propagate(specs, start, stop, iss_j2k=bool(iss))
            warnings.extend(m)
        # Freeze historical elements for the observed SP3 day; identity is resolved at each epoch.
        historical, histories = [], {}
        hist_start = datetime.combine(day, datetime.min.time(), tzinfo=UTC)
        for r in chosen:
            if metadata is None or metadata.identity_at(r.norad, hist_start+timedelta(hours=12)) is None:
                continue
            archive = archives[str(r.norad)]
            preceding = [a for a in archive if parse_time(a['captured_at']) <= hist_start and parse_time(a['epoch']) <= hist_start]
            a = max(preceding, key=lambda a: a['captured_at']) if preceding else min(archive, key=lambda a: abs((parse_time(a['epoch'])-(hist_start+timedelta(hours=12))).total_seconds()))
            histories[r.norad] = {**a, 'mode': 'forecast' if preceding else 'hindcast'}
            historical.append(SatSpec(r.norad, gmat_name(r.norad), tuple(a['tle'])))
        hist = None
        if historical and gnss:
            hist, _, m = self.propagate(historical, hist_start, hist_start+timedelta(days=1))
            warnings.extend(m)
        qth = None
        # One facility is labelled explicitly; no silent use of a browser's location.
        if module:
            m = self.store.get_module(module)
            name = m.qth or self.store.default_qth()
        else:
            name = self.store.default_qth()
        if name:
            qth = self.store.get_qth(name)
        for r in chosen:
            row = {'norad': r.norad, 'name': r.name, 'tle_epoch': stamp(r.epoch), 'reference': None,
                   'tle_key': tle_key(r.tle_lines), 'status': 'unverified', 'change': None, 'metrics': None, 'note': 'ยังไม่มีวงโคจรอ้างอิงสำหรับดาวดวงนี้'}
            key = gmat_name(r.norad)
            if r.norad in old_by_id and eph and key in eph.positions_km and 'O'+key in eph.positions_km:
                old = dict(zip(eph.times_utc, eph.positions_km['O'+key]))
                row['change'] = {**metrics(eph.positions_km[key], old.get, eph.times_utc, qth),
                                 'previous_epoch': old_by_id[r.norad]['epoch'], 'kind': 'element_change',
                                 'start': stamp(start), 'stop': stamp(stop)}
            track, positions, times = None, None, None
            if r.norad == 25544 and iss and inertial:
                track, positions, times = iss, inertial, eph.times_utc
                row.update(mode='operator_prediction_comparison', note='NASA OEM เป็นวงโคจรประมาณการจากผู้ควบคุม ไม่ใช่ telemetry ที่วัดสด')
            elif hist and key in hist.positions_km:
                ident = metadata.identity_at(r.norad, hist_start+timedelta(hours=12))
                track = gnss.get(ident.prn)
                if track:
                    positions, times = hist.positions_km[key], hist.times_utc
                    row.update(mode=histories[r.norad]['mode'], compared_tle_epoch=histories[r.norad]['epoch'],
                               note='ตรวจย้อนหลังกับ observed SP3; hindcast หมายถึงยังไม่มี TLE ที่บันทึกไว้ก่อนวันตรวจ')
            if track and positions is not None:
                if r.norad == 25544:
                    truth = track.at
                else:
                    # Handle PRN reassignments; never compare a different spacecraft's orbit.
                    def truth(t, norad=r.norad):
                        identity = metadata.identity_at(norad, t)
                        other = gnss.get(identity.prn) if identity else None
                        return other.at(t) if other else None
                row['metrics'] = metrics(positions, truth, times, qth if track.frame == 'ITRF' else None)
                row['status'] = 'compared' if row['metrics']['samples'] >= 20 else 'insufficient_data'
                row['reference'] = {'source': track.source, 'url': track.url, 'kind': track.kind,
                                    'frame': track.frame, 'created_at': track.created,
                                    'start': stamp(track.times[0]), 'stop': stamp(track.times[-1])}
            rows.append(row)
        return {'checked_at': stamp(now), 'module': module, 'qth': name, 'gnss_day': str(day),
                'step_seconds': STEP, 'selected_count': len(records), 'omitted_count': max(0,len(records)-MAX_COMPARE),
                'rows': rows, 'warnings': warnings+self.refs.warnings,
                'note': 'ความต่าง TLE เก่า/ใหม่ไม่ใช่ค่าความคลาดจริง การตรวจเทียบไม่ได้ปรับแก้ TLE โดยอัตโนมัติ'}

    def close(self):
        with self.lock:
            self.closing = True
            if self.pgid:
                try:
                    os.killpg(self.pgid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            thread = self.thread
        if thread:
            thread.join()
