"""Build NOAA-21 (JPSS-2) Northrop Grumman LEOStar-3 spacecraft procedural 3D model.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/noaa-21/scripts/build.py -- --root models/noaa-21 --render
"""
import math
import os
import sys

import bpy

TOOLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_tools")
sys.path.insert(0, TOOLS)
import proc_lib as pl  # noqa: E402
import vendor_lib as vl  # noqa: E402

args, ROOT, TEXDIR = pl.parse_build_args()
scene = pl.init_scene()
root_obj = bpy.data.objects.new("noaa_21", None)
scene.collection.objects.link(root_obj)
store = pl.MaterialStore()

# 5-panel single solar array wing texture sized for 1.54 x 2.15 m panels
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", 1.54, 2.15, cols=20, rows=14, seed=2026601)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", 1.54, 2.15, seed=2026602)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)
store.make("cavity_dark", (0.025, 0.025, 0.030), metallic=0.1, roughness=0.70)
store.make("optics_glass", (0.14, 0.22, 0.34), metallic=0.75, roughness=0.08)

# --------------------------------------------------------------------------------------
# Verified NOAA-21 / JPSS-2 (NORAD 54234, COSPAR 2022-150A) Envelope
# Frame: +X velocity/ram, +Y starboard radiator, -Y single 5-panel wing, +Z nadir deck
# Body: 4.30 m x 2.10 m (NOAA 14 ft x 7 ft), LEOStar-3 chamfered octagonal prism
# Total Y span: 10.70 m (NOAA 35 ft deployed), cell_normal: -X
# --------------------------------------------------------------------------------------
HY = 1.050
HZ = 1.050
BUS_X0 = -2.000
BUS_X1 = 2.050
CHAMFER_C = 0.680

# 1. Main LEOStar-3 chamfered octagonal bus + aft propulsion & fore avionics caps
bus = pl.Part("bus", store)
hex_pts = [
    (HY, -CHAMFER_C), (HY, CHAMFER_C),
    (CHAMFER_C, HZ), (-CHAMFER_C, HZ),
    (-HY, CHAMFER_C), (-HY, -CHAMFER_C),
    (-CHAMFER_C, -HZ), (CHAMFER_C, -HZ),
]
pl.prism(bus, (BUS_X0, 0.0, 0.0), (1, 0, 0), hex_pts, BUS_X1 - BUS_X0,
         side="mli_gold", top="mli_black", bottom="mli_black", uhint=(0, 1, 0))

# +X ram forward electronics bay cap (reaches +2.150 m)
pl.box(bus, (2.100, 0.0, 0.0), (0.100, 1.32, 1.32),
       {"+x": "mli_black", "default": "mli_gold"}, uv="tile", tile=pl.MLI_TILE)
# Star-forward louver & avionics harness strip on +X
pl.box(bus, (2.142, 0.32, -0.18), (0.016, 0.42, 0.36), "osr_radiator", uv="fit")
pl.box(bus, (2.142, -0.34, 0.22), (0.016, 0.38, 0.32), "aluminium")

# -X aft propulsion collar & orbit-adjust thrusters (reaches -2.150 m -> total X = 4.300 m)
pl.cylinder(bus, (-2.000, 0.0, 0.0), (-1, 0, 0), 0.72, 0.08, 24, "mli_black", top="aluminium", side_tile=pl.MLI_TILE)
for py, pz in ((-0.26, -0.26), (0.26, -0.26), (-0.26, 0.26), (0.26, 0.26)):
    pl.cylinder(bus, (-2.080, py, pz), (-1, 0, 0), 0.065, 0.070, 14, "titanium_grey", top="cavity_dark", r1=0.095)

# +Y starboard cold-space OSR thermal radiator bays
pl.box(bus, (0.05, 1.052, 0.0), (2.75, 0.016, 1.18), {"+y": "osr_radiator", "default": "aluminium"}, uv="fit")
pl.box(bus, (-1.62, 1.052, 0.0), (0.45, 0.016, 0.90), "mli_black", uv="tile", tile=pl.MLI_TILE)

# -Y port SADA bay thermal trim
pl.box(bus, (-0.35, -1.052, 0.0), (0.85, 0.016, 0.88), "mli_black", uv="tile", tile=pl.MLI_TILE)

