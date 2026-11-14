"""Procedural ISS Reshetnev GLONASS-K1 (Uragan-K1) satellite model -> glonass-k1.glb.

Covers IGS blocks: GLO-K1, GLO-K1A, GLO-K1B, GLO-K1+.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/glonass-k1/scripts/build.py -- --root models/glonass-k1 --render
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
#   - ISS Reshetnev Uragan-K1 (Ekspress-1000K unpressurized box platform),
#     GLONASS-IAC (glonass-iac.ru: 1.43 m width, 3.01 m stowed height; alternative
#     2.53 x 6.01 x 1.43 m operational envelope noted in NOTES.md),
#     & Novosti Kosmonavtiki / Roscosmos:
#       Bus: X_B = 1.600 m (measured/derived to carry Ø1.50 m LRA + aux housing),
#            Y_B = 1.430 m (official GLONASS-IAC), Z_B = 2.130 m (derived for 3.010 m total Z).
#       Solar array total area: 17.0 m^2 (official Reshetnev / Novosti Kosmonavtiki: halved
#       relative to GLONASS-M ~30-34 m^2; 8.50 m^2 per wing; 1.6 kW EOL).
#   - IGS igs_satellite_metadata.snx:
#       LRA_GLO_K1 (123 corner-cube prisms in an annular ring array) centered at
#       (0.0000, 0.0000, +1.4730) m around the L-band navigation antenna array.
#   - Solar wings: 2 wings, 2 panels/wing (2.125 m x 2.000 m = 8.50 m^2/wing, 17.00 m^2 total),
#       yoke 0.620 m, gap 0.060 m -> deployed span Y = 11.290 m.
# --------------------------------------------------------------------------------------
BUS = (1.600, 1.430, 2.130)                 # Ekspress-1000K unpressurized bus (X, Y, Z) m
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2

N_PANELS = 2
PANEL_L, PANEL_W, PANEL_T = 2.125, 2.000, 0.025
PANEL_GAP = 0.060
YOKE_LEN = 0.620                            # wing_tip = 0.715 + 0.620 + 4.250 + 0.060 = 5.645 m -> span 11.290 m
SADM_X, SADM_Z = 0.0, +0.05

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=28, rows=16, seed=202671)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=202672)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)

ROOTOBJ = bpy.data.objects.new("glonass_k1", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# 1. Unpressurized Ekspress-1000K Honeycomb Bus Box (Black & Silver MLI + OSR Radiators)
# --------------------------------------------------------------------------------------
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, 0.0), BUS, bevel_offset=0.022, segments=3,
             mat={"+z": "mli_gold", "-z": "mli_black",
                  "+x": "mli_black", "-x": "mli_black",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_black"})

# External structural frame rails & corner brackets characteristic of Ekspress-1000K
for sx in (1, -1):
    for sy in (1, -1):
        pl.bar(p, (sx * (HX + 0.008), sy * (HY + 0.008), -HZ + 0.04),
               (sx * (HX + 0.008), sy * (HY + 0.008), +HZ - 0.04),
               0.040, 0.040, "aluminium", (sx, sy, 0))

# Optical Solar Reflector (OSR) radiator panels & heat-pipe louvers on +-X and +-Y
TO = 0.005
for sgn_x in (1, -1):
    pl.box(p, (sgn_x * (HX + TO / 2 + 0.002), 0.0, +0.10), (TO, 1.08, 1.48),
           "osr_radiator", uv="tile", tile=0.18)
for sgn_y in (1, -1):
    pl.box(p, (-0.28, sgn_y * (HY + TO / 2 + 0.002), +0.15), (0.56, TO, 1.30),
           "osr_radiator", uv="tile", tile=0.18)
    pl.box(p, (+0.34, sgn_y * (HY + TO / 2 + 0.002), -0.20), (0.44, TO, 1.10),
           "mli_silver", uv="tile", tile=pl.MLI_TILE)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 2. Earth-Facing (+Z) Antenna Pedestal, 12-Helix Array & Annular LRA_GLO_K1 (123 Prisms)
# --------------------------------------------------------------------------------------
p = pl.Part("nadir_antenna_and_lra", store)
# Octagonal/cylindrical antenna support pedestal from Z = +1.065 m to Z = +1.430 m
pl.cylinder(p, (0.0, 0.0, HZ), (0, 0, 1), 0.64, 0.365, 28,
            "mli_gold", top="aluminium", r1=0.76, side_tile=pl.MLI_TILE)

# Annular Laser Retroreflector Array (LRA_GLO_K1, 123 prisms) at Z = +1.430..+1.473 m
# Official SINEX coordinate: (0.0000, 0.0000, +1.4730) m
pl.lrr_ring(p, (0.0, 0.0, HZ + 0.365), r_inner=0.62, r_outer=0.75, height=0.043, n_prisms=36)

# 12 L-band helical antennas inside the LRA ring (4 inner at r=0.22 m, 8 outer at r=0.47 m)
# Extending from Z = +1.430 m to Z = +1.850 m (height 0.420 m)
z_ant = HZ + 0.365
for r_ring, n_el, phase in ((0.22, 4, 45.0), (0.47, 8, 22.5)):
    for k in range(n_el):
        ang = math.radians(phase + 360.0 * k / n_el)
        bx, by = r_ring * math.cos(ang), r_ring * math.sin(ang)
        pl.helical_element(
            p, (bx, by, z_ant), (0, 0, 1),
            r_cup=0.062, h_cup=0.055, r_rod=0.030, h_rod=0.365,
            cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
        )

# COSPAS-SARSAT search-and-rescue & L3 CDMA auxiliary antennas on +X side of +Z deck
pl.box(p, (+0.54, +0.52, HZ + 0.08), (0.20, 0.20, 0.16), "mli_silver")
pl.cylinder(p, (+0.54, +0.52, HZ + 0.16), (0, 0, 1), 0.048, 0.24, 14,
            "radome_white", top="titanium_grey", r1=0.032)
pl.finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# 3. Zenith (-Z) Launch Adapter Ring & AOCS Thrusters
# --------------------------------------------------------------------------------------
p = pl.Part("zenith_adapter", store)
pl.cylinder(p, (0.0, 0.0, -HZ - 0.095), (0, 0, 1), 0.54, 0.095, 32,
            "titanium_grey", bottom="aluminium")
for sx in (1, -1):
    for sy in (1, -1):
        b0 = Vector((sx * (HX - 0.10), sy * (HY - 0.10), -HZ))
        d = Vector((0.18 * sx, 0.18 * sy, -1.0)).normalized()
        pl.cylinder(p, b0, d, 0.022, 0.070, 10, "titanium_grey", r1=0.032, top="black_paint")
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

pl.export_and_render(ROOT, "glonass-k1", scene, args)

