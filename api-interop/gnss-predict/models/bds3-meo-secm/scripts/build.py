"""Procedural SECM (CAS) BeiDou-3 MEO satellite model -> bds3-meo-secm.glb.

Covers IGS blocks: BDS-3M-SECM-A, BDS-3M-SECM-B, BDS-3SM-SECM.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/bds3-meo-secm/scripts/build.py -- --root models/bds3-meo-secm --render
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
#   - CSNO (2019) "BeiDou Navigation Satellite System Open Service Performance Standard"
#     & BDS-3 MEO SECM metadata:
#       Z-face area = 2.58 m^2, Y-face area = 2.22 m^2, X-face area = 1.24 m^2
#       -> exact rectangular prism solution: X_B = 2.150 m, Y_B = 1.200 m, Z_B = 1.033 m
#          (X_B*Y_B = 2.580 m^2, X_B*Z_B = 2.221 m^2, Y_B*Z_B = 1.240 m^2).
#   - IGS igs_satellite_metadata.snx:
#       LRA_BDS_SHAO_42 (42 corner-cube prisms) at (+0.6096, +0.4316, +0.6204) m (SECM-A),
#       consistent with +Z deck at Z = +0.5165 m + 0.104 m LRA height = +0.6205 m.
#   - Solar wings: 2 wings, 2 panels/wing (2.150 m x 1.256 m = 5.40 m^2/wing, 10.80 m^2 total,
#       matching official CSNO / Zhao et al. 2022 / Li et al. 10.8 m^2 solar array area),
#       yoke 0.720 m, gap 0.060 m -> deployed span Y = 11.360 m.
# --------------------------------------------------------------------------------------
BUS = (2.150, 1.200, 1.033)                 # official/derived from CSNO panel areas (X, Y, Z) m
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 2
PANEL_L, PANEL_W, PANEL_T = 2.150, 1.256, 0.024
PANEL_GAP = 0.060
YOKE_LEN = 0.720                            # wing_tip = 0.600 + 0.720 + 4.300 + 0.060 = 5.680 m -> span 11.360 m
SADM_X, SADM_Z = 0.0, 0.0

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=28, rows=14, seed=202651)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=202652)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("bds3_meo_secm", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# 1. Compact Elongated Bus (Galileo-like SECM Microsatellite Platform)
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.020, segments=3,
             mat={"+z": "mli_silver", "-z": "mli_gold",
                  "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})
# End structural frames & thermal louver panels on +-X
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + 0.015), 0.0, 0.0), (0.030, 0.86, 0.68),
           "aluminium", uv="tile", tile=0.20)
# OSR optical solar reflector radiator mirrors on +-Y panels (atomic clock & payload cooling)
TO = 0.005
for sgn_y in (1, -1):
    pl.box(p, (-0.38, sgn_y * (HY + TO / 2 + 0.002), 0.06), (1.02, TO, 0.72),
           "osr_radiator", uv="tile", tile=0.16)
    pl.box(p, (+0.56, sgn_y * (HY + TO / 2 + 0.002), -0.04), (0.62, TO, 0.64),
           "osr_radiator", uv="tile", tile=0.16)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 2. Earth-Facing (+Z) Navigation Array, Ka-Band ISL Phased Array & SHAO-42 LRA
# --------------------------------------------------------------------------------------
p = pl.Part("nadir_payload_deck", store)
# Circular L-band navigation phased array on -X half of +Z deck (centered at X = -0.36 m)
ant_cx, ant_cy = -0.360, 0.0
pl.cylinder(p, (ant_cx, ant_cy, HZ), (0, 0, 1), 0.50, 0.045, 32,
            "aluminium", top="mli_silver")
# Rim shield ring
pl.cylinder(p, (ant_cx, ant_cy, HZ + 0.045), (0, 0, 1), 0.51, 0.035, 32,
            "titanium_grey", top="titanium_grey")

# 16 L-band helical cup elements (4 inner at r=0.16 m + 12 outer at r=0.36 m)
# Top of elements reaches Z = HZ + 0.045 + 0.255 = +0.8165 m
z_ant = HZ + 0.045
for r_ring, n_el, phase in ((0.16, 4, 45.0), (0.36, 12, 15.0)):
    for k in range(n_el):
        ang = math.radians(phase + 360.0 * k / n_el)
        bx = ant_cx + r_ring * math.cos(ang)
        by = ant_cy + r_ring * math.sin(ang)
        pl.helical_element(
            p, (bx, by, z_ant), (0, 0, 1),
            r_cup=0.056, h_cup=0.045, r_rod=0.026, h_rod=0.210,
            cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
        )

# Ka-band Inter-Satellite Link (ISL) phased-array transceiver on +X half of +Z deck
isl_cx, isl_cy = +0.480, -0.140
pl.box(p, (isl_cx, isl_cy, HZ + 0.040), (0.52, 0.52, 0.080),
       {"+z": "titanium_grey", "default": "mli_silver"})
pl.box(p, (isl_cx, isl_cy, HZ + 0.095), (0.44, 0.44, 0.030),
       {"+z": "radome_white", "default": "aluminium"})

# Official LRA_BDS_SHAO_42 (42 corner-cube prisms) at (+0.6096, +0.4316, +0.6204) m
# Pedestal + 7x6 array tray reaching Z = +0.6204 m
pl.box(p, (0.610, 0.432, HZ + 0.032), (0.36, 0.28, 0.064), "aluminium")
pl.lrr_array(p, (0.610, 0.432, HZ + 0.064), (0.34, 0.26, 0.040), nx=7, ny=6)

# S-band TT&C & L-band monitoring horn antennas
pl.cylinder(p, (+0.86, -0.38, HZ), (0, 0, 1), 0.048, 0.19, 16,
            "white_paint", top="titanium_grey", r1=0.030)
pl.box(p, (-0.92, +0.42, HZ + 0.05), (0.16, 0.14, 0.10), "black_paint")
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 3. Zenith (-Z) Dual-Launch Adapter Ring & AOCS Thrusters
# --------------------------------------------------------------------------------------
p = pl.Part("zenith_adapter_thrusters", store)
pl.cylinder(p, (0.0, 0.0, -HZ - 0.070), (0, 0, 1), 0.46, 0.070, 32,
            "titanium_grey", bottom="aluminium")
for sx in (1, -1):
    for sy in (1, -1):
        b0 = Vector((sx * (HX - 0.10), sy * (HY - 0.08), -HZ))
        d = Vector((0.18 * sx, 0.18 * sy, -1.0)).normalized()
        pl.cylinder(p, b0, d, 0.022, 0.065, 10, "titanium_grey", r1=0.032, top="black_paint")
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

pl.export_and_render(ROOT, "bds3-meo-secm", scene, args)