# -Z zenith propulsion deck, S-band omni & twin canted star trackers (Z min = -1.320 m)
pl.box(bus, (-0.15, 0.0, -1.055), (2.40, 1.18, 0.04), "mli_black", uv="tile", tile=pl.MLI_TILE)
for sx, sy in ((0.72, 0.36), (0.72, -0.36)):
    axis_st = (0.35, 0.30 if sy > 0 else -0.30, -0.88)
    ln = math.sqrt(sum(c * c for c in axis_st))
    axis_n = tuple(c / ln for c in axis_st)
    pl.box(bus, (sx, sy, -1.08), (0.20, 0.20, 0.10), "aluminium")
    pl.cylinder(bus, (sx, sy, -1.11), axis_n, 0.085, 0.22, 16, "white_paint", top="cavity_dark", r1=0.115)
pl.cylinder(bus, (-1.55, 0.0, -1.05), (0, 0, -1), 0.045, 0.270, 14, "white_paint", top="radome_white")
bus_ob = pl.finish(bus, root_obj)

# 2. +Z Nadir Earth-Observing Payload Deck (VIIRS, CrIS, ATMS, OMPS-N/L, Ka-band HGA)
pay = pl.Part("nadir_payload_deck", store)

# Nadir optical bench mounting plate
pl.box(pay, (0.0, 0.0, 1.060), (3.85, 1.28, 0.03), "aluminium")

# VIIRS (Raytheon Visible Infrared Imaging Radiometer Suite, forward +X, +Z top = +1.67 m)
pl.box(pay, (1.02, -0.06, 1.365), (1.12, 0.96, 0.58),
       {"+z": "mli_white", "-y": "osr_radiator", "default": "mli_white"}, uv="tile", tile=pl.MLI_TILE)
# VIIRS rotating telescope aperture cavity & Earth-view baffle
pl.box(pay, (1.06, -0.06, 1.658), (0.48, 0.62, 0.03), "cavity_dark")
pl.box(pay, (1.36, -0.06, 1.672), (0.14, 0.66, 0.05), "titanium_grey")
pl.box(pay, (0.76, -0.06, 1.672), (0.14, 0.66, 0.05), "titanium_grey")
# VIIRS passive cryoradiator louver on +Y
pl.box(pay, (1.02, 0.435, 1.40), (0.54, 0.04, 0.34), "osr_radiator", uv="fit")

# ATMS (Northrop Grumman 70 x 60 x 40 cm verified eoPortal dimensions)
pl.box(pay, (0.04, -0.34, 1.275), (0.70, 0.60, 0.40),
       {"+z": "white_paint", "default": "mli_gold"}, uv="tile", tile=pl.MLI_TILE)
for ay in (-0.47, -0.21):
    pl.cylinder(pay, (0.04, ay, 1.475), (0, 0, 1), 0.11, 0.075, 18, "titanium_grey", top="optics_glass", r1=0.13)

# CrIS (L3Harris Cross-track Infrared Sounder, mid-starboard)
pl.box(pay, (-0.12, 0.32, 1.355), (0.78, 0.72, 0.56),
       {"+z": "mli_white", "+y": "osr_radiator", "default": "mli_gold"}, uv="tile", tile=pl.MLI_TILE)
pl.cylinder(pay, (-0.12, 0.32, 1.635), (0, 0, 1), 0.19, 0.055, 20, "titanium_grey", top="cavity_dark", r1=0.22)
pl.box(pay, (-0.12, 0.69, 1.38), (0.46, 0.03, 0.36), "osr_radiator", uv="fit")

# OMPS-Nadir & OMPS-Limb (Ball Aerospace UV ozone suite, aft -X)
pl.box(pay, (-1.18, 0.06, 1.315), (0.68, 0.64, 0.48),
       {"+z": "mli_white", "default": "white_paint"}, uv="tile", tile=pl.MLI_TILE)
# OMPS-Nadir dual Earth-view UV telescopes
for oy in (-0.08, 0.20):
    pl.box(pay, (-1.10, oy, 1.568), (0.20, 0.18, 0.04), "cavity_dark")
# OMPS-Limb triple-slit aft limb profiler hood (-X facing along orbit track)
pl.box(pay, (-1.62, 0.06, 1.36), (0.28, 0.44, 0.32), "white_paint")
pl.box(pay, (-1.77, 0.06, 1.36), (0.04, 0.36, 0.22), "cavity_dark")

