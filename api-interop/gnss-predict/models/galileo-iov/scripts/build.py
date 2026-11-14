"""Procedural EADS Astrium / Thales Alenia Space Galileo IOV (GAL-1) model -> galileo-iov.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/galileo-iov/scripts/build.py -- --root models/galileo-iov --render
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
#   - European GNSS Service Centre (GSC) "Galileo Satellite Metadata" (official IOV):
#       Bus box: X_B = 2.611 m, Y_B = 1.149 m, Z_B = 1.149 m
#       Solar wing active area: 5.000 m x 1.082 m = 5.410 m^2 per wing (10.820 m^2 total)
#   - ESA Galileo IOV Fact Sheet & Montenbruck et al. (2015):
#       Deployed tip-to-tip solar array span: 14.500 m (wing_tip = 7.250 m).
#       2 panels per wing: 2 x 2.470 m + 0.060 m gap = 5.000 m panel stack,
#       yoke_len = 7.250 - 0.5745 - 5.000 = 1.6755 m.
#   - IGS igs_satellite_metadata.snx:
#       LRA_GAL_1 (84 corner-cube prisms) at (-1.0927, +0.0340, +0.6225) m relative to CoM.
# --------------------------------------------------------------------------------------
BUS = (2.611, 1.149, 1.149)                 # official GSC IOV bus (X, Y, Z) m
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 2
PANEL_L, PANEL_W, PANEL_T = 2.470, 1.082, 0.024
PANEL_GAP = 0.060
YOKE_LEN = 1.6755                           # exact for 14.500 m tip-to-tip span
SADM_X, SADM_Z = -0.10, 0.0

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=32, rows=14, seed=202681)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=202682)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=False)

ROOTOBJ = bpy.data.objects.new("galileo_iov", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# 1. Main Elongated Rectangular Bus (Black Kapton MLI + Silver Ge-Kapton Foil on +Z)
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.022, segments=3,
             mat={"+z": "ge_kapton_foil", "-z": "mli_black",
                  "+x": "mli_black", "-x": "mli_black",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_black"})

# OSR optical solar reflector radiator mirrors on +-Y and -Z faces
TO = 0.004
for sgn_y in (1, -1):
    pl.box(p, (-0.36, sgn_y * (HY + TO / 2 + 0.002), +0.10), (1.18, TO, 0.78),
           "osr_radiator", uv="tile", tile=0.18)
    pl.box(p, (+0.64, sgn_y * (HY + TO / 2 + 0.002), -0.05), (0.68, TO, 0.72),
           "osr_radiator", uv="tile", tile=0.18)

# -X propulsion module end-frame & thruster guard collar (extends X slightly to +-1.335 m -> 2.670 m)
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + 0.0145), 0.0, 0.0), (0.029, 0.92, 0.92),
           "titanium_grey")
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 2. Earth-Facing (+Z) Navigation Antenna, SAR Hexagonal Antenna, C-Band & LRA_GAL_1 (84 Prisms)
# --------------------------------------------------------------------------------------
p = pl.Part("nadir_antennas_and_lra", store)
# Main L-band navigation antenna (circular dish/cup array at X = +0.44 m, Ø1.26 m)
nav_cx, nav_cy = +0.440, 0.0
pl.cylinder(p, (nav_cx, nav_cy, HZ), (0, 0, 1), 0.56, 0.085, 36,
            "ge_kapton_foil", top="radome_maroon", r1=0.63)
pl.cylinder(p, (nav_cx, nav_cy, HZ + 0.085), (0, 0, 1), 0.635, 0.025, 36,
            "aluminium", top="radome_maroon")

# Search-and-Rescue (SAR) hexagonal phased array at X = -0.46 m, Y = -0.14 m
sar_cx, sar_cy = -0.460, -0.140
hex_pts = [(0.31 * math.cos(math.radians(60 * k)), 0.31 * math.sin(math.radians(60 * k))) for k in range(6)]
pl.prism(p, (sar_cx, sar_cy, HZ), (0, 0, 1), hex_pts, 0.075,
         "ge_kapton_foil", "radome_white", uhint=(1, 0, 0))

# C-band mission receiver circular antenna at X = -0.38 m, Y = +0.34 m
pl.cylinder(p, (-0.380, +0.340, HZ), (0, 0, 1), 0.165, 0.070, 24,
            "ge_kapton_foil", top="radome_maroon")

# Official LRA_GAL_1 (84 corner-cube prisms, 12x7 array) near -X edge of +Z deck
# SINEX relative to CoM: (-1.0927, +0.0340, +0.6225) m -> top at Z = +0.623 m
pl.lrr_array(p, (-1.050, +0.034, HZ), (0.34, 0.48, 0.048), nx=7, ny=12)

# S-band TT&C helical/horn antenna & infrared Earth sensor on +Z
pl.cylinder(p, (+1.12, -0.38, HZ), (0, 0, 1), 0.045, 0.215, 16,
            "white_paint", top="titanium_grey", r1=0.028)
pl.box(p, (+1.10, +0.36, HZ + 0.055), (0.18, 0.16, 0.11), "black_paint")
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 3. Zenith (-Z) Soyuz Dispenser Interface & AOCS Thruster Pods
# --------------------------------------------------------------------------------------
p = pl.Part("zenith_and_thrusters", store)
# Soyuz twin-launch dispenser interface fittings on -Z (down to Z = -HZ - 0.075 = -0.650 m)
pl.cylinder(p, (0.0, 0.0, -HZ - 0.075), (0, 0, 1), 0.44, 0.075, 32,
            "titanium_grey", bottom="aluminium")
for sx in (1, -1):
    for sy in (1, -1):
        b0 = Vector((sx * (HX - 0.12), sy * (HY - 0.08), -HZ))
        d = Vector((0.18 * sx, 0.18 * sy, -1.0)).normalized()
        pl.cylinder(p, b0, d, 0.020, 0.065, 10, "titanium_grey", r1=0.030, top="black_paint")
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 4. SADMs + Solar Wings (wing+Y, wing-Y)
# --------------------------------------------------------------------------------------
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY,
    sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS,
    panel_l=PANEL_L, panel_w=PANEL_W, panel_t=PANEL_T, panel_gap=PANEL_GAP,
    yoke_style="single_bar", wing_prefix="wing", yoke_mat="yoke_orange", cell_side="-x",
)

pl.export_and_render(ROOT, "galileo-iov", scene, args)
