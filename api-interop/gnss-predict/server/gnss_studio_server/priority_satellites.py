"""Named public satellite collections. Mission history is separate from orbit availability."""
import json
import re

from . import gpredict_catalog

CHECKED_ON = '2026-11-17'
GISTDA_STATEMENT = 'https://gistda.or.th/th/news/แถลงการณ์-ผลการนำส่งดา/'
SATCAT = 'https://celestrak.org/satcat/records.php?CATNR={}&FORMAT=JSON'
THAICOM = 'https://www.thaicom.net/satellites/'
MAXAR = 'https://developers.maxar.com/docs/streaming-imagery/guides/streaming-guide'
ASI = 'https://www.asi.it/en/earth-science/cosmo-skymed/'
USGS = 'https://www.usgs.gov/landsat-missions'


def entry(key, name, norad, aliases=(), status='catalogued', note='', reference=None):
    return {'id':key, 'name':name, 'norad':norad, 'aliases':list(aliases), 'mission_status':status,
            'note':note, 'reference_url':reference or (SATCAT.format(norad) if norad else GISTDA_STATEMENT)}


THAI = [
    entry('thaicom6','THAICOM 6',39500,('ไทยคม 6',),note='ดาวเทียมสื่อสาร GEO',reference=THAICOM),
    entry('thaicom7','THAICOM 7',40141,('ไทยคม 7','ASIASAT 6','AsiaSat 6 / Thaicom 7'),note='ชื่อในแคตตาล็อกคือ ASIASAT 6; ใช้ NORAD เดียวกัน',reference='https://www.thaicom.net/satellites/thaicom-7/'),
    entry('thaicom8','THAICOM 8',41552,('ไทยคม 8',),note='ดาวเทียมสื่อสาร GEO',reference=THAICOM),
    entry('theos1','THEOS-1',33396,('THEOS','TEOS','ไทยโชต','Thaichote'),note='ดาวสำรวจโลกของ GISTDA'),
    entry('theos2','THEOS-2',58016,('THEOS-2 (T2V)','TEOS-2'),note='ดาวสำรวจโลกของ GISTDA'),
    entry('theos2a','THEOS-2A',None,('THEOS 2A','TEOS-2A'),status='launch_failed',note='นำส่งไม่สำเร็จ 12 ม.ค. 2569; ไม่มีวงโคจรปัจจุบันสำหรับคำนวณ',reference=GISTDA_STATEMENT),
    entry('napa1','NAPA-1',46320,('นภา-1','RTAF-SAT 1'),status='deorbited',note='กลับเข้าสู่บรรยากาศ 2 พ.ย. 2569 ตาม SATCAT'),
    entry('napa2','NAPA-2',48963,('นภา-2','RTAF-SAT 2'),status='deorbited',note='กลับเข้าสู่บรรยากาศ 5 ก.ค. 2569 ตาม SATCAT'),
]
COMMERCIAL = [
    entry('ikonos','IKONOS (IKONOS-2)',25919,('IKONOS 2','ECONOS','ไอโคนอส'),status='retired',note='ยุติภารกิจถ่ายภาพในปี 2558; ยังติดตามวงโคจรได้เมื่อมี TLE',reference='https://eo.belspo.be/nl/satellites-and-sensors/ikonos-2'),
    entry('geoeye1','GeoEye-1',33331,('GEOEYE 1','จีโออาย'),reference=MAXAR),
    entry('worldview1','WorldView-1',32060,('WORLDVIEW-1 (WV-1)','เวิลด์วิว 1'),reference=MAXAR),
    entry('worldview2','WorldView-2',35946,('WORLDVIEW-2 (WV-2)','เวิลด์วิว 2'),reference=MAXAR),
    entry('worldview3','WorldView-3',40115,('WORLDVIEW-3 (WV-3)','เวิลด์วิว 3'),reference=MAXAR),
    entry('worldview4','WorldView-4 / GeoEye-2',41848,('WORLDVIEW-4','GEOEYE-2'),status='deorbited',note='กลับเข้าสู่บรรยากาศ 30 พ.ย. 2564 ตาม SATCAT'),
    *[entry(f'legion{i}',f'WorldView Legion {i}',norad,(f'LEGION {i}',),reference=MAXAR)
      for i,norad in enumerate((59625,59626,60452,60453,62900,62901),1)],
]
ITALY = [*[entry(f'csk{i}',f'COSMO-SkyMed {i}',norad,(f'COSMO-SKYMED {i}',),reference=ASI)
           for i,norad in enumerate((31598,32376,33412,37216),1)],
         *[entry(f'csg{i}',f'COSMO-SkyMed Second Generation {i}',norad,(f'CSG-{i}',),reference=ASI)
           for i,norad in enumerate((44873,51444,67304),1)]]
