"""ตาราง preset ของดาวถ่ายภาพ X01…X08 ผ่าน server (spec ดาวถ่ายภาพ §1, §5): GET /api/imaging/presets

route นี้คงที่ อ่านจาก gnss_predict.imaging โดยตรง ไม่อ่าน snapshot ไม่ต่อเน็ต; ชั้นภาพ GIBS ของทุก preset ต้องมีใน CATALOG ของ server
"""

from gnss_predict.imaging import IMAGING_SATELLITES
from gnss_studio_server.imagery import layer_by_id

# ชั้นภาพ GIBS ของแต่ละดาว (Global Constraints ของแผน คัดลอกตรงตัว)
GIBS_LAYERS = {
    "X01": "Himawari_AHI_Band3_Red_Visible_1km",
    "X02": "GOES-West_ABI_GeoColor",
    "X03": "GOES-East_ABI_GeoColor",
    "X04": "MODIS_Terra_CorrectedReflectance_TrueColor",
    "X05": "MODIS_Aqua_CorrectedReflectance_TrueColor",
    "X06": "VIIRS_SNPP_CorrectedReflectance_TrueColor",
    "X07": "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
    "X08": "VIIRS_NOAA21_CorrectedReflectance_TrueColor",
}
ROW_KEYS = {"prn", "norad", "name", "camera", "gibs_layer", "sensor"}
SENSOR_KEYS = {"type", "cone_half_angle", "vertical_half_angle", "horizontal_half_angle"}


def test_presets_route(client):
    r = client.get("/api/imaging/presets")
    assert r.status_code == 200, r.text
    rows = r.json()
    assert [row["prn"] for row in rows] == ["X01", "X02", "X03", "X04", "X05", "X06", "X07", "X08"]
    assert all(set(row) == ROW_KEYS and set(row["sensor"]) == SENSOR_KEYS for row in rows)
    assert rows[3] == {"prn": "X04", "norad": 25994, "name": "Terra", "camera": "MODIS",
                       "gibs_layer": "MODIS_Terra_CorrectedReflectance_TrueColor",
                       "sensor": {"type": "Rectangular", "cone_half_angle": None, "vertical_half_angle": 55.0,
                                  "horizontal_half_angle": 0.41}}
    assert rows[0]["sensor"] == {"type": "Simple Conic", "cone_half_angle": 8.7, "vertical_half_angle": None,
                                 "horizontal_half_angle": None}
    assert rows[7]["sensor"] == {"type": "Rectangular", "cone_half_angle": None, "vertical_half_angle": 56.28,
                                 "horizontal_half_angle": 0.42}
    assert [(row["norad"], row["name"], row["camera"]) for row in rows] == [
        (41836, "Himawari-9", "AHI"), (51850, "GOES-18", "ABI"), (60133, "GOES-19", "ABI"), (25994, "Terra", "MODIS"),
        (27424, "Aqua", "MODIS"), (37849, "Suomi NPP", "VIIRS"), (43013, "NOAA-20", "VIIRS"), (54234, "NOAA-21", "VIIRS")]
    assert {row["prn"]: row["gibs_layer"] for row in rows} == GIBS_LAYERS


def test_presets_need_no_snapshot(client, data_dir):
    """route คงที่: ไม่มี data/orbits เลยก็ตอบได้ และไม่สร้างไฟล์หรือโฟลเดอร์ใดใน data/"""
    before = sorted(data_dir.rglob("*"))
    assert client.get("/api/imaging/presets").status_code == 200
    assert sorted(data_dir.rglob("*")) == before


def test_presets_route_is_get_only(client):
    assert client.post("/api/imaging/presets").status_code == 405


def test_every_preset_layer_is_in_catalog():
    layers = {p.prn: layer_by_id(p.gibs_layer) for p in IMAGING_SATELLITES}
    assert all(layer is not None for layer in layers.values()), [p for p, layer in layers.items() if layer is None]
    assert {prn: layer.id for prn, layer in layers.items()} == GIBS_LAYERS
    assert all(layer.source == "gibs" for layer in layers.values())
