import json
from dataclasses import replace
from pathlib import Path
import pytest
from gnss_predict.omm import _parse_records,to_tle_lines
from gnss_predict import custom_satellites
from gnss_studio_server import priority_satellites as priority

FX=Path(__file__).resolve().parents[2]/'tests/fixtures'


def connected(client,tmp_path):
    raw=json.loads((FX/'studio/omm_sample.json').read_text())[0]
    names={39500:'THAICOM 6',40141:'ASIASAT 6',41552:'THAICOM 8',33396:'THEOS',58016:'THEOS-2 (T2V)',46320:'NAPA-1',48963:'NAPA-2',25919:'IKONOS 2',41848:'WORLDVIEW-4',30000:'COSMOS 2999',30001:'COSMOS 2999 DEB',31598:'COSMO-SKYMED 1',39084:'LANDSAT 8'}
    records=_parse_records(json.dumps([{**raw,'NORAD_CAT_ID':n,'OBJECT_NAME':name} for n,name in names.items()]))
    doc={'version':1,'satellites':{str(r.norad):{'name':r.name,'tle':list(to_tle_lines(r)),'epoch':'2026-11-09T12:00:00Z'} for r in records}}
    folder=tmp_path/'gpredict';folder.mkdir();(folder/'satdb.json').write_text(json.dumps(doc))
    client.app.state.config=replace(client.app.state.config,gpredict_data=folder)
    return folder


def test_required_names_stay_visible_without_orbits(client):
    r=client.get('/api/satellite-collections');assert r.status_code==200
    data=r.json();groups={g['id']:g for g in data['collections']}
    assert set(groups)=={'thai','commercial','landsat','cosmo_skymed','cosmos_russia'}
    assert {s['id'] for s in groups['thai']['entries']}=={'thaicom6','thaicom7','thaicom8','theos1','theos2','theos2a','napa1','napa2'}
    assert data['source_error'] and not any(s['orbit_available'] for g in groups.values() for s in g['entries'])
    theos=next(s for s in groups['thai']['entries'] if s['id']=='theos2a')
    assert theos['norad'] is None and theos['mission_status']=='launch_failed'


def test_alias_identity_lifecycle_and_both_cosmos_groups(client,tmp_path):
    connected(client,tmp_path)
    data=client.get('/api/satellite-collections').json();groups={g['id']:g for g in data['collections']}
    rows={s['id']:s for g in groups.values() for s in g['entries']}
    assert rows['thaicom7']['norad']==40141 and rows['thaicom7']['catalog_name']=='ASIASAT 6'
    assert rows['thaicom7']['orbit_available']
    for key in ['napa1','napa2','worldview4','theos2a']:assert not rows[key]['orbit_available']
    assert rows['ikonos']['orbit_available'] and rows['ikonos']['mission_status']=='retired'
    assert 'ECONOS' in rows['ikonos']['aliases'] and 'TEOS' in rows['theos1']['aliases']
    assert len(groups['cosmos_russia']['entries'])==1
    assert groups['cosmos_russia']['entries'][0]['norad']==30000
    assert groups['cosmo_skymed']['entries'][0]['norad']==31598


def test_import_alias_preserves_original_tle_and_source(client,s_empty,snapshot,data_dir,tmp_path):
    folder=connected(client,tmp_path);before=(folder/'satdb.json').read_bytes();_,tag=s_empty
    body={'class':'Satellite','method':'Import Orbits','format':'priority','norads':[40141,40141,33396]}
    r=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':tag});assert r.status_code==201,r.text
    assert len(r.json()['created'])==2
    sc=client.get('/api/scenarios/S1').json();rows=custom_satellites.read_registry(data_dir/'orbits'/sc['orbit_snapshot'])
    assert next(s['name'] for s in rows if s['norad']==40141)=='THAICOM 7'
    assert (folder/'satdb.json').read_bytes()==before and not (snapshot/custom_satellites.FILE).exists()


@pytest.mark.parametrize('norads',[[46320],[48963],[41848],[40141,46320],[12345],[True],[]])
def test_unavailable_or_unknown_satellites_cannot_be_imported(client,s_empty,snapshot,data_dir,tmp_path,norads):
    connected(client,tmp_path);_,tag=s_empty
    before=client.get('/api/scenarios/S1').json();folders=set((data_dir/'orbits').iterdir())
    body={'class':'Satellite','method':'Import Orbits','format':'priority','norads':norads}
    r=client.post('/api/scenarios/S1/objects',json=body,headers={'If-Match':tag})
    assert r.status_code==422,r.text
    assert client.get('/api/scenarios/S1').json()==before and set((data_dir/'orbits').iterdir())==folders