# Ka-band / X-band High-Rate Data gimbaled nadir dish (Z max = +1.720 m)
pl.cylinder(pay, (-0.75, -0.44, 1.075), (0, 0, 1), 0.045, 0.36, 14, "titanium_grey")
pl.parabolic_dish(pay, (-0.75, -0.44, 1.54), (0, 0, 1), 0.28, 0.09, rings=5, segs=24,
                  front_mat="radome_white", back_mat="mli_gold", feed_len=0.18)

# S-band / GNSS telemetry antennas on forward & aft nadir corners
for ax, ay in ((1.78, 0.42), (1.78, -0.42), (-1.78, -0.42)):
    pl.cylinder(pay, (ax, ay, 1.075), (0, 0, 1), 0.032, 0.18, 12, "aluminium", top="radome_white")
pl.finish(pay, root_obj)

# 3. Single 5-Panel Solar Array Wing on -Y (sadm_-Y + articulated wing-Y)
# Total Y: bus +Y = +1.050 m, -Y wing tip = -9.650 m -> 10.700 m (35.1 ft NOAA official)
SADM_X = -0.350
SADM_Z = 0.0
SADM_R = 0.110
SADM_LEN = 0.140
YOKE_LEN = 0.700
N_PANELS = 5
PANEL_L = 1.540
PANEL_W = 2.150
PANEL_T = 0.032
PANEL_GAP = 0.050

sadm = pl.Part("sadm_-Y", store)
pl.cylinder(sadm, (SADM_X, -HY, SADM_Z), (0, -1, 0), SADM_R + 0.038, 0.020, 24,
            "mli_black", top="mli_black", side_tile=pl.MLI_TILE)
pl.cylinder(sadm, (SADM_X, -(HY + 0.020), SADM_Z), (0, -1, 0), SADM_R, SADM_LEN - 0.020, 24,
            "titanium_grey", top="bronze_anodised")
pl.finish(sadm, root_obj)

wing = pl.Part("wing-Y", store)
wing_in = HY + YOKE_LEN
y_root0 = HY + SADM_LEN
y_root1 = y_root0 + 0.100
pl.box(wing, (SADM_X, -(y_root0 + y_root1) / 2, SADM_Z), (0.07, y_root1 - y_root0, 0.16), "bronze_anodised")

z_spread = PANEL_W * 0.30
y_cross = wing_in - 0.06
for zz in (z_spread, -z_spread):
    pl.bar(wing, (SADM_X, -y_root1, SADM_Z), (SADM_X, -y_cross, SADM_Z + zz),
           0.045, 0.030, "titanium_grey", (0, 0, 1))
    pl.box(wing, (SADM_X, -(y_cross + wing_in) / 2, SADM_Z + zz),
           (0.048, wing_in - y_cross + 0.02, 0.065), "titanium_grey")
pl.bar(wing, (SADM_X, -y_cross, SADM_Z - z_spread), (SADM_X, -y_cross, SADM_Z + z_spread),
       0.038, 0.028, "titanium_grey", (0, 1, 0))

mats = {"-x": "solar_cells", "+x": "panel_back_cfrp", "default": "panel_edge"}
for k in range(N_PANELS):
    y0 = wing_in + k * (PANEL_L + PANEL_GAP)
    uv_flip = lambda uu, vv: (1.0 - uu, vv)
    pl.box(wing, (SADM_X, -(y0 + PANEL_L / 2), SADM_Z), (PANEL_T, PANEL_L, PANEL_W), mats,
           uv="fit", uvmap={"-x": uv_flip, "+x": uv_flip})
    if k < N_PANELS - 1:
        yh = y0 + PANEL_L + PANEL_GAP / 2
        for zz in (PANEL_W * 0.28, -PANEL_W * 0.28):
            pl.box(wing, (SADM_X, -yh, SADM_Z + zz), (0.042, PANEL_GAP + 0.05, 0.042), "titanium_grey")
        for zz in (PANEL_W * 0.12, -PANEL_W * 0.12):
            pl.box(wing, (SADM_X - 0.016, -yh, SADM_Z + zz), (0.006, PANEL_GAP + 0.04, 0.028), "gold_flex")

pl.finish(wing, root_obj, location=(SADM_X, -HY, SADM_Z))

views = vl.compute_eo_views(scene, bus_ob)
pl.export_and_render(ROOT, "noaa-21", scene, args, views=views)
