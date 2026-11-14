"""Comparison sheets: reference photo (left) beside a render of galileo_foc.glb (right) from a
camera matched to the photo (EXIF focal length + poses measured in photo_geometry.py).
For internal review only; the photos never go into the model.

Blender -b --factory-startup -P scripts/compare.py -- --root <galileo-foc dir> [--only name]
"""
import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import photo_geometry as pg  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--root", required=True)
ap.add_argument("--only", default="")
args = ap.parse_args(argv)
ROOT = os.path.abspath(args.root)

OUT_W, OUT_H = 1200, 800          # each half; photos are 3:2
HY, HZ, HX = 0.6, 0.55, 1.265
SADM_X = 0.10
WING_IN, PANEL_W = 2.22, 1.082

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "galileo_foc.glb"))
OBJ = {o.name: o for o in scene.objects}

r = scene.render
r.engine = "BLENDER_EEVEE"
r.resolution_x, r.resolution_y, r.resolution_percentage = OUT_W, OUT_H, 100
scene.eevee.taa_render_samples = 48
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
world = bpy.data.worlds.new("cleanroom")
scene.world = world
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.55, 0.56, 0.58, 1)      # bright, diffuse cleanroom-like light
bg.inputs["Strength"].default_value = 0.9
sun_d = bpy.data.lights.new("sun", "SUN")
sun_d.energy = 2.5
sun = bpy.data.objects.new("sun", sun_d)
scene.collection.objects.link(sun)
cam_d = bpy.data.cameras.new("cam")
cam_d.sensor_fit = "HORIZONTAL"
cam_d.sensor_width = 36.0
cam_d.clip_start = 0.05
cam_d.clip_end = 200
cam = bpy.data.objects.new("cam", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam


def set_cam(position, right, down, forward, focal_mm):
    """Camera from an OpenCV-style frame (x right, y down, z forward) given in model coords."""
    rx, dn, fw = Vector(right).normalized(), Vector(down).normalized(), Vector(forward).normalized()
    m = Matrix((rx, -dn, -fw)).transposed().to_4x4()
    m.translation = Vector(position)
    cam.matrix_world = m
    cam_d.lens = focal_mm


def aim_sun(direction_from):
    s = Vector(direction_from).normalized()
    f = -s
    rgt = f.cross(Vector((0, 0, 1)) if abs(s.z) < 0.95 else Vector((0, 1, 0))).normalized()
    u = rgt.cross(f)
    sun.matrix_world = Matrix((rgt, u, -f)).transposed().to_4x4()


def set_wing_angle(theta):
    for nm in ("solar_wing_+Y", "solar_wing_-Y"):
        if nm in OBJ:
            OBJ[nm].rotation_mode = "XYZ"
            OBJ[nm].rotation_euler = (0.0, theta, 0.0)


def show_wings(flag):
    for nm in ("solar_wing_+Y", "solar_wing_-Y"):
        if nm in OBJ:
            OBJ[nm].hide_render = not flag


def load_rgb(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[..., :3]
    bpy.data.images.remove(img)
    return px  # row 0 = bottom


def resize(a, W, H):
    h, w = a.shape[:2]
    yi = np.clip((np.arange(H) + 0.5) / H * h, 0, h - 1).astype(int)
    xi = np.clip((np.arange(W) + 0.5) / W * w, 0, w - 1).astype(int)
    return a[yi][:, xi]


def mark(img, pts_px):
    """Draw small yellow crosses at measured photo points (full-res px) on an OUT_W x OUT_H half."""
    for u, v in pts_px:
        x = int(round(u / pg.IMG_W * OUT_W))
        y = OUT_H - 1 - int(round(v / pg.IMG_H * OUT_H))
        for d in range(-7, 8):
            for (yy, xx) in ((y, x + d), (y + d, x)):
                if 0 <= yy < OUT_H and 0 <= xx < OUT_W:
                    img[yy, xx] = (1.0, 0.85, 0.0)


def sheet(name, photo_path, marks=()):
    tmp = os.path.join(ROOT, "renders", "_cmp_tmp.png")
    r.filepath = tmp
    bpy.ops.render.render(write_still=True)
    rend = load_rgb(tmp)
    os.remove(tmp)
    photo = resize(load_rgb(photo_path), OUT_W, OUT_H)
    rend = resize(rend, OUT_W, OUT_H)
    if marks:
        mark(photo, marks)
        mark(rend, marks)
    gap = np.full((OUT_H, 12, 3), 0.15, dtype=np.float32)
    out = np.concatenate([photo, gap, rend], 1)
    H, W = out.shape[:2]
    im = bpy.data.images.new("sheet_" + name, W, H, alpha=False)
    rgba = np.ones((H, W, 4), dtype=np.float32)
    rgba[..., :3] = out
    im.pixels.foreach_set(rgba.ravel())
    im.filepath_raw = os.path.join(ROOT, "renders", "compare_%s.png" % name)
    im.file_format = "PNG"
    im.save()
    print("SHEET", im.filepath_raw)


def want(n):
    return not args.only or args.only in n


# 1) Phenix (2013, 24 mm): Earth (+Z) face frontal; +X right, +Y up; wings not mounted -----
if want("phenix"):
    F = pg.f_px(pg.PH_FOCAL)
    s = pg.PH_FACE_PX_PER_M
    dist = F / s
    cx = -HX + (pg.IMG_W / 2 - pg.PH_FACE_MINUS_X_END_U) / s
    cy = (pg.PH_FACE_CENTRE_V - pg.IMG_H / 2) / s
    set_cam((cx, cy, HZ + dist), (1, 0, 0), (0, -1, 0), (0, 0, -1), pg.PH_FOCAL)
    show_wings(False)
    aim_sun((-0.2, 0.3, 1.0))
    sheet("phenix_earth_face", os.path.join(ROOT, "refs", "esa_phenix.jpg"))
    show_wings(True)

# 2) Side view of the deployed wing (2017, 27 mm): -Y wing frontal, cell side ---------------
if want("side"):
    F = pg.f_px(pg.SV_FOCAL)
    s = pg.SV_SCALE_PX_PER_M
    dist = F / s
    y = -(WING_IN + (pg.IMG_W / 2 - pg.SV_PANEL1_INNER_U) / s)
    z = (pg.SV_PANEL_CENTRE_V - pg.IMG_H / 2) / s
    set_wing_angle(0.0)
    set_cam((SADM_X - dist, y, z), (0, -1, 0), (0, 0, -1), (1, 0, 0), pg.SV_FOCAL)
    aim_sun((-1.0, -0.2, 0.4))
    sheet("wing_side_view", os.path.join(ROOT, "refs", "esa_side_view_wing.jpg"))

# 3) Wing deployment (2013, 24 mm): camera pose from the wing PnP, array angle fitted ------
if want("deploy"):
    F = pg.f_px(pg.WD_FOCAL)
    names = list(pg.WD_PTS)            # all 6 wing corners (inner edge, hinge, tip)
    R, t, err = pg.solve_plane_pose([pg.WD_PTS[n][0] for n in names], [pg.WD_PTS[n][1] for n in names], F)
    A = np.array([SADM_X, 0.0, 0.0])

    def roty(th):
        c, s_ = math.cos(th), math.sin(th)
        return np.array([[c, 0, s_], [0, 1, 0], [-s_, 0, c]])

    def cam_model(th, top_sign):
        Ry = roty(th)
        O = A + Ry @ np.array([0.0, -WING_IN, top_sign * PANEL_W / 2])
        e_s = np.array([0.0, -1.0, 0.0])
        e_t = Ry @ np.array([0.0, 0.0, -top_sign])
        e_n = np.cross(e_s, e_t)
        B = np.stack([e_s, e_t, e_n], 1)
        C = O + B @ (-R.T @ t)
        axes = B @ R.T                     # columns: camera x(right), y(down), z(forward) in model
        return C, axes

    bus_pts = np.array([[-HX, -HY, HZ], [-HX, -HY, -HZ], [SADM_X, -(HY + 0.17), 0.0]])
    bus_px = np.array([pg.WD_BUS_LEFT_TOP_PX, pg.WD_BUS_LEFT_BOT_PX, pg.WD_ROOT_HINGE_PX], float)
    best = None
    for top_sign in (1.0, -1.0):
        for th_deg in np.arange(-180, 180, 0.5):
            C, axes = cam_model(math.radians(th_deg), top_sign)
            Pc = (bus_pts - C) @ axes
            if (Pc[:, 2] <= 0).any():
                continue
            e = np.sqrt(((pg.project_cam(Pc, F) - bus_px) ** 2).sum(1)).mean()
            # the camera must see the cell side (-X of the wing in its own frame)
            n_cell = roty(math.radians(th_deg)) @ np.array([-1.0, 0, 0])
            if n_cell @ (C - A) <= 0:
                continue
            if best is None or e < best[0]:
                best = (e, th_deg, top_sign, C, axes)
    e, th_deg, top_sign, C, axes = best
    print("DEPLOY fit: array angle %.1f deg, top edge %s, mean bus reprojection error %.1f px, camera at %s"
          % (th_deg, "+Z" if top_sign > 0 else "-Z", e, np.round(C, 2)))
    set_wing_angle(math.radians(th_deg))
    set_cam(C, axes[:, 0], axes[:, 1], axes[:, 2], pg.WD_FOCAL)
    aim_sun(tuple(-axes[:, 2] + np.array([0, 0, 0.6])))
    sheet("wing_deploy_2013", os.path.join(ROOT, "refs", "esa_wing_deploy.jpg"),
          marks=[uv for _, uv in pg.WD_PTS.values()] + [pg.WD_BUS_LEFT_TOP_PX, pg.WD_BUS_LEFT_BOT_PX,
                                                       pg.WD_ROOT_HINGE_PX])
    set_wing_angle(0.0)
