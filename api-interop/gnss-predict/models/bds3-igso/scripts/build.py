"""Procedural CAST BeiDou-3 IGSO (DFH-3B, BDS-3I) satellite model -> bds3-igso.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/bds3-igso/scripts/build.py -- --root models/bds3-igso --render
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
#   - CSNO (2019) "BeiDou Satellite Metadata" & CAST DFH-3B IGSO bus specifications:
#       Bus box: X_B = 2.100 m, Y_B = 2.000 m, Z_B = 3.100 m (launch mass ~4200 kg).
#       Unlike BDS-3G (GEO), BDS-3I (IGSO) does not carry the twin Ø2.2 m side RDSS mesh
#       reflectors; instead it carries a +Z L-band phased array, Ka-band ISL phased array,
#       and a compact +X regional S/C-band dish (Ø0.84 m, extending X to [-1.08, +1.28] m = 2.36 m).
#   - Solar wings: 2 wings, 3 panels/wing (2.300 m x 1.800 m = 12.42 m^2/wing, 24.84 m^2 total),
#       yoke 1.000 m, gap 0.060 m -> deployed span Y = 18.040 m.
#   - IGS igs_satellite_metadata.snx:
#       LRA_BDS_SHAO_90 (90 corner-cube prisms) at (-0.9893, -0.7118, +1.9724) m.
# --------------------------------------------------------------------------------------
BUS = (2.100, 2.000, 3.100)                 # CAST DFH-3B bus (X, Y, Z) m
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 3
PANEL_L, PANEL_W, PANEL_T = 2.300, 1.800, 0.026
PANEL_GAP = 0.060
YOKE_LEN = 1.000                            # wing_tip = 1.000 + 1.000 + 6.900 + 0.120 = 9.020 m -> span 18.040 m
SADM_X, SADM_Z = 0.0, 0.0

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=30, rows=18, seed=202695)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=202696)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("bds3_igso", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# 1. CAST DFH-3B Tall Bus (Gold MLI + OSR North/South Radiator Mirrors)
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.026, segments=3,
             mat={"+z": "mli_gold", "-z": "mli_gold",
                  "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})

# End-frame thermal radiator louvers on +-X (extend X to -1.080 m on -X)
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + 0.015), 0.0, +0.10), (0.030, 1.40, 2.20),
           "aluminium", uv="tile", tile=0.22)

# Large OSR mirror radiator panels on +-Y faces
TO = 0.005
for sgn_y in (1, -1):
    pl.box(p, (-0.42, sgn_y * (HY + TO / 2 + 0.002), +0.25), (0.96, TO, 2.20),
           "osr_radiator", uv="tile", tile=0.20)
    pl.box(p, (+0.48, sgn_y * (HY + TO / 2 + 0.002), -0.20), (0.72, TO, 1.95),
           "osr_radiator", uv="tile", tile=0.20)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 2. Earth-Facing (+Z) L-Band Navigation Array, Ka-Band ISL, S-Band Dish & SHAO-90 LRA
# --------------------------------------------------------------------------------------
p = pl.Part("nadir_payload_deck", store)
# Raised circular L-band phased-array platform (Ø1.36 m) centered at (-0.12, +0.10, HZ)
nav_cx, nav_cy = -0.120, +0.100
pl.cylinder(p, (nav_cx, nav_cy, HZ), (0, 0, 1), 0.68, 0.060, 32,
            "mli_gold", top="aluminium")
z_ant = HZ + 0.060
# 19 L-band helical elements (1 center + 6 inner at r=0.25 m + 12 outer at r=0.52 m)
# Top at Z = HZ + 0.060 + 0.440 = +2.050 m
pl.helical_element(
    p, (nav_cx, nav_cy, z_ant), (0, 0, 1),
    r_cup=0.064, h_cup=0.055, r_rod=0.028, h_rod=0.385,
    cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
)
for r_ring, n_el, phase in ((0.25, 6, 0.0), (0.52, 12, 15.0)):
    for k in range(n_el):
        ang = math.radians(phase + 360.0 * k / n_el)
        bx = nav_cx + r_ring * math.cos(ang)
        by = nav_cy + r_ring * math.sin(ang)
        pl.helical_element(
            p, (bx, by, z_ant), (0, 0, 1),
            r_cup=0.062, h_cup=0.055, r_rod=0.028, h_rod=0.385,
            cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
        )

# Ka-band Inter-Satellite Link (ISL) phased-array transceiver on +Z deck (+0.52, +0.46, HZ)
pl.box(p, (+0.52, +0.46, HZ + 0.060), (0.58, 0.58, 0.120),
       {"+z": "titanium_grey", "default": "mli_silver"})
pl.box(p, (+0.52, +0.46, HZ + 0.138), (0.50, 0.50, 0.036),
       {"+z": "radome_white", "default": "aluminium"})

# Compact S/C-band dish (Ø0.84 m, r=0.42 m) on +X edge of +Z deck (centered at X = +0.86 m -> max X = +1.280 m)
pl.cylinder(p, (+0.86, -0.36, HZ), (0, 0, 1), 0.075, 0.16, 16, "titanium_grey")
pl.parabolic_dish(p, (+0.86, -0.36, HZ + 0.16), (0, 0, 1),
                  radius=0.42, depth=0.10, rings=5, segs=28,
                  front_mat="mesh_gold", back_mat="titanium_grey", feed_len=0.28)

# Official LRA_BDS_SHAO_90 (90 corner-cube prisms) at (-0.820, -0.712, +1.972) m
# Mounted on an elevated support pedestal on the (-X, -Y) corner of the +Z deck
# (SINEX Z = +1.9724 m, Y = -0.7118 m)
pl.box(p, (-0.820, -0.712, HZ + 0.184), (0.18, 0.18, 0.368), "titanium_grey")
pl.lrr_array(p, (-0.820, -0.712, HZ + 0.368), (0.46, 0.38, 0.054), nx=10, ny=9)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 3. Zenith (-Z) Launch Vehicle Adapter Ring & Liquid Apogee Engine (490 N)
# --------------------------------------------------------------------------------------
p = pl.Part("zenith_propulsion", store)
pl.cylinder(p, (0.0, 0.0, -HZ - 0.100), (0, 0, 1), 0.597, 0.100, 36,
            "aluminium", bottom="titanium_grey")
pl.cylinder(p, (0.0, 0.0, -HZ - 0.350), (0, 0, 1), 0.24, 0.250, 24,
            "titanium_grey", bottom="black_paint", r1=0.11)
for sx in (1, -1):
    for sy in (1, -1):
        b0 = Vector((sx * (HX - 0.12), sy * (HY - 0.12), -HZ))
        d = Vector((0.18 * sx, 0.18 * sy, -1.0)).normalized()
        pl.cylinder(p, b0, d, 0.024, 0.085, 10, "titanium_grey", r1=0.036, top="black_paint")
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

pl.export_and_render(ROOT, "bds3-igso", scene, args)
