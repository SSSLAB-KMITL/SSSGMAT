import json
from pathlib import Path
from dataclasses import replace

import pytest
from gnss_predict import custom_satellites as custom
from gnss_predict.omm import _parse_records,to_tle_lines
from gnss_studio_server import gpredict_catalog as pool

FX=Path(__file__).resolve().parents[2]/'tests/fixtures'


def bulk_database(count):
    template=json.loads((FX/'studio/omm_sample.json').read_text())[0]
    records=_parse_records(json.dumps([{**template,'NORAD_CAT_ID':20000+i,'OBJECT_NAME':f'BULK_{i}'} for i in range(count)]))
    return {'version':1,'satellites':{str(r.norad):{'name':r.name,'tle':list(to_tle_lines(r))} for r in records}}


def connect(client,tmp_path,count=1400):
    folder=tmp_path/'gpredict';folder.mkdir();doc=bulk_database(count)
    for key,row in doc['satellites'].items():row['groups']=['starlink'] if int(key)%2==0 else ['oneweb']
    (folder/'satdb.json').write_text(json.dumps(doc))
    client.app.state.config=replace(client.app.state.config,gpredict_data=folder)
    return folder,doc


def test_large_catalog_groups_and_deterministic_batches(client,tmp_path):
    folder,doc=connect(client,tmp_path)
    summary=client.get('/api/gpredict/groups');assert summary.status_code==200,summary.text
    assert summary.json()['total']==1400
    assert {g['name']:g['count'] for g in summary.json()['groups']}=={'starlink':700,'oneweb':700}
    with pytest.raises(ValueError,match='เลือกกลุ่ม'):pool.import_text(folder)
    first=json.loads(pool.import_text(folder,'starlink',0,100))['satellites']
    second=json.loads(pool.import_text(folder,'starlink',1,100))['satellites']
    assert len(first)==len(second)==100 and not set(first)&set(second)
    assert list(first)==[str(20000+2*i) for i in range(100)]
    doc['satellites']=dict(reversed(list(doc['satellites'].items())))
    (folder/'satdb.json').write_text(json.dumps(doc))
    assert pool.import_text(folder,'starlink',0,100)==json.dumps({'version':1,'satellites':first},ensure_ascii=False)
    for group,batch,size in [('unknown',0,100),('starlink',7,100),('starlink',True,100),('starlink',0,1000)]:
        with pytest.raises(ValueError):pool.import_text(folder,group,batch,size)


def test_local_database_can_exceed_upload_limit_without_importing_it_all(client,tmp_path):
    folder,doc=connect(client,tmp_path,count=2);doc['padding']='x'*(custom.MAX_BYTES+1)
    (folder/'satdb.json').write_text(json.dumps(doc))
    text=pool.import_text(folder,'starlink',0,100)
    assert len(text.encode())<custom.MAX_BYTES and len(custom.parse_import(text,'gpredict'))==1


def test_group_subset_import_preserves_source(client,s_empty,snapshot,data_dir,tmp_path):
    folder,doc=connect(client,tmp_path);before=(folder/'satdb.json').read_bytes()
    _,tag=s_empty
    body={'class':'Satellite','method':'Import Orbits','format':'gpredict_local','group':'starlink','batch':1,'batch_size':100}
    r=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':tag})
    assert r.status_code==201,r.text
    assert len(r.json()['created'])==100
    sc=client.get('/api/scenarios/S1').json()
    assert {s['norad'] for s in sc['objects']}=={20200+2*i for i in range(100)}
    assert (folder/'satdb.json').read_bytes()==before and not (snapshot/custom.FILE).exists()


def test_replace_unused_rows_keeps_selected_satellites_and_original_snapshot(client,s_empty,snapshot,data_dir):
    _,tag=s_empty
    body={'class':'Satellite','method':'Import Orbits','format':'tle','text':(FX/'custom/iss.tle').read_text()}
    r=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':tag});assert r.status_code==201,r.text
    more={'class':'Satellite','method':'Import Orbits','format':'gpredict','text':json.dumps(bulk_database(5)),'add_to_scenario':False}
    r=client.post('/api/scenarios/S1/objects',json=more,headers={'If-Match':r.headers['etag']});assert r.status_code==201,r.text
    old=client.get('/api/scenarios/S1').json();old_path=data_dir/'orbits'/old['orbit_snapshot'];old_raw=(old_path/custom.FILE).read_bytes()
    omm=json.loads((FX/'studio/omm_sample.json').read_text())[0];omm['NORAD_CAT_ID']=12345
    body={'class':'Satellite','method':'Import Orbits','format':'omm','text':json.dumps(omm),'replace_unselected':True,'add_to_scenario':False}
    r=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':r.headers['etag']});assert r.status_code==201,r.text
    new=client.get('/api/scenarios/S1').json();rows=custom.read_registry(data_dir/'orbits'/new['orbit_snapshot'])
    assert {s['norad'] for s in rows}=={25544,12345}
    assert next(s['prn'] for s in rows if s['norad']==25544)=='U01'
    assert new['objects']==old['objects'] and (old_path/custom.FILE).read_bytes()==old_raw
