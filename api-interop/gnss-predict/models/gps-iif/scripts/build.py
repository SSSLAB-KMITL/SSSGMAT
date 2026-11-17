"""Procedural Boeing GPS Block IIF satellite model -> gps-iif.glb (+ optional renders).

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
#   - Boeing GPS IIF Fact Sheet & USAF Space Force sheets (bus 1.98 x 2.49 x 2.23 m)
#   - ESA eoPortal & InsideGNSS (deployed solar array span 13.11 m / ~43.0 ft;
#     Air & Space Forces Magazine lists 43.1 ft = 13.14 m)
#   - Rodriguez-Solano et al. (2012, 2014) / IGS repro3 PROPBOXW.f (solar array 22.25 m^2)
#   - InsideGNSS / ION GPS IIF L-band array (12 helical elements: 4 inner + 8 outer ring)
# --------------------------------------------------------------------------------------
BUS = (1.980, 2.490, 2.230)                 # official/literature (X, Y, Z) m
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 3                                # official: 3 hinged panels per wing (Boeing GPS IIF)
PANEL_L, PANEL_W, PANEL_T = 1.600, 2.318, 0.025  # derived: 2 * 3 * 1.600 * 2.318 = 22.25 m^2 (PROPBOXW.f), fitted to 13.11 m span
PANEL_GAP = 0.030                           # est. inter-panel hinge gap
YOKE_LEN = 0.450                            # derived: 2 * (1.245 + 0.450 + 3*1.600 + 2*0.030) = 13.110 m span
SADM_X, SADM_Z = 0.0, -0.15                 # est. from Boeing GPS IIF drawings

INNER_RING_R = 0.250                        # 4 inner L-band helical elements (derived from deck size)
OUTER_RING_R = 0.620                        # 8 outer L-band helical elements
HELIX_INNER_H = 0.420                       # est.
HELIX_OUTER_H = 0.350                       # est.

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=30, rows=16, seed=202601)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=202602)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("gps_iif", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# Bus: main rectangular cuboid with black & gold MLI thermal blankets + structural steps
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.025, segments=3,
             mat={"-z": "mli_gold", "+z": "mli_gold", "+x": "mli_black", "-x": "mli_black",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_black"})
# Gold MLI equipment bay wraps on upper/lower bands of +-X faces
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + 0.010), 0.0, 0.62), (0.020, 1.90, 0.55), "mli_gold", uv="tile", tile=pl.MLI_TILE)
    pl.box(p, (sgn_x * (HX + 0.010), 0.0, -0.68), (0.020, 1.90, 0.48), "mli_gold", uv="tile", tile=pl.MLI_TILE)
# Raised octagonal Earth-facing (+Z) antenna base platen
pl.prism(p, (0.0, 0.0, HZ), (0, 0, 1),
         [(0.78 * math.cos(math.radians(22.5 + 45 * k)), 0.78 * math.sin(math.radians(22.5 + 45 * k)))
          for k in range(8)],
         0.045, "mli_gold", "mli_gold", uhint=(1, 0, 0))
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# OSR mirror radiators on +-Y and +-X faces
# --------------------------------------------------------------------------------------
p = pl.Part("radiators_osr", store)
TO = 0.005
for sgn_y in (1, -1):
    pl.box(p, (-0.35, sgn_y * (HY + TO / 2 + 0.002), 0.15), (1.05, TO, 1.45), "osr_radiator", uv="tile", tile=0.18)
    pl.box(p, (0.58, sgn_y * (HY + TO / 2 + 0.002), 0.25), (0.55, TO, 1.10), "osr_radiator", uv="tile", tile=0.18)
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + TO / 2 + 0.002), 0.0, -0.05), (TO, 1.55, 0.65), "osr_radiator", uv="tile", tile=0.18)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# L-band navigation antenna array on +Z: 4 inner + 8 outer helical elements in cups
# --------------------------------------------------------------------------------------
p = pl.Part("lband_antenna_array", store)
z_deck = HZ + 0.045
# Inner ring of 4 helical elements
for i in range(4):
    ang = math.radians(45 + 90 * i)
    bx, by = INNER_RING_R * math.cos(ang), INNER_RING_R * math.sin(ang)
    pl.helical_element(p, (bx, by, z_deck), (0, 0, 1), r_cup=0.088, h_cup=0.065,
                       r_rod=0.036, h_rod=HELIX_INNER_H - 0.065,
                       cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey")
# Outer ring of 8 helical elements
for i in range(8):
    ang = math.radians(22.5 + 45 * i)
    bx, by = OUTER_RING_R * math.cos(ang), OUTER_RING_R * math.sin(ang)
    pl.helical_element(p, (bx, by, z_deck), (0, 0, 1), r_cup=0.082, h_cup=0.060,
                       r_rod=0.034, h_rod=HELIX_OUTER_H - 0.060,
                       cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey")
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Auxiliary antennas & sensors (UHF/VHF mast on +Z, APRA on -X, S-band TT&C, Earth sensors)
# --------------------------------------------------------------------------------------
p = pl.Part("aux_antennas_sensors", store)
# UHF / NDS cross-dipole antenna mast at (+X, +Y) corner of +Z deck
uhf_base = Vector((0.68, 0.85, HZ))
pl.cylinder(p, uhf_base, (0, 0, 1), 0.065, 0.08, 16, "mli_gold", top="titanium_grey")
pl.cylinder(p, uhf_base + Vector((0, 0, 0.08)), (0, 0, 1), 0.022, 0.36, 12, "titanium_grey", top="titanium_grey")
for ang in (0, 90):
    a = math.radians(ang)
    d = Vector((math.cos(a), math.sin(a), 0))
    pl.bar(p, uhf_base + Vector((0, 0, 0.42)) - d * 0.24,
           uhf_base + Vector((0, 0, 0.42)) + d * 0.24, 0.016, 0.010, "aluminium", (0, 0, 1))

# S-band TT&C biconical / helical horn at (-X, -Y) corner of +Z deck
sb_base = Vector((-0.72, -0.88, HZ))
pl.box(p, (sb_base.x, sb_base.y, HZ + 0.03), (0.14, 0.14, 0.06), "black_paint")
pl.cylinder(p, sb_base + Vector((0, 0, 0.06)), (0, 0, 1), 0.055, 0.24, 18, "white_paint", top="titanium_grey", r1=0.035)

# Earth sensor & sun sensors on +Z deck (-X, +Y)
pl.box(p, (-0.70, 0.85, HZ + 0.06), (0.22, 0.18, 0.12), "mli_black")
pl.cylinder(p, (-0.70, 0.85, HZ + 0.12), (0, 0, 1), 0.045, 0.04, 16, "titanium_grey", top="black_paint")

# Auxiliary Payload Receive Antenna (APRA) & W-sensor assembly on -X panel (Rodriguez-Solano 2012)
pl.box(p, (-HX - 0.06, -0.45, 0.35), (0.12, 0.38, 0.38), "mli_gold")
pl.cylinder(p, (-HX - 0.12, -0.45, 0.35), (-1, 0, 0), 0.12, 0.18, 20, "white_paint", top="radome_white", r1=0.08)

# -Z launch vehicle adapter ring & apogee thruster bell
pl.cylinder(p, (0.0, 0.0, -HZ - 0.06), (0, 0, 1), 0.68, 0.06, 36, "aluminium", bottom="titanium_grey")
pl.cylinder(p, (0.0, 0.0, -HZ - 0.18), (0, 0, 1), 0.16, 0.12, 24, "titanium_grey", bottom="black_paint", r1=0.08)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Thruster pods on corners
# --------------------------------------------------------------------------------------
p = pl.Part("thrusters", store)
for sx in (1, -1):
    for sy in (1, -1):
        b0 = Vector((sx * (HX - 0.08), sy * (HY - 0.08), -HZ))
        d = Vector((0.2 * sx, 0.2 * sy, -1.0)).normalized()
        pl.cylinder(p, b0, d, 0.024, 0.05, 10, "titanium_grey", top="titanium_grey")
        pl.cylinder(p, b0 + d * 0.05, d, 0.015, 0.06, 10, "titanium_grey", r1=0.032, top="black_paint")
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

pl.export_and_render(ROOT, "gps-iif", scene, args)
