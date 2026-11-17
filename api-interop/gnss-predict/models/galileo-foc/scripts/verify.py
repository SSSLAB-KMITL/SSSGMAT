"""Re-import galileo_foc.glb into a fresh scene and report what the web app will get.

Blender -b --factory-startup -P scripts/verify.py -- --glb galileo_foc.glb [--render out.png]
"""
import argparse
import json
import math
import os
import struct
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--glb", required=True)
ap.add_argument("--render", default="")
args = ap.parse_args(argv)
glb = os.path.abspath(args.glb)

# ---- raw glTF JSON (what Cesium reads, +Y up) -------------------------------------------
with open(glb, "rb") as fh:
    magic, version, length = struct.unpack("<4sII", fh.read(12))
    clen, ctype = struct.unpack("<I4s", fh.read(8))
    gj = json.loads(fh.read(clen))
print("GLB magic=%s version=%d length=%d bytes" % (magic, version, length))
print("FILE_SIZE_BYTES", os.path.getsize(glb), "(%.3f MB)" % (os.path.getsize(glb) / 1048576))
print("glTF nodes:")
for nd in gj["nodes"]:
    print("  %-20s mesh=%-4s T=%s R=%s children=%s" % (
        nd.get("name"), nd.get("mesh"), [round(v, 4) for v in nd.get("translation", [0, 0, 0])],
        nd.get("rotation", "identity"), nd.get("children", [])))
print("images:", [(im.get("name"), im.get("mimeType")) for im in gj.get("images", [])])
print("materials:", [m["name"] for m in gj["materials"]])


def mesh_bounds(mesh_idx):
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for prim in gj["meshes"][mesh_idx]["primitives"]:
        acc = gj["accessors"][prim["attributes"]["POSITION"]]
        lo = [min(a, b) for a, b in zip(lo, acc["min"])]
        hi = [max(a, b) for a, b in zip(hi, acc["max"])]
    return lo, hi


print("glTF-space bounds of key meshes (mesh-local + node translation):")
for nd in gj["nodes"]:
    if "mesh" in nd and nd["name"] in ("bus", "nav_antenna", "lrr", "sar_antenna", "solar_wing_+Y",
                                       "solar_wing_-Y", "radiators_osr"):
        lo, hi = mesh_bounds(nd["mesh"])
        t = nd.get("translation", [0, 0, 0])
        lo = [round(a + b, 3) for a, b in zip(lo, t)]
        hi = [round(a + b, 3) for a, b in zip(hi, t)]
        print("  %-14s min=%s max=%s" % (nd["name"], lo, hi))

# ---- re-import -------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
scene = bpy.context.scene
tri = 0
rows = []
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for ob in scene.objects:
    if ob.type != "MESH":
        continue
    me = ob.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    tri += n
    rows.append((ob.name, n, [m.name for m in me.materials]))
    mw = ob.matrix_world
    for v in me.vertices:
        w = mw @ v.co
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
print("REIMPORT_TRIANGLES", tri)
print("REIMPORT_MESHES (name, tris, materials):")
for r in sorted(rows):
    print("  %-20s %6d  %s" % r)
print("REIMPORT_BBOX_MIN", tuple(round(c, 3) for c in lo))
print("REIMPORT_BBOX_MAX", tuple(round(c, 3) for c in hi))
print("REIMPORT_BBOX_SIZE", tuple(round(c, 3) for c in (hi - lo)))
print("IMAGES", [(im.name, tuple(im.size)) for im in bpy.data.images])

if not args.render:
    sys.exit(0)

# ---- render the re-imported model (checks that materials/textures survived export) -------
r = scene.render
r.engine = "BLENDER_EEVEE"
r.resolution_x, r.resolution_y = 1600, 1000
scene.eevee.taa_render_samples = 32
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
world = bpy.data.worlds.new("w")
scene.world = world
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.03, 0.035, 0.045, 1)
sun_d = bpy.data.lights.new("sun", "SUN")
sun_d.energy = 6.0
sun = bpy.data.objects.new("sun", sun_d)
scene.collection.objects.link(sun)
cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 45
cam_d.clip_end = 500
cam = bpy.data.objects.new("cam", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam


def orient(obj, forward, up=(0, 0, 1)):
    f = Vector(forward).normalized()
    rgt = f.cross(Vector(up)).normalized()
    u = rgt.cross(f)
    obj.matrix_world = Matrix.Translation(obj.location) @ Matrix((rgt, u, -f)).transposed().to_4x4()


d = Vector((-0.62, -0.62, 0.48)).normalized()
cam.location = Vector((0, -0.3, 0)) + d * 19.5
orient(cam, -d)
orient(sun, -Vector((-0.75, -0.35, 0.55)))
r.filepath = os.path.abspath(args.render)
bpy.ops.render.render(write_still=True)
print("RENDERED", r.filepath)
