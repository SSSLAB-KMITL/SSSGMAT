"""Shared procedural textures, PBR materials, and bmesh geometry primitives for GNSS satellite models."""
import argparse
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector


def parse_build_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--views", default="all")
    ap.add_argument("--samples", type=int, default=32)
    ap.add_argument("--tag", default="")
    args = ap.parse_args(argv)
    root = os.path.abspath(args.root)
    texdir = os.path.join(root, "textures")
    os.makedirs(texdir, exist_ok=True)
    os.makedirs(os.path.join(root, "renders"), exist_ok=True)
    return args, root, texdir


def init_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    return scene


def s2l(c):
    c = np.asarray(c, dtype=float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def make_image(texdir, name, arr, non_color=False):
    """arr: H x W x 3, row 0 = bottom (v = 0). Saved as PNG in textures/ and loaded from disk."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr, 0.0, 1.0)
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(texdir, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    img = bpy.data.images.load(path)
    img.name = name
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def periodic_noise(n, cells, rng, m=None):
    m = n if m is None else m
    g = rng.random((cells, cells))

    def axis(k):
        x = np.arange(k) / k * cells
        i0 = np.floor(x).astype(int)
        f = x - i0
        return i0, (i0 + 1) % cells, f * f * (3 - 2 * f)

    yi0, yi1, fy = axis(n)
    xi0, xi1, fx = axis(m)
    a = g[np.ix_(yi0, xi0)]
    b = g[np.ix_(yi0, xi1)]
    c = g[np.ix_(yi1, xi0)]
    d = g[np.ix_(yi1, xi1)]
    fy = fy[:, None]
    fx = fx[None, :]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def blur(a, r, wrap=False):
    for _ in range(3):
        for ax in (0, 1):
            if wrap:
                acc = sum(np.roll(a, k, axis=ax) for k in range(-r, r + 1))
            else:
                pad = [(0, 0)] * a.ndim
                pad[ax] = (r, r)
                ap_ = np.pad(a, pad, mode="edge")
                acc = sum(np.take(ap_, np.arange(k, k + a.shape[ax]), axis=ax) for k in range(2 * r + 1))
            a = acc / (2 * r + 1)
    return a


def facet_field(n, nseeds, rng, periodic, stretch=1.0, tilt=1.0):
    """Crumpled sheet: piecewise-planar height field (Voronoi facets with random tilts)."""
    pts = rng.random((nseeds, 2))
    gx = rng.normal(0, tilt, nseeds)
    gy = rng.normal(0, tilt, nseeds)
    off = rng.normal(0, 0.3, nseeds)
    offs = [(ox, oy) for ox in (-1, 0, 1) for oy in (-1, 0, 1)] if periodic else [(0, 0)]
    S = np.concatenate([pts + np.array(o) for o in offs])
    owner = np.tile(np.arange(nseeds), len(offs))
    yy, xx = np.mgrid[0:n, 0:n] / n
    P = np.stack([xx.ravel(), yy.ravel()], 1)
    sc = np.array([1.0, stretch])
    h = np.zeros(len(P))
    crease = np.zeros(len(P))
    nx = np.zeros(len(P))
    ny = np.zeros(len(P))
    for s in range(0, len(P), 8192):
        ch = P[s:s + 8192]
        D = (((ch[:, None, :] - S[None, :, :]) * sc) ** 2).sum(-1)
        part = np.argpartition(D, 1, axis=1)[:, :2]
        d0 = np.take_along_axis(D, part, 1)
        order = np.argsort(d0, axis=1)
        part = np.take_along_axis(part, order, 1)
        d0 = np.take_along_axis(d0, order, 1)
        k = owner[part[:, 0]]
        rel = ch - S[part[:, 0]]
        h[s:s + 8192] = off[k] + rel[:, 0] * gx[k] + rel[:, 1] * gy[k]
        nx[s:s + 8192] = gx[k]
        ny[s:s + 8192] = gy[k]
        crease[s:s + 8192] = np.sqrt(d0[:, 1]) - np.sqrt(d0[:, 0])
    return (h.reshape(n, n), nx.reshape(n, n), ny.reshape(n, n), crease.reshape(n, n))


def normal_from_slopes(sx, sy, strength):
    n = np.stack([-sx * strength, -sy * strength, np.ones_like(sx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def slopes(hf, scale_px, wrap):
    if wrap:
        sx = (np.roll(hf, -1, 1) - np.roll(hf, 1, 1)) / 2 * scale_px
        sy = (np.roll(hf, -1, 0) - np.roll(hf, 1, 0)) / 2 * scale_px
    else:
        sy, sx = np.gradient(hf)
        sx = sx * scale_px
        sy = sy * scale_px
    return sx, sy


def downsample(a, k):
    h, w = a.shape[0] // k, a.shape[1] // k
    return a[:h * k, :w * k].reshape(h, k, w, k, -1).mean((1, 3))


# --------------------------------------------------------------------------------------
# Procedural Texture Generators
# --------------------------------------------------------------------------------------
MLI_TILE = 0.60


def tex_mli(texdir, name="tex_mli_black", base_rgb=(0.085, 0.085, 0.090), tape_rgb=(0.055, 0.055, 0.060),
            stud_rgb=(0.40, 0.30, 0.15), seed=20261113):
    rng = np.random.default_rng(seed)
    n = 512
    m_per_px = MLI_TILE / n
    hA, _, _, _ = facet_field(n, 10, rng, True, tilt=0.6)
    hB, _, _, _ = facet_field(n, 36, rng, True, tilt=0.4)
    wr = blur(hA, 14, wrap=True) * 1.0 + blur(hB, 6, wrap=True) * 0.35
    yy, xx = np.mgrid[0:n, 0:n] * m_per_px
    height = wr * 0.004
    mod = 1.0 + 0.12 * (periodic_noise(n, 3, rng) - 0.5) - 0.08 * np.clip(np.abs(wr), 0, 1)
    col = np.stack([base_rgb[0] * mod, base_rgb[1] * mod, base_rgb[2] * mod], -1)
    dx = np.minimum(xx, MLI_TILE - xx)
    dy = np.minimum(yy, MLI_TILE - yy)
    tape = (dx < 0.0125) | (dy < 0.0125)
    col[tape] = tape_rgb
    height[tape] += 0.0015
    seam = (np.abs(xx - 0.0125) < 0.0012) | (np.abs(yy - 0.0125) < 0.0012)
    col[seam] = np.array(tape_rgb) * 0.6
    height[seam] -= 0.001
    seam2 = np.abs(yy - 0.30) < 0.0012
    col[seam2] = np.array(tape_rgb) * 0.65
    height[seam2] -= 0.0008
    btn = []
    for t in np.arange(0.075, MLI_TILE, 0.15):
        btn += [(t, 0.006), (0.006, t)]
    btn.append((0.30, 0.30))
    for bx, by in btn:
        d = np.hypot(xx - bx, yy - by)
        d = np.minimum(d, np.hypot(xx - bx - MLI_TILE * np.sign(bx - 0.3), yy - by))
        m = d < 0.005
        col[m] = stud_rgb
        height[m] += 0.0015 * (1 - (d[m] / 0.005) ** 2)
    sx, sy = slopes(height, 1.0 / m_per_px, True)
    nrm = normal_from_slopes(sx, sy, 1.0)
    return make_image(texdir, name, col), make_image(texdir, name + "_nrm", nrm, True)


def tex_foil(texdir, name="tex_foil_silver", base_rgb=(0.82, 0.82, 0.83), seed=20261114):
    rng = np.random.default_rng(seed)
    n = 512
    _, gx1, gy1, cr1 = facet_field(n, 480, rng, False, stretch=0.45, tilt=0.30)
    _, gx2, gy2, _ = facet_field(n, 45, rng, False, stretch=0.6, tilt=0.35)
    sx = blur(gx1, 1) + blur(gx2, 6)
    sy = blur(gy1, 1) + blur(gy2, 6)
    nrm = normal_from_slopes(sx, sy, 0.85)
    mod = 1.0 + 0.04 * (periodic_noise(n, 7, rng) - 0.5) - 0.07 * np.clip(1.0 - cr1 * n / 1.5, 0, 1)
    col = np.stack([base_rgb[0] * mod, base_rgb[1] * mod, base_rgb[2] * mod], -1)
    return make_image(texdir, name, col), make_image(texdir, name + "_nrm", nrm, True)


def tex_osr(texdir, name="tex_osr_tiles", tiles=4, base_rgb=(0.80, 0.82, 0.86), seed=20261115):
    rng = np.random.default_rng(seed)
    n = 256
    t = n // tiles
    yy, xx = np.mgrid[0:n, 0:n]
    tid = (yy // t) * tiles + (xx // t)
    var = rng.uniform(-0.03, 0.03, tiles * tiles)[tid]
    base = np.stack([base_rgb[0] + var, base_rgb[1] + var, base_rgb[2] + var], -1)
    line = ((xx % t) < 2) | ((yy % t) < 2)
    base[line] = np.array(base_rgb) * 0.68
    return make_image(texdir, name, base)


def tex_solar_front(texdir, name="tex_solar_front", panel_l=2.5, panel_w=1.2,
                    cols=32, rows=14, cell_rgb=(0.048, 0.052, 0.115), sub_rgb=(0.15, 0.125, 0.075),
                    strip_rows=(), seed=20261116):
    rng = np.random.default_rng(seed)
    W, H = 1024, 512
    s = (np.arange(W) + 0.5) / W * panel_l
    t = (np.arange(H) + 0.5) / H * panel_w
    S, T = np.meshgrid(s, t)
    img = np.empty((H, W, 3))
    img[:] = sub_rgb

    margin_s = 0.035 * panel_l
    margin_t = 0.030 * panel_w
    mid_gap = 0.028 * panel_l
    half_cols = cols // 2
    col_span = (panel_l - 2 * margin_s - mid_gap) / 2
    col_pitch = col_span / half_cols
    cell_u = col_pitch * 0.93
    row_pitch = (panel_w - 2 * margin_t) / rows
    cell_v = row_pitch * 0.93
    cut = min(cell_u, cell_v) * 0.18

    s_starts = [margin_s + i * col_pitch for i in range(half_cols)] + \
               [margin_s + col_span + mid_gap + i * col_pitch for i in range(half_cols)]
    t_starts = [margin_t + j * row_pitch for j in range(rows)]

    for r_idx, t0 in enumerate(t_starts):
        if r_idx in strip_rows:
            img[(T >= t0) & (T < t0 + row_pitch)] = (0.23, 0.19, 0.10)
            continue
        mv = (T >= t0) & (T < t0 + cell_v)
        if not mv.any():
            continue
        for s0 in s_starts:
            m = mv & (S >= s0) & (S < s0 + cell_u)
            if not m.any():
                continue
            a = S[m] - s0
            b = T[m] - t0
            ok = ((a + b) > cut) & ((cell_u - a + b) > cut) & ((a + cell_v - b) > cut) & \
                 ((cell_u - a + cell_v - b) > cut)
            sh = rng.uniform(-0.008, 0.008)
            c = np.array([cell_rgb[0] + sh, cell_rgb[1] + sh, cell_rgb[2] + sh * 1.5])
            vals = np.where(ok[:, None], c + np.c_[b, b, b] / cell_v * 0.012, img[m])
            img[m] = vals
            okf = np.zeros_like(m)
            okf[m] = ok
            dash = okf & ((S - s0) < cell_u * 0.06) & (((T - t0) % (cell_v / 3)) < (cell_v / 6))
            img[dash] = (0.38, 0.38, 0.41)

    # Central harness & edge frame
    s_mid = panel_l / 2
    img[np.abs(S - s_mid) < mid_gap * 0.45] = (0.16, 0.13, 0.07)
    for off in (-mid_gap * 0.2, mid_gap * 0.2):
        img[np.abs(S - (s_mid + off)) < 0.0025 * panel_l] = (0.80, 0.62, 0.20)
    for tt in np.linspace(margin_t, panel_w - margin_t, 10):
        img[(np.abs(S - s_mid) < mid_gap * 0.35) & (np.abs(T - tt) < 0.008 * panel_w)] = (0.92, 0.80, 0.30)

    border_s = 0.006 * panel_l
    border_t = 0.006 * panel_w
    img[(S < border_s) | (S > panel_l - border_s) | (T < border_t) | (T > panel_w - border_t)] = (0.04, 0.04, 0.045)
    for se in (0.014 * panel_l, panel_l - 0.014 * panel_l):
        img[(np.abs(S - se) < 0.002 * panel_l) & (T > border_t * 2) & (T < panel_w - border_t * 2)] = (0.80, 0.62, 0.20)
    return make_image(texdir, name, img[::-1])


def tex_solar_back(texdir, name="tex_solar_back", panel_l=2.5, panel_w=1.2,
                   base_rgb=(0.19, 0.19, 0.21), seed=20261117):
    rng = np.random.default_rng(seed)
    W, H = 512, 256
    s = (np.arange(W) + 0.5) / W * panel_l
    t = (np.arange(H) + 0.5) / H * panel_w
    S, T = np.meshgrid(s, t)
    lum = 1.0 + 0.12 * (periodic_noise(H, 24, rng, W) - 0.5) + 0.06 * (rng.random((H, W)) - 0.5)
    img = np.stack([base_rgb[0] * lum, base_rgb[1] * lum, base_rgb[2] * lum], -1)
    # Structural grid / stiffener ribs + harness runs
    for sr in np.linspace(0.2 * panel_l, 0.8 * panel_l, 4):
        img[np.abs(S - sr) < 0.004 * panel_l] = np.array(base_rgb) * 0.65
    for i in range(4):
        t0 = (0.18 + i * 0.21) * panel_w
        img[np.abs(T - t0) < 0.004 * panel_w] = (0.04, 0.04, 0.045)
        for sd in np.linspace(0.08 * panel_l, 0.92 * panel_l, 12):
            img[np.hypot(S - sd, T - t0) < 0.007 * panel_w] = (0.72, 0.16, 0.09)
    border_s = 0.006 * panel_l
    border_t = 0.006 * panel_w
    img[(S < border_s) | (S > panel_l - border_s) | (T < border_t) | (T > panel_w - border_t)] = (0.04, 0.04, 0.045)
    return make_image(texdir, name, img[::-1])


def tex_phased_array(texdir, name="tex_phased_array", nx=8, ny=8,
                     bg_rgb=(0.86, 0.86, 0.84), patch_rgb=(0.76, 0.58, 0.22)):
    n = 256
    yy, xx = np.mgrid[0:n, 0:n] / n
    arr = np.empty((n, n, 3))
    arr[:] = bg_rgb
    fx = (xx * nx) % 1.0
    fy = (yy * ny) % 1.0
    in_grid = (xx > 0.06) & (xx < 0.94) & (yy > 0.06) & (yy < 0.94)
    patch = in_grid & (fx > 0.18) & (fx < 0.82) & (fy > 0.18) & (fy < 0.82)
    arr[patch] = patch_rgb
    ring = in_grid & ((np.abs(fx - 0.5) < 0.06) | (np.abs(fy - 0.5) < 0.06)) & patch
    arr[ring] = np.array(patch_rgb) * 1.15
    border = (xx < 0.03) | (xx > 0.97) | (yy < 0.03) | (yy > 0.97)
    arr[border] = (0.35, 0.35, 0.37)
    return make_image(texdir, name, arr)


# --------------------------------------------------------------------------------------
# PBR Materials
# --------------------------------------------------------------------------------------
class MaterialStore:
    def __init__(self):
        self.mats = {}

    def make(self, name, color=(0.5, 0.5, 0.5), metallic=0.0, roughness=0.5,
             image=None, normal=None, normal_strength=1.0):
        if name in self.mats:
            return self.mats[name]
        m = bpy.data.materials.new(name)
        try:
            m.use_nodes = True
        except Exception:
            pass
        nt = m.node_tree
        b = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
        lin = s2l(color)
        b.inputs["Base Color"].default_value = (float(lin[0]), float(lin[1]), float(lin[2]), 1.0)
        b.inputs["Metallic"].default_value = metallic
        b.inputs["Roughness"].default_value = roughness
        if image is not None:
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = image
            t.extension = "REPEAT"
            nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
        if normal is not None:
            tn = nt.nodes.new("ShaderNodeTexImage")
            tn.image = normal
            tn.extension = "REPEAT"
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = normal_strength
            nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
        m.diffuse_color = (float(lin[0]), float(lin[1]), float(lin[2]), 1.0)
        self.mats[name] = m
        return m

    def add_standard_palette(self, texdir, solar_front_img=None, solar_back_img=None,
                             include_gold_mli=False, include_white_mli=False):
        mli_b, mli_b_nrm = tex_mli(texdir, "tex_mli_black", (0.085, 0.085, 0.092), (0.05, 0.05, 0.055), seed=20261113)
        self.make("mli_black", (0.09, 0.09, 0.10), 0.0, 0.34, mli_b, mli_b_nrm, 1.0)
        if include_gold_mli:
            mli_g, mli_g_nrm = tex_mli(texdir, "tex_mli_gold", (0.82, 0.56, 0.16), (0.68, 0.42, 0.10),
                                       stud_rgb=(0.90, 0.72, 0.28), seed=20261121)
            self.make("mli_gold", (0.82, 0.56, 0.16), 0.88, 0.28, mli_g, mli_g_nrm, 0.9)
        if include_white_mli:
            mli_w, mli_w_nrm = tex_mli(texdir, "tex_mli_white", (0.86, 0.86, 0.84), (0.76, 0.76, 0.74),
                                       stud_rgb=(0.65, 0.65, 0.65), seed=20261122)
            self.make("mli_white", (0.86, 0.86, 0.84), 0.0, 0.46, mli_w, mli_w_nrm, 0.75)
        foil_s, foil_s_nrm = tex_foil(texdir, "tex_foil_silver", (0.80, 0.80, 0.82), seed=20261114)
        self.make("ge_kapton_foil", (0.80, 0.80, 0.82), 0.72, 0.30, foil_s, foil_s_nrm, 0.55)
        osr_img = tex_osr(texdir, "tex_osr_tiles", tiles=4, seed=20261115)
        self.make("osr_radiator", (0.86, 0.87, 0.90), 0.75, 0.16, osr_img)
        if solar_front_img is None:
            solar_front_img = tex_solar_front(texdir)
        if solar_back_img is None:
            solar_back_img = tex_solar_back(texdir)
        self.make("solar_cells", (0.06, 0.06, 0.12), 0.0, 0.14, solar_front_img)
        self.make("panel_back_cfrp", (0.20, 0.19, 0.22), 0.15, 0.55, solar_back_img)
        self.make("panel_edge", (0.05, 0.05, 0.055), 0.2, 0.5)
        self.make("yoke_orange", (0.88, 0.56, 0.15), 0.20, 0.42)
        self.make("gold_kapton", (0.85, 0.63, 0.25), 1.0, 0.30)
        self.make("gold_flex", (0.88, 0.70, 0.30), 0.9, 0.35)
        self.make("aluminium", (0.78, 0.79, 0.81), 1.0, 0.34)
        self.make("titanium_grey", (0.52, 0.53, 0.56), 1.0, 0.40)
        self.make("bronze_anodised", (0.62, 0.48, 0.28), 0.8, 0.40)
        self.make("white_paint", (0.90, 0.90, 0.88), 0.0, 0.48)
        self.make("black_paint", (0.05, 0.05, 0.055), 0.0, 0.58)
        self.make("radome_white", (0.92, 0.91, 0.88), 0.0, 0.38)
        self.make("radome_maroon", (0.42, 0.14, 0.12), 0.05, 0.42)
        self.make("lrr_cube_glass", (0.42, 0.46, 0.52), 0.9, 0.08)
        self.make("lrr_holder", (0.84, 0.85, 0.87), 0.65, 0.30)
        self.make("hdrm_orange", (0.78, 0.38, 0.16), 0.5, 0.45)
        self.make("mesh_gold", (0.78, 0.62, 0.28), 0.85, 0.38)


# --------------------------------------------------------------------------------------
# Geometry Primitives
# --------------------------------------------------------------------------------------
class Part:
    def __init__(self, name, mat_store):
        self.name = name
        self.store = mat_store
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.verify()
        self.mats = []

    def mi(self, mname):
        names = [m.name for m in self.mats]
        if mname not in names:
            self.mats.append(self.store.mats[mname])
            names.append(mname)
        return names.index(mname)

    def verts(self, coords):
        return [self.bm.verts.new(Vector(c)) for c in coords]

    def face(self, vs, mname, uvs=None, expect=None, smooth=False):
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(mname)
        f.smooth = smooth
        if expect is not None:
            f.normal_update()
            if f.normal.dot(Vector(expect)) < 0:
                f.normal_flip()
        if uvs is not None:
            for loop in f.loops:
                loop[self.uv].uv = uvs[loop.vert]
        return f


def frame_from_axis(axis, uhint=None):
    w = Vector(axis).normalized()
    if uhint is None:
        uhint = Vector((1, 0, 0)) if abs(w.x) < 0.9 else Vector((0, 1, 0))
    uhint = Vector(uhint)
    u = (uhint - w * w.dot(uhint)).normalized()
    return u, w.cross(u), w


FACE_DEF = {
    "-x": [(0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)],
    "+x": [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
    "-y": [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
    "+y": [(0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)],
    "-z": [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)],
    "+z": [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
}
FACE_N = {
    "-x": (-1, 0, 0), "+x": (1, 0, 0),
    "-y": (0, -1, 0), "+y": (0, 1, 0),
    "-z": (0, 0, -1), "+z": (0, 0, 1),
}


def box(part, c, s, mats, uv="fit", tile=1.0, skip=(), uvmap=None):
    lo = [c[i] - s[i] / 2 for i in range(3)]
    hi = [c[i] + s[i] / 2 for i in range(3)]
    for key, idx in FACE_DEF.items():
        if key in skip:
            continue
        coords = [
            (lo[0] if i == 0 else hi[0], lo[1] if j == 0 else hi[1], lo[2] if k == 0 else hi[2])
            for i, j, k in idx
        ]
        vs = part.verts(coords)
        ax = "xyz".index(key[1])
        t1, t2 = [a for a in range(3) if a != ax]
        uvs = {}
        for v in vs:
            if uv == "fit":
                uu = (v.co[t1] - lo[t1]) / max(s[t1], 1e-6)
                vv = (v.co[t2] - lo[t2]) / max(s[t2], 1e-6)
                if uvmap and key in uvmap:
                    uu, vv = uvmap[key](uu, vv)
                uvs[v] = (uu, vv)
            else:
                uvs[v] = (v.co[t1] / tile, v.co[t2] / tile)
        mname = mats if isinstance(mats, str) else mats.get(key, mats.get("default"))
        part.face(vs, mname, uvs, FACE_N[key])


def bevel_box(part, center, size, bevel_offset=0.022, segments=3, mat="mli_black", tile=MLI_TILE):
    bm_tmp = bmesh.new()
    bmesh.ops.create_cube(bm_tmp, size=1.0)
    c = Vector(center)
    for vt in bm_tmp.verts:
        vt.co = Vector((vt.co.x * size[0], vt.co.y * size[1], vt.co.z * size[2])) + c
    if bevel_offset > 0 and segments > 0:
        bmesh.ops.bevel(bm_tmp, geom=list(bm_tmp.verts) + list(bm_tmp.edges),
                        offset=bevel_offset, segments=segments, profile=0.5, affect="EDGES")
    vmap = {}
    for vt in bm_tmp.verts:
        vmap[vt] = part.bm.verts.new(vt.co)
    mi = part.mi(mat) if isinstance(mat, str) else None
    for f in bm_tmp.faces:
        f.normal_update()
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        sgn = "+" if n[ax] >= 0 else "-"
        fkey = sgn + "xyz"[ax]
        mname = mat if isinstance(mat, str) else mat.get(fkey, mat.get("default"))
        t1, t2 = [a for a in range(3) if a != ax]
        nf = part.bm.faces.new([vmap[v] for v in f.verts])
        nf.material_index = mi if mi is not None else part.mi(mname)
        nf.smooth = True
        for loop in nf.loops:
            loop[part.uv].uv = ((loop.vert.co[t1] + 0.07) / tile, (loop.vert.co[t2] + 0.11) / tile)
    bm_tmp.free()


def cylinder(part, base, axis, r0, length, segs, side, top=None, bottom=None, r1=None,
             smooth=True, side_tile=None, uhint=None):
    r1 = r0 if r1 is None else r1
    u, v, w = frame_from_axis(axis, uhint)
    base = Vector(base)
    angs = [2 * math.pi * i / segs for i in range(segs)]
    dirs = [u * math.cos(a) + v * math.sin(a) for a in angs]
    V0 = part.verts([base + d * r0 for d in dirs])
    V1 = part.verts([base + w * length + d * r1 for d in dirs])
    circ = 2 * math.pi * max(r0, r1)
    for i in range(segs):
        j = (i + 1) % segs
        vs = [V0[i], V0[j], V1[j], V1[i]]
        if side_tile:
            u0, u1, vv = i / segs * circ / side_tile, (i + 1) / segs * circ / side_tile, length / side_tile
        else:
            u0, u1, vv = i / segs, (i + 1) / segs, 1.0
        uvs = {V0[i]: (u0, 0), V0[j]: (u1, 0), V1[j]: (u1, vv), V1[i]: (u0, vv)}
        mid = 2 * math.pi * (i + 0.5) / segs
        part.face(vs, side, uvs, u * math.cos(mid) + v * math.sin(mid), smooth)
    for cap, rr, nrm, mat in ((top, r1, w, top), (bottom, r0, -w, bottom)):
        if not cap or rr <= 1e-6:
            continue
        ctr = base + (w * length if nrm is w else Vector())
        Vt = part.verts([ctr + d * rr for d in dirs])
        uvs = {Vt[i]: (0.5 + 0.5 * math.cos(angs[i]), 0.5 + 0.5 * math.sin(angs[i])) for i in range(segs)}
        part.face(Vt, mat, uvs, nrm)


def lathe(part, base, axis, profile, segs, mname, uv_r):
    u, v, w = frame_from_axis(axis)
    base = Vector(base)
    angs = [2 * math.pi * i / segs for i in range(segs)]
    rings = []
    for r, h in profile:
        if r <= 1e-6:
            rings.append(part.verts([base + w * h]))
        else:
            rings.append(part.verts([base + w * h + (u * math.cos(a) + v * math.sin(a)) * r for a in angs]))

    def uvof(vt):
        p = vt.co - base
        return (0.5 + 0.5 * p.dot(u) / uv_r, 0.5 + 0.5 * p.dot(v) / uv_r)

    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        for i in range(segs):
            j = (i + 1) % segs
            if len(B) == 1:
                vs = [A[i], A[j], B[0]]
            elif len(A) == 1:
                vs = [A[0], B[j], B[i]]
            else:
                vs = [A[i], A[j], B[j], B[i]]
            cen = sum((x.co for x in vs), Vector()) / len(vs)
            rad = cen - base - w * (cen - base).dot(w)
            exp = rad.normalized() * 0.3 + w if profile[k + 1][1] >= profile[k][1] - 1e-9 else rad
            part.face(vs, mname, {x: uvof(x) for x in vs}, exp, True)


def prism(part, base, axis, pts2d, height, side, top, bottom=None, uhint=None):
    u, v, w = frame_from_axis(axis, uhint)
    base = Vector(base)
    r0 = [base + u * x + v * y for x, y in pts2d]
    r1 = [p + w * height for p in r0]
    n = len(pts2d)
    xs = [p[0] for p in pts2d]
    ys = [p[1] for p in pts2d]
    sx, sy = max(max(xs) - min(xs), 1e-6), max(max(ys) - min(ys), 1e-6)
    for i in range(n):
        j = (i + 1) % n
        vs = part.verts([r0[i], r0[j], r1[j], r1[i]])
        mid = (r0[i] + r0[j]) / 2 - base
        out = (mid - w * mid.dot(w)).normalized()
        part.face(vs, side, {vs[0]: (0, 0), vs[1]: (1, 0), vs[2]: (1, 1), vs[3]: (0, 1)}, out)
    for ring, nrm, mat in ((r1, w, top), (r0, -w, bottom)):
        if not mat:
            continue
        vt = part.verts(ring)
        uvs = {vt[i]: ((pts2d[i][0] - min(xs)) / sx, (pts2d[i][1] - min(ys)) / sy) for i in range(n)}
        part.face(vt, mat, uvs, nrm)


def helix(part, base, axis, R, height, turns, tube_r, segs_per_turn, sides, mname, phase=0.0):
    u, v, w = frame_from_axis(axis)
    base = Vector(base)
    n = int(turns * segs_per_turn) + 1
    rings, centres = [], []
    for k in range(n):
        t = k / (n - 1)
        a = phase + 2 * math.pi * turns * t
        radial = u * math.cos(a) + v * math.sin(a)
        c = base + radial * R + w * (height * t)
        tang = ((-u * math.sin(a) + v * math.cos(a)) * (2 * math.pi * turns * R) + w * height).normalized()
        b2 = tang.cross(radial).normalized()
        b1 = b2.cross(tang).normalized()
        rings.append(part.verts([
            c + (b1 * math.cos(2 * math.pi * s / sides) + b2 * math.sin(2 * math.pi * s / sides)) * tube_r
            for s in range(sides)
        ]))
        centres.append(c)
    for k in range(n - 1):
        for s in range(sides):
            s2 = (s + 1) % sides
            vs = [rings[k][s], rings[k][s2], rings[k + 1][s2], rings[k + 1][s]]
            cen = sum((x.co for x in vs), Vector()) / 4
            part.face(vs, mname, {x: (0.5, 0.5) for x in vs}, cen - (centres[k] + centres[k + 1]) / 2, True)


def bar(part, a, b, width, thick, mname, wdir):
    a, b = Vector(a), Vector(b)
    ax = (b - a).normalized()
    wv = Vector(wdir)
    wv = (wv - ax * ax.dot(wv)).normalized()
    tv = ax.cross(wv)
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    ring = lambda p: [p + wv * (cx * width / 2) + tv * (cy * thick / 2) for cx, cy in corners]
    A, B = part.verts(ring(a)), part.verts(ring(b))
    for i in range(4):
        j = (i + 1) % 4
        vs = [A[i], A[j], B[j], B[i]]
        cen = sum((x.co for x in vs), Vector()) / 4
        part.face(vs, mname, {x: (0.5, 0.5) for x in vs}, cen - (a + b) / 2)
    for R_, n_ in ((A, -ax), (B, ax)):
        vv = part.verts([x.co for x in R_])
        part.face(vv, mname, {x: (0.5, 0.5) for x in vv}, n_)


def helical_element(part, base, axis=(0, 0, 1), r_cup=0.075, h_cup=0.055, r_rod=0.032, h_rod=0.36,
                    cup_mat="gold_kapton", rod_mat="radome_white", tip_mat="titanium_grey",
                    exposed_helix=False, turns=4.5):
    """L-band helical antenna element (cup reflector + dielectric radome tube or exposed helical wire)."""
    base = Vector(base)
    w = Vector(axis).normalized()
    # Flared cup base
    cylinder(part, base, w, r_cup * 0.78, h_cup, 14, cup_mat, top=cup_mat, r1=r_cup)
    if exposed_helix:
        cylinder(part, base + w * h_cup, w, r_rod * 0.35, h_rod, 8, rod_mat, top=tip_mat)
        helix(part, base + w * h_cup, w, r_rod, h_rod * 0.96, turns, 0.004, 10, 5, "gold_kapton")
    else:
        cylinder(part, base + w * h_cup, w, r_rod, h_rod, 14, rod_mat, top=tip_mat, r1=r_rod * 0.72)
        # Helical winding bands on the outside of the radome
        for k in range(3):
            hk = h_cup + h_rod * (0.22 + 0.28 * k)
            rk = r_rod * (1.0 - 0.28 * (0.22 + 0.28 * k)) + 0.002
            cylinder(part, base + w * hk, w, rk, 0.012, 12, cup_mat)


def parabolic_dish(part, apex, axis, radius, depth, rings=6, segs=28,
                   front_mat="mesh_gold", back_mat="titanium_grey", feed_len=0.0):
    """Shallow parabolic dish reflector with rim and optional central/tripod feed."""
    u, v, w = frame_from_axis(axis)
    apex = Vector(apex)
    angs = [2 * math.pi * i / segs for i in range(segs)]
    dirs = [u * math.cos(a) + v * math.sin(a) for a in angs]
    thick = 0.012
    f_rings, b_rings = [], []
    for k in range(rings + 1):
        t = k / rings
        r = radius * t
        z = depth * (t * t)
        if k == 0:
            f_rings.append(part.verts([apex + w * thick]))
            b_rings.append(part.verts([apex]))
        else:
            f_rings.append(part.verts([apex + w * (z + thick) + d * r for d in dirs]))
            b_rings.append(part.verts([apex + w * z + d * r for d in dirs]))
    for k in range(rings):
        Af, Bf = f_rings[k], f_rings[k + 1]
        Ab, Bb = b_rings[k], b_rings[k + 1]
        for i in range(segs):
            j = (i + 1) % segs
            if k == 0:
                vs_f = [Af[0], Bf[i], Bf[j]]
                vs_b = [Ab[0], Bb[j], Bb[i]]
            else:
                vs_f = [Af[i], Bf[i], Bf[j], Af[j]]
                vs_b = [Ab[i], Ab[j], Bb[j], Bb[i]]
            part.face(vs_f, front_mat, {x: (0.5, 0.5) for x in vs_f}, w, True)
            part.face(vs_b, back_mat, {x: (0.5, 0.5) for x in vs_b}, -w, True)
    # Outer rim
    Af, Ab = f_rings[-1], b_rings[-1]
    for i in range(segs):
        j = (i + 1) % segs
        vs = [Ab[i], Ab[j], Af[j], Af[i]]
        mid = 2 * math.pi * (i + 0.5) / segs
        part.face(vs, back_mat, {x: (0.5, 0.5) for x in vs}, u * math.cos(mid) + v * math.sin(mid), True)
    if feed_len > 0:
        fpos = apex + w * feed_len
        cylinder(part, fpos - w * 0.04, w, 0.035, 0.08, 12, "gold_kapton", top="black_paint", bottom="titanium_grey")
        for s in range(3):
            ang = 2 * math.pi * s / 3
            rim_pt = apex + w * (depth * 0.72) + (u * math.cos(ang) + v * math.sin(ang)) * (radius * 0.85)
            bar(part, rim_pt, fpos, 0.014, 0.014, "titanium_grey", w)


def lrr_array(part, center_xyz, size_xyz, nx=6, ny=8, holder_mat="lrr_holder",
              glass_mat="lrr_cube_glass", base_mat="aluminium", staggered=True):
    """Rectangular tray of corner-cube retroreflectors on the +Z face."""
    cx0, cy0, cz0 = center_xyz
    lx, ly, lz = size_xyz
    box(part, (cx0, cy0, cz0 + 0.010), (lx + 0.016, ly + 0.016, 0.020), base_mat)
    pitch_x = lx / (nx + (0.5 if staggered else 0.0))
    pitch_y = ly / ny
    r_ccr = min(pitch_x, pitch_y) * 0.38
    for j in range(ny):
        for i in range(nx):
            cx = cx0 - lx / 2 + (i + 0.5 + (0.25 if (staggered and j % 2) else 0.0)) * pitch_x
            cy = cy0 - ly / 2 + (j + 0.5) * pitch_y
            cylinder(part, (cx, cy, cz0 + 0.020), (0, 0, 1), r_ccr, lz - 0.020, 6,
                     holder_mat, top=glass_mat, smooth=False)


def lrr_ring(part, center_xyz, r_inner, r_outer, height, n_prisms=36,
             holder_mat="lrr_holder", glass_mat="lrr_cube_glass", base_mat="aluminium"):
    """Annular/ring laser retroreflector array (e.g. GLONASS-K1 ring array)."""
    cx0, cy0, cz0 = center_xyz
    r_mid = (r_inner + r_outer) / 2
    # Ring base
    segs = 36
    angs = [2 * math.pi * i / segs for i in range(segs)]
    for k in range(segs):
        k2 = (k + 1) % segs
        a0, a1 = angs[k], angs[k2]
        pts = [
            (r_inner * math.cos(a0), r_inner * math.sin(a0)),
            (r_outer * math.cos(a0), r_outer * math.sin(a0)),
            (r_outer * math.cos(a1), r_outer * math.sin(a1)),
            (r_inner * math.cos(a1), r_inner * math.sin(a1)),
        ]
        prism(part, (cx0, cy0, cz0), (0, 0, 1), pts, height * 0.55, base_mat, holder_mat)
    r_ccr = min((r_outer - r_inner) * 0.36, 2 * math.pi * r_mid / n_prisms * 0.38)
    for i in range(n_prisms):
        a = 2 * math.pi * i / n_prisms
        px = cx0 + r_mid * math.cos(a)
        py = cy0 + r_mid * math.sin(a)
        cylinder(part, (px, py, cz0 + height * 0.55), (0, 0, 1), r_ccr, height * 0.45, 6,
                 holder_mat, top=glass_mat, smooth=False)


def finish(part, parent=None, location=None):
    me = bpy.data.meshes.new(part.name)
    part.bm.normal_update()
    part.bm.to_mesh(me)
    part.bm.free()
    for m in part.mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(part.name, me)
    bpy.context.scene.collection.objects.link(ob)
    if location is not None:
        me.transform(Matrix.Translation(-Vector(location)))
        ob.location = Vector(location)
    if parent is not None:
        ob.parent = parent
    return ob


def build_sadm_and_wings(root_obj, store, hy, sadm_x=0.0, sadm_z=0.0,
                         yoke_len=0.80, n_panels=2, panel_l=2.50, panel_w=1.20,
                         panel_t=0.025, panel_gap=0.06, yoke_style="v_strut",
                         wing_prefix="wing", yoke_mat="titanium_grey", cell_side="-x"):
    """Build SADM housings on +-Y and articulated wing+Y / wing-Y nodes with pivots on the SADM axis.

    Returns wing_tip_y (so total Y span is 2 * wing_tip_y).
    """
    sadm_len = min(0.12, yoke_len * 0.25)
    sadm_r = 0.10
    wing_in = hy + yoke_len
    wing_tip = wing_in + n_panels * panel_l + (n_panels - 1) * panel_gap

    for sgn, tag in ((1, "+Y"), (-1, "-Y")):
        p_sadm = Part("sadm_" + tag, store)
        cylinder(p_sadm, (sadm_x, sgn * hy, sadm_z), (0, sgn, 0), sadm_r + 0.035, 0.015, 24,
                 "mli_black", top="mli_black", side_tile=MLI_TILE)
        cylinder(p_sadm, (sadm_x, sgn * (hy + 0.015), sadm_z), (0, sgn, 0), sadm_r, max(sadm_len - 0.015, 0.03), 24,
                 "titanium_grey", top="bronze_anodised")
        finish(p_sadm, root_obj)

        p = Part(wing_prefix + tag, store)
        Y = lambda y: sgn * y
        y_root0 = hy + sadm_len
        y_root1 = y_root0 + min(0.10, yoke_len * 0.2)
        box(p, (sadm_x, Y((y_root0 + y_root1) / 2), sadm_z), (0.06, y_root1 - y_root0, 0.15), "bronze_anodised")

        if yoke_style == "single_bar":
            y_t = wing_in - 0.10
            bar(p, (sadm_x, Y(y_root1), sadm_z), (sadm_x, Y(y_t), sadm_z), 0.08, 0.03, yoke_mat, (0, 0, 1))
            box(p, (sadm_x, Y(y_t), sadm_z), (0.03, 0.08, panel_w * 0.62), yoke_mat)
            for zz in (panel_w * 0.25, -panel_w * 0.25):
                bar(p, (sadm_x, Y(y_t), sadm_z + zz), (sadm_x, Y(wing_in), sadm_z + zz),
                    0.04, 0.03, "titanium_grey", (0, 0, 1))
        else:
            # Classic V-strut / triangular yoke frame from SADM root to two hinge points on inner panel edge
            z_spread = panel_w * 0.32
            y_cross = wing_in - 0.06
            for zz in (z_spread, -z_spread):
                bar(p, (sadm_x, Y(y_root1), sadm_z), (sadm_x, Y(y_cross), sadm_z + zz),
                    0.042, 0.028, yoke_mat, (0, 0, 1))
                box(p, (sadm_x, Y((y_cross + wing_in) / 2), sadm_z + zz),
                    (0.045, wing_in - y_cross + 0.02, 0.06), "titanium_grey")
            bar(p, (sadm_x, Y(y_cross), sadm_z - z_spread), (sadm_x, Y(y_cross), sadm_z + z_spread),
                0.036, 0.026, yoke_mat, (0, 1, 0))

        # Solar panels
        front_key = cell_side
        back_key = "+x" if cell_side == "-x" else "-x"
        mats = {front_key: "solar_cells", back_key: "panel_back_cfrp", "default": "panel_edge"}
        for k in range(n_panels):
            y0 = wing_in + k * (panel_l + panel_gap)

            def uv_flip(uu, vv, sgn=sgn):
                return (uu if sgn > 0 else 1.0 - uu), vv

            box(p, (sadm_x, Y(y0 + panel_l / 2), sadm_z), (panel_t, panel_l, panel_w), mats,
                uv="fit", uvmap={front_key: uv_flip, back_key: uv_flip})
            if k < n_panels - 1:
                yh = y0 + panel_l + panel_gap / 2
                for zz in (panel_w * 0.28, -panel_w * 0.28):
                    box(p, (sadm_x, Y(yh), sadm_z + zz), (0.04, panel_gap + 0.05, 0.04), "titanium_grey")
                for zz in (panel_w * 0.12, -panel_w * 0.12):
                    box(p, (sadm_x - 0.015, Y(yh), sadm_z + zz), (0.005, panel_gap + 0.04, 0.025), "gold_flex")

        finish(p, root_obj, location=(sadm_x, sgn * hy, sadm_z))
    return wing_tip


def export_and_render(root, model_id, scene, args, views=None):
    tri = 0
    per = []
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in scene.objects:
        if ob.type == "MESH":
            ob.data.calc_loop_triangles()
            n = len(ob.data.loop_triangles)
            tri += n
            per.append((ob.name, n))
            mw = ob.matrix_world
            for v in ob.data.vertices:
                w = mw @ v.co
                lo = Vector(map(min, lo, w))
                hi = Vector(map(max, hi, w))
    bbox = tuple(round(c, 3) for c in (hi - lo))
    print("TRIANGLES", tri)
    for nm, n in sorted(per, key=lambda x: -x[1]):
        print("  %-22s %6d" % (nm, n))
    print("BBOX_MIN", tuple(round(c, 3) for c in lo))
    print("BBOX_MAX", tuple(round(c, 3) for c in hi))
    print("BBOX_SIZE", bbox)

    glb = os.path.join(root, f"{model_id}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB")
    print("EXPORTED", glb, os.path.getsize(glb))

    if not args.render:
        return bbox, tri

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import render_setup  # noqa: E402

    render_setup.setup(scene, args.samples, res=(1200, 750))
    sx, sy, sz = bbox
    span_d = max(sy * 1.45, 9.0)
    bus_d = max(max(sx, sz) * 2.7, 5.2)
    default_views = {
        "01_earth_face": dict(
            target=(0.0, 0.0, sz * 0.15),
            direction=(-0.18, -0.32, 1.0),
            dist=bus_d * 1.15,
            lens=50,
            sun_from=(-0.55, -0.45, 0.75),
            up=(0, 1, 0),
        ),
        "02_side_span": dict(
            target=(0.0, 0.0, 0.0),
            direction=(-1.0, -0.06, 0.16),
            dist=span_d * 1.12,
            lens=50,
            sun_from=(-0.85, -0.25, 0.45),
        ),
        "03_three_quarter": dict(
            target=(0.0, -0.2, 0.0),
            direction=(-0.62, -0.62, 0.48),
            dist=span_d * 0.96,
            lens=45,
            sun_from=(-0.75, -0.35, 0.55),
        ),
        "04_closeup": dict(
            target=(0.0, 0.0, sz * 0.12),
            direction=(-0.70, -0.52, 0.58),
            dist=bus_d * 0.92,
            lens=50,
            sun_from=(-0.6, -0.55, 0.6),
        ),
    }
    use_views = views if views is not None else default_views
    sel = list(use_views) if args.views == "all" else [
        v for v in use_views if any(v.startswith(s) for s in args.views.split(","))
    ]
    for nm in sel:
        out_jpg = os.path.join(root, "renders", nm + args.tag + ".jpg")
        render_setup.view(scene, out_jpg, **use_views[nm])
    return bbox, tri
