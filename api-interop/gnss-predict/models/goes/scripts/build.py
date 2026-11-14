"""Convert NASA-3D-Resources GOES-R .glb -> goes.glb (+Z nadir, +Y array axis, metres).

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/goes/scripts/build.py -- --root models/goes --render
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
    os.path.join(ROOT, "..", "vendor", "nasa", "Geostationary_Operational_Environmental_Satellites.glb")
)

# Raw GOES-R Layer_0 is scaled by 0.01 (0.134 x 0.111 x 0.122 -> scale 100.0 gives ~4.0 m bus, ~8 m mag boom).
# Rz(+90 deg) preserves +Z nadir (ABI/GLM Earth deck) and rotates -X solar wing onto -Y.
scene, objs = vl.import_and_flatten(SRC_GLB, rot_deg=(0.0, 0.0, 90.0), scale=100.0)

ob0 = objs[0]
me0 = ob0.data
WING_MATS = {
    i for i, m in enumerate(me0.materials)
    if m and ("solarpanel" in m.name.lower() or "parasol-solar" in m.name.lower())
}

# Center bus excluding magnetometer boom (x > 2.2 or z < -2.2) and solar wing (y < -2.35)
blo = Vector((1e9, 1e9, 1e9))
bhi = Vector((-1e9, -1e9, -1e9))
for v in me0.vertices:
    if v.co.y < -2.35 or v.co.z < -2.2 or v.co.x < -2.4:
        continue
    blo = Vector(map(min, blo, v.co))
    bhi = Vector(map(max, bhi, v.co))
bmid = (blo + bhi) * 0.5
shift = Vector((-bmid.x, -bmid.y, -bmid.z))
me0.transform(Matrix.Translation(shift))

WING_CUT_Y = (blo.y - bmid.y) - 0.02
root_obj, bus_ob, wing_ob = vl.split_bus_and_wing(
    scene, objs, "goes", "wing-Y", (0.0, WING_CUT_Y, 1.19 - bmid.z),
    lambda ob_nm, p, me: (
        p.material_index in WING_MATS
        or all(me.vertices[vi].co.y < WING_CUT_Y for vi in p.vertices)
    ),
)

vl.decimate_object(bus_ob, 9800, planar_deg=1.5, weld_dist=0.0005, edge_split_deg=35.0)
vl.decimate_object(wing_ob, 5000, planar_deg=2.0, weld_dist=0.0005, edge_split_deg=35.0)
vl.resize_packed_images(512)

views = vl.compute_eo_views(scene, bus_ob)
pl.export_and_render(ROOT, "goes", scene, args, views=views)
