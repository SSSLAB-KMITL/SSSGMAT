"""Convert NASA-3D-Resources Terra.glb -> terra.glb (+Z nadir, +Y array axis, metres).

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    -P models/terra/scripts/build.py -- --root models/terra --render
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
SRC_GLB = os.path.abspath(os.path.join(ROOT, "..", "vendor", "nasa", "Terra.glb"))

# Raw Terra.glb is in 0.5 mm units (scale 0.0005 -> bus length 6.81 m vs official 6.8 m),
# with Main Dish zenith on +Z, instruments nadir on -Z, and single wing on -Y.
# Rotating 180 deg around Y maps nadir (-Z) -> +Z and keeps single wing on -Y.
SCALE = 0.0005
scene, objs = vl.import_and_flatten(SRC_GLB, rot_deg=(0.0, 180.0, 0.0), scale=SCALE)

# Center the main bus (exclude wing layers Layer16 / Layer17 and zenith dish Layer20 from XY offset)
blo = Vector((1e9, 1e9, 1e9))
bhi = Vector((-1e9, -1e9, -1e9))
for ob in objs:
    if any(k in ob.name for k in ("Layer16", "Layer17")):
        continue
    for v in ob.data.vertices:
        blo = Vector(map(min, blo, v.co))
        bhi = Vector(map(max, bhi, v.co))
bus_center = (blo + bhi) * 0.5
# Keep bus centered around origin (shift slightly on Y so bus sits at [-1.75, +1.75] m)
shift = Vector((-bus_center.x, -1.75 - blo.y, -bus_center.z))
for ob in objs:
    ob.data.transform(Matrix.Translation(shift))

# Remove broken external .tga images and rebuild clean PBR materials for solar wing & side panels
for im in list(bpy.data.images):
    if im.size[0] == 0:
        bpy.data.images.remove(im)

store = pl.MaterialStore()
sf_img = pl.tex_solar_front(TEXDIR, "tex_solar_front", 9.0, 5.0, cols=40, rows=22, seed=2026511)
solar_mat = store.make("Main Solar Panels", (0.08, 0.10, 0.24), metallic=0.05, roughness=0.18, image=sf_img)
side_mat = store.make("Side Panels", (0.76, 0.77, 0.79), metallic=0.80, roughness=0.35)

for ob in objs:
    for i, m in enumerate(ob.data.materials):
        if m is None:
            continue
        if "Solar Panels" in m.name and "Hardware" not in m.name:
            ob.data.materials[i] = solar_mat
        elif m.name == "Side Panels":
            ob.data.materials[i] = side_mat

# Compute wing-Y SADM pivot from Layer16 inboard bound
y_sadm = -1.78
x_sadm, z_sadm = 0.0, 0.0
for ob in objs:
    if "Layer16" in ob.name:
        ys = [v.co.y for v in ob.data.vertices]
        xs = [v.co.x for v in ob.data.vertices]
        zs = [v.co.z for v in ob.data.vertices]
        y_sadm = max(ys) + 0.08
        x_sadm = (min(xs) + max(xs)) * 0.5
        z_sadm = (min(zs) + max(zs)) * 0.5
        break

root_obj, bus_ob, wing_ob = vl.split_bus_and_wing(
    scene, objs, "terra", "wing-Y", (x_sadm, y_sadm, z_sadm),
    lambda ob_nm, p, me: ("Layer16" in ob_nm or "Layer17" in ob_nm),
)

vl.decimate_object(bus_ob, 10800)
vl.decimate_object(wing_ob, 2600)
vl.resize_packed_images(512)

views = vl.compute_eo_views(scene, bus_ob)
pl.export_and_render(ROOT, "terra", scene, args, views=views)
