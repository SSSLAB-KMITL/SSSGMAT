"""Procedural Himawari-8/9 (JMA, MELCO DS2000 Bus) model -> himawari-9.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/himawari-9/scripts/build.py -- --root models/himawari-9 --render
"""
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_tools"))
import proc_lib as pl  # noqa: E402

args, ROOT, TEXDIR = pl.parse_build_args()
scene = pl.init_scene()

# --------------------------------------------------------------------------------------
# Dimensions (metres). Sources: JMA / eoPortal Himawari-8 & -9 (MELCO DS2000)
#   - Deployed envelope: 5.2 m (X) x 8.0 m (Y) x 5.3 m (Z)
#   - Bus core (DS2000): 2.36 x 2.30 x 3.80 m
#   - Single South (-Y) 3-panel GaAs solar wing (~2.6 kW): extends to Y = -6.64 m
#   - +Y (North) unobstructed except AHI 3-stage radiative cooler & OSR radiators (+1.36 m)
#   - +Z (Nadir): AHI (Advanced Himawari Imager) telescope baffle to +2.65 m, SEDA monitor
#   - +-X side dishes: Ka-band high-rate downlink (+X) & Ku-band TT&C / DCP (-X)
# --------------------------------------------------------------------------------------
BUS = (2.360, 2.300, 3.800)
BUS_CZ = -0.350                             # Z in [-2.25, +1.55]
HX, HY = BUS[0] / 2, BUS[1] / 2
Z_BOT = BUS_CZ - BUS[2] / 2                 # -2.25
Z_TOP = BUS_CZ + BUS[2] / 2                 # +1.55

N_PANELS = 3
PANEL_L, PANEL_W, PANEL_T = 1.580, 2.100, 0.026
PANEL_GAP = 0.050
YOKE_LEN = 0.650                            # wing_tip = 1.15 + 0.65 + 3*1.58 + 2*0.05 = 6.64 m
SADM_X, SADM_Z = 0.0, BUS_CZ

store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", PANEL_L, PANEL_W, cols=28, rows=20, seed=2026609)
sb_img = pl.tex_solar_back(TEXDIR, "tex_solar_back", PANEL_L, PANEL_W, seed=2026610)
store.add_standard_palette(TEXDIR, solar_front_img=sf_img, solar_back_img=sb_img,
                           include_gold_mli=True, include_white_mli=True)
osr_mat = store.make("ahi_cooler", (0.86, 0.89, 0.94), metallic=0.55, roughness=0.14)

