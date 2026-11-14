"""Procedural NavIC / IRNSS-1 (ISRO I-1K bus, IRS-1G / IRS-1I) model -> navic-irnss1.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/navic-irnss1/scripts/build.py -- --root models/navic-irnss1 --render
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_tools"))
import proc_lib as pl  # noqa: E402

args, ROOT, TEXDIR = pl.parse_build_args()
scene = pl.init_scene()

# --------------------------------------------------------------------------------------
# Dimensions (metres). Sources: ISRO / URSC official IRNSS-1 docs, eoPortal, IGS SNX
#   - I-1K main bus cuboid: 1.580 (X) x 1.500 (Y) x 1.500 (Z) m
#   - Two deployed solar arrays (wing+Y, wing-Y): 2.15 m x 1.80 m each -> 1660 W
#     Wait: modeled as 2 hinged sub-panels (1.06 m x 1.80 m, gap 0.04 m) + 0.55 m yoke
#     -> wing_tip = 0.75 + 0.55 + 2.12 + 0.04 = 3.46 m -> Y span = 6.92 m
#   - +Z deck: Dual-band L5 + S-band helical array + C-band horns + LRA_IRNSS_1
#   - -Z face: Central 440 N LAM apogee motor nozzle + thermal shield + adapter ring
# --------------------------------------------------------------------------------------
BUS = (1.580, 1.500, 1.500)
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 2
PANEL_L, PANEL_W, PANEL_T = 1.060, 1.800, 0.024
PANEL_GAP = 0.040
YOKE_LEN = 0.550
SADM_X, SADM_Z = 0.0, 0.0

store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=16, rows=18, seed=2026311)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=2026312)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("navic_irnss1", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# 1. ISRO I-1K Cuboid Bus (Gold Kapton MLI + OSR Radiators on +-Y)
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.022, segments=3,
             mat={"+z": "mli_white", "-z": "mli_gold",
                  "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})

TO = 0.005
for sgn_y in (1, -1):
    pl.box(p, (0.0, sgn_y * (HY + TO / 2 + 0.002), 0.36), (1.15, TO, 0.52), "osr_radiator", uv="tile", tile=0.18)
    pl.box(p, (0.0, sgn_y * (HY + TO / 2 + 0.002), -0.36), (1.15, TO, 0.52), "osr_radiator", uv="tile", tile=0.18)
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + 0.008), 0.0, 0.0), (0.015, 0.96, 0.88), "osr_radiator", uv="tile", tile=0.18)

# -Z LAM 440 N Liquid Apogee Motor + Thermal Shield Cone + Launch Adapter Ring
pl.cylinder(p, (0, 0, -HZ), (0, 0, -1), 0.52, 0.14, 24, "titanium_grey", r1=0.46, top="black_paint")
pl.cylinder(p, (0, 0, -HZ - 0.14), (0, 0, -1), 0.24, 0.06, 20, "aluminium", r1=0.28)
pl.cylinder(p, (0, 0, -HZ - 0.16), (0, 0, -1), 0.10, 0.20, 18, "black_paint", r1=0.18)

# Star trackers & corner RCS thruster blocks
for sy in (1, -1):
    pl.cylinder(p, (-HX, sy * 0.44, HZ - 0.28), (-0.7, sy * 0.3, 0.65), 0.075, 0.20, 14,
                "white_paint", r1=0.11, top="black_paint")
for sx in (1, -1):
    for sy in (1, -1):
        pl.box(p, (sx * (HX - 0.12), sy * (HY - 0.12), -HZ + 0.12), (0.12, 0.12, 0.12), "titanium_grey")
pl.finish(p, ROOTOBJ)

# 2. +Z Earth-Facing Payload Deck (Dual-Band L5 + S Helical Array + C-Band Horns + LRA)
p = pl.Part("payload_deck", store)
pl.box(p, (0.0, 0.0, HZ + 0.025), (1.48, 1.40, 0.05), "aluminium")

# Helical Array Baseplate
pl.box(p, (+0.08, 0.0, HZ + 0.068), (0.98, 0.98, 0.036), "white_paint")
pl.box(p, (+0.08, 0.0, HZ + 0.055), (1.02, 1.02, 0.014), "gold_kapton")

# 12-element shaped-beam L5 + S-band helical array (inner 4 + outer 8 ring)
z_ant = HZ + 0.086
pts = [
    (-0.14, -0.14), (+0.14, -0.14), (-0.14, +0.14), (+0.14, +0.14),
]
for i in range(8):
    a = 2 * math.pi * i / 8 + math.pi / 8
    pts.append((0.36 * math.cos(a), 0.36 * math.sin(a)))
for px, py in pts:
    pl.helical_element(p, (+0.08 + px, py, z_ant), axis=(0, 0, 1),
                       r_cup=0.062, h_cup=0.042, r_rod=0.028, h_rod=0.22,
                       cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
                       exposed_helix=False)

# C-band CDMA Ranging Tx/Rx Horns (-X/+Y side & +X/-Y side)
pl.cylinder(p, (-0.54, -0.48, HZ + 0.05), (0, 0, 1), 0.09, 0.16, 16, "gold_kapton", r1=0.12, top="black_paint")
pl.cylinder(p, (+0.58, -0.48, HZ + 0.05), (0, 0, 1), 0.08, 0.14, 16, "aluminium", r1=0.11, top="black_paint")

# LRA_IRNSS_1 (SNX offset: -0.436, +0.528, +1.120 relative to CoM -> mount on short standoff on +Z)
pl.box(p, (-0.436, +0.528, HZ + 0.11), (0.28, 0.24, 0.12), "aluminium")
pl.lrr_array(p, (-0.436, +0.528, HZ + 0.17), (0.26, 0.22, 0.05), nx=5, ny=4, staggered=True)

# S-band TTC omni mast
pl.cylinder(p, (-0.58, 0.0, HZ + 0.05), (-0.12, 0.0, 1.0), 0.020, 0.34, 10, "titanium_grey", top="radome_white")
pl.finish(p, ROOTOBJ)

# 3. Articulated SADM & 2-Panel Wings
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY, sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS, panel_l=PANEL_L, panel_w=PANEL_W,
    panel_t=PANEL_T, panel_gap=PANEL_GAP, yoke_style="v_strut",
    wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x",
)

pl.export_and_render(ROOT, "navic-irnss1", scene, args)
