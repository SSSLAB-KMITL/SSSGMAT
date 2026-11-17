"""Procedural ISS Reshetnev GLONASS-M (Uragan-M, GLO-M / GLO-M+) model -> glonass-m.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/glonass-m/scripts/build.py -- --root models/glonass-m --render
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
#   - Montenbruck et al. (2015) & Rodriguez-Solano et al. (2012) PROPBOXW.f:
#     pressurized cylinder diameter 1.24 m (r=0.62 m), cylinder length ~3.60 m,
#     solar array total area ~23.6-26.1 m^2 (2 wings, 2 panels/wing).
#   - ESA Navipedia & ISS Reshetnev Uragan-M (14F113) specifications:
#     outer structural equipment ring / avionics diameter 2.40 m (FLANGE_R = 1.20 m;
#     height 3.7 m quoted in Navipedia, 3.90 m with zenith dome + L-band tips),
#     12 L-band helical antennas on conical nadir support frame,
#     total deployed span 16.00 m (2 x 3.15 m x 1.95 m panels/wing = 24.57 m^2).
#   - IGS igs_satellite_metadata.snx:
#     LRA_GLO_M (112 corner-cube prisms) at (+0.1370, +0.0030, +1.8737) m.
# --------------------------------------------------------------------------------------
CYL_R = 0.620
CYL_Z_MIN = -1.550
CYL_Z_MAX = +1.150
FLANGE_R = 1.200                            # outer structural ring / avionics envelope (Ø2.40 m per ESA Navipedia)
HY_SADM = 1.220                             # SADM pivot at Y = +-1.220 m

N_PANELS = 2
PANEL_L, PANEL_W, PANEL_T = 3.150, 1.950, 0.025  # 2 * 3.15 * 1.95 = 12.285 m^2/wing (24.57 m^2 total)
PANEL_GAP = 0.080
YOKE_LEN = 0.400                            # wing_tip = 1.22 + 0.40 + 6.30 + 0.08 = 8.00 m -> span 16.00 m
SADM_X, SADM_Z = 0.0, -0.05

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=32, rows=18, seed=202641)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=202642)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("glonass_m", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# 1. Pressurized Cylindrical Core & Thermal Radiator Shell
# --------------------------------------------------------------------------------------
p = pl.Part("pressurized_cylinder", store)
# Lower & upper gold/silver MLI sections
pl.cylinder(p, (0.0, 0.0, CYL_Z_MIN), (0, 0, 1), CYL_R, CYL_Z_MAX - CYL_Z_MIN, 32,
            "mli_silver", top="mli_gold", bottom="mli_black", side_tile=pl.MLI_TILE)
# Central radiator band with axial thermal heat-pipe ribs (characteristic Uragan-M cylinder)
pl.cylinder(p, (0.0, 0.0, -0.95), (0, 0, 1), CYL_R + 0.012, 1.65, 32,
            "white_paint", top="aluminium", bottom="aluminium")
for i in range(12):
    ang = 2 * math.pi * i / 12
    ux, uy = math.cos(ang), math.sin(ang)
    pl.bar(p, ((CYL_R + 0.022) * ux, (CYL_R + 0.022) * uy, -0.92),
           ((CYL_R + 0.022) * ux, (CYL_R + 0.022) * uy, +0.68),
           0.026, 0.022, "aluminium", (-uy, ux, 0))

# Zenith (-Z) hemispherical / conical dome & AOCS propulsion ring (down to Z = -1.80 m)
pl.cylinder(p, (0.0, 0.0, CYL_Z_MIN - 0.16), (0, 0, 1), 0.38, 0.16, 28,
            "mli_black", bottom="mli_black", r1=CYL_R)
pl.cylinder(p, (0.0, 0.0, -1.80), (0, 0, 1), 0.52, 0.10, 28,
            "titanium_grey", bottom="aluminium", r1=0.56)
for i in range(4):
    ang = math.radians(45 + 90 * i)
    tx, ty = 0.60 * math.cos(ang), 0.60 * math.sin(ang)
    pl.cylinder(p, (tx, ty, -1.80), (0, 0, 1), 0.055, 0.09, 14,
                "titanium_grey", bottom="black_paint", r1=0.028)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 2. Outer Equipment Rings, Truss Struts & Side Avionics Bays (Envelope Ø2.40 m)
# --------------------------------------------------------------------------------------
p = pl.Part("equipment_frame", store)
for zc in (-1.05, -0.05, +0.95):
    pl.cylinder(p, (0.0, 0.0, zc - 0.03), (0, 0, 1), FLANGE_R, 0.06, 32,
                "aluminium", top="titanium_grey", bottom="titanium_grey")
# 8 diagonal truss struts between structural rings
for i in range(8):
    a0 = 2 * math.pi * i / 8
    a1 = 2 * math.pi * (i + 0.5) / 8
    p0 = Vector((1.08 * math.cos(a0), 1.08 * math.sin(a0), -1.02))
    p1 = Vector((1.08 * math.cos(a1), 1.08 * math.sin(a1), -0.05))
    p2 = Vector((1.08 * math.cos(a0), 1.08 * math.sin(a0), +0.92))
    pl.bar(p, p0, p1, 0.032, 0.032, "titanium_grey", (0, 0, 1))
    pl.bar(p, p1, p2, 0.032, 0.032, "titanium_grey", (0, 0, 1))

# Side avionics & Cs-clock thermal louver boxes on +-X (spanning X in [-1.20, +1.20] m)
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * 0.98, 0.0, -0.05), (0.44, 0.88, 1.48),
           {"+x": "osr_radiator", "-x": "osr_radiator", "default": "mli_gold"},
           uv="tile", tile=0.20)
# SADM support brackets on +-Y (out to Y = +-1.22 m)
for sgn_y in (1, -1):
    pl.box(p, (0.0, sgn_y * 0.98, SADM_Z), (0.38, 0.48, 0.44), "mli_silver", uv="tile", tile=pl.MLI_TILE)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 3. Conical Nadir Payload Support & 12-Element L-Band Helical Array (+Z)
# --------------------------------------------------------------------------------------
p = pl.Part("nadir_antenna_deck", store)
# Conical payload adapter from Z = +1.15 m to Z = +1.52 m
pl.cylinder(p, (0.0, 0.0, CYL_Z_MAX), (0, 0, 1), CYL_R, 0.37, 28,
            "mli_gold", top="aluminium", r1=0.84, side_tile=pl.MLI_TILE)
# Circular L-band ground plane disc (r = 0.88 m) at Z = +1.52..+1.58 m
pl.cylinder(p, (0.0, 0.0, +1.52), (0, 0, 1), 0.88, 0.06, 32,
            "titanium_grey", top="mli_silver", bottom="aluminium")

# 12 conical L-band helical antennas (4 inner at r=0.30 m, 8 outer at r=0.66 m)
# Projecting from Z = +1.58 m to Z = +2.10 m (height 0.52 m -> total Z = 3.90 m)
z_ant = 1.580
for r_ring, n_el, phase in ((0.30, 4, 0.0), (0.66, 8, 22.5)):
    for k in range(n_el):
        ang = math.radians(phase + 360.0 * k / n_el)
        bx, by = r_ring * math.cos(ang), r_ring * math.sin(ang)
        pl.helical_element(
            p, (bx, by, z_ant), (0, 0, 1),
            r_cup=0.070, h_cup=0.065, r_rod=0.036, h_rod=0.455,
            cup_mat="aluminium", rod_mat="radome_white", tip_mat="gold_kapton",
        )

# Official LRA_GLO_M (112 corner-cube prisms) at (+0.1370, +0.0030, +1.8737) m
# Mounted on a raised stand between the inner/outer L-band rings
pl.cylinder(p, (0.137, 0.003, z_ant), (0, 0, 1), 0.048, 0.255, 14, "titanium_grey")
pl.lrr_array(p, (0.137, 0.003, 1.835), (0.34, 0.34, 0.045), nx=6, ny=6)

# Optical solar & Earth horizon sensors on +Z deck periphery
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * 0.80, 0.36, z_ant + 0.08), (0.16, 0.16, 0.16), "black_paint")
    pl.cylinder(p, (sgn_x * 0.80, 0.36, z_ant + 0.16), (0, 0, 1), 0.045, 0.04, 14,
                "titanium_grey", top="lrr_cube_glass")
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 4. SADMs + Solar Wings (wing+Y, wing-Y)
# --------------------------------------------------------------------------------------
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY_SADM,
    sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS,
    panel_l=PANEL_L, panel_w=PANEL_W, panel_t=PANEL_T, panel_gap=PANEL_GAP,
    yoke_style="v_strut", wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x",
)

pl.export_and_render(ROOT, "glonass-m", scene, args)
