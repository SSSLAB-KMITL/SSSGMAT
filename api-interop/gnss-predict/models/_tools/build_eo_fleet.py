"""Build high-detail procedural 3D .glb models for the 14 EO_HighRes_Fleet spacecraft families.

Run headless via Blender:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/_tools/build_eo_fleet.py
"""
import json
import math
import os
import sys

import bpy

TOOLS = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
import proc_lib as pl  # noqa: E402


def _make_store(texdir, panel_l=1.2, panel_w=0.8, seed=2026700):
    store = pl.MaterialStore()
    sf = pl.tex_solar_front(texdir, "tex_solar_front", panel_l, panel_w, cols=12, rows=8, seed=seed)
    sb = pl.tex_solar_back(texdir, "tex_solar_back", panel_l, panel_w, seed=seed + 1)
    store.add_standard_palette(texdir, solar_front_img=sf, solar_back_img=sb,
                               include_gold_mli=True, include_white_mli=True)
    store.make("cavity_dark", (0.020, 0.020, 0.025), metallic=0.1, roughness=0.75)
    store.make("optics_glass", (0.10, 0.22, 0.38), metallic=0.85, roughness=0.05)
    store.make("dish_mesh", (0.70, 0.63, 0.44), metallic=0.78, roughness=0.42)
    store.make("carbon_black", (0.045, 0.045, 0.050), metallic=0.25, roughness=0.38)
    pa = pl.tex_phased_array(texdir, "tex_sar_array", nx=16, ny=4)
    store.make("sar_array", (0.74, 0.74, 0.76), metallic=0.58, roughness=0.32, image=pa)
    return store


def _oct_pts(rx, ry, chamfer=0.65):
    cx, cy = rx * chamfer, ry * chamfer
    return [(rx, -cy), (rx, cy), (cx, ry), (-cx, ry), (-rx, cy), (-rx, -cy), (-cx, -ry), (cx, -ry)]


def _hex_pts(r):
    return [(r * math.cos(i * math.pi / 3), r * math.sin(i * math.pi / 3)) for i in range(6)]


def _add_telescope(part, z_base, radius, length, baffle_mat="carbon_black", ring_mat="titanium_grey", hood=True):
    # Mounting flange & thermal collar
    pl.cylinder(part, (0.0, 0.0, z_base), (0, 0, 1), radius * 1.12, 0.06, 28, "aluminium", top="mli_black")
    # Main optical barrel
    pl.cylinder(part, (0.0, 0.0, z_base + 0.05), (0, 0, 1), radius, length * 0.65, 28, baffle_mat, top="cavity_dark", r1=radius * 1.02)
    # Upper sunshade baffle
    z_mid = z_base + 0.05 + length * 0.65
    pl.cylinder(part, (0.0, 0.0, z_mid), (0, 0, 1), radius * 1.02, length * 0.35, 28, baffle_mat, top="cavity_dark", r1=radius * 1.07)
    # Stiffening rings along barrel
    for frac in (0.25, 0.55, 0.92):
        pl.cylinder(part, (0.0, 0.0, z_base + length * frac), (0, 0, 1), radius * 1.09, 0.025, 28, ring_mat)
    # Primary mirror deep inside barrel + secondary mirror + 3-vane spider
    z_pri = z_base + length * 0.22
    z_sec = z_base + length * 0.78
    pl.cylinder(part, (0.0, 0.0, z_pri), (0, 0, 1), radius * 0.84, 0.03, 28, "optics_glass")
    pl.cylinder(part, (0.0, 0.0, z_sec), (0, 0, 1), radius * 0.24, 0.06, 18, "carbon_black", top=ring_mat)
    for k in range(3):
        ang = k * 2.094395
        pl.bar(part, (0.0, 0.0, z_sec + 0.02),
               (radius * 0.96 * math.cos(ang), radius * 0.96 * math.sin(ang), z_sec + 0.02),
               0.014, 0.025, "carbon_black", (0, 0, 1))
    # Angled sun-shield hood lip
    if hood:
        pl.cylinder(part, (0.0, 0.0, z_base + length), (0.12, 0.0, 1.0), radius * 1.08, 0.08, 28, ring_mat, top="cavity_dark")


