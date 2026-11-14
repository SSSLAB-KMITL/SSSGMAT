"""Procedural CAST BeiDou-2 GEO (DFH-3A, BDS-2G) satellite model -> bds2-geo.glb.

Separated from bds2-igso because BDS-2G carries the large (+X/+Z) deployable
C/S-band RDSS Communication Antenna (CA, ~3.14 m^2 / Ø2.00 m) and uses the
shifted BDS-2G LRA_BDS_SHAO_90 deck coordinates (-0.6241, -0.5705, +1.1000) m.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/bds2-geo/scripts/build.py -- --root models/bds2-geo --render
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_tools"))
import proc_lib as pl  # noqa: E402

args, ROOT, TEXDIR = pl.parse_build_args()
scene = pl.init_scene()

# --------------------------------------------------------------------------------------
# Dimensions (metres). official / derived / est.
# Sources:
#   - Montenbruck et al. (2015), Guo et al. (2016), CSNO BDS-2G metadata:
#       DFH-3A bus box: X_B = 2.000 m, Y_B = 1.720 m, Z_B = 2.200 m (Z in [-1.100, +1.100] m).
#       Large deployable RDSS Communication Antenna (CA) on +X connecting to +Z:
#         effective area ~3.14 m^2 -> Ø2.00 m parabolic reflector (DISH_R = 1.000 m) centered
#         at X = +1.950 m -> X extent [-1.025, +2.950] = 3.975 m.
#   - IGS igs_satellite_metadata.snx (BDS-2G):
#       LRA_BDS_SHAO_90 (90 prisms) at (-0.6241, -0.5705, +1.1000) m.
#   - Solar wings: 2 wings, 3 panels/wing (2.080 x 1.640 m = 10.234 m^2/wing, 20.47 m^2 total),
#       yoke 0.900 m, gap 0.060 m, SADM at Y = +-0.860 m -> deployed span Y = 16.240 m.
# --------------------------------------------------------------------------------------
BUS = (2.000, 1.720, 2.200)
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 3
PANEL_L, PANEL_W, PANEL_T = 2.080, 1.640, 0.025
PANEL_GAP = 0.060
YOKE_LEN = 0.900
SADM_X, SADM_Z = 0.0, 0.0

RDSS_DISH_R = 1.000                         # Ø2.00 m (~3.14 m^2) single deployable RDSS CA dish on +X
RDSS_DISH_CX = +1.950                       # X max = +1.950 + 1.000 = +2.950 m (total X = 3.975 m)

store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=28, rows=16, seed=2026121)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=2026122)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("bds2_geo", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# 1. CAST DFH-3A Rectangular Bus
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.024, segments=3,
             mat={"+z": "mli_gold", "-z": "mli_gold",
                  "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})

# Thermal louver frame on -X (out to X = -1.025 m) and hinge panel on +X
pl.box(p, (-HX - 0.0125, 0.0, 0.0), (0.025, 1.18, 1.54), "aluminium", uv="tile", tile=0.20)
pl.box(p, (+HX + 0.010, 0.0, 0.0), (0.020, 1.10, 1.40), "aluminium", uv="tile", tile=0.20)

TO = 0.005
for sgn_y in (1, -1):
    pl.box(p, (-0.36, sgn_y * (HY + TO / 2 + 0.002), +0.16), (0.84, TO, 1.50),
           "osr_radiator", uv="tile", tile=0.18)
    pl.box(p, (+0.44, sgn_y * (HY + TO / 2 + 0.002), -0.14), (0.64, TO, 1.35),
           "osr_radiator", uv="tile", tile=0.18)
pl.finish(p, ROOTOBJ)

# 2. Large Deployable C/S-Band RDSS Communication Antenna (CA) on +X -> +Z
p = pl.Part("rdss_ca_dish", store)
hinge_pt = Vector((+HX, 0.0, +0.42))
apex_pt = Vector((RDSS_DISH_CX, 0.0, +0.72))
pl.box(p, (+HX + 0.05, 0.0, +0.42), (0.10, 0.24, 0.24), "titanium_grey")
pl.bar(p, hinge_pt, apex_pt, 0.060, 0.050, "titanium_grey", (0, 1, 0))
pl.bar(p, hinge_pt + Vector((0, 0, -0.28)), apex_pt + Vector((-0.22, 0, -0.04)),
       0.042, 0.038, "titanium_grey", (0, 1, 0))
pl.parabolic_dish(
    p, (RDSS_DISH_CX, 0.0, +0.72), (0, 0, 1),
    radius=RDSS_DISH_R, depth=0.28, rings=6, segs=32,
    front_mat="mesh_gold", back_mat="titanium_grey", feed_len=0.0,
)
# Feed horn cluster on +X edge of +Z deck illuminating the RDSS reflector
feed_base = Vector((+HX - 0.12, 0.0, HZ))
for iy in (-0.16, 0.0, +0.16):
    pl.cylinder(p, feed_base + Vector((0, iy, 0)), (+0.38, 0, 1.0),
                0.052, 0.22, 14, "mli_gold", top="radome_white", r1=0.070)
pl.finish(p, ROOTOBJ)

# 3. Earth-Facing (+Z) L-Band Navigation Array, TT&C Dish & BDS-2G SHAO-90 LRA
p = pl.Part("nadir_payload_deck", store)
nav_cx, nav_cy = +0.160, +0.140
pl.cylinder(p, (nav_cx, nav_cy, HZ), (0, 0, 1), 0.56, 0.050, 32,
            "mli_gold", top="aluminium")
z_ant = HZ + 0.050
for r_ring, n_el, phase in ((0.19, 4, 45.0), (0.42, 8, 22.5)):
    for k in range(n_el):
        ang = math.radians(phase + 360.0 * k / n_el)
        bx = nav_cx + r_ring * math.cos(ang)
        by = nav_cy + r_ring * math.sin(ang)
        pl.helical_element(
            p, (bx, by, z_ant), (0, 0, 1),
            r_cup=0.064, h_cup=0.050, r_rod=0.028, h_rod=0.320,
            cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
        )

# Telemetry / C-band beacon dish on (-X, +Y) corner of +Z deck
pl.cylinder(p, (-0.54, +0.44, HZ), (0, 0, 1), 0.055, 0.14, 16, "titanium_grey")
pl.parabolic_dish(p, (-0.54, +0.44, HZ + 0.14), (0, 0, 1),
                  radius=0.30, depth=0.08, rings=4, segs=24,
                  front_mat="white_paint", back_mat="titanium_grey", feed_len=0.20)

# Official BDS-2G LRA_BDS_SHAO_90 at (-0.6241, -0.5705, +1.1000) m
pl.lrr_array(p, (-0.624, -0.571, HZ), (0.44, 0.36, 0.050), nx=10, ny=9)

pl.cylinder(p, (+0.74, -0.58, HZ), (0, 0, 1), 0.050, 0.24, 16,
            "white_paint", top="titanium_grey", r1=0.032)
pl.box(p, (+0.72, -0.22, HZ + 0.06), (0.18, 0.16, 0.12), "black_paint")
pl.finish(p, ROOTOBJ)

# 4. Zenith (-Z) CZ-3A Launch Adapter Ring & 490 N LAE
p = pl.Part("zenith_propulsion", store)
pl.cylinder(p, (0.0, 0.0, -HZ - 0.090), (0, 0, 1), 0.56, 0.090, 32,
            "aluminium", bottom="titanium_grey")
pl.cylinder(p, (0.0, 0.0, -HZ - 0.300), (0, 0, 1), 0.22, 0.210, 24,
            "titanium_grey", bottom="black_paint", r1=0.10)
for sx in (1, -1):
    for sy in (1, -1):
        b0 = Vector((sx * (HX - 0.10), sy * (HY - 0.10), -HZ))
        d = Vector((0.18 * sx, 0.18 * sy, -1.0)).normalized()
        pl.cylinder(p, b0, d, 0.022, 0.075, 10, "titanium_grey", r1=0.034, top="black_paint")
pl.finish(p, ROOTOBJ)

# 5. SADMs + Solar Wings (wing+Y, wing-Y)
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY,
    sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS,
    panel_l=PANEL_L, panel_w=PANEL_W, panel_t=PANEL_T, panel_gap=PANEL_GAP,
    yoke_style="v_strut", wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x",
)

pl.export_and_render(ROOT, "bds2-geo", scene, args)
