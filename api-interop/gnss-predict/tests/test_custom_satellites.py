import json
import shutil
import tempfile
import unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path

from gnss_predict import custom_satellites as c
from gnss_predict.analyze import aer_rows
from gnss_predict.catalog import build_catalog
from gnss_predict.dop import dop_series
from gnss_predict.errors import OrbitUnavailableError
from gnss_predict.imaging import scenario_catalog
from gnss_predict.omm import read_omm,to_tle_lines
from gnss_predict.propagate import Ephemeris
from gnss_predict.scenario import Facility

FX=Path(__file__).parent/'fixtures'
TEXT=(FX/'custom/iss.tle').read_text()
PERIOD=(datetime(2026,11,10,tzinfo=timezone.utc),datetime(2026,11,11,tzinfo=timezone.utc))


class CustomSatelliteTest(unittest.TestCase):
    def test_tle_checksum_and_identity(self):
        r=c.parse_import(TEXT,'tle')[0]
        self.assertEqual((r.norad,r.name),(25544,'ISS (ZARYA)'))
        with self.assertRaises(ValueError):c.parse_import(TEXT.replace('289.3631','289.3632'),'tle')
        with self.assertRaises(ValueError):c.parse_import('1 incomplete','tle')
        with self.assertRaises(ValueError):c.parse_import(TEXT+'\nSTRAY NAME','tle')

    def test_omm_and_alpha5(self):
        records=json.loads((FX/'studio/omm_sample.json').read_text())
        data=next(r for r in records if r['NORAD_CAT_ID']==100744)
        self.assertEqual(c.parse_import(json.dumps(data),'omm')[0].norad,100744)
        r=next(r for r in read_omm(FX/'studio/omm_sample.json') if r.norad==100744)
        self.assertEqual(c.parse_import('OBJECT\n'+'\n'.join(to_tle_lines(r)),'tle')[0].norad,100744)
        data['REF_FRAME']='EME2000'
        with self.assertRaises(ValueError):c.parse_import(json.dumps([data]),'omm')

    def test_import_limits_and_invalid_omm(self):
        data=json.loads((FX/'studio/omm_sample.json').read_text())[0]
        with self.assertRaises(ValueError):c.parse_import(json.dumps([{**data,'NORAD_CAT_ID':i} for i in range(1,c.MAX_SATELLITES+2)]),'omm')
        with self.assertRaises(ValueError):c.parse_import(json.dumps({**data,'MEAN_MOTION_DDOT':float('inf')}),'omm')
        with self.assertRaises(ValueError):c.parse_import('['*2000+']'*2000,'omm')
        with self.assertRaises(ValueError):c.parse_import('x'*(c.MAX_BYTES+1),'tle')

    def test_registry_codes_stable_and_native_not_replaced(self):
        r=c.parse_import(TEXT,'tle')[0]
        first,skipped=c.merged_registry([], [r],set())
        again,_=c.merged_registry(first['satellites'],[r],set())
        self.assertEqual(first,again);self.assertEqual(first['satellites'][0]['prn'],'U01')
        native,skipped=c.merged_registry([], [r],{25544})
        self.assertEqual(native['satellites'],[]);self.assertEqual(skipped,[25544])

    def test_catalog_extends_without_altering_gnss(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'snap';shutil.copytree(FX/'studio/snapshot',p)
            baseline=build_catalog(p,PERIOD,{'G','R','E','C'})
            doc,_=c.merged_registry([],c.parse_import(TEXT,'tle'),set())
            (p/c.FILE).write_text(json.dumps(doc))
            result=scenario_catalog(p,PERIOD,{'G','R','E','C'},False)
            self.assertEqual(result.satellites[:-1],baseline.satellites)
            self.assertEqual((result.satellites[-1].prn,result.satellites[-1].system),('U01','U'))
            self.assertNotIn('no_broadcast',result.satellites[-1].flags)
            (p/c.FILE).write_text('{}')
            with self.assertRaises(OrbitUnavailableError):c.read_registry(p)

    def test_custom_orbits_do_not_enter_dop_or_ipp(self):
        t=PERIOD[0];fac=Facility('Q',0.,0.,0.,0.)
        eph=Ephemeris([t],{'U01':[(6800.,0.,0.)]})
        rows=aer_rows(eph,fac,400.)
        self.assertEqual(len(rows),1);self.assertIsNone(rows[0].ipp_lat_deg);self.assertIsNone(rows[0].mf)
        result=dop_series(rows,fac,{},times_utc=eph.times_utc)
        self.assertTrue(all(row['n_visible']==0 and row['gdop'] is None for row in result))

    def test_all_999_codes_roundtrip_and_keep_existing_ids(self):
        data=json.loads((FX/'studio/omm_sample.json').read_text())[0]
        records=c.parse_import(json.dumps([{**data,'NORAD_CAT_ID':20000+i,'OBJECT_NAME':f'BULK {i}'} for i in range(c.MAX_SATELLITES)]),'omm')
        original,_=c.merged_registry([],records[:99],set())
        full,_=c.merged_registry(original['satellites'],records,set())
        by_id={r['norad']:r['prn'] for r in full['satellites']}
        self.assertEqual(len(by_id),999)
        self.assertEqual((by_id[20000],by_id[20098],by_id[20099]),('U01','U99','V01'))
        self.assertEqual({r['norad']:r['prn'] for r in original['satellites']},{n:by_id[n] for n in range(20000,20099)})
        self.assertTrue(all(len(code)==3 and code[0] not in 'GRECX' for code in by_id.values()))
        with tempfile.TemporaryDirectory() as temp:
            snapshot=Path(temp);(snapshot/c.FILE).write_text(json.dumps(full))
            self.assertEqual(c.read_registry(snapshot),full['satellites'])
        again,_=c.merged_registry(full['satellites'],list(reversed(records)),set())
        self.assertEqual(full,again)
        extra=c.parse_import(json.dumps({**data,'NORAD_CAT_ID':50000}),'omm')
        with self.assertRaises(ValueError):c.merged_registry(full['satellites'],extra,set())

    def test_gpredict_database_import_checks_identity_and_blank_exponent(self):
        lines=TEXT.splitlines()[1:]
        # A blank exponent sign represents positive; keep its checksum valid.
        a=lines[0][:50]+' '+lines[0][51:68]
        a+=str(sum(int(x) if x.isdigit() else 1 if x=='-' else 0 for x in a)%10)
        doc={'version':1,'satellites':{'25544':{'name':'ISS','tle':[a,lines[1]]}}}
        records=c.parse_import(json.dumps(doc),'gpredict')
        self.assertEqual(records[0].norad,25544)
        doc['satellites']['99999']=doc['satellites'].pop('25544')
        with self.assertRaises(ValueError):c.parse_import(json.dumps(doc),'gpredict')

    def test_999_identifiers_survive_sp3_and_1000_is_rejected(self):
        from gnss_predict.sp3 import write_sp3,read_sp3_all
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'predicted.sp3'
            positions={code:[(7000.,10.,20.)] for code in c.CODES}
            write_sp3([PERIOD[0]],positions,p)
            self.assertEqual(set(read_sp3_all(p)),set(c.CODES))
            before=p.read_bytes()
            with self.assertRaises(ValueError):write_sp3([PERIOD[0]],{**positions,'G01':[(20000.,0.,0.)]},p)
            self.assertEqual(p.read_bytes(),before)
