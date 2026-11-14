"""Procedural Lockheed Martin GPS Block IIR / IIR-M satellite model -> gps-iir.glb.

Covers IGS blocks: GPS-IIR-A, GPS-IIR-B, GPS-IIR-M.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/gps-iir/scripts/build.py -- --root models/gps-iir --render
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
#   - Lockheed Martin / USAF GPS IIR & IIR-M Fact Sheets & Montenbruck et al. (2015):
#     AS-4000 bus cube: X_B = 1.520 m, Y_B = 1.930 m, Z_B = 1.910 m.
#   - Rodriguez-Solano et al. (2012) PROPBOXW.f:
#     solar array total area 13.60-13.92 m^2 (2 wings, 2 panels/wing),
#     W-sensor antennas on +-X panels (0.5 m^2 total).
#   - Solar wings: 2 panels/wing, 2.050 m x 1.680 m = 6.888 m^2/wing (13.78 m^2 total),
#     yoke 0.780 m, gap 0.060 m -> deployed span Y = 11.810 m (official ~11.4-11.8 m).
# --------------------------------------------------------------------------------------
BUS = (1.520, 1.930, 1.910)                 # official AS-4000 bus (X, Y, Z) m
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 2
PANEL_L, PANEL_W, PANEL_T = 2.050, 1.680, 0.025
PANEL_GAP = 0.060
YOKE_LEN = 0.780                            # wing_tip = 0.965 + 0.780 + 4.100 + 0.060 = 5.905 m -> span 11.810 m
SADM_X, SADM_Z = 0.0, -0.08

INNER_RING_R = 0.220                        # 4 inner L-band helical elements
OUTER_RING_R = 0.540                        # 8 outer L-band helical elements

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=28, rows=16, seed=202661)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=202662)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("gps_iir", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# 1. Lockheed Martin AS-4000 Bus Cube (Black Kapton MLI + Gold MLI Accents)
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.024, segments=3,
             mat={"+z": "mli_gold", "-z": "mli_gold",
                  "+x": "mli_black", "-x": "mli_black",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_black"})

# Raised Earth-facing (+Z) L-band antenna mounting deck (IIR-M modernized panel)
pl.box(p, (0.0, 0.0, HZ + 0.025), (1.36, 1.48, 0.050),
       {"+z": "mli_gold", "default": "titanium_grey"}, uv="tile", tile=pl.MLI_TILE)

# OSR mirror radiators on +-Y and +-X faces
TO = 0.005
for sgn_y in (1, -1):
    pl.box(p, (-0.28, sgn_y * (HY + TO / 2 + 0.002), 0.12), (0.76, TO, 1.18),
           "osr_radiator", uv="tile", tile=0.18)
    pl.box(p, (+0.42, sgn_y * (HY + TO / 2 + 0.002), -0.18), (0.44, TO, 0.96),
           "osr_radiator", uv="tile", tile=0.18)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 2. L-Band Helical Array (4 Inner + 8 Outer Elements) on +Z Deck
# --------------------------------------------------------------------------------------
p = pl.Part("lband_antenna_array", store)
z_deck = HZ + 0.050
# 4 inner L-band helical elements (height 0.44 m -> top at Z = HZ + 0.49 = +1.445 m)
for i in range(4):
    ang = math.radians(45 + 90 * i)
    bx, by = INNER_RING_R * math.cos(ang), INNER_RING_R * math.sin(ang)
    pl.helical_element(
        p, (bx, by, z_deck), (0, 0, 1),
        r_cup=0.080, h_cup=0.060, r_rod=0.034, h_rod=0.380,
        cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
    )
# 8 outer L-band helical elements (height 0.37 m)
for i in range(8):
    ang = math.radians(22.5 + 45 * i)
    bx, by = OUTER_RING_R * math.cos(ang), OUTER_RING_R * math.sin(ang)
    pl.helical_element(
        p, (bx, by, z_deck), (0, 0, 1),
        r_cup=0.074, h_cup=0.055, r_rod=0.032, h_rod=0.315,
        cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
    )
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 3. W-Sensor (NDS) Side Arrays on +-X, UHF Mast, S-Band Boom & -Z Star Kick Motor
# --------------------------------------------------------------------------------------
p = pl.Part("w_sensor_and_aux", store)
# W-sensor (Nuclear Detonation Detection System) dipole trough arrays on +-X faces
# (Rodriguez-Solano 2012 notes 0.5 m^2 W-sensor panels on +-X; extends X to +-1.02 m -> 2.04 m)
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + 0.13), 0.0, +0.52), (0.26, 0.92, 0.24),
           {"+z": "radome_white", "default": "mli_gold"}, uv="tile", tile=pl.MLI_TILE)
    # Support struts for W-sensor winglet
    for sy in (-0.34, +0.34):
        pl.bar(p, (sgn_x * HX, sy, +0.28), (sgn_x * (HX + 0.22), sy, +0.42),
               0.026, 0.022, "titanium_grey", (0, 1, 0))

# UHF cross-dipole antenna on +Z deck corner (+X, +Y)
uhf_base = Vector((0.54, 0.72, HZ))
pl.cylinder(p, uhf_base, (0, 0, 1), 0.055, 0.08, 14, "mli_gold", top="titanium_grey")
pl.cylinder(p, uhf_base + Vector((0, 0, 0.08)), (0, 0, 1), 0.020, 0.34, 12, "titanium_grey")
for ang in (0, 90):
    a = math.radians(ang)
    d = Vector((math.cos(a), math.sin(a), 0))
    pl.bar(p, uhf_base + Vector((0, 0, 0.40)) - d * 0.22,
           uhf_base + Vector((0, 0, 0.40)) + d * 0.22, 0.015, 0.010, "aluminium", (0, 0, 1))

# S-band TT&C biconical antenna on +Z boom (-X, -Y)
sb_base = Vector((-0.56, -0.74, HZ))
pl.cylinder(p, sb_base, (0, 0, 1), 0.024, 0.42, 12, "titanium_grey")
pl.cylinder(p, sb_base + Vector((0, 0, 0.42)), (0, 0, 1), 0.062, 0.14, 16,
            "radome_white", top="gold_kapton", r1=0.036)

# -Z Delta II payload attach fitting & Star-37FM apogee kick motor nozzle (down to Z = -1.205 m)
pl.cylinder(p, (0.0, 0.0, -HZ - 0.08), (0, 0, 1), 0.58, 0.08, 32,
            "aluminium", bottom="titanium_grey")
pl.cylinder(p, (0.0, 0.0, -HZ - 0.25), (0, 0, 1), 0.22, 0.17, 24,
            "titanium_grey", bottom="black_paint", r1=0.11)
for sx in (1, -1):
    for sy in (1, -1):
        b0 = Vector((sx * (HX - 0.08), sy * (HY - 0.08), -HZ))
        d = Vector((0.20 * sx, 0.20 * sy, -1.0)).normalized()
        pl.cylinder(p, b0, d, 0.022, 0.075, 10, "titanium_grey", r1=0.032, top="black_paint")
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

pl.export_and_render(ROOT, "gps-iir", scene, args)
