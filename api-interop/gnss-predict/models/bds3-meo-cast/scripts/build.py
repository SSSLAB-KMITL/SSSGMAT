"""Procedural CAST BeiDou-3 MEO (BDS-3M-CAST / BDS-3SM-CAST) satellite model -> bds3-meo-cast.glb (+ optional renders).

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/build.py -- --root . [--render]
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
#   - CSNO (2019), "BeiDou Satellite Metadata" / Duan et al. (2022) / Guo et al. (2021):
#       X-panel area = 1.22 m^2, Z-panel area = 2.25 m^2, Y-panel area = 2.68 m^2
#       -> Bus box (X x Y x Z): 1.970 x 1.140 x 1.070 m
#         (X * Z = 2.11 m^2 + payload step -> 2.68 m^2; Y * Z = 1.14 * 1.07 = 1.220 m^2;
#          X * Y = 1.97 * 1.14 = 2.246 m^2)
#       Solar array area: 20.44 m^2 total (10.22 m^2 per wing; alternative eoPortal 14.10 m^2
#       = 2 x 4.7 x 1.5 m noted in NOTES.md).
#   - IGS igs_satellite_metadata.snx:
#       LRA_BDS_NCRIEO_38 (38 prisms) at (0.5933, -0.0870, 1.2600) m
# --------------------------------------------------------------------------------------
BUS = (1.970, 1.140, 1.070)                 # derived from official CSNO face areas (1.22 / 2.25 m^2)
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 3                                # 3 panels/wing so PANEL_L <= BUS X_B (1.893 <= 1.970 m) stows flush
PANEL_L, PANEL_W, PANEL_T = 1.893, 1.800, 0.025  # 3 * 1.893 * 1.800 = 10.222 m^2/wing (20.44 m^2 total, CSNO official)
PANEL_GAP = 0.050                           # est. inter-panel hinge gap
YOKE_LEN = 0.650                            # est. yoke -> wing_tip = 0.570 + 0.650 + 5.679 + 0.100 = 6.999 m (span 13.998 m)
SADM_X, SADM_Z = 0.0, 0.0

# Official IGS LRA_BDS_NCRIEO_38 eccentricity: X = +0.5933 m, Y = -0.0870 m, Z = +1.2600 m
LRR_POS = (0.593, -0.087, HZ)
LRR_SIZE = (0.200, 0.240, 0.045)            # 38 CCR prisms (NCRIEO array)

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=32, rows=14, seed=202605)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=202606)
pa_img = pl.tex_phased_array(TEXDIR, "tex_phased_array", nx=6, ny=6)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)
store.make("phased_array_face", (0.86, 0.86, 0.84), 0.2, 0.35, image=pa_img)

ROOTOBJ = bpy.data.objects.new("bds3_meo_cast", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# Bus: CAST MEO cuboid wrapped in gold Kapton MLI with black MLI +Z deck
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.022, segments=3,
             mat={"+z": "mli_black", "-z": "mli_gold", "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})
# Raised payload bay step on +Z (accounts for Z_LRA = 1.26 m vs HZ = 0.535 m)
pl.box(p, (-0.12, 0.0, HZ + 0.12), (1.52, 0.96, 0.24), "mli_gold", uv="tile", tile=pl.MLI_TILE)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# OSR mirror radiators on +-Y faces
# --------------------------------------------------------------------------------------
p = pl.Part("radiators_osr", store)
TO = 0.005
for sgn_y in (1, -1):
    pl.box(p, (0.0, sgn_y * (HY + TO / 2 + 0.002), 0.0), (1.58, TO, 0.84), "osr_radiator", uv="tile", tile=0.16)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Navigation payload on +Z: L-band phased-array / helical array + Ka-band ISL phased array
# --------------------------------------------------------------------------------------
p = pl.Part("nav_antenna_deck", store)
z_top = HZ + 0.24
# Circular L-band navigation antenna drum with white dielectric cover + peripheral helical elements
pl.cylinder(p, (-0.22, 0.0, z_top), (0, 0, 1), 0.44, 0.08, 48, "mli_gold", top="phased_array_face")
for i in range(8):
    ang = math.radians(22.5 + 45 * i)
    bx = -0.22 + 0.34 * math.cos(ang)
    by = 0.34 * math.sin(ang)
    pl.helical_element(p, (bx, by, z_top + 0.08), (0, 0, 1), r_cup=0.055, h_cup=0.040,
                       r_rod=0.022, h_rod=0.16, cup_mat="gold_kapton", rod_mat="radome_white")

# Ka-band Inter-Satellite Link (ISL) phased-array antenna assembly on -X side of +Z deck
pl.box(p, (-0.78, 0.0, z_top + 0.05), (0.28, 0.32, 0.10),
       {"+z": "phased_array_face", "default": "titanium_grey"})

# SAR / UHF antennas on +X/+Y corner (CAST MEO SAR payload on C32/C33/C45/C46)
for sy in (0.34, -0.34):
    pl.cylinder(p, (0.76, sy, HZ), (0, 0, 1), 0.045, 0.22, 16, "gold_kapton", top="radome_white", r1=0.030)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Laser Retroreflector Array (LRA_BDS_NCRIEO_38, 38 prisms)
# --------------------------------------------------------------------------------------
p = pl.Part("lrr", store)
pl.box(p, (LRR_POS[0], LRR_POS[1], HZ + 0.09), (LRR_SIZE[0] + 0.04, LRR_SIZE[1] + 0.04, 0.18), "mli_gold")
pl.lrr_array(p, (LRR_POS[0], LRR_POS[1], HZ + 0.18), LRR_SIZE, nx=6, ny=6, staggered=True)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# S-band TT&C, sun/earth sensors, launcher ring & thrusters
# --------------------------------------------------------------------------------------
p = pl.Part("sensors_and_ttc", store)
pl.box(p, (0.58, 0.36, HZ + 0.04), (0.16, 0.14, 0.08), "mli_black")
pl.cylinder(p, (0.58, 0.36, HZ + 0.08), (0, 0, 1), 0.036, 0.03, 16, "titanium_grey", top="black_paint")
pl.cylinder(p, (0.0, 0.0, -HZ - 0.05), (0, 0, 1), 0.52, 0.05, 32, "aluminium", bottom="titanium_grey")
for sx in (1, -1):
    for sy in (1, -1):
        b0 = Vector((sx * (HX - 0.08), sy * (HY - 0.08), -HZ))
        d = Vector((0.2 * sx, 0.2 * sy, -1.0)).normalized()
        pl.cylinder(p, b0, d, 0.020, 0.04, 10, "titanium_grey", top="titanium_grey")
        pl.cylinder(p, b0 + d * 0.04, d, 0.012, 0.05, 10, "titanium_grey", r1=0.026, top="black_paint")
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# SADMs + Solar Wings (wing+Y, wing-Y)
# --------------------------------------------------------------------------------------
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY,
    sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS,
    panel_l=PANEL_L, panel_w=PANEL_W, panel_t=PANEL_T, panel_gap=PANEL_GAP,
    yoke_style="v_strut", wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x",
)

pl.export_and_render(ROOT, "bds3-meo-cast", scene, args)

