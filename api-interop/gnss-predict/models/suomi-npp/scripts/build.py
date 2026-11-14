"""Convert NASA-3D-Resources Suomi NPP .glb -> suomi-npp.glb (+Z nadir, +Y array axis, metres).

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/suomi-npp/scripts/build.py -- --root models/suomi-npp --render
"""
import os
import sys

import bpy
from mathutils import Matrix, Vector

TOOLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_tools")
sys.path.insert(0, TOOLS)
import proc_lib as pl  # noqa: E402
import vendor_lib as vl  # noqa: E402

args, ROOT, TEXDIR = pl.parse_build_args()
SRC_GLB = os.path.abspath(
    os.path.join(ROOT, "..", "vendor", "nasa", "Suomi_National_Polar-orbiting_Partnership_Suomi_NPP.glb")
)

# Already in metres (~4.18 m bus length x 8.96 m deployed span x 2.57 m width).
# Ry(+90 deg) maps raw -X (VIIRS/CrIS/ATMS/OMPS nadir) -> +Z, keeps -Y solar wing on -Y, raw +Z -> +X.
scene, objs = vl.import_and_flatten(SRC_GLB, rot_deg=(0.0, 90.0, 0.0), scale=1.0)

blo = Vector((1e9, 1e9, 1e9))
bhi = Vector((-1e9, -1e9, -1e9))
for ob in objs:
    if "shiny_panel" in ob.name:
        continue
    for v in ob.data.vertices:
        if v.co.y < -0.78:
            continue
        blo = Vector(map(min, blo, v.co))
        bhi = Vector(map(max, bhi, v.co))
bmid = (blo + bhi) * 0.5
shift = Vector((-bmid.x, -bmid.y, -bmid.z))
for ob in objs:
    ob.data.transform(Matrix.Translation(shift))

WING_CUT_Y = (blo.y - bmid.y) - 0.12
root_obj, bus_ob, wing_ob = vl.split_bus_and_wing(
    scene, objs, "suomi_npp", "wing-Y", (0.0, WING_CUT_Y, 0.0),
    lambda ob_nm, p, me: (
        "shiny_panel" in ob_nm
        or all(me.vertices[vi].co.y < WING_CUT_Y for vi in p.vertices)
    ),
)

# Downscale 1024^2 PNG textures to 512^2 so GLB fits cleanly well below 1.5 MB budget
vl.resize_packed_images(512)

views = vl.compute_eo_views(scene, bus_ob)
pl.export_and_render(ROOT, "suomi-npp", scene, args, views=views)
