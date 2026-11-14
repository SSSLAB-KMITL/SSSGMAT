"""Procedural QZSS GEO (QZS-3 / QZS-6 / QZS-7, MELCO DS2000) model -> qzss-geo.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/qzss-geo/scripts/build.py -- --root models/qzss-geo --render
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
# Dimensions (metres). Sources: Cabinet Office SPI-QZS3 / qzss.go.jp, eoPortal DS2000 GEO
#   - Bus: DS2000 ~2.36 x 2.30 x 5.00 m (+Z Earth-facing flat L-band & SBAS patch arrays)
#   - QZS-3 Expandable S-band Dish: Ø3.20 m reflector deployed on +X boom
#   - QZS-3 Fixed Ku-band Dish: Ø1.00 m reflector mounted on -X side of Earth deck
#   - Solar wings: 2 wings x 3 panels -> ~18.92 m span (~19 m)
# --------------------------------------------------------------------------------------
BUS = (2.360, 2.300, 5.000)
BUS_CZ = -0.050                             # Z in [-2.55, +2.45]
HX, HY = BUS[0] / 2, BUS[1] / 2
Z_BOT = BUS_CZ - BUS[2] / 2                 # -2.55
Z_TOP = BUS_CZ + BUS[2] / 2                 # +2.45

N_PANELS = 3
PANEL_L, PANEL_W, PANEL_T = 2.480, 1.800, 0.028
PANEL_GAP = 0.060
YOKE_LEN = 0.750                            # wing_tip = 1.15 + 0.75 + 7.44 + 0.12 = 9.46 -> span 18.92 m
SADM_X, SADM_Z = 0.0, BUS_CZ

SBAND_DISH_R = 1.600                        # Ø3.20 m expandable S-band reflector (qzss.go.jp)
KU_DISH_R = 0.500                           # Ø1.00 m fixed Ku-band dish (qzss.go.jp)

store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=32, rows=18, seed=2026211)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=2026212)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)
l_pa = pl.tex_phased_array(TEXDIR, "tex_lband_patch", nx=6, ny=6,
                           bg_rgb=(0.90, 0.90, 0.88), patch_rgb=(0.76, 0.60, 0.24))
store.make("lband_patch_mat", (0.88, 0.88, 0.86), 0.1, 0.40, l_pa)
sbas_pa = pl.tex_phased_array(TEXDIR, "tex_sbas_patch", nx=4, ny=4,
                              bg_rgb=(0.90, 0.90, 0.88), patch_rgb=(0.68, 0.52, 0.22))
store.make("sbas_patch_mat", (0.88, 0.88, 0.86), 0.1, 0.40, sbas_pa)

ROOTOBJ = bpy.data.objects.new("qzss_geo", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# 1. DS2000 GEO Bus + Launch Adapter
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, BUS_CZ), BUS, bevel_offset=0.028, segments=3,
             mat={"+z": "mli_white", "-z": "mli_gold",
                  "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})

TO = 0.006
for sgn_y in (1, -1):
    for cz in (BUS_CZ + 1.08, BUS_CZ - 1.08):
        pl.box(p, (0.0, sgn_y * (HY + TO / 2 + 0.002), cz), (1.72, TO, 1.72),
               "osr_radiator", uv="tile", tile=0.22)
    pl.box(p, (0.0, sgn_y * (HY + 0.015), BUS_CZ), (1.88, 0.026, 0.34), "aluminium")

for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + 0.012), 0.0, BUS_CZ - 0.85), (0.022, 1.46, 1.35), "osr_radiator", uv="tile", tile=0.20)

# -Z Adapter Ring & Apogee Engine
pl.cylinder(p, (0, 0, Z_BOT), (0, 0, -1), 0.72, 0.34, 24, "titanium_grey", r1=0.62, top="black_paint")
pl.cylinder(p, (0, 0, Z_BOT - 0.34), (0, 0, -1), 0.65, 0.05, 24, "aluminium", top="titanium_grey")
pl.cylinder(p, (0, 0, Z_BOT - 0.25), (0, 0, -1), 0.18, 0.16, 18, "black_paint", r1=0.25)

# Star trackers & corner thrusters
for sy in (1, -1):
    pl.cylinder(p, (-HX, sy * 0.72, BUS_CZ + 1.90), (-0.7, sy * 0.35, 0.62), 0.095, 0.24, 14,
                "white_paint", r1=0.135, top="black_paint")
for sx in (1, -1):
    for sy in (1, -1):
        pl.box(p, (sx * (HX + 0.05), sy * (HY - 0.18), Z_BOT + 0.18), (0.12, 0.12, 0.12), "titanium_grey")
pl.finish(p, ROOTOBJ)

# 2. +Z Flat L-Band Patch Array & L1S/SBAS Augmentation Array (Distinct from IGSO Helix Cone)
p = pl.Part("nadir_patches", store)
pl.box(p, (0.0, 0.0, Z_TOP + 0.025), (2.24, 2.18, 0.05), "aluminium")

# Primary L-band flat patch panel
pl.box(p, (+0.16, -0.18, Z_TOP + 0.11), (1.36, 1.36, 0.12),
       {"+z": "lband_patch_mat", "default": "white_paint"}, uv="fit")
pl.box(p, (+0.16, -0.18, Z_TOP + 0.08), (1.42, 1.42, 0.06), "gold_kapton")

# Secondary L1S / SBAS patch panel
pl.box(p, (+0.45, +0.76, Z_TOP + 0.10), (0.56, 0.44, 0.10),
       {"+z": "sbas_patch_mat", "default": "white_paint"}, uv="fit")

# LRA_QZS_2 (matching J003 SNX -X/+Y placement)
pl.lrr_array(p, (-0.84, +0.46, Z_TOP + 0.05), (0.34, 0.28, 0.055), nx=6, ny=5, staggered=True)

# S-band / TT&C omni & horn
pl.cylinder(p, (+0.92, +0.86, Z_TOP + 0.05), (0.0, 0.0, 1.0), 0.022, 0.42, 10, "titanium_grey", top="radome_white")
pl.cylinder(p, (-0.75, -0.82, Z_TOP + 0.05), (0.0, 0.0, 1.0), 0.10, 0.16, 14, "gold_kapton", r1=0.13, top="black_paint")
pl.finish(p, ROOTOBJ)

# 3. Side-Mounted Reflector Dishes: Ø3.20 m S-Band Expandable Dish (+X) & Ø1.00 m Ku-Band Dish (-X)
p = pl.Part("reflectors", store)
# +X Ø3.20 m expandable S-band dish boom + mesh dish + tension hoop + feed tower
s_hinge = Vector((HX, 0.0, BUS_CZ + 1.15))
s_apex = Vector((+2.76, 0.0, BUS_CZ + 1.55))
pl.box(p, (HX + 0.05, 0.0, BUS_CZ + 1.15), (0.10, 0.26, 0.26), "titanium_grey")
pl.bar(p, s_hinge, s_apex, 0.065, 0.055, "titanium_grey", (0, 1, 0))
pl.bar(p, s_hinge + Vector((0, 0, -0.35)), s_apex + Vector((-0.25, 0, -0.05)), 0.045, 0.040, "titanium_grey", (0, 1, 0))
pl.parabolic_dish(
    p, s_apex, (-0.12, 0.0, 1.0),
    radius=SBAND_DISH_R, depth=0.38, rings=6, segs=32,
    front_mat="mesh_gold", back_mat="titanium_grey", feed_len=1.25,
)

# -X Ø1.00 m fixed Ku-band dish on short boom pointing +Z
k_hinge = Vector((-HX, -0.32, Z_TOP - 0.22))
k_apex = Vector((-1.78, -0.32, Z_TOP + 0.02))
pl.box(p, (-HX - 0.05, -0.32, Z_TOP - 0.22), (0.10, 0.20, 0.20), "titanium_grey")
pl.bar(p, k_hinge, k_apex, 0.055, 0.045, "titanium_grey", (0, 1, 0))
pl.parabolic_dish(
    p, k_apex, (+0.08, 0.0, 1.0),
    radius=KU_DISH_R, depth=0.16, rings=5, segs=24,
    front_mat="radome_white", back_mat="titanium_grey", feed_len=0.45,
)
pl.finish(p, ROOTOBJ)

# 4. SADM & 3-Panel Solar Wings
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY, sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS, panel_l=PANEL_L, panel_w=PANEL_W,
    panel_t=PANEL_T, panel_gap=PANEL_GAP, yoke_style="v_strut",
    wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x",
)

pl.export_and_render(ROOT, "qzss-geo", scene, args)