def _add_aft_module(part, z_aft, r_bus):
    # Aft adapter ring + 4 canted thrusters + S-band omni + GPS dome
    pl.cylinder(part, (0.0, 0.0, z_aft), (0, 0, -1), r_bus * 0.72, 0.08, 24, "titanium_grey", top="mli_black")
    for sx, sy in ((0.22, 0.22), (-0.22, 0.22), (0.22, -0.22), (-0.22, -0.22)):
        ax = (sx * 0.8, sy * 0.8, -1.0)
        ln = math.sqrt(sum(c * c for c in ax))
        pl.cylinder(part, (sx * r_bus * 1.4, sy * r_bus * 1.4, z_aft - 0.06),
                    tuple(c / ln for c in ax), 0.035, 0.08, 12, "titanium_grey", top="cavity_dark", r1=0.055)
    # Twin canted star trackers
    for sy in (-r_bus * 0.35, r_bus * 0.35):
        ax = (0.35, 0.32 if sy > 0 else -0.32, -0.88)
        ln = math.sqrt(sum(c * c for c in ax))
        pl.cylinder(part, (r_bus * 0.36, sy, z_aft - 0.02),
                    tuple(c / ln for c in ax), 0.055, 0.16, 14, "white_paint", top="cavity_dark", r1=0.082)
    # Zenith S-band / GNSS antenna
    pl.cylinder(part, (-r_bus * 0.35, 0.0, z_aft - 0.02), (0, 0, -1), 0.04, 0.18, 14, "white_paint", top="radome_white")


def _add_xband_dish(part, x, y, z, r=0.22):
    pl.bar(part, (x * 0.65, y, z - 0.12), (x, y, z), 0.035, 0.035, "titanium_grey", (0, 1, 0))
    pl.parabolic_dish(part, (x, y, z), (-0.25 if x < 0 else 0.25, 0.0, 1.0), r, r * 0.28,
                      rings=5, segs=20, front_mat="white_paint", back_mat="titanium_grey")
    pl.cylinder(part, (x, y, z + r * 0.15), (0, 0, 1), 0.02, r * 0.55, 10, "titanium_grey")


def _add_wings(root_obj, store, hy, panel_l, panel_w, n_panels=2, single=False, sadm_z=0.0):
    pl.build_sadm_and_wings(
        root_obj, store, hy=hy, sadm_x=0.0, sadm_z=sadm_z,
        n_panels=n_panels, panel_l=panel_l, panel_w=panel_w,
        panel_gap=0.04, yoke_len=0.22,
    )
    if single:
        for nm in ("wing+Y", "sadm_+Y"):
            ob = bpy.data.objects.get(nm)
            if ob is not None:
                bpy.data.objects.remove(ob, do_unlink=True)
        return ["wing-Y"]
    return ["wing+Y", "wing-Y"]


