import json
import hashlib
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch

import pytest
from gnss_predict import custom_satellites as custom
from gnss_predict.studio import plan_propagate,run_propagate,run_analyze
from gnss_predict.run_gmat import find_gmat_console
from gnss_predict.errors import GmatNotFoundError
from gnss_studio_server.templates import snapshot_time

FX=Path(__file__).resolve().parents[2]/'tests/fixtures'
TEXT=(FX/'custom/iss.tle').read_text()


def import_iss(client,tag,**extra):
    return client.post('/api/scenarios/S1/objects',json={'class':'Satellite','method':'Import Orbits','format':'tle','text':TEXT,**extra},headers={'If-Match':tag})


def test_import_creates_immutable_snapshot_and_is_repeatable(client,s_empty,snapshot,data_dir):
    before={str(p.relative_to(snapshot)):hashlib.sha256(p.read_bytes()).hexdigest() for p in snapshot.rglob('*') if p.is_file()}
    _,tag=s_empty
    r=import_iss(client,tag);assert r.status_code==201,r.text
    assert len(r.json()['created'])==1
    doc=client.get('/api/scenarios/S1').json()
    assert doc['orbit_snapshot']!=snapshot.name
    assert snapshot_time(doc['orbit_snapshot']) is not None
    new=data_dir/'orbits'/doc['orbit_snapshot']
    assert (new/custom.FILE).is_file()
    assert before=={str(p.relative_to(snapshot)):hashlib.sha256(p.read_bytes()).hexdigest() for p in snapshot.rglob('*') if p.is_file()}
    rows=client.get('/api/catalog',params={'snapshot':doc['orbit_snapshot'],'start':doc['analysis_period']['start'],'stop':doc['analysis_period']['stop'],'system':'U'}).json()
    assert len(rows)==1 and rows[0]['category']=='custom' and rows[0]['norad']==25544
    plan=plan_propagate(data_dir/'scenarios/S1',data_dir)
    assert plan.satellites==['U01']
    r2=import_iss(client,r.headers['etag']);assert r2.status_code==201,r2.text
    assert r2.json()['created']==[]
    assert client.get('/api/scenarios/S1').json()['orbit_snapshot']==doc['orbit_snapshot']
    sums=dict(line.split('  ',1)[::-1] for line in (new/'SHA256SUMS').read_text().splitlines())
    assert custom.FILE in sums
    assert all(hashlib.sha256((new/name).read_bytes()).hexdigest()==digest for name,digest in sums.items())


def test_invalid_import_and_stale_etag_are_atomic(client,s_empty,snapshot,data_dir):
    _,tag=s_empty
    before=client.get('/api/scenarios/S1').json()
    folders=set((data_dir/'orbits').iterdir())
    bad=import_iss(client,tag,text='invalid')
    assert bad.status_code==422
    assert client.get('/api/scenarios/S1').json()==before
    assert set((data_dir/'orbits').iterdir())==folders
    stale=import_iss(client,'"wrong"')
    assert stale.status_code==412
    assert set((data_dir/'orbits').iterdir())==folders


def test_gnss_only_plan_unchanged_by_imported_snapshot(client,s1,snapshot,data_dir):
    _,tag=s1
    sc=data_dir/'scenarios/S1'
    before=plan_propagate(sc,data_dir)
    r=import_iss(client,tag);assert r.status_code==201,r.text
    assert 'U01' in plan_propagate(sc,data_dir).satellites
    doc=client.get('/api/scenarios/S1').json()
    doc['objects']=[o for o in doc['objects'] if o.get('norad')!=25544]
    saved=client.put('/api/scenarios/S1',json=doc,headers={'If-Match':r.headers['etag']})
    assert saved.status_code==200,saved.text
    after=plan_propagate(sc,data_dir)
    assert before.hash==after.hash and before.satellites==after.satellites


def test_norad_lookup_uses_omm_and_existing_throttle(client,s_empty,snapshot,data_dir):
    from gnss_predict import omm
    raw=json.loads((FX/'studio/omm_sample.json').read_text())[0]
    raw.update(NORAD_CAT_ID=25544,OBJECT_NAME='ISS',OBJECT_ID='1998-067A',EPOCH='2026-11-09T12:00:00')
    requests=[]
    class Response:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def read(self,size=-1):return json.dumps([raw]).encode()[:size]
    def opener(request,**kw):requests.append(request.full_url);return Response()
    _,tag=s_empty
    from gnss_studio_server import custom_orbits
    original=custom_orbits.fetch_group
    def fetched(*args,**kw):return original(*args,**kw,opener=opener)
    body={'class':'Satellite','method':'Import Orbits','format':'norad','norad':25544}
    with patch.object(custom_orbits,'fetch_group',side_effect=fetched):
        r=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':tag});assert r.status_code==201,r.text
        r2=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':r.headers['etag']});assert r2.status_code==201,r2.text
    assert len(requests)==1 and 'CATNR=25544&FORMAT=json' in requests[0]