ROOTOBJ = bpy.data.objects.new("himawari_9", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# 1. DS2000 Bus, Radiators, Star Trackers & Apogee Thruster
p = pl.Part("bus", store)
pl.bevel_box(p, (0.0, 0.0, BUS_CZ), BUS, bevel_offset=0.028, segments=3,
             mat={"+z": "mli_white", "-z": "mli_gold",
                  "+x": "mli_gold", "-x": "mli_gold",
                  "+y": "mli_black", "-y": "mli_black", "default": "mli_gold"})

TO = 0.006
for sgn_y in (1, -1):
    for cz in (BUS_CZ + 0.92, BUS_CZ - 0.92):
        pl.box(p, (0.0, sgn_y * (HY + TO / 2 + 0.002), cz), (1.76, TO, 1.38),
               "osr_radiator", uv="tile", tile=0.22)
    pl.box(p, (0.0, sgn_y * (HY + 0.014), BUS_CZ), (1.88, 0.024, 0.28), "aluminium")

# Launch Adapter Ring & Apogee Engine (-Z down to -2.65 m)
pl.cylinder(p, (0, 0, Z_BOT), (0, 0, -1), 0.72, 0.28, 24, "titanium_grey", r1=0.62, top="black_paint")
pl.cylinder(p, (0, 0, Z_BOT - 0.25), (0, 0, -1), 0.16, 0.15, 18, "black_paint", r1=0.24)

# Corner RCS thruster pods & Star Trackers
for sx in (1, -1):
    for sy in (1, -1):
        pl.box(p, (sx * (HX + 0.05), sy * (HY - 0.18), Z_BOT + 0.18), (0.12, 0.12, 0.12), "titanium_grey")
    pl.cylinder(p, (sx * 0.78, HY, BUS_CZ + 1.48), (sx * 0.35, 0.7, 0.58), 0.09, 0.22, 14,
                "white_paint", r1=0.13, top="black_paint")
pl.finish(p, ROOTOBJ)

# 2. +Z Nadir Deck: AHI 16-Band Imager + North Radiative Cooler + SEDA
p = pl.Part("nadir_payload", store)
pl.box(p, (0.0, 0.0, Z_TOP + 0.03), (2.24, 2.18, 0.06), "aluminium")

# AHI Main Optical Bench & Scanner Housing (up to Z = +2.65 m)
pl.bevel_box(p, (+0.18, +0.20, Z_TOP + 0.48), (1.10, 1.04, 0.84), bevel_offset=0.025, segments=2,
             mat={"+z": "white_paint", "default": "mli_white"})
# AHI Deep Earth-Viewing Aperture Baffle (reaches Z = +2.650)
pl.cylinder(p, (+0.18, +0.20, Z_TOP + 0.90), (0.0, 0.0, 1.0), 0.34, 0.20, 24,
            "white_paint", r1=0.39, top="black_paint")
pl.cylinder(p, (+0.18, +0.20, Z_TOP + 0.90), (0.0, 0.0, 1.0), 0.31, 0.18, 20, "black_paint", top="black_paint")
# AHI North-Facing (+Y) 3-Stage Passive Radiative Cooler (reaches Y = +1.360)
pl.box(p, (+0.18, +0.96, Z_TOP + 0.42), (0.78, 0.62, 0.52),
       {"+y": "ahi_cooler", "default": "white_paint"})
pl.box(p, (+0.18, +1.30, Z_TOP + 0.42), (0.64, 0.12, 0.40), "osr_radiator", uv="tile", tile=0.18)

# SEDA (Space Environment Data Acquisition monitor) & S-band TT&C omni mast
pl.box(p, (-0.72, -0.58, Z_TOP + 0.22), (0.52, 0.48, 0.32),
       {"+z": "mli_gold", "default": "aluminium"})
pl.box(p, (-0.72, +0.58, Z_TOP + 0.18), (0.44, 0.40, 0.24), "white_paint")
pl.cylinder(p, (+0.92, -0.86, Z_TOP + 0.06), (0.0, 0.0, 1.0), 0.024, 0.48, 12,
            "titanium_grey", top="radome_white")
pl.finish(p, ROOTOBJ)

# 3. East/West Deployable Shaped Reflector Dishes (+X Ka-band, -X Ku-band / DCP) -> X = 5.20 m
p = pl.Part("reflectors", store)
ka_hinge = Vector((HX, -0.22, BUS_CZ + 0.95))
ka_apex = Vector((+2.02, -0.22, Z_TOP + 0.05))
pl.box(p, (HX + 0.05, -0.22, BUS_CZ + 0.95), (0.10, 0.22, 0.22), "titanium_grey")
pl.bar(p, ka_hinge, ka_apex, 0.060, 0.050, "titanium_grey", (0, 1, 0))
pl.parabolic_dish(
    p, ka_apex, (0.05, 0.0, 1.0),
    radius=0.580, depth=0.18, rings=5, segs=28,
    front_mat="radome_white", back_mat="titanium_grey", feed_len=0.52,
)

ku_hinge = Vector((-HX, +0.22, BUS_CZ + 0.95))
ku_apex = Vector((-2.02, +0.22, Z_TOP + 0.05))
pl.box(p, (-HX - 0.05, +0.22, BUS_CZ + 0.95), (0.10, 0.22, 0.22), "titanium_grey")
pl.bar(p, ku_hinge, ku_apex, 0.060, 0.050, "titanium_grey", (0, 1, 0))
pl.parabolic_dish(
    p, ku_apex, (-0.05, 0.0, 1.0),
    radius=0.580, depth=0.18, rings=5, segs=28,
    front_mat="radome_white", back_mat="titanium_grey", feed_len=0.52,
)
pl.finish(p, ROOTOBJ)

# 4. Single South (-Y) 3-Panel Solar Wing (remove +Y wing generated by build_sadm_and_wings)
pl.build_sadm_and_wings(
    ROOTOBJ, store, HY, sadm_x=SADM_X, sadm_z=SADM_Z,
    yoke_len=YOKE_LEN, n_panels=N_PANELS, panel_l=PANEL_L, panel_w=PANEL_W,
    panel_t=PANEL_T, panel_gap=PANEL_GAP, yoke_style="v_strut",
    wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x",
)
for extra in ("sadm_+Y", "wing+Y"):
    ob = bpy.data.objects.get(extra)
    if ob is not None:
        bpy.data.objects.remove(ob, do_unlink=True)

pl.export_and_render(ROOT, "himawari-9", scene, args)

