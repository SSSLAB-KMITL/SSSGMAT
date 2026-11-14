"""Procedural QZSS IGSO (QZS-1R / QZS-2 / QZS-4, MELCO DS2000) model -> qzss-igso.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/qzss-igso/scripts/build.py -- --root models/qzss-igso --render
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
# Dimensions (metres). Sources: Cabinet Office SPI-QZS2 / SPI-QZS1R, JAXA, eoPortal DS2000
# --------------------------------------------------------------------------------------
BUS = (2.400, 2.360, 4.900)                 # DS2000 structural box (Z shifted slightly for deck + adapter)
BUS_CZ = -0.050                             # Bus Z in [-2.50, +2.40]
HX, HY = BUS[0] / 2, BUS[1] / 2
Z_BOT = BUS_CZ - BUS[2] / 2                 # -2.50
Z_TOP = BUS_CZ + BUS[2] / 2                 # +2.40

N_PANELS = 3
PANEL_L, PANEL_W, PANEL_T = 2.480, 1.800, 0.028
PANEL_GAP = 0.060
YOKE_LEN = 0.720                            # wing_tip = 1.18 + 0.72 + 7.44 + 0.12 = 9.46 -> span 18.92 m (~19 m)
SADM_X, SADM_Z = 0.0, BUS_CZ

store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=32, rows=18, seed=2026111)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=2026112)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)
pa_img = pl.tex_phased_array(TEXDIR, "tex_l1s_patch", nx=4, ny=4,
                             bg_rgb=(0.90, 0.90, 0.88), patch_rgb=(0.76, 0.60, 0.24))
store.make("l1s_patch_mat", (0.88, 0.88, 0.86), 0.1, 0.42, pa_img)

ROOTOBJ = bpy.data.objects.new("qzss_igso", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# 1. MELCO DS2000 Core Bus (Gold MLI + OSR Radiator North/South Faces + Launch Adapter)
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, BUS_CZ), BUS, bevel_offset=0.028, segments=3,
             mat={"+z": "mli_white", "-z": "mli_gold",
                  "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})

TO = 0.006
for sgn_y in (1, -1):
    for cz in (BUS_CZ + 1.05, BUS_CZ - 1.05):
        pl.box(p, (0.0, sgn_y * (HY + TO / 2 + 0.002), cz), (1.76, TO, 1.72),
               "osr_radiator", uv="tile", tile=0.22)
    # Center structural SADM stiffener band on +-Y
    pl.box(p, (0.0, sgn_y * (HY + 0.015), BUS_CZ), (1.90, 0.026, 0.34), "aluminium")

# Dark payload radiator louver strips & harness trays on +-X
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + 0.012), 0.0, BUS_CZ + 0.95), (0.022, 1.50, 1.25), "osr_radiator", uv="tile", tile=0.20)
    pl.box(p, (sgn_x * (HX + 0.016), -0.68, BUS_CZ - 0.55), (0.028, 0.32, 1.80), "titanium_grey")

# -Z Launch Vehicle Adapter Ring + Main Apogee Engine Nozzle (reaching Z = -2.90)
pl.cylinder(p, (0, 0, Z_BOT), (0, 0, -1), 0.72, 0.32, 24, "titanium_grey", r1=0.62, top="black_paint")
pl.cylinder(p, (0, 0, Z_BOT - 0.32), (0, 0, -1), 0.65, 0.05, 24, "aluminium", top="titanium_grey")
pl.cylinder(p, (0, 0, Z_BOT - 0.24), (0, 0, -1), 0.18, 0.16, 18, "black_paint", r1=0.24, top="black_paint")

# Star tracker optical baffles & corner RCS thruster quads
for sy in (1, -1):
    pl.cylinder(p, (-HX, sy * 0.72, BUS_CZ + 1.85), (-0.7, sy * 0.35, 0.62), 0.095, 0.24, 14,
                "white_paint", r1=0.135, top="black_paint")
for sx in (1, -1):
    for sy in (1, -1):
        pl.box(p, (sx * (HX + 0.06), sy * (HY - 0.18), Z_BOT + 0.18), (0.14, 0.14, 0.14), "titanium_grey")
        pl.cylinder(p, (sx * (HX + 0.11), sy * (HY - 0.18), Z_BOT + 0.18), (sx * 0.7, 0.0, -0.7),
                    0.028, 0.07, 10, "black_paint", r1=0.042)
pl.finish(p, ROOTOBJ)

# 2. +Z Nadir Payload Deck: Conical L-Band Helical Array (L-ANT) + L1-SAIF/SLAS + S-band + LRA
p = pl.Part("payload_deck", store)
pl.box(p, (0.0, 0.0, Z_TOP + 0.025), (2.28, 2.24, 0.05), "aluminium")

# Truncated conical L-ANT shroud (SPI-QZS2: Ø1.8 m bottom -> Ø1.5 m top)
CONE_X, CONE_Y = 0.16, 0.0
CONE_H = 0.56
pl.cylinder(p, (CONE_X, CONE_Y, Z_TOP + 0.05), (0, 0, 1), 0.88, CONE_H, 28,
            "radome_white", r1=0.73, top="black_paint")
pl.cylinder(p, (CONE_X, CONE_Y, Z_TOP + 0.05), (0, 0, 1), 0.90, 0.12, 28, "gold_kapton")
# Recessed metallic aperture ground plate at cone top
Z_APR = Z_TOP + 0.05 + CONE_H
pl.cylinder(p, (CONE_X, CONE_Y, Z_APR - 0.01), (0, 0, 1), 0.70, 0.025, 24, "aluminium", top="white_paint")

# 19-element L-band helical array (center + 6 inner ring + 12 outer ring) -> tips at +3.30 m
hel_pts = [(0.0, 0.0)]
for i in range(6):
    a = 2 * math.pi * i / 6
    hel_pts.append((0.25 * math.cos(a), 0.25 * math.sin(a)))
for i in range(12):
    a = 2 * math.pi * i / 12 + math.pi / 12
    hel_pts.append((0.52 * math.cos(a), 0.52 * math.sin(a)))
for hx_off, hy_off in hel_pts:
    pl.helical_element(p, (CONE_X + hx_off, CONE_Y + hy_off, Z_APR), axis=(0, 0, 1),
                       r_cup=0.068, h_cup=0.045, r_rod=0.030, h_rod=0.25,
                       cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
                       exposed_helix=False)

# L1-SAIF / L1-SLAS separate patch antenna array (~1.2 m offset from L-ANT along -X)
pl.box(p, (-0.98, 0.0, Z_TOP + 0.09), (0.64, 0.64, 0.10), "aluminium")
pl.box(p, (-1.04, 0.0, Z_TOP + 0.145), (0.56, 0.56, 0.02),
       {"+z": "l1s_patch_mat", "default": "white_paint"}, uv="fit")

# LRA (LRA_QZS_2 planar tray on +Z deck matching SNX +X/+Y corner)
pl.lrr_array(p, (+0.96, +0.84, Z_TOP + 0.05), (0.34, 0.28, 0.055), nx=6, ny=5, staggered=True)

# TT&C S-band omni booms on +X and -X nadir corners & feeder horn
for sgn_y in (1, -1):
    pl.cylinder(p, (-0.98, sgn_y * 0.88, Z_TOP + 0.05), (-0.15, sgn_y * 0.15, 1.0),
                0.022, 0.42, 10, "titanium_grey", top="radome_white")
    pl.cylinder(p, (-1.04, sgn_y * 0.94, Z_TOP + 0.46), (-0.15, sgn_y * 0.15, 1.0),
                0.048, 0.07, 12, "radome_white", r1=0.036)
pl.cylinder(p, (+0.92, -0.82, Z_TOP + 0.05), (0.0, 0.0, 1.0), 0.11, 0.18, 16,
            "gold_kapton", r1=0.14, top="black_paint")
pl.finish(p, ROOTOBJ)

# 3. Articulated SADM & 3-Panel Solar Wings (wing+Y, wing-Y)
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY, sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS, panel_l=PANEL_L, panel_w=PANEL_W,
    panel_t=PANEL_T, panel_gap=PANEL_GAP, yoke_style="v_strut",
    wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x",
)

pl.export_and_render(ROOT, "qzss-igso", scene, args)
