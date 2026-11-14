"""Re-import a satellite .glb into an empty Blender scene and verify budgets, wing nodes, and bounding box.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P ../_tools/verify.py -- \
      --glb <model>.glb [--expected-size X,Y,Z] [--max-tris 15000] [--render renders/90_reimport_check.jpg]
"""
import argparse
import json
import os
import struct
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--glb", required=True)
ap.add_argument("--expected-size", default="")
ap.add_argument("--max-tris", type=int, default=15000)
ap.add_argument("--max-bytes", type=int, default=int(1.5 * 1048576))
ap.add_argument("--tol", type=float, default=0.02)
ap.add_argument("--single-wing", action="store_true")
ap.add_argument("--render", default="")
args = ap.parse_args(argv)
glb = os.path.abspath(args.glb)

# ---- raw glTF JSON (what Cesium reads, +Y up) -------------------------------------------
with open(glb, "rb") as fh:
    magic, version, length = struct.unpack("<4sII", fh.read(12))
    clen, ctype = struct.unpack("<I4s", fh.read(8))
    gj = json.loads(fh.read(clen))
fsize = os.path.getsize(glb)
print("GLB magic=%s version=%d length=%d bytes" % (magic, version, length))
print("FILE_SIZE_BYTES", fsize, "(%.3f MB)" % (fsize / 1048576))
print("glTF nodes:")
nodes_by_name = {}
for nd in gj["nodes"]:
    nm = nd.get("name")
    nodes_by_name[nm] = nd
    print("  %-20s mesh=%-4s T=%s R=%s children=%s" % (
        nm, nd.get("mesh"), [round(v, 4) for v in nd.get("translation", [0, 0, 0])],
        nd.get("rotation", "identity"), nd.get("children", [])))
print("images:", [(im.get("name"), im.get("mimeType")) for im in gj.get("images", [])])
print("materials:", [m["name"] for m in gj.get("materials", [])])


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
    if "mesh" in nd:
        lo, hi = mesh_bounds(nd["mesh"])
        t = nd.get("translation", [0, 0, 0])
        lo = [round(a + b, 3) for a, b in zip(lo, t)]
        hi = [round(a + b, 3) for a, b in zip(hi, t)]
        print("  %-18s min=%s max=%s" % (nd["name"], lo, hi))

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
bbox_size = tuple(round(c, 3) for c in (hi - lo))
print("REIMPORT_TRIANGLES", tri)
print("REIMPORT_MESHES (name, tris, materials):")
for r in sorted(rows):
    print("  %-20s %6d  %s" % r)
print("REIMPORT_BBOX_MIN", tuple(round(c, 3) for c in lo))
print("REIMPORT_BBOX_MAX", tuple(round(c, 3) for c in hi))
print("REIMPORT_BBOX_SIZE", bbox_size)
imgs = [(im.name, tuple(im.size)) for im in bpy.data.images]
print("IMAGES", imgs)

# ---- verification checks ---------------------------------------------------------------
errors = []
if fsize > args.max_bytes:
    errors.append(f"File size {fsize} exceeds budget {args.max_bytes}")
if tri > args.max_tris:
    errors.append(f"Triangles {tri} exceed budget {args.max_tris}")
for nm, sz in imgs:
    if sz[0] > 1024 or sz[1] > 1024:
        errors.append(f"Image {nm} size {sz} exceeds 1024x1024")

wing_pair = None
for cand in (("wing+Y", "wing-Y"), ("solar_wing_+Y", "solar_wing_-Y")):
    if cand[0] in nodes_by_name and cand[1] in nodes_by_name:
        wing_pair = cand
        break
if wing_pair is not None:
    w_pos = nodes_by_name[wing_pair[0]]
    w_neg = nodes_by_name[wing_pair[1]]
    t_pos = w_pos.get("translation", [0.0, 0.0, 0.0])
    t_neg = w_neg.get("translation", [0.0, 0.0, 0.0])
    # In glTF (+Y up), body +Y is glTF -Z
    if not (t_pos[2] < -0.05 and t_neg[2] > 0.05):
        errors.append(f"Wing node pivots not on +-Y axis (glTF T_pos={t_pos}, T_neg={t_neg})")
    print(f"WING_NODES {wing_pair[0]} T={t_pos}, {wing_pair[1]} T={t_neg}")
elif args.single_wing and ("wing+Y" in nodes_by_name or "wing-Y" in nodes_by_name):
    w_nm = "wing+Y" if "wing+Y" in nodes_by_name else "wing-Y"
    t_w = nodes_by_name[w_nm].get("translation", [0.0, 0.0, 0.0])
    ok = (t_w[2] < -0.05) if w_nm == "wing+Y" else (t_w[2] > 0.05)
    if not ok:
        errors.append(f"Single wing node {w_nm} pivot not on matching +-Y axis (glTF T={t_w})")
    print(f"WING_NODE {w_nm} T={t_w}")
else:
    errors.append("Missing wing+Y / wing-Y nodes")

if args.expected_size:
    exp = [float(x) for x in args.expected_size.split(",")]
    diffs = [abs(a - b) / max(b, 1e-6) for a, b in zip(bbox_size, exp)]
    print("EXPECTED_SIZE", tuple(round(x, 3) for x in exp),
          "REL_DIFF_PCT", tuple(round(d * 100, 2) for d in diffs))
    for axis_name, a, b, d in zip(("X", "Y", "Z"), bbox_size, exp, diffs):
        if d > args.tol:
            errors.append(f"Axis {axis_name}: bbox {a} differs from expected {b} by {d*100:.2f}% (> {args.tol*100:.1f}%)")

if errors:
    for e in errors:
        print("VERIFY_ERROR:", e)
    sys.exit(1)
print("VERIFY_STATUS PASS")

if not args.render:
    sys.exit(0)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_setup  # noqa: E402

render_setup.setup(scene, samples=24, res=(1200, 750))
span = max(bbox_size)
render_setup.view(
    scene,
    os.path.abspath(args.render),
    target=(0.0, 0.0, 0.0),
    direction=(-0.62, -0.62, 0.48),
    dist=max(span * 1.35, 8.0),
    lens=45,
    sun_from=(-0.75, -0.35, 0.55),
)

