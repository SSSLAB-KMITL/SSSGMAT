"""Convert NASA-3D-Resources Aqua_B.glb -> aqua.glb (+Z nadir, +Y array axis, metres).

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/aqua/scripts/build.py -- --root models/aqua --render
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
SRC_GLB = os.path.abspath(os.path.join(ROOT, "..", "vendor", "nasa", "Aqua_B.glb"))

# Official Aqua deployed span = 16.70 m (Aqua_B raw Z span = 17.777 -> scale = 16.70 / 17.777).
# Rx(-90 deg) maps raw +Y (MODIS/AIRS/CERES nadir) -> +Z, raw -Y (TDRSS HGA zenith) -> -Z, and solar wing -> -Y.
SCALE = 16.700 / 17.7773
scene, objs = vl.import_and_flatten(SRC_GLB, rot_deg=(-90.0, 0.0, 0.0), scale=SCALE)

# Center the main spacecraft bus (exclude shiny_panel & solar wing vertices with y < -1.45)
blo = Vector((1e9, 1e9, 1e9))
bhi = Vector((-1e9, -1e9, -1e9))
for ob in objs:
    if "shiny_panel" in ob.name:
        continue
    for v in ob.data.vertices:
        if v.co.y < -1.45:
            continue
        blo = Vector(map(min, blo, v.co))
        bhi = Vector(map(max, bhi, v.co))
bmid = (blo + bhi) * 0.5
shift = Vector((-bmid.x, -bmid.y, -bmid.z))
for ob in objs:
    ob.data.transform(Matrix.Translation(shift))

# Wing cut plane: separate single solar wing extending along -Y below bus wall
WING_CUT_Y = (blo.y - bmid.y) - 0.08
spine_zs = [v.co.z for ob in objs if "shiny_panel" in ob.name for v in ob.data.vertices]
wing_z = (min(spine_zs) + max(spine_zs)) * 0.5 if spine_zs else 0.0
root_obj, bus_ob, wing_ob = vl.split_bus_and_wing(
    scene, objs, "aqua", "wing-Y", (0.0, WING_CUT_Y, wing_z),
    lambda ob_nm, p, me: (
        "shiny_panel" in ob_nm
        or all(me.vertices[vi].co.y < WING_CUT_Y for vi in p.vertices)
    ),
)

vl.decimate_object(bus_ob, 11200)
vl.decimate_object(wing_ob, 1800)
vl.resize_packed_images(512)

views = vl.compute_eo_views(scene, bus_ob)
pl.export_and_render(ROOT, "aqua", scene, args, views=views)
