"""Quality checks must preserve provenance and never turn missing reference data into success."""
import gzip
import json
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from gpredict_web.app import create_app
from gpredict_web.module import module_from_dict
from gpredict_web.quality import QualityService, metrics
from gpredict_web.reference import References, Track, read_oem, read_observed_sp3
from gpredict_web.satdb import SatDb
from gpredict_web.store import Qth, Store
from gpredict_web.tletext import parse_tle_text
from gnss_predict.propagate import Ephemeris
from gnss_predict.sp3 import write_sp3
from tests.helpers import temp_config, TEST_HOSTS
from tests.test_bootstrap import OMM_SAMPLE
from tests.test_tletext import line1, line2

UTC = timezone.utc
DAY = datetime(2026, 11, 11, tzinfo=UTC)
NOW = DAY + timedelta(days=2)


class ReferencesTest(unittest.TestCase):
    def test_sp3_gps_time_is_converted_once_and_predicted_points_removed(self):
        cfg = temp_config(); cfg.data_dir.mkdir(parents=True); p = cfg.data_dir/'ref.sp3'
        times = [DAY+timedelta(minutes=15*i) for i in range(12)]
        write_sp3(times, {'G01': [(20000., 10., 30.)]*12}, p)
        lines = p.read_text().splitlines()
        i = next(i for i,l in enumerate(lines) if l.startswith('PG01'))
        lines[i] = lines[i][:79].ljust(79)+'P'
        p.write_text('\n'.join(lines)+'\n')
        track = read_observed_sp3(p)['G01']
        self.assertNotIn(DAY, track.positions)
        self.assertEqual(track.at(times[1]), (20000.,10.,30.))
        self.assertIsNone(track.at(DAY-timedelta(minutes=1)))
        self.assertEqual(track.kind,'observed_sp3')

    def test_oem_refuses_wrong_frame_and_labels_operator_prediction(self):
        cfg=temp_config(); cfg.data_dir.mkdir(parents=True); p=cfg.data_dir/'oem.txt'
        header = 'REF_FRAME = EME2000\nTIME_SYSTEM = UTC\nCENTER_NAME = Earth\nOBJECT_ID = 1998-067-A\nSTART_TIME = 2026-11-11T00:00:00\nSTOP_TIME = 2026-11-12T00:00:00\n'
        p.write_text(header+'\n'.join(f'{(DAY+timedelta(minutes=i)).isoformat()} 6700 0 1 0 7 0' for i in range(12)))
        track=read_oem(p)
        self.assertEqual(track.kind,'operator_ephemeris')
        self.assertIsNone(track.at(DAY-timedelta(seconds=1)))
        p.write_text(p.read_text().replace('EME2000','TEME'))
        with self.assertRaises(ValueError):read_oem(p)

    def test_failed_download_keeps_good_file_and_is_throttled(self):
        cfg=temp_config();calls=[]
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return b'not a valid orbit'
        def opener(*args,**kwargs):calls.append(1);return Response()
        refs=References(cfg.data_dir/'refs',opener)
        refs.root.mkdir(parents=True);p=refs.root/'ref.txt';p.write_text('good')
        def validate(path):
            if path.read_text()!='good':raise ValueError('invalid')
        self.assertEqual(refs.fetch('ref.txt','https://example.test/ref',NOW,validate),p)
        self.assertEqual(p.read_text(),'good')
        refs.fetch('ref.txt','https://example.test/ref',NOW+timedelta(minutes=1),validate)
        self.assertEqual(len(calls),1)
        self.assertTrue(refs.warnings)

    def test_alpha5_imports_keep_distinct_real_catalogue_numbers(self):
        text='\n'.join([line1('A0744'),line2('A0744'),line1('Z9999'),line2('Z9999')])+'\n'
        self.assertEqual([r.norad for r in parse_tle_text(text)],[100744,339999])