LANDSAT = [*[entry(f'landsat{i}',f'Landsat {i}',norad,status='retired',note='ยุติภารกิจถ่ายภาพ; ติดตามวัตถุได้เมื่อมี TLE ปัจจุบัน',reference=USGS)
             for i,norad in ((1,6126),(2,7615),(3,10702))],
           entry('landsat4','Landsat 4',13367,status='deorbited',note='กลับเข้าสู่บรรยากาศ 8 ต.ค. 2568 ตาม SATCAT'),
           entry('landsat5','Landsat 5',14780,status='retired',note='ยุติภารกิจถ่ายภาพ; ติดตามวัตถุได้เมื่อมี TLE ปัจจุบัน',reference=USGS),
           entry('landsat6','Landsat 6',None,status='launch_failed',note='นำส่งไม่สำเร็จในปี 2536; ไม่มีวงโคจรปัจจุบัน',reference='https://www.usgs.gov/landsat-missions/landsat-6'),
           entry('landsat7','Landsat 7',25682,status='retired',note='ยุติภารกิจ 4 มิ.ย. 2568; ยังมีข้อมูลวงโคจร',reference='https://www.usgs.gov/landsat-missions/landsat-7'),
           entry('landsat8','Landsat 8',39084,reference=USGS),entry('landsat9','Landsat 9',49260,reference=USGS)]


def collections_from_database(db):
    russian=[]
    for key,row in sorted(db['satellites'].items(),key=lambda item:int(item[0])):
        name=row.get('name','')
        if re.match(r'^(?:COSMOS|KOSMOS)\s+\d+',name,re.I) and not any(s in name.upper() for s in (' DEB',' R/B')):
            russian.append(entry(f'cosmos-{key}',name,int(key),('Kosmos','คอสมอส'),note='ซีรีส์รัสเซียหลายประเภทภารกิจ; เฉพาะข้อมูลสาธารณะที่มีในฐานข้อมูล'))
    groups=[('thai','ดาวไทย: ไทยคม / THEOS / นภา',THAI,''),
            ('commercial','IKONOS / GeoEye / WorldView',COMMERCIAL,'EYEVIEW ไม่ใช่ชื่อดาวเฉพาะ ใช้ค้นกลุ่ม GeoEye / WorldView แทน; ไม่ได้เพิ่มสิทธิ์ดาวน์โหลดภาพเชิงพาณิชย์'),
            ('landsat','Landsat',LANDSAT,'แสดงทั้งรุ่นปัจจุบันและภารกิจเก่า: ยุติภารกิจไม่ได้หมายความว่ากลับเข้าสู่บรรยากาศแล้ว; รุ่นที่ไม่มีวงโคจรปัจจุบันเลือกคำนวณไม่ได้'),
            ('cosmo_skymed','COSMO-SkyMed — อิตาลี',ITALY,'กลุ่มดาวเรดาร์ SAR ของอิตาลี แยกจาก COSMOS ของรัสเซีย'),
            ('cosmos_russia','COSMOS / Kosmos — รัสเซีย',russian,'รวมซีรีส์หลายภารกิจ ไม่ได้หมายถึงดาวถ่ายภาพทุกดวง')]
    result=[]
    for key,label,entries,note in groups:
        rows=[]
        for mission in entries:
            orbit=db['satellites'].get(str(mission['norad']))
            available=orbit is not None and mission['mission_status'] not in ('launch_failed','deorbited')
            rows.append({**mission,'orbit_available':available,'orbit_epoch':orbit.get('epoch') if available else None,
                         'catalog_name':orbit.get('name') if orbit else None})
        result.append({'id':key,'label':label,'note':note,'entries':rows})
    return result


def catalog(folder):
    error=None
    try:db=gpredict_catalog.read_database(folder)
    except ValueError as exc:db={'satellites':{}};error=str(exc)
    return {'checked_on':CHECKED_ON,'source_error':error,'collections':collections_from_database(db)}


def import_text(folder,norads):
    if not isinstance(norads,list) or not norads or not all(type(n) is int and n>0 for n in norads):
        raise ValueError('เลือกหมายเลข NORAD จากรายการสำคัญอย่างน้อยหนึ่งดวง')
    db=gpredict_catalog.read_database(folder)
    allowed={r['norad']:r for group in collections_from_database(db) for r in group['entries'] if r['norad'] is not None}
    selected={}
    for norad in dict.fromkeys(norads):
        mission=allowed.get(norad)
        if mission is None or not mission['orbit_available']:
            raise ValueError(f'NORAD {norad} ไม่มีวงโคจรปัจจุบันที่นำเข้าได้ในรายการสำคัญ')
        selected[str(norad)]={**db['satellites'][str(norad)],'name':mission['name']}
    return json.dumps({'version':1,'satellites':selected},ensure_ascii=False)
