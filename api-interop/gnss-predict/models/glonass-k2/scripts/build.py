"""Procedural ISS Reshetnev GLONASS-K2 (Uragan-K2, GLO-K2) satellite model -> glonass-k2.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/glonass-k2/scripts/build.py -- --root models/glonass-k2 --render
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
#   - Steigenberger & Montenbruck (2023) / IGS GLONASS-K2 box-wing parameters &
#     ISS Reshetnev Uragan-K2 specifications:
#       Launch mass: 1645 kg (official)
#       Unpressurized honeycomb bus: X_B = 2.000 m, Y_B = 1.400 m, Z_B = 2.500 m
#       Solar array total area: 34.0 m^2 (17.0 m^2 per wing, official box-wing value)
#   - Solar wings: 2 wings, 3 panels/wing (2.8333 m x 2.000 m = 17.00 m^2/wing, 34.00 m^2 total),
#       yoke 0.880 m, gap 0.060 m, SADM at Y = +-0.700 m -> deployed span Y = 20.400 m.
# --------------------------------------------------------------------------------------
BUS = (2.000, 1.400, 2.500)                 # Ekspress-1000K enlarged K2 bus (X, Y, Z) m
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 3
PANEL_L, PANEL_W, PANEL_T = 2.8333, 2.000, 0.026
PANEL_GAP = 0.060
YOKE_LEN = 0.8801                           # wing_tip = 0.700 + 0.8801 + 8.4999 + 0.120 = 10.200 m -> span 20.400 m
SADM_X, SADM_Z = 0.0, 0.0

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=34, rows=18, seed=2026101)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=2026102)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("glonass_k2", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# 1. Enlarged Unpressurized Ekspress-1000K Bus Box (Black & Gold MLI + OSR Radiators)
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.024, segments=3,
             mat={"+z": "mli_gold", "-z": "mli_black",
                  "+x": "mli_black", "-x": "mli_black",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_black"})

# External structural longerons & heat-pipe radiator frames on +-X and +-Y
for sx in (1, -1):
    for sy in (1, -1):
        pl.bar(p, (sx * (HX + 0.010), sy * (HY + 0.010), -HZ + 0.05),
               (sx * (HX + 0.010), sy * (HY + 0.010), +HZ - 0.05),
               0.044, 0.044, "aluminium", (sx, sy, 0))

TO = 0.005
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + TO / 2 + 0.002), 0.0, +0.10), (TO, 1.12, 1.88),
           "osr_radiator", uv="tile", tile=0.20)
for sgn_y in (1, -1):
    pl.box(p, (-0.42, sgn_y * (HY + TO / 2 + 0.002), +0.20), (0.84, TO, 1.65),
           "osr_radiator", uv="tile", tile=0.20)
    pl.box(p, (+0.48, sgn_y * (HY + TO / 2 + 0.002), -0.25), (0.68, TO, 1.45),
           "mli_silver", uv="tile", tile=pl.MLI_TILE)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 2. Earth-Facing (+Z) Stepped Payload Truss, 18-Helix L1/L2/L3 Array & LRA Ring
# --------------------------------------------------------------------------------------
p = pl.Part("nadir_antenna_and_lra", store)
# Stepped payload support module from Z = +1.250 m to Z = +1.640 m (width X = 1.76 m, Y = 1.32 m)
pl.box(p, (0.0, 0.0, HZ + 0.195), (1.76, 1.32, 0.390),
       {"+z": "aluminium", "default": "mli_gold"}, uv="tile", tile=pl.MLI_TILE)
# Circular L-band ground plane & annular LRA ring centered at X = -0.14 m, Z = +1.640 m
nav_cx, nav_cy = -0.140, 0.0
z_ant = HZ + 0.390
pl.lrr_ring(p, (nav_cx, nav_cy, z_ant), r_inner=0.60, r_outer=0.72, height=0.045, n_prisms=36)

# 18 L-band (FDMA + CDMA L1/L2/L3) helical elements inside the ring (6 inner at r=0.24 m, 12 outer at r=0.46 m)
# Top reaches Z = +1.640 + 0.460 = +2.100 m
for r_ring, n_el, phase in ((0.24, 6, 0.0), (0.46, 12, 15.0)):
    for k in range(n_el):
        ang = math.radians(phase + 360.0 * k / n_el)
        bx = nav_cx + r_ring * math.cos(ang)
        by = nav_cy + r_ring * math.sin(ang)
        pl.helical_element(
            p, (bx, by, z_ant), (0, 0, 1),
            r_cup=0.060, h_cup=0.055, r_rod=0.030, h_rod=0.405,
            cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
        )

# Auxiliary CDMA / COSPAS-SARSAT & inter-satellite link antennas on +X side of +Z deck
pl.cylinder(p, (+0.68, +0.34, z_ant), (0, 0, 1), 0.14, 0.08, 20, "mli_silver", top="radome_white")
pl.cylinder(p, (+0.68, -0.34, z_ant), (0, 0, 1), 0.055, 0.32, 16,
            "radome_white", top="titanium_grey", r1=0.035)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 3. Zenith (-Z) Fregat Adapter Ring & AOCS Thrusters
# --------------------------------------------------------------------------------------
p = pl.Part("zenith_adapter", store)
# Extends down to Z = -HZ - 0.110 = -1.360 m -> total Z = 3.460 m
pl.cylinder(p, (0.0, 0.0, -HZ - 0.110), (0, 0, 1), 0.62, 0.110, 32,
            "titanium_grey", bottom="aluminium")
for sx in (1, -1):
    for sy in (1, -1):
        b0 = Vector((sx * (HX - 0.12), sy * (HY - 0.10), -HZ))
        d = Vector((0.18 * sx, 0.18 * sy, -1.0)).normalized()
        pl.cylinder(p, b0, d, 0.024, 0.080, 10, "titanium_grey", r1=0.035, top="black_paint")
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

pl.export_and_render(ROOT, "glonass-k2", scene, args)
