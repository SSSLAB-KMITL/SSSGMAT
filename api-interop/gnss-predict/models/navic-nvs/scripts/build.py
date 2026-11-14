"""Procedural NavIC 2nd-Gen NVS-01 / NVS-02 (ISRO I-2K bus, IRS-2G / IRS-2I) -> navic-nvs.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/navic-nvs/scripts/build.py -- --root models/navic-nvs --render
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
# Dimensions (metres). Sources: ISRO NVS-01/02 press releases, I-2K bus specs, IGS SNX
#   - Bus: I-2K taller bus 1.650 (X) x 1.530 (Y) x 2.400 (Z) m (launch mass ~2250 kg)
#   - Wings: 2 wings x 2 I-2K panels (2.540 m x 1.530 m, ESA/I-2K class, ~2.4-3.0 kW)
#     with yoke 0.650 m, gap 0.060 m -> wing_tip = 0.765 + 0.65 + 5.08 + 0.06 = 6.555 m -> span 13.11 m
#   - Payload: Tri-band (L1 + L5 + S) phased patch + S-band helical array + C-band horn
# --------------------------------------------------------------------------------------
BUS = (1.650, 1.530, 2.400)
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 2
PANEL_L, PANEL_W, PANEL_T = 2.540, 1.530, 0.026
PANEL_GAP = 0.060
YOKE_LEN = 0.650
SADM_X, SADM_Z = 0.0, 0.0

store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=30, rows=16, seed=2026411)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=2026412)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)
l_pa = pl.tex_phased_array(TEXDIR, "tex_l1_l5_patch", nx=5, ny=5,
                           bg_rgb=(0.90, 0.90, 0.88), patch_rgb=(0.78, 0.60, 0.24))
store.make("l1_l5_patch_mat", (0.88, 0.88, 0.86), 0.1, 0.40, l_pa)

ROOTOBJ = bpy.data.objects.new("navic_nvs", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# 1. ISRO I-2K Core Bus (Significantly Taller 2.4 m Bus + Dual-Bay Radiators)
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.026, segments=3,
             mat={"+z": "mli_white", "-z": "mli_gold",
                  "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})

TO = 0.006
for sgn_y in (1, -1):
    for cz in (+0.62, -0.62):
        pl.box(p, (0.0, sgn_y * (HY + TO / 2 + 0.002), cz), (1.30, TO, 0.92),
               "osr_radiator", uv="tile", tile=0.20)
    pl.box(p, (0.0, sgn_y * (HY + 0.012), 0.0), (1.42, 0.022, 0.24), "aluminium")

# Indigenous Rubidium Clock (iRAFS) thermal bay radiator panel & heat-pipe louvers on +-X
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + 0.008), 0.0, +0.42), (0.016, 1.12, 1.05), "osr_radiator", uv="tile", tile=0.18)
    pl.box(p, (sgn_x * (HX + 0.014), -0.45, -0.52), (0.024, 0.28, 0.90), "titanium_grey")

# -Z I-2K Launch Adapter Cone & 440 N LAM Engine Nozzle
pl.cylinder(p, (0, 0, -HZ), (0, 0, -1), 0.60, 0.24, 24, "titanium_grey", r1=0.52, top="black_paint")
pl.cylinder(p, (0, 0, -HZ - 0.24), (0, 0, -1), 0.28, 0.06, 20, "aluminium", r1=0.32)
pl.cylinder(p, (0, 0, -HZ - 0.26), (0, 0, -1), 0.11, 0.24, 18, "black_paint", r1=0.20)

# Star trackers & corner thruster pods
for sy in (1, -1):
    pl.cylinder(p, (-HX, sy * 0.48, HZ - 0.34), (-0.7, sy * 0.3, 0.65), 0.085, 0.22, 14,
                "white_paint", r1=0.12, top="black_paint")
for sx in (1, -1):
    for sy in (1, -1):
        pl.box(p, (sx * (HX - 0.14), sy * (HY - 0.14), -HZ + 0.14), (0.14, 0.14, 0.14), "titanium_grey")
pl.finish(p, ROOTOBJ)

# 2. +Z Tri-Band Navigation Deck (L1 Patch Array + L5/S-Band Helical Cluster + C-Band Horn)
p = pl.Part("payload_deck", store)
pl.box(p, (0.0, 0.0, HZ + 0.028), (1.56, 1.44, 0.056), "aluminium")

# L1 + L5 flat phased patch array on -X half of +Z deck (new in NVS-01/02)
pl.box(p, (-0.34, 0.0, HZ + 0.095), (0.68, 0.88, 0.08),
       {"+z": "l1_l5_patch_mat", "default": "white_paint"}, uv="fit")
pl.box(p, (-0.34, 0.0, HZ + 0.065), (0.72, 0.92, 0.03), "gold_kapton")

# S-band + L5 helical element array on +X half of +Z deck
pl.box(p, (+0.38, 0.0, HZ + 0.072), (0.66, 1.06, 0.036), "white_paint")
for ky in (-0.34, -0.11, +0.11, +0.34):
    for kx in (+0.23, +0.52):
        pl.helical_element(p, (kx, ky, HZ + 0.09), axis=(0, 0, 1),
                           r_cup=0.058, h_cup=0.04, r_rod=0.026, h_rod=0.22,
                           cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
                           exposed_helix=False)

# C-band CDMA ranging horn & TT&C S-band omni
pl.cylinder(p, (-0.42, -0.56, HZ + 0.056), (0, 0, 1), 0.095, 0.16, 16, "gold_kapton", r1=0.125, top="black_paint")
pl.cylinder(p, (-0.64, +0.56, HZ + 0.056), (-0.1, 0.05, 1.0), 0.022, 0.36, 10, "titanium_grey", top="radome_white")
pl.lrr_array(p, (-0.36, +0.54, HZ + 0.056), (0.28, 0.24, 0.05), nx=5, ny=4, staggered=True)
pl.finish(p, ROOTOBJ)

# 3. Articulated SADM & I-2K Solar Wings
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY, sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS, panel_l=PANEL_L, panel_w=PANEL_W,
    panel_t=PANEL_T, panel_gap=PANEL_GAP, yoke_style="v_strut",
    wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x",
)

pl.export_and_render(ROOT, "navic-nvs", scene, args)

