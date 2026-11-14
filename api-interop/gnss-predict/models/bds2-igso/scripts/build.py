"""Procedural CAST BeiDou-2 IGSO/GEO/MEO (DFH-3A, BDS-2I / BDS-2G / BDS-2M) model -> bds2-igso.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/bds2-igso/scripts/build.py -- --root models/bds2-igso --render
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
#   - Montenbruck et al. (2015), Guo et al. (2016) & CAST DFH-3A bus specifications:
#       Bus box: X_B = 2.000 m, Y_B = 1.720 m, Z_B = 2.200 m (Z in [-1.100, +1.100] m).
#   - IGS igs_satellite_metadata.snx:
#       BDS-2I: LRA_BDS_SHAO_90 (90 prisms) at (-0.4173, -0.5729, +1.1001) m
#       BDS-2G: LRA_BDS_SHAO_90 (90 prisms) at (-0.6241, -0.5705, +1.1000) m
#       BDS-2M: LRA_BDS_SHAO_42 (42 prisms) at (-0.4321, -0.5621, +1.1128) m
#       (All sit directly on the +Z bus deck at Z = +1.100 m!)
#   - Solar wings: 2 wings, 3 panels/wing (2.080 m x 1.640 m = 10.234 m^2/wing, 20.47 m^2 total),
#       yoke 0.900 m, gap 0.060 m, SADM at Y = +-0.860 m -> deployed span Y = 16.240 m.
# --------------------------------------------------------------------------------------
BUS = (2.000, 1.720, 2.200)                 # official CAST DFH-3A bus (X, Y, Z) m
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 3
PANEL_L, PANEL_W, PANEL_T = 2.080, 1.640, 0.025
PANEL_GAP = 0.060
YOKE_LEN = 0.900                            # wing_tip = 0.860 + 0.900 + 6.240 + 0.120 = 8.120 m -> span 16.240 m
SADM_X, SADM_Z = 0.0, 0.0

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=28, rows=16, seed=2026111)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=2026112)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("bds2_igso", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# 1. CAST DFH-3A Rectangular Bus (Gold Kapton MLI + OSR Radiator Mirrors on +-Y)
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.024, segments=3,
             mat={"+z": "mli_gold", "-z": "mli_gold",
                  "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})

# End-plate thermal louvers on +-X (extend X to +-1.025 m -> 2.050 m)
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + 0.0125), 0.0, 0.0), (0.025, 1.18, 1.54),
           "aluminium", uv="tile", tile=0.20)

# OSR mirror radiators on +-Y faces
TO = 0.005
for sgn_y in (1, -1):
    pl.box(p, (-0.36, sgn_y * (HY + TO / 2 + 0.002), +0.16), (0.84, TO, 1.50),
           "osr_radiator", uv="tile", tile=0.18)
    pl.box(p, (+0.44, sgn_y * (HY + TO / 2 + 0.002), -0.14), (0.64, TO, 1.35),
           "osr_radiator", uv="tile", tile=0.18)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 2. Earth-Facing (+Z) L-Band Navigation Array, S/C-Band Dish & SHAO-90 LRA
# --------------------------------------------------------------------------------------
p = pl.Part("nadir_payload_deck", store)
# Circular L-band navigation antenna array on +Z deck centered at (+0.16, +0.14, HZ)
nav_cx, nav_cy = +0.160, +0.140
pl.cylinder(p, (nav_cx, nav_cy, HZ), (0, 0, 1), 0.56, 0.050, 32,
            "mli_gold", top="aluminium")
z_ant = HZ + 0.050
# 12 L-band helical cup elements (4 inner at r=0.19 m + 8 outer at r=0.42 m)
# Top reaches Z = HZ + 0.050 + 0.370 = +1.520 m
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

# Regional S/C-band dish antenna on -X side of +Z deck (-0.54, +0.28, HZ)
pl.cylinder(p, (-0.54, +0.28, HZ), (0, 0, 1), 0.065, 0.14, 16, "titanium_grey")
pl.parabolic_dish(p, (-0.54, +0.28, HZ + 0.14), (0, 0, 1),
                  radius=0.38, depth=0.09, rings=5, segs=24,
                  front_mat="mesh_gold", back_mat="titanium_grey", feed_len=0.24)

# Official LRA_BDS_SHAO_90 (90 corner-cube prisms) at (-0.417, -0.573, +1.100) m
pl.lrr_array(p, (-0.417, -0.573, HZ), (0.44, 0.36, 0.050), nx=10, ny=9)

# S-band TT&C horn & Earth sensor on (+X, -Y) corner of +Z deck
pl.cylinder(p, (+0.74, -0.58, HZ), (0, 0, 1), 0.050, 0.24, 16,
            "white_paint", top="titanium_grey", r1=0.032)
pl.box(p, (+0.72, -0.22, HZ + 0.06), (0.18, 0.16, 0.12), "black_paint")
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 3. Zenith (-Z) CZ-3A Launch Adapter Ring & 490 N Liquid Apogee Engine
# --------------------------------------------------------------------------------------
p = pl.Part("zenith_propulsion", store)
# Extends down to Z = -HZ - 0.300 = -1.400 m -> total Z = 2.920 m
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

# --------------------------------------------------------------------------------------
# 4. SADMs + Solar Wings (wing+Y, wing-Y)
# --------------------------------------------------------------------------------------
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY,
    sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS,
    panel_l=PANEL_L, panel_w=PANEL_W, panel_t=PANEL_T, panel_gap=PANEL_GAP,
    yoke_style="v_strut", wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x",
)

pl.export_and_render(ROOT, "bds2-igso", scene, args)