def _build_optical_bus(root_obj, store, bus_r, bus_h, tel_r, tel_l, hy, panel_l, panel_w, n_panels,
                       hex_shape=True, extra_dish=True, body_mat="mli_gold", dorsal_wing=False):
    bus = pl.Part("bus", store)
    pts = _hex_pts(bus_r) if hex_shape else _oct_pts(bus_r, bus_r)
    pl.prism(bus, (0.0, 0.0, -bus_h / 2), (0, 0, 1), pts, bus_h,
             side=body_mat, top="mli_black", bottom="mli_black")
    # Structural deck rings + OSR radiator panels on +-X
    for rz in (-bus_h * 0.35, 0.0, bus_h * 0.35):
        pl.prism(bus, (0.0, 0.0, rz), (0, 0, 1), [(x * 1.015, y * 1.015) for x, y in pts], 0.04,
                 side="aluminium", top="aluminium", bottom="aluminium")
    pl.box(bus, (bus_r * 0.96, 0.0, 0.0), (0.025, bus_r * 0.82, bus_h * 0.55), "osr_radiator", uv="fit")
    pl.box(bus, (-bus_r * 0.96, 0.0, 0.0), (0.025, bus_r * 0.82, bus_h * 0.55), "osr_radiator", uv="fit")
    _add_telescope(bus, bus_h / 2 - 0.05, tel_r, tel_l)
    _add_aft_module(bus, -bus_h / 2, bus_r)
    if extra_dish:
        _add_xband_dish(bus, -bus_r * 0.72, 0.0, bus_h / 2 + 0.14, r=min(0.24, bus_r * 0.32))
    if dorsal_wing:
        # Signature 3rd cantilevered solar panel (AstroBus / Pleiades Neo)
        pl.bar(bus, (bus_r * 0.75, 0.0, -0.20), (bus_r * 1.05, 0.0, -0.35), 0.04, 0.04, "titanium_grey", (0, 1, 0))
        pl.box(bus, (bus_r * 1.35, 0.0, -0.35), (0.95, 1.15, 0.028),
               {"+x": "solar_cells", "-x": "solar_cells", "default": "aluminium"})
    pl.finish(bus, root_obj)
    return _add_wings(root_obj, store, hy=hy, panel_l=panel_l, panel_w=panel_w, n_panels=n_panels)


def build_theos_2(root_obj, store):
    return _build_optical_bus(root_obj, store, bus_r=0.72, bus_h=1.45, tel_r=0.34, tel_l=0.68,
                              hy=0.68, panel_l=1.35, panel_w=0.90, n_panels=2, hex_shape=True,
                              extra_dish=True, body_mat="mli_gold", dorsal_wing=True)


def build_worldview_legion(root_obj, store):
    return _build_optical_bus(root_obj, store, bus_r=0.82, bus_h=2.05, tel_r=0.40, tel_l=0.92,
                              hy=0.82, panel_l=1.45, panel_w=1.05, n_panels=3, hex_shape=False,
                              extra_dish=True, body_mat="mli_gold")


def build_pleiades_neo(root_obj, store):
    return _build_optical_bus(root_obj, store, bus_r=0.88, bus_h=2.25, tel_r=0.42, tel_l=0.85,
                              hy=0.85, panel_l=1.30, panel_w=1.00, n_panels=2, hex_shape=True,
                              extra_dish=True, body_mat="carbon_black", dorsal_wing=True)


def build_cartosat_3(root_obj, store):
    return _build_optical_bus(root_obj, store, bus_r=0.80, bus_h=2.10, tel_r=0.38, tel_l=0.82,
                              hy=0.78, panel_l=1.40, panel_w=0.95, n_panels=3, hex_shape=True,
                              extra_dish=True, body_mat="mli_gold")


def build_kompsat_7(root_obj, store):
    return _build_optical_bus(root_obj, store, bus_r=0.85, bus_h=2.30, tel_r=0.42, tel_l=0.90,
                              hy=0.82, panel_l=1.45, panel_w=1.00, n_panels=3, hex_shape=True,
                              extra_dish=True, body_mat="mli_gold")


def build_superview_neo_1(root_obj, store):
    return _build_optical_bus(root_obj, store, bus_r=0.72, bus_h=1.85, tel_r=0.34, tel_l=0.74,
                              hy=0.70, panel_l=1.25, panel_w=0.88, n_panels=2, hex_shape=False,
                              extra_dish=True, body_mat="mli_gold")


def build_eros_c3(root_obj, store):
    return _build_optical_bus(root_obj, store, bus_r=0.70, bus_h=1.75, tel_r=0.32, tel_l=0.70,
                              hy=0.68, panel_l=1.20, panel_w=0.85, n_panels=2, hex_shape=False,
                              extra_dish=True, body_mat="mli_gold")