class QualityTest(unittest.TestCase):
    def setUp(self):
        self.cfg=temp_config();self.store=Store(self.cfg.data_dir);self.db=SatDb(self.cfg.data_dir/'satdb.json')
        self.db.apply_groups({'gps-ops':OMM_SAMPLE},NOW);self.db.save()
        self.store.put_qth(Qth('Q',lat_deg=0.,lon_deg=0.,alt_m=0.));self.store.set_default_qth('Q')
        module=module_from_dict({'name':'test','qth':'Q','satellites':[62339]}, {'Q'}, self.db.norads())
        self.store.put_module(module);self.store.set_session(['test'])
        class Refs:
            warnings=[]
            def gnss(self,day,now):
                identity=SimpleNamespace(identity_at=lambda norad,t:SimpleNamespace(prn='G01') if norad==62339 else None)
                series={DAY+timedelta(seconds=i*300):(20000.,0.,0.) for i in range(289)}
                return identity,{'G01':Track(series,'independent.sp3','https://example.test/sp3','observed_sp3','ITRF')}
        self.service=QualityService(self.cfg,self.store,self.db,lambda:{'updated':0},lambda:NOW,None,references=Refs())
        self.addCleanup(self.service.close)
        def propagate(specs,start,stop,iss_j2k=False):
            times=[start+timedelta(seconds=i*300) for i in range(289)]
            return Ephemeris(times,{s.prn:[(20001.,0.,0.)]*len(times) for s in specs}),None,[]
        self.service.propagate=propagate

    def test_independent_reference_residual_and_hindcast_are_reported(self):
        report=self.service.compare('test');row=report['rows'][0]
        self.assertEqual(row['status'],'compared');self.assertEqual(row['mode'],'hindcast')
        self.assertEqual(row['metrics']['position_m']['rms'],1000.)
        self.assertEqual(row['metrics']['samples'],289)
        self.assertEqual(row['reference']['kind'],'observed_sp3')
        self.assertIsNone(row['change'])

    def test_only_previously_captured_elements_are_called_forecast(self):
        self.service.remember()
        a=self.service.archive['62339'][0]
        a.update(captured_at='2026-11-10T00:00:00Z',epoch='2026-11-10T00:00:00Z')
        self.assertEqual(self.service.compare('test')['rows'][0]['mode'],'forecast')

    def test_missing_truth_is_unverified_not_zero_error(self):
        self.service.refs.gnss=lambda *args: (_ for _ in ()).throw(ValueError('not published'))
        report=self.service.compare('test')
        self.assertEqual(report['rows'][0]['status'],'unverified')
        self.assertIsNone(report['rows'][0]['metrics'])
        self.assertIn('not published',report['warnings'][0])

    def test_archive_deduplicates_and_retains_original_capture_time(self):
        self.service.remember();self.service.remember()
        self.assertEqual(len(self.service.archive['62339']),1)
        original=self.service.archive['62339'][0]['captured_at']
        self.service.now=lambda:NOW+timedelta(days=1);self.service.remember()
        self.assertEqual(self.service.archive['62339'][0]['captured_at'],original)

    def test_scheduled_refresh_and_overlap_and_restart(self):
        self.assertTrue(self.service.due())
        release=threading.Event();entered=threading.Event()
        def update():entered.set();release.wait(3);return {'updated':1}
        self.service.update=update;self.service.configure({'compare_after_update':False})
        self.service.start('refresh');self.assertTrue(entered.wait(2))
        self.assertFalse(self.service.due())
        from gpredict_web.errors import ApiError
        with self.assertRaises(ApiError):self.service.start('compare')
        release.set();self.service.thread.join(3)
        self.assertEqual(self.service.job['state'],'succeeded');self.assertFalse(self.service.due())
        new=QualityService(self.cfg,self.store,self.db,update,lambda:NOW,None)
        self.addCleanup(new.close);self.assertFalse(new.due())
        new.now=lambda:NOW+timedelta(hours=2);self.assertTrue(new.due())
        new.configure({'enabled':False});self.assertFalse(new.due())

    def test_compare_preserves_refresh_result_and_does_not_postpone_refresh(self):
        self.service.report = {'refresh': {'updated': 3}, 'refresh_checked_at': '2026-11-12T00:00:00Z'}
        self.service.start('compare', 'test')
        self.service.thread.join(3)
        self.assertEqual(self.service.job['state'], 'succeeded')
        self.assertEqual(self.service.report['refresh']['updated'], 3)
        self.assertEqual(self.service.report['refresh_checked_at'], '2026-11-12T00:00:00Z')
        self.assertTrue(self.service.due())

    def test_invalid_settings_do_not_partially_write(self):
        from gpredict_web.errors import ApiError
        with self.assertRaises(ApiError):self.service.configure({'enabled':False,'interval_hours':1})
        self.assertTrue(self.service.settings['enabled'])

    def test_api_settings_status_and_invalid_run(self):
        app=create_app(self.cfg,start_background=False,allowed_hosts=TEST_HOSTS)
        with TestClient(app) as client:
            self.assertEqual(client.get('/api/quality').status_code,200)
            r=client.put('/api/quality/settings',json={'enabled':False,'interval_hours':6})
            self.assertFalse(r.json()['settings']['enabled'])
            self.assertEqual(client.post('/api/quality/run',json={'action':'bad'}).status_code,422)
            self.assertEqual(client.post('/api/quality/run',json={'module':22}).status_code,422)

    def test_missing_reference_samples_are_not_counted_as_zero(self):
        result=metrics([(1.,2.,3.)]*2,lambda t:None,[DAY,DAY+timedelta(seconds=1)])
        self.assertEqual(result['samples'],0);self.assertIsNone(result['position_m'])
