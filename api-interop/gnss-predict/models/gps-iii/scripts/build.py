"""Procedural Lockheed Martin GPS Block III (IIIA) satellite model -> gps-iii.glb (+ optional renders).

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
#   - Steigenberger, Thoelert & Montenbruck (2020), "GPS III Vespucci: Results of half a year
#     in orbit", Adv. Space Res. 66(9):2123-2134, Table 3:
#       Bus box (X x Y x Z): 2.46 x 1.78 x 3.40 m
#       Solar array total area: 28.2 m^2 (14.1 m^2 per wing)
#   - IGS igs_satellite_metadata.snx: LRA_GPS_III (48 prisms) at (1.1030, 0.0070, 2.1730) m
#   - Lockheed Martin GPS III fact sheet (A2100M bus, 2 panels/wing, 8+4 L-band array)
# --------------------------------------------------------------------------------------
BUS = (2.460, 1.780, 3.400)                 # official (Steigenberger et al. 2020)
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 2                                # 2 panels per wing (Lockheed Martin A2100M GPS III)
PANEL_L, PANEL_W, PANEL_T = 3.680, 1.916, 0.025  # 2 * 3.680 * 1.916 = 14.10 m^2/wing (28.20 m^2 total, official)
PANEL_GAP = 0.060                           # est. inter-panel hinge gap
YOKE_LEN = 1.150                            # derived from span (~18.92 m tip-to-tip)
SADM_X, SADM_Z = 0.0, -0.20                 # est. from Lockheed Martin A2100M drawings

ARRAY_C = Vector((-0.20, 0.0, HZ))          # L-band array centre on +Z deck (offset -X to clear LRA on +X)
INNER_RING_R = 0.240                        # 4 inner L-band helical elements
OUTER_RING_R = 0.580                        # 8 outer L-band helical elements
HELIX_INNER_H = 0.440                       # est.
HELIX_OUTER_H = 0.370                       # est.

# LRA_GPS_III: 48 prisms, official IGS eccentricity X = +1.103 m, Y = +0.007 m, Z = +2.173 m (on +Z/+X edge)
LRR_POS = (1.103, 0.007, HZ)
LRR_SIZE = (0.210, 0.280, 0.045)            # 6 x 8 = 48 CCR prisms

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=36, rows=16, seed=202603)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=202604)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("gps_iii", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# Bus: tall A2100M cuboid wrapped in gold Kapton & black MLI blankets
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.025, segments=3,
             mat={"+z": "mli_gold", "-z": "mli_gold", "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})
# Raised +Z payload deck frame
pl.box(p, (-0.12, 0.0, HZ + 0.025), (1.95, 1.56, 0.050), "mli_gold", uv="tile", tile=pl.MLI_TILE)
# Equipment bays on +X / -X faces
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + 0.012), 0.0, 0.85), (0.024, 1.35, 0.90), "mli_black", uv="tile", tile=pl.MLI_TILE)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# OSR mirror radiators on +-Y faces
# --------------------------------------------------------------------------------------
p = pl.Part("radiators_osr", store)
TO = 0.005
for sgn_y in (1, -1):
    pl.box(p, (0.0, sgn_y * (HY + TO / 2 + 0.002), 0.45), (1.92, TO, 1.75), "osr_radiator", uv="tile", tile=0.18)
    pl.box(p, (0.0, sgn_y * (HY + TO / 2 + 0.002), -1.05), (1.60, TO, 0.82), "osr_radiator", uv="tile", tile=0.18)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# L-band navigation antenna array on +Z: 4 inner + 8 outer helical elements
# --------------------------------------------------------------------------------------
p = pl.Part("lband_antenna_array", store)
z_deck = HZ + 0.050
for i in range(4):
    ang = math.radians(45 + 90 * i)
    bx = ARRAY_C.x + INNER_RING_R * math.cos(ang)
    by = ARRAY_C.y + INNER_RING_R * math.sin(ang)
    pl.helical_element(p, (bx, by, z_deck), (0, 0, 1), r_cup=0.088, h_cup=0.065,
                       r_rod=0.036, h_rod=HELIX_INNER_H - 0.065,
                       cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey")
for i in range(8):
    ang = math.radians(22.5 + 45 * i)
    bx = ARRAY_C.x + OUTER_RING_R * math.cos(ang)
    by = ARRAY_C.y + OUTER_RING_R * math.sin(ang)
    pl.helical_element(p, (bx, by, z_deck), (0, 0, 1), r_cup=0.082, h_cup=0.060,
                       r_rod=0.034, h_rod=HELIX_OUTER_H - 0.060,
                       cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey")
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Laser Retroreflector Array (LRA_GPS_III, 48 prisms, official X=+1.103, Y=+0.007 on +Z)
# --------------------------------------------------------------------------------------
p = pl.Part("lrr", store)
pl.lrr_array(p, LRR_POS, LRR_SIZE, nx=6, ny=8, staggered=False)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# UHF cross-dipole, S-band TT&C, high-gain spot-beam feed & -Z Liquid Apogee Engine
# --------------------------------------------------------------------------------------
p = pl.Part("aux_antennas_sensors", store)
# UHF / DASS cross-dipole mast on (-X, +Y) corner of +Z deck
uhf_base = Vector((-0.95, 0.62, HZ))
pl.cylinder(p, uhf_base, (0, 0, 1), 0.06, 0.08, 16, "mli_gold", top="titanium_grey")
pl.cylinder(p, uhf_base + Vector((0, 0, 0.08)), (0, 0, 1), 0.022, 0.38, 12, "titanium_grey", top="titanium_grey")
for ang in (0, 90):
    a = math.radians(ang)
    d = Vector((math.cos(a), math.sin(a), 0))
    pl.bar(p, uhf_base + Vector((0, 0, 0.44)) - d * 0.25,
           uhf_base + Vector((0, 0, 0.44)) + d * 0.25, 0.016, 0.010, "aluminium", (0, 0, 1))

# S-band TT&C antenna on (+X, -Y) corner of +Z deck
sb_base = Vector((0.88, -0.62, HZ))
pl.box(p, (sb_base.x, sb_base.y, HZ + 0.03), (0.14, 0.14, 0.06), "black_paint")
pl.cylinder(p, sb_base + Vector((0, 0, 0.06)), (0, 0, 1), 0.052, 0.22, 18, "white_paint", top="titanium_grey", r1=0.034)

# Earth sensor & sun sensors at (-X, -Y) corner of +Z deck
pl.box(p, (-0.94, -0.60, HZ + 0.06), (0.22, 0.18, 0.12), "mli_black")
pl.cylinder(p, (-0.94, -0.60, HZ + 0.12), (0, 0, 1), 0.045, 0.04, 16, "titanium_grey", top="black_paint")

# -Z launch adapter ring & Liquid Apogee Engine (LAE) nozzle
pl.cylinder(p, (0.0, 0.0, -HZ - 0.06), (0, 0, 1), 0.74, 0.06, 36, "aluminium", bottom="titanium_grey")
pl.cylinder(p, (0.0, 0.0, -HZ - 0.22), (0, 0, 1), 0.18, 0.16, 24, "titanium_grey", bottom="black_paint", r1=0.09)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Thruster pods
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

pl.export_and_render(ROOT, "gps-iii", scene, args)