def build_blacksky(root_obj, store):
    bus = pl.Part("bus", store)
    pl.bevel_box(bus, (0.0, 0.0, 0.0), (0.85, 0.75, 1.15), mat="mli_black")
    pl.box(bus, (0.0, 0.0, -0.52), (0.88, 0.78, 0.06), "aluminium")
    _add_telescope(bus, 0.54, 0.22, 0.42, hood=False)
    pl.box(bus, (0.43, 0.0, 0.0), (0.015, 0.50, 0.65), "osr_radiator", uv="fit")
    pl.cylinder(bus, (-0.30, 0.22, 0.58), (0, 0, 1), 0.04, 0.08, 12, "white_paint")
    _add_aft_module(bus, -0.57, 0.40)
    pl.finish(bus, root_obj)
    return _add_wings(root_obj, store, hy=0.38, panel_l=0.90, panel_w=0.65, n_panels=2)


def build_skysat(root_obj, store):
    bus = pl.Part("bus", store)
    pl.bevel_box(bus, (0.0, 0.0, 0.0), (0.60, 0.60, 0.95), mat="mli_black")
    for rz in (-0.42, 0.0, 0.42):
        pl.box(bus, (0.0, 0.0, rz), (0.62, 0.62, 0.05), "aluminium")
    _add_telescope(bus, 0.45, 0.20, 0.35, hood=False)
    pl.box(bus, (0.31, 0.0, 0.0), (0.015, 0.38, 0.50), "osr_radiator", uv="fit")
    pl.finish(bus, root_obj)
    return _add_wings(root_obj, store, hy=0.30, panel_l=0.75, panel_w=0.55, n_panels=1)


def build_pelican(root_obj, store):
    bus = pl.Part("bus", store)
    pl.bevel_box(bus, (0.0, 0.0, 0.0), (0.78, 0.72, 1.20), mat="mli_gold")
    pl.box(bus, (0.0, 0.0, 0.0), (0.80, 0.74, 0.08), "aluminium")
    _add_telescope(bus, 0.58, 0.24, 0.45, hood=True)
    _add_aft_module(bus, -0.60, 0.38)
    pl.finish(bus, root_obj)
    return _add_wings(root_obj, store, hy=0.36, panel_l=0.95, panel_w=0.68, n_panels=2)


def build_newsat(root_obj, store):
    bus = pl.Part("bus", store)
    pl.bevel_box(bus, (0.0, 0.0, 0.0), (0.55, 0.55, 0.90), mat="mli_black")
    pl.box(bus, (0.0, 0.0, 0.42), (0.58, 0.58, 0.05), "aluminium")
    for ox in (-0.11, 0.11):
        pl.cylinder(bus, (ox, 0.0, 0.44), (0, 0, 1), 0.09, 0.24, 18, "carbon_black", top="cavity_dark")
        pl.cylinder(bus, (ox, 0.0, 0.52), (0, 0, 1), 0.072, 0.03, 18, "optics_glass")
    pl.box(bus, (0.28, 0.0, 0.0), (0.015, 0.34, 0.45), "osr_radiator", uv="fit")
    pl.finish(bus, root_obj)
    return _add_wings(root_obj, store, hy=0.28, panel_l=0.75, panel_w=0.52, n_panels=2)


