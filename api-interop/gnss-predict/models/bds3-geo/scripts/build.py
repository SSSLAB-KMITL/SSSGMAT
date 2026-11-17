"""Procedural CAST BeiDou-3 GEO (DFH-3B, BDS-3G) satellite model -> bds3-geo.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/bds3-geo/scripts/build.py -- --root models/bds3-geo --render
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
#   - CSNO (2019) "BeiDou Satellite Metadata" & CAST DFH-3B bus specifications:
#       Bus box: X_B = 2.100 m, Y_B = 2.000 m, Z_B = 3.100 m (launch mass ~4600 kg).
#   - Twin deployable S/C-band RDSS gold-mesh parabolic reflectors on +-X faces:
#       Dish diameter 2.00 m (radius 1.00 m, ~3.14 m^2 aperture matching CAST GEO RDSS
#       specifications), centered at X = +-2.18 m -> total X = 6.360 m.
#       (Previous estimate used 2.20 m dishes / 6.900 m X extent.)
#   - Solar wings: 2 wings, 3 panels/wing (2.450 m x 1.860 m = 13.67 m^2/wing, 27.34 m^2 total),
#       yoke 1.050 m, gap 0.060 m -> deployed span Y = 19.040 m.
#   - IGS igs_satellite_metadata.snx:
#       LRA_BDS_SHAO_90 (90 corner-cube prisms) at (+0.5896, -0.0845) m on +Z deck.
# --------------------------------------------------------------------------------------
BUS = (2.100, 2.000, 3.100)                 # CAST DFH-3B bus (X, Y, Z) m
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 3
PANEL_L, PANEL_W, PANEL_T = 2.450, 1.860, 0.028
PANEL_GAP = 0.060
YOKE_LEN = 1.050                            # wing_tip = 1.000 + 1.050 + 7.350 + 0.120 = 9.520 m -> span 19.040 m
SADM_X, SADM_Z = 0.0, 0.0

DISH_R = 1.000                              # Ø2.00 m (~3.14 m^2) deployable RDSS mesh reflectors on +-X
DISH_CX = 2.180                             # X extent = +- (2.180 + 1.000) = +-3.180 m -> 6.360 m

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=32, rows=18, seed=202691)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=202692)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("bds3_geo", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# 1. CAST DFH-3B Tall Communications/Navigation Bus (Gold MLI + OSR North/South Panels)
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.026, segments=3,
             mat={"+z": "mli_gold", "-z": "mli_gold",
                  "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})

# Large OSR mirror radiator panels on +-Y (North/South) faces
TO = 0.005
for sgn_y in (1, -1):
    pl.box(p, (-0.42, sgn_y * (HY + TO / 2 + 0.002), +0.25), (0.96, TO, 2.20),
           "osr_radiator", uv="tile", tile=0.20)
    pl.box(p, (+0.48, sgn_y * (HY + TO / 2 + 0.002), -0.20), (0.72, TO, 1.95),
           "osr_radiator", uv="tile", tile=0.20)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 2. Twin Deployable S/C-Band RDSS Gold-Mesh Parabolic Reflectors (+X and -X)
# --------------------------------------------------------------------------------------
p = pl.Part("rdss_mesh_reflectors", store)
for sgn_x in (1, -1):
    # Articulated deployment boom from +-X bus wall to dish apex at (sgn_x * 2.350, 0.0, +0.920)
    hinge_pt = Vector((sgn_x * HX, 0.0, +0.55))
    apex_pt = Vector((sgn_x * DISH_CX, 0.0, +0.92))
    pl.box(p, (sgn_x * (HX + 0.05), 0.0, +0.55), (0.10, 0.24, 0.24), "titanium_grey")
    pl.bar(p, hinge_pt, apex_pt, 0.065, 0.055, "titanium_grey", (0, 1, 0))
    pl.bar(p, hinge_pt + Vector((0, 0, -0.32)), apex_pt + Vector((-sgn_x * 0.25, 0, -0.05)),
           0.045, 0.040, "titanium_grey", (0, 1, 0))
    # Ø2.00 m parabolic gold-mesh reflector dish pointing +Z (toward Earth)
    pl.parabolic_dish(
        p, (sgn_x * DISH_CX, 0.0, +0.92), (0, 0, 1),
        radius=DISH_R, depth=0.30, rings=6, segs=32,
        front_mat="mesh_gold", back_mat="titanium_grey", feed_len=0.0,
    )
    # Offset feed horn array on +-X edge of +Z deck illuminating the side dish
    feed_base = Vector((sgn_x * (HX - 0.14), 0.0, HZ))
    for iy in (-0.18, 0.0, +0.18):
        pl.cylinder(p, feed_base + Vector((0, iy, 0)), (sgn_x * 0.35, 0, 1.0),
                    0.055, 0.22, 14, "mli_gold", top="radome_white", r1=0.075)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 3. Earth-Facing (+Z) L-Band Navigation Array, Ka/C-Band Horns & SHAO-90 LRA
# --------------------------------------------------------------------------------------
p = pl.Part("nadir_payload_deck", store)
# Raised circular L-band phased-array platform (Ø1.36 m) centered at (-0.18, 0.0, HZ)
nav_cx, nav_cy = -0.180, 0.0
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

# Steerable Ka-band / SBAS dish antenna on +Z deck (+0.52, +0.56, HZ)
pl.cylinder(p, (+0.52, +0.56, HZ), (0, 0, 1), 0.06, 0.18, 16, "titanium_grey")
pl.parabolic_dish(p, (+0.52, +0.56, HZ + 0.18), (0, 0, 1),
                  radius=0.32, depth=0.08, rings=4, segs=24,
                  front_mat="white_paint", back_mat="mli_gold", feed_len=0.22)

# Official LRA_BDS_SHAO_90 (90 corner-cube prisms, 10x9 array) at (+0.590, -0.085, HZ)
pl.lrr_array(p, (+0.590, -0.085, HZ), (0.46, 0.38, 0.055), nx=10, ny=9)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 4. Zenith (-Z) Launch Vehicle Adapter Ring & Liquid Apogee Engine (490 N)
# --------------------------------------------------------------------------------------
p = pl.Part("zenith_propulsion", store)
pl.cylinder(p, (0.0, 0.0, -HZ - 0.100), (0, 0, 1), 0.597, 0.100, 36,
            "aluminium", bottom="titanium_grey")
# 490 N liquid apogee engine nozzle (down to Z = -HZ - 0.350 = -1.900 m -> total Z = 3.950 m)
pl.cylinder(p, (0.0, 0.0, -HZ - 0.350), (0, 0, 1), 0.24, 0.250, 24,
            "titanium_grey", bottom="black_paint", r1=0.11)
for sx in (1, -1):
    for sy in (1, -1):
        b0 = Vector((sx * (HX - 0.12), sy * (HY - 0.12), -HZ))
        d = Vector((0.18 * sx, 0.18 * sy, -1.0)).normalized()
        pl.cylinder(p, b0, d, 0.024, 0.085, 10, "titanium_grey", r1=0.036, top="black_paint")
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 5. SADMs + Solar Wings (wing+Y, wing-Y)
# --------------------------------------------------------------------------------------
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY,
    sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS,
    panel_l=PANEL_L, panel_w=PANEL_W, panel_t=PANEL_T, panel_gap=PANEL_GAP,
    yoke_style="v_strut", wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x",
)

pl.export_and_render(ROOT, "bds3-geo", scene, args)
