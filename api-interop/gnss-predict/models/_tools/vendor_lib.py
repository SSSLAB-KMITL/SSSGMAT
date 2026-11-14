"""Shared helpers for converting NASA-3D-Resources vendor .glb models into project conventions."""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import proc_lib as pl  # noqa: E402


def import_and_flatten(glb_path, rot_deg=(0.0, 0.0, 0.0), scale=1.0, offset=(0.0, 0.0, 0.0)):
    """Import vendor GLB, bake hierarchy world transforms, apply rigid rotation + scale + offset."""
    scene = pl.init_scene()
    bpy.ops.import_scene.gltf(filepath=glb_path)

    meshes = [o for o in scene.objects if o.type == "MESH"]
    rot_m = Euler([math.radians(a) for a in rot_deg], "XYZ").to_matrix().to_4x4()
    xform = Matrix.Translation(Vector(offset)) @ Matrix.Scale(scale, 4) @ rot_m

    baked = []
    for ob in meshes:
        me = ob.data.copy()
        mw = ob.matrix_world.copy()
        me.transform(xform @ mw)
        nob = bpy.data.objects.new(ob.name, me)
        scene.collection.objects.link(nob)
        baked.append(nob)

    for ob in list(scene.objects):
        if ob not in baked:
            bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    return scene, baked


def _subset_mesh_by_faces(src_ob, scene, flags, new_name):
    me = src_ob.data.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    to_del = [f for f, keep in zip(bm.faces, flags) if not keep]
    if to_del:
        bmesh.ops.delete(bm, geom=to_del, context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.name = new_name
    nob = bpy.data.objects.new(new_name, me)
    scene.collection.objects.link(nob)
    return nob


def split_bus_and_wing(scene, objs, root_name, wing_name, wing_pivot, is_wing_poly_fn):
    """Split each mesh into bus vs solar-wing faces, join into bus + wing node under ROOTOBJ."""
    bus_parts = []
    wing_parts = []

    for ob in objs:
        me = ob.data
        flags = [bool(is_wing_poly_fn(ob.name, p, me)) for p in me.polygons]
        if all(flags):
            wing_parts.append(ob)
        elif not any(flags):
            bus_parts.append(ob)
        else:
            bus_parts.append(_subset_mesh_by_faces(ob, scene, [not f for f in flags], ob.name + "_bus"))
            wing_parts.append(_subset_mesh_by_faces(ob, scene, flags, ob.name + "_wing"))
            bpy.data.objects.remove(ob, do_unlink=True)

    def join_group(parts, target_name):
        bpy.ops.object.select_all(action="DESELECT")
        for p in parts:
            p.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        if len(parts) > 1:
            bpy.ops.object.join()
        res = bpy.context.view_layer.objects.active
        res.name = target_name
        res.data.name = target_name
        return res

    bus_ob = join_group(bus_parts, "bus")
    wing_ob = join_group(wing_parts, wing_name)

    piv = Vector(wing_pivot)
    wing_ob.data.transform(Matrix.Translation(-piv))
    wing_ob.location = piv

    root_obj = bpy.data.objects.new(root_name, None)
    scene.collection.objects.link(root_obj)
    bus_ob.parent = root_obj
    wing_ob.parent = root_obj
    return root_obj, bus_ob, wing_ob


def decimate_object(ob, target_tris, planar_deg=0.0, weld_dist=0.0, edge_split_deg=0.0):
    """Collapse-decimate mesh object down to target_tris while preserving materials & UVs."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    if weld_dist > 0.0:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=weld_dist)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-4, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()

    if ob.data.has_custom_normals and weld_dist > 0.0:
        with bpy.context.temp_override(object=ob, active_object=ob):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()

    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob

    if planar_deg > 0.0:
        pmod = ob.modifiers.new("DecimatePlanar", "DECIMATE")
        pmod.decimate_type = "DISSOLVE"
        pmod.angle_limit = math.radians(planar_deg)
        pmod.delimit = {"MATERIAL", "UV"}
        bpy.ops.object.modifier_apply(modifier=pmod.name)

    ob.data.calc_loop_triangles()
    cur = len(ob.data.loop_triangles)
    if cur > target_tris:
        ratio = max(target_tris / float(cur), 0.02)
        mod = ob.modifiers.new("DecimateBudget", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)

    if edge_split_deg > 0.0:
        smod = ob.modifiers.new("EdgeSplitSharp", "EDGE_SPLIT")
        smod.split_angle = math.radians(edge_split_deg)
        smod.use_edge_angle = True
        bpy.ops.object.modifier_apply(modifier=smod.name)

    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


def resize_packed_images(max_dim=512):
    """Downscale any packed image larger than max_dim so GLB easily clears 1.5 MB."""
    for im in bpy.data.images:
        w, h = im.size
        if w <= 0 or h <= 0:
            continue
        m = max(w, h)
        if m > max_dim:
            sc = max_dim / float(m)
            im.scale(max(1, int(round(w * sc))), max(1, int(round(h * sc))))
        try:
            im.pack()
        except Exception:
            pass


def compute_eo_views(scene, bus_ob):
    """Camera views framing both full single-wing span and close-up nadir instrument deck."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    blo = Vector((1e9, 1e9, 1e9))
    bhi = Vector((-1e9, -1e9, -1e9))
    for ob in scene.objects:
        if ob.type != "MESH":
            continue
        mw = ob.matrix_world
        for v in ob.data.vertices:
            w = mw @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
            if ob == bus_ob:
                blo = Vector(map(min, blo, w))
                bhi = Vector(map(max, bhi, w))
    mid = tuple((lo + hi) * 0.5)
    bmid = tuple((blo + bhi) * 0.5)
    span = max(hi - lo)
    bspan = max(bhi - blo)
    return {
        "01_earth_face": dict(
            target=bmid,
            direction=(-0.18, -0.32, 1.0),
            dist=max(bspan * 1.65, 5.5),
            lens=50,
            sun_from=(-0.55, -0.45, 0.75),
            up=(0, 1, 0),
        ),
        "02_side_span": dict(
            target=mid,
            direction=(-1.0, -0.06, 0.16),
            dist=max(span * 1.42, 9.0),
            lens=50,
            sun_from=(-0.85, -0.25, 0.45),
        ),
        "03_three_quarter": dict(
            target=mid,
            direction=(-0.62, -0.62, 0.48),
            dist=max(span * 1.25, 8.5),
            lens=45,
            sun_from=(-0.75, -0.35, 0.55),
        ),
        "04_closeup": dict(
            target=bmid,
            direction=(-0.70, -0.52, 0.58),
            dist=max(bspan * 1.45, 5.0),
            lens=50,
            sun_from=(-0.6, -0.55, 0.6),
        ),
    }