def build_iceye(root_obj, store):
    bus = pl.Part("bus", store)
    pl.bevel_box(bus, (0.0, 0.0, 0.0), (0.95, 0.85, 0.85), mat="mli_black")
    # Bus structural frame & gold MLI side radiator panels
    pl.box(bus, (0.0, 0.0, 0.0), (0.98, 0.88, 0.07), "aluminium")
    pl.box(bus, (0.48, 0.0, 0.0), (0.02, 0.60, 0.55), "osr_radiator", uv="fit")
    # Signature 3.2 m flat phased-array X-band SAR antenna with backing frame + truss
    pl.box(bus, (0.0, 0.0, 0.56), (3.20, 0.48, 0.05), {"+z": "sar_array", "-z": "mli_gold", "default": "aluminium"}, uv="fit")
    pl.box(bus, (0.0, 0.0, 0.52), (3.16, 0.42, 0.03), "carbon_black")
    for sx in (-1.20, -0.45, 0.45, 1.20):
        pl.bar(bus, (sx * 0.30, -0.18, 0.42), (sx, -0.14, 0.51), 0.03, 0.03, "titanium_grey", (0, 1, 0))
        pl.bar(bus, (sx * 0.30, 0.18, 0.42), (sx, 0.14, 0.51), 0.03, 0.03, "titanium_grey", (0, 1, 0))
    # Star tracker + S-band antenna on zenith
    _add_aft_module(bus, -0.42, 0.42)
    pl.finish(bus, root_obj)
    return _add_wings(root_obj, store, hy=0.43, panel_l=1.05, panel_w=0.78, n_panels=2, single=True)


def _build_sar_dish(root_obj, store, bus_r, bus_h, dish_r, single_wing=False):
    bus = pl.Part("bus", store)
    pts = _hex_pts(bus_r)
    pl.prism(bus, (0.0, 0.0, -bus_h / 2), (0, 0, 1), pts, bus_h,
             side="mli_gold", top="mli_black", bottom="mli_black")
    pl.box(bus, (bus_r * 0.96, 0.0, 0.0), (0.02, bus_r * 0.80, bus_h * 0.55), "osr_radiator", uv="fit")
    # Deployment boom & hub
    z_apex = bus_h / 2 + 0.34
    pl.cylinder(bus, (0.0, 0.0, bus_h / 2), (0, 0, 1), 0.12, 0.36, 16, "titanium_grey")
    # Deployable parabolic mesh reflector
    pl.parabolic_dish(bus, (0.0, 0.0, z_apex), (0.0, 0.0, 1.0), dish_r, 0.42,
                      rings=7, segs=30, front_mat="dish_mesh", back_mat="titanium_grey")
    # 18 radial deployment ribs (characteristic of Umbra & QPS-SAR umbrella mesh antennas)
    for k in range(18):
        ang = 2.0 * math.pi * k / 18.0
        pl.bar(bus, (0.08 * math.cos(ang), 0.08 * math.sin(ang), z_apex + 0.01),
               (dish_r * 0.99 * math.cos(ang), dish_r * 0.99 * math.sin(ang), z_apex + 0.42),
               0.016, 0.020, "carbon_black", (0, 0, 1))
    # Tripod struts & central SAR feed horn
    feed_z = z_apex + 1.18
    for ang in (0.0, 2.094, 4.189):
        rx, ry = dish_r * 0.72 * math.cos(ang), dish_r * 0.72 * math.sin(ang)
        pl.bar(bus, (rx, ry, z_apex + 0.22), (0.0, 0.0, feed_z), 0.032, 0.032, "carbon_black", (0, 0, 1))
    pl.cylinder(bus, (0.0, 0.0, feed_z), (0, 0, -1), 0.10, 0.24, 16, "white_paint", top="cavity_dark", r1=0.13)
    _add_aft_module(bus, -bus_h / 2, bus_r)
    pl.finish(bus, root_obj)
    return _add_wings(root_obj, store, hy=bus_r, panel_l=1.10, panel_w=0.75, n_panels=2, single=single_wing)


def build_umbra(root_obj, store):
    return _build_sar_dish(root_obj, store, bus_r=0.58, bus_h=1.15, dish_r=1.80, single_wing=False)


def build_qps_sar(root_obj, store):
    return _build_sar_dish(root_obj, store, bus_r=0.52, bus_h=1.00, dish_r=1.75, single_wing=True)


