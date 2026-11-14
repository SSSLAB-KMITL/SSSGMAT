"""Shared render setup (Cycles CPU / Eevee, dark space background, sun key light, dim environment for reflections)."""
import math
import os

import bpy
from mathutils import Matrix, Vector


def setup(scene, samples=32, res=(1200, 750)):
    r = scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = res[0], res[1], 100
    r.image_settings.file_format = "JPEG"
    r.image_settings.quality = 92
    # Use CYCLES CPU by default so headless/sandboxed runs never fail on macOS Metal shader cache
    pref_eng = os.environ.get("BLENDER_RENDER_ENGINE", "CYCLES")
    for eng in (pref_eng, "CYCLES", "BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            r.engine = eng
            break
        except TypeError:
            continue
    if r.engine == "CYCLES":
        scene.cycles.device = "CPU"
        scene.cycles.samples = samples
        if hasattr(scene.cycles, "use_denoising"):
            scene.cycles.use_denoising = False
    else:
        ee = scene.eevee
        ee.taa_render_samples = samples
        for attr in ("use_raytracing", "use_shadows"):
            if hasattr(ee, attr):
                try:
                    setattr(ee, attr, True)
                except Exception:
                    pass
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("render_world")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    wn, wl = world.node_tree.nodes, world.node_tree.links
    for nd in list(wn):
        wn.remove(nd)
    out = wn.new("ShaderNodeOutputWorld")
    lp = wn.new("ShaderNodeLightPath")
    bg_cam = wn.new("ShaderNodeBackground")
    bg_cam.inputs["Color"].default_value = (0.004, 0.0045, 0.006, 1)
    tc = wn.new("ShaderNodeTexCoord")
    sep = wn.new("ShaderNodeSeparateXYZ")
    ramp = wn.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.025, 0.028, 0.036, 1)
    ramp.color_ramp.elements[1].color = (0.10, 0.11, 0.14, 1)
    mapr = wn.new("ShaderNodeMapRange")
    mapr.inputs["From Min"].default_value = -1.0
    bg_env = wn.new("ShaderNodeBackground")
    mix = wn.new("ShaderNodeMixShader")
    wl.new(tc.outputs["Generated"], sep.inputs["Vector"])
    wl.new(sep.outputs["Z"], mapr.inputs["Value"])
    wl.new(mapr.outputs["Result"], ramp.inputs["Fac"])
    wl.new(ramp.outputs["Color"], bg_env.inputs["Color"])
    wl.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    wl.new(bg_env.outputs["Background"], mix.inputs[1])
    wl.new(bg_cam.outputs["Background"], mix.inputs[2])
    wl.new(mix.outputs["Shader"], out.inputs["Surface"])
    sun_d = bpy.data.lights.new("sun", "SUN")
    sun_d.energy = 6.0
    sun_d.angle = math.radians(0.6)
    sun = bpy.data.objects.new("sun", sun_d)
    scene.collection.objects.link(sun)
    cam_d = bpy.data.cameras.new("cam")
    cam_d.clip_start = 0.05
    cam_d.clip_end = 500
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam, sun


def orient(obj, forward, up):
    f = Vector(forward).normalized()
    rgt = f.cross(Vector(up)).normalized()
    u = rgt.cross(f)
    obj.matrix_world = Matrix.Translation(obj.location) @ Matrix((rgt, u, -f)).transposed().to_4x4()


def aim_sun(scene, sun_from):
    sun = scene.objects["sun"]
    s = Vector(sun_from).normalized()
    sun.location = (0, 0, 0)
    orient(sun, -s, (0, 0, 1) if abs(s.z) < 0.95 else (0, 1, 0))


def view(scene, filepath, target, direction, dist, lens, sun_from, up=(0, 0, 1), shift=(0, 0)):
    cam = scene.camera
    target = Vector(target)
    d = Vector(direction).normalized()
    cam.location = target + d * dist
    orient(cam, -d, up)
    cam.data.lens = lens
    cam.data.sensor_width = 36.0
    cam.data.shift_x, cam.data.shift_y = shift
    aim_sun(scene, sun_from)
    ext = os.path.splitext(filepath)[1].lower()
    if ext in (".jpg", ".jpeg"):
        scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.quality = 92
    elif ext == ".png":
        scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = filepath
    bpy.ops.render.render(write_still=True)
    print("RENDERED", filepath)