def test_real_gmat_propagates_imported_satellite(client,s_empty,snapshot,data_dir):
    try:console=find_gmat_console()
    except GmatNotFoundError:pytest.skip('GMAT not built')
    _,tag=s_empty
    r=import_iss(client,tag);assert r.status_code==201,r.text
    sc=data_dir/'scenarios/S1'
    out,messages=run_propagate(sc,data_dir,console)
    doc=json.loads((out/'manifest.json').read_text())
    assert any(s['prn']=='U01' and s['norad']==25544 and s['propagated'] for s in doc['satellites'])
    assert 'sat/U01' in (out/'scene.czml').read_text()


def bulk_database(count=906):
    from gnss_predict.omm import _parse_records,to_tle_lines
    template=json.loads((FX/'studio/omm_sample.json').read_text())[0]
    omm=[{**template,'NORAD_CAT_ID':20000+i,'OBJECT_NAME':f'BULK_{i}'} for i in range(count)]
    records=_parse_records(json.dumps(omm))
    return {'version':1,'satellites':{str(r.norad):{'name':r.name,'tle':list(to_tle_lines(r))} for r in records}}


def test_local_gpredict_906_import_is_read_only_and_repeatable(client,s_empty,snapshot,data_dir,tmp_path):
    from dataclasses import replace
    folder=tmp_path/'gpredict';folder.mkdir()
    raw=json.dumps(bulk_database());(folder/'satdb.json').write_text(raw)
    client.app.state.config=replace(client.app.state.config,gpredict_data=folder)
    _,tag=s_empty
    body={'class':'Satellite','method':'Import Orbits','format':'gpredict_local'}
    r=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':tag})
    assert r.status_code==201,r.text
    assert len(r.json()['created'])==906
    assert len(plan_propagate(data_dir/'scenarios/S1',data_dir).satellites)==906
    doc=client.get('/api/scenarios/S1').json()
    rows=custom.read_registry(data_dir/'orbits'/doc['orbit_snapshot'])
    assert len(rows)==906 and len({r['prn'] for r in rows})==906
    r2=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':r.headers['etag']})
    assert r2.status_code==201 and r2.json()['created']==[]
    assert (folder/'satdb.json').read_text()==raw
    assert not (snapshot/custom.FILE).exists()


def test_catalog_only_bulk_then_select_subset(client,s_empty,snapshot,data_dir):
    _,tag=s_empty
    body={'class':'Satellite','method':'Import Orbits','format':'gpredict','text':json.dumps(bulk_database()),'add_to_scenario':False}
    r=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':tag})
    assert r.status_code==201 and r.json()['created']==[],r.text
    doc=client.get('/api/scenarios/S1').json()
    assert doc['objects']==[] and len(custom.read_registry(data_dir/'orbits'/doc['orbit_snapshot']))==906
    insert={'class':'Satellite','method':'From Satellite Catalog','norads':[20098,20099,20905]}
    selected=client.post('/api/scenarios/S1/objects',json=insert,headers={'If-Match':r.headers['etag']})
    assert selected.status_code==201,selected.text
    assert len(selected.json()['created'])==3
    assert set(plan_propagate(data_dir/'scenarios/S1',data_dir).satellites)=={'U99','V01',custom.CODES[905]}


def test_missing_connection_and_invalid_inputs_do_not_mutate(client,s_empty,snapshot,data_dir):
    _,tag=s_empty
    before=client.get('/api/scenarios/S1').json()
    for fields in [{'format':'gpredict_local'},{'format':'group','group':'amateur&FORMAT=xml'},{'format':'tle','text':TEXT,'add_to_scenario':'yes'}]:
        r=client.post('/api/scenarios/S1/objects',json={'class':'Satellite','method':'Import Orbits',**fields},headers={'If-Match':tag})
        assert r.status_code==422,r.text
    assert client.get('/api/scenarios/S1').json()==before
    assert list((data_dir/'orbits').iterdir())==[snapshot]


def test_group_import_uses_one_group_download(client,s_empty,snapshot,data_dir):
    from gnss_studio_server import custom_orbits
    _,tag=s_empty
    body={'class':'Satellite','method':'Import Orbits','format':'group','group':'amateur','add_to_scenario':False}
    with patch.object(custom_orbits,'fetch_group',return_value=(FX/'studio/omm_sample.json',[])) as fetch:
        r=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':tag})
    assert r.status_code==201,r.text
    assert fetch.call_count==1 and fetch.call_args.args[0]=='amateur'
    assert fetch.call_args.kwargs['url'].endswith('?GROUP=amateur&FORMAT=json')


def test_import_over_scenario_capacity_is_atomic(client,s_empty,snapshot,data_dir):
    _,tag=s_empty
    r=import_iss(client,tag);assert r.status_code==201,r.text
    before=client.get('/api/scenarios/S1').json()
    folders=set((data_dir/'orbits').iterdir())
    body={'class':'Satellite','method':'Import Orbits','format':'gpredict','text':json.dumps(bulk_database(999))}
    bad=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':r.headers['etag']})
    assert bad.status_code==422 and '999' in bad.json()['text']
    assert client.get('/api/scenarios/S1').json()==before
    assert set((data_dir/'orbits').iterdir())==folders