SPECS = [
    ("theos-2", build_theos_2, [58016]),
    ("iceye", build_iceye, [43800, 44390, 46496, 46497, 56963, 58288, 58302, 59100, 59102, 59103, 60539, 60546, 60548, 60549, 62384, 62389, 62698, 62700, 62705, 62707, 63253, 63255, 63257, 63258, 64570, 64572, 64574, 64578, 64581, 64584, 66300, 66301, 66302, 66751, 66752, 66753, 66754, 66755, 67372, 67373, 68494, 68496, 68497, 68500, 68502, 68504, 68995, 68996, 69870, 69889, 69892, 69893, 100889, 100894, 100910, 100914, 101122, 101123, 101124, 101125]),
    ("umbra", build_umbra, [58297, 60541, 60547, 66748, 67371, 101129, 101130]),
    ("qps-sar", build_qps_sar, [58578, 59447, 60542, 63205, 64055, 64340, 65116, 66316, 66598, 67228, 67698, 68149, 69896, 100243, 100349, 100401, 100851, 100852, 101257, 101385]),
    ("worldview-legion", build_worldview_legion, [59625, 59626, 60452, 60453, 62900, 62901]),
    ("pleiades-neo", build_pleiades_neo, [48268, 49070]),
    ("cartosat-3", build_cartosat_3, [44804]),
    ("kompsat-7", build_kompsat_7, [66820]),
    ("superview-neo-1", build_superview_neo_1, [52320, 52322, 63125, 63126]),
    ("blacksky", build_blacksky, [43812, 44499, 47971, 49469, 49772, 49773, 49774, 49949, 49950, 51094, 52194, 52196, 52197, 52198, 52202, 55979, 55980, 55982, 55983, 62992, 63027, 64231, 66554, 68098, 100682]),
    ("eros-c3", build_eros_c3, [54880]),
    ("skysat", build_skysat, [39418, 40072, 41601, 41771, 41772, 41773, 41774, 42987, 42988, 42989, 42990, 42991, 42992, 43797]),
    ("pelican", build_pelican, [58296, 62631, 65315, 65316, 66667, 66703, 66704, 67322, 69018, 69019, 69871, 100886, 100887, 101128]),
    ("newsat", build_newsat, [52184, 55047, 55048, 56201, 56202, 56203, 56204, 56944, 56966, 56995, 56996, 57005, 57006, 57007, 58594, 58595, 58596, 58597, 59122, 59127, 60461, 60462, 60463, 60464, 60493, 60498, 60500, 62640, 66692, 66740, 66743, 68432, 68442, 100896, 100907, 101099]),
]


class _NoRenderArgs:
    render = False
    samples = 16


def main():
    catalog_path = os.path.join(MODELS_DIR, "catalog.json")
    with open(catalog_path, encoding="utf-8") as f:
        catalog = json.load(f)

    new_ids = {s[0] for s in SPECS}
    catalog["models"] = [m for m in catalog["models"] if m["id"] not in new_ids]

    for idx, (model_id, builder, norad_ids) in enumerate(SPECS):
        root = os.path.join(MODELS_DIR, model_id)
        texdir = os.path.join(root, "textures")
        os.makedirs(texdir, exist_ok=True)
        scene = pl.init_scene()
        root_obj = bpy.data.objects.new(model_id.replace("-", "_"), None)
        scene.collection.objects.link(root_obj)
        store = _make_store(texdir, seed=2026700 + idx * 10)
        wing_nodes = builder(root_obj, store)
        bbox, tri = pl.export_and_render(root, model_id, scene, _NoRenderArgs())
        entry = {
            "id": model_id,
            "glb": f"{model_id}/{model_id}.glb",
            "blocks": [],
            "norad_ids": norad_ids,
            "size_m": list(bbox),
            "triangles": tri,
            "wing_nodes": wing_nodes,
            "cell_normal": "-X",
            "status": "done",
        }
        insert_at = next((i for i, m in enumerate(catalog["models"]) if m["id"] == "generic"), len(catalog["models"]))
        catalog["models"].insert(insert_at, entry)

    with open(catalog_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("DONE building", len(SPECS), "high-detail EO models and updated catalog.json")


if __name__ == "__main__":
    main()
