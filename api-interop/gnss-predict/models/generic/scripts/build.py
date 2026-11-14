"""Procedural generic GNSS fallback satellite model -> generic.glb.

Covers unknown, retired, or regional/experimental blocks (GAL-0A/0B, BDS-3S*, QZS-*, IRS-*, GPS-I/II/IIA, GLO).
Spec (§3): a simple box bus with two wings and an Earth-deck antenna, about 2 x 2 x 2 m
with 2 x 5 m wings, under 2,000 triangles.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/generic/scripts/build.py -- --root models/generic --render
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
# Dimensions (metres) — Brief §3 specification:
#   - Bus cube: 2.000 x 2.000 x 2.000 m (HX = HY = HZ = 1.000 m)
#   - Two solar wings along +-Y: each wing extends 5.000 m from the SADM pivot at Y = +-1.000 m
#     (0.540 m yoke + 2 panels of 2.200 x 2.000 m + 0.060 m gap = 5.000 m wing length ->
#      total span Y = 12.000 m)
#   - Earth-deck (+Z) navigation antenna array + LRA tray (Z = +1.000 to +1.360 m)
#     and -Z launch adapter ring (Z = -1.080 m -> total Z = 2.440 m)
#   - Budget: < 2,000 triangles
# --------------------------------------------------------------------------------------
BUS = (2.000, 2.000, 2.000)
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 2
PANEL_L, PANEL_W, PANEL_T = 2.200, 2.000, 0.025
PANEL_GAP = 0.060
YOKE_LEN = 0.540                            # wing_tip = 1.000 + 0.540 + 4.400 + 0.060 = 6.000 m -> span 12.000 m
SADM_X, SADM_Z = 0.0, 0.0

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=28, rows=18, seed=2026121)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=2026122)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=False)

ROOTOBJ = bpy.data.objects.new("generic_gnss", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# 1. 2x2x2 m Box Bus (Gold & Black MLI + OSR Radiator Mirrors)
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.024, segments=2,
             mat={"+z": "mli_gold", "-z": "mli_black",
                  "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})

TO = 0.005
for sgn_y in (1, -1):
    pl.box(p, (0.0, sgn_y * (HY + TO / 2 + 0.002), 0.0), (1.30, TO, 1.30),
           "osr_radiator", uv="tile", tile=0.20)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 2. Earth-Deck (+Z) Navigation Antenna Array & LRA (< 1,000 triangles)
# --------------------------------------------------------------------------------------
p = pl.Part("nadir_antenna_deck", store)
# Circular L-band ground plane (Ø1.24 m) on +Z face
pl.cylinder(p, (0.0, 0.0, HZ), (0, 0, 1), 0.62, 0.050, 24,
            "aluminium", top="mli_silver")
z_ant = HZ + 0.050
# 6 L-band helical cup elements around a central element (top at Z = +1.360 m)
pl.helical_element(
    p, (0.0, 0.0, z_ant), (0, 0, 1),
    r_cup=0.068, h_cup=0.050, r_rod=0.030, h_rod=0.260,
    cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
)
for k in range(6):
    ang = math.radians(30.0 + 60.0 * k)
    bx, by = 0.40 * math.cos(ang), 0.40 * math.sin(ang)
    pl.helical_element(
        p, (bx, by, z_ant), (0, 0, 1),
        r_cup=0.064, h_cup=0.050, r_rod=0.028, h_rod=0.260,
        cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
    )

# Compact LRA tray on (+X, +Y) corner of +Z deck
pl.box(p, (+0.62, +0.62, HZ + 0.020), (0.32, 0.24, 0.040),
       {"+z": "lrr_cube_glass", "default": "aluminium"})

# -Z launch adapter ring (down to Z = -1.080 m -> total Z = 2.440 m)
pl.cylinder(p, (0.0, 0.0, -HZ - 0.080), (0, 0, 1), 0.54, 0.080, 24,
            "titanium_grey", bottom="aluminium")
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 3. SADMs + Solar Wings (wing+Y, wing-Y)
# --------------------------------------------------------------------------------------
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY,
    sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS,
    panel_l=PANEL_L, panel_w=PANEL_W, panel_t=PANEL_T, panel_gap=PANEL_GAP,
    yoke_style="v_strut", wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x",
)

pl.export_and_render(ROOT, "generic", scene, args)
