"""Procedural Galileo FOC (OHB) satellite model -> galileo_foc.glb (+ optional renders).

Run headless:
  Blender -b --factory-startup -P scripts/build.py -- --root <galileo-foc dir> [--render] [--views a,b]

Frame (inside Blender): GSC/OHB mechanical body frame orientation, origin moved to the
geometric centre of the bus box:
  +Z = L-band navigation antenna boresight (Earth-facing panel)
  +Y = solar-array rotation axis (wings on +Y / -Y)
  +X = normal of the clock panel (deep-space side in nominal attitude)
Model coordinates = GSC mechanical coordinates - GSC_TO_MODEL_OFFSET.
Units: metres.  All textures are generated procedurally below (no photo textures).
"""
import argparse
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--root", required=True)
ap.add_argument("--render", action="store_true")
ap.add_argument("--views", default="all")
ap.add_argument("--samples", type=int, default=64)
ap.add_argument("--tag", default="")
args = ap.parse_args(argv)
ROOT = os.path.abspath(args.root)

# --------------------------------------------------------------------------------------
# Dimensions (metres).  See NOTES.md for sources; "est" = estimated from photos/CAD.
# --------------------------------------------------------------------------------------
BUS = (2.530, 1.200, 1.100)                     # GSC metadata FOC box dX, dY, dZ (official)
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2
GSC_TO_MODEL_OFFSET = Vector((0.415, 0.0, 0.550))  # X est (GSC fig 805 mm + photos), Z = dZ/2

def gsc(x_mm, y_mm, z_mm):
    """GSC mechanical-frame point (mm) -> model coordinates (m)."""
    return Vector((x_mm / 1000.0, y_mm / 1000.0, z_mm / 1000.0)) - GSC_TO_MODEL_OFFSET

ARP = gsc(140.00, 0.00, 1215.00)                 # official: nav antenna reference point
LRR_REF = gsc(-703.00, -27.50, 1120.45)          # official: LRR reference point
COM = gsc(261.0, -10.0, 565.3)                   # official (typical FOC value, for notes)

SPAN = 14.670                                     # official (OHB): solar generator span
PANEL_L, PANEL_W, PANEL_T = 2.500, 1.082, 0.025   # GSC: wing 5.000 x 1.082 m, 2 panels/wing (OHB); thickness est
PANEL_GAP = 0.020                                 # est
WING_TIP = SPAN / 2
WING_IN = WING_TIP - (2 * PANEL_L + PANEL_GAP)    # derived: inner panel edge |y|
SADM_LEN = 0.10                                   # est
SADM_R = 0.085                                    # est
SADM_X, SADM_Z = 0.0, 0.0                         # est (CAD: centre of the +/-Y panel)

NAV_R = 0.58                                      # est (photos: ~face width)
NAV_H = ARP.z - HZ                                # derived from official ARP height
SAR_C = Vector((0.80, 0.0, HZ))                   # est
SAR_PLATE_R = 0.48                                # est, hexagon circumradius
SAR_HELIX_RING = 0.425                           # est
LRR_SIZE = (0.253, 0.350, 0.0485)                 # official (ILRS GSAT0233/34 RRA size), 60 CCRs

STATS = {}

# --------------------------------------------------------------------------------------
# Scene reset
# --------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1.0


def s2l(c):
    c = np.asarray(c, dtype=float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# --------------------------------------------------------------------------------------
# Procedural textures (values in sRGB; rows bottom -> top)
# --------------------------------------------------------------------------------------
RNG = np.random.default_rng(20261113)


def make_image(name, arr, fmt="PNG"):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr, 0.0, 1.0)
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = fmt
    img.update()
    try:
        img.pack()
    except Exception:
        pass
    return img


def periodic_noise(n, cells, rng):
    g = rng.random((cells, cells))
    x = np.arange(n) / n * cells
    i0 = np.floor(x).astype(int)
    f = x - i0
    i1 = (i0 + 1) % cells
    f = f * f * (3 - 2 * f)
    a = g[np.ix_(i0, i0)]
    b = g[np.ix_(i0, i1)]
    c = g[np.ix_(i1, i0)]
    d = g[np.ix_(i1, i1)]
    fy = f[:, None]
    fx = f[None, :]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def facets(n, nseeds, rng, periodic, stretch=1.0):
    """Crumpled-foil facets: per-pixel brightness in ~[-1, 1] and crease mask."""
    pts = rng.random((nseeds, 2))
    shade = rng.uniform(-1, 1, nseeds)
    tilt = rng.normal(0, 1, (nseeds, 2))
    offs = [(ox, oy) for ox in (-1, 0, 1) for oy in (-1, 0, 1)] if periodic else [(0, 0)]
    S = np.concatenate([pts + np.array(o) for o in offs])
    owner = np.tile(np.arange(nseeds), len(offs))
    yy, xx = np.mgrid[0:n, 0:n] / n
    P = np.stack([xx.ravel(), yy.ravel()], 1)
    if stretch != 1.0:
        S = S * np.array([1.0, stretch])
        P = P * np.array([1.0, stretch])
    val = np.zeros(len(P))
    crease = np.zeros(len(P))
    step = 8192
    for s in range(0, len(P), step):
        ch = P[s:s + step]
        D = ((ch[:, None, :] - S[None, :, :]) ** 2).sum(-1)
        part = np.argpartition(D, 1, axis=1)[:, :2]
        d0 = np.take_along_axis(D, part, 1)
        order = np.argsort(d0, axis=1)
        part = np.take_along_axis(part, order, 1)
        d0 = np.take_along_axis(d0, order, 1)
        k = owner[part[:, 0]]
        rel = ch - S[part[:, 0]]
        v = shade[k] * 0.6 + (rel * tilt[k]).sum(1) * 6.0
        val[s:s + step] = v
        gap = np.sqrt(d0[:, 1]) - np.sqrt(d0[:, 0])
        crease[s:s + step] = np.clip(1.0 - gap * n / 2.5, 0, 1)
    return np.clip(val, -1.5, 1.5).reshape(n, n), crease.reshape(n, n)


def blur(a, r, wrap=False):
    """Separable box blur (3 passes ~ gaussian)."""
    for _ in range(3):
        for ax in (0, 1):
            if wrap:
                acc = sum(np.roll(a, k, axis=ax) for k in range(-r, r + 1))
            else:
                pad = [(0, 0), (0, 0)]
                pad[ax] = (r, r)
                ap_ = np.pad(a, pad, mode="edge")
                acc = sum(np.take(ap_, np.arange(k, k + a.shape[ax]), axis=ax) for k in range(2 * r + 1))
            a = acc / (2 * r + 1)
    return a


def tex_mli():
    n = 256
    v, c = facets(n, 22, RNG, periodic=True)
    lum = 0.105 + 0.012 * v + 0.012 * c + 0.035 * (periodic_noise(n, 3, RNG) - 0.5) \
        + 0.015 * (periodic_noise(n, 8, RNG) - 0.5)
    arr = np.stack([lum, lum, lum * 1.06], -1)
    return make_image("tex_mli_black", arr)


def tex_foil():
    n = 512
    v, c = facets(n, 90, RNG, periodic=False, stretch=0.5)
    v = blur(v, 5)
    c = blur(c, 1)
    lum = 0.70 + 0.17 * v + 0.10 * c + 0.07 * (periodic_noise(n, 5, RNG) - 0.5)
    arr = np.stack([lum, lum * 1.0, lum * 1.02], -1)
    return make_image("tex_foil_silver", arr)


def tex_osr():
    n, tiles = 256, 4
    t = n // tiles
    yy, xx = np.mgrid[0:n, 0:n]
    tile_id = (yy // t) * tiles + (xx // t)
    var = RNG.uniform(-0.035, 0.035, tiles * tiles)[tile_id]
    base = np.stack([0.80 + var, 0.82 + var, 0.86 + var], -1)
    line = ((xx % t) < 2) | ((yy % t) < 2)
    base[line] = (0.56, 0.57, 0.60)
    return make_image("tex_osr_tiles", base)


def tex_solar():
    W, H = 1024, 512                      # u along panel length (2.5 m), v along width (1.082 m)
    Lu, Lv = PANEL_L, PANEL_W
    xs = (np.arange(W) + 0.5) / W * Lu
    ys = (np.arange(H) + 0.5) / H * Lv
    X, Y = np.meshgrid(xs, ys)
    arr = np.empty((H, W, 3))
    arr[:] = (0.20, 0.19, 0.18)           # border / substrate
    margin_u, margin_v = 0.035, 0.030
    cu, cv, g = 0.0395, 0.0765, 0.0045    # cell 4 x 7.7 cm, gap 4.5 mm (est, 3G28-class cells)
    string_gap = 0.012
    inside = (X > margin_u) & (X < Lu - margin_u) & (Y > margin_v) & (Y < Lv - margin_v)
    arr[inside] = (0.21, 0.21, 0.23)      # inter-cell gaps / interconnects
    nu = int((Lu - 2 * margin_u + g) // (cu + g))
    off_u = (Lu - nu * (cu + g) + g) / 2
    rows_v = []
    y = margin_v
    for r in range(12):
        rows_v.append(y)
        y += cv + g + (string_gap if r % 4 == 3 else 0.0)
    total_v = y - g - (string_gap if 11 % 4 == 3 else 0.0) - margin_v
    shift_v = (Lv - 2 * margin_v - total_v) / 2
    rows_v = [r + shift_v for r in rows_v]
    iu = np.floor((X - off_u) / (cu + g)).astype(int)
    fu = (X - off_u) - iu * (cu + g)
    in_u = (iu >= 0) & (iu < nu) & (fu < cu)
    cell_rng = RNG.uniform(-0.012, 0.012, (12, nu + 1))
    for r, y0 in enumerate(rows_v):
        in_v = (Y >= y0) & (Y < y0 + cv)
        m = in_u & in_v
        shade = cell_rng[r, np.clip(iu[m], 0, nu)]
        fv = (Y[m] - y0) / cv
        arr[m, 0] = 0.055 + shade + 0.008 * fv
        arr[m, 1] = 0.062 + shade + 0.008 * fv
        arr[m, 2] = 0.135 + shade + 0.016 * fv
        bus = m & (fu < 0.0035)
        arr[bus] = (0.20, 0.21, 0.25)
    # blank (white) patches with hold-down / snubber inserts, as on the flight panels (est)
    for (pu, pv, nu_c, nv_c) in [(0.40, 0.0, 2, 1), (2.05, 0.0, 2, 1), (1.20, 11.0, 2, 1)]:
        y0 = rows_v[int(pv)]
        u0 = off_u + round((pu - off_u) / (cu + g)) * (cu + g)
        m = (X >= u0) & (X < u0 + nu_c * (cu + g) - g) & (Y >= y0) & (Y < y0 + nv_c * cv)
        arr[m] = (0.62, 0.62, 0.60)
        cxp, cyp = u0 + (nu_c * (cu + g) - g) / 2, y0 + cv / 2
        d = np.hypot(X - cxp, Y - cyp)
        arr[m & (d < 0.016)] = (0.55, 0.56, 0.58)
        arr[m & (d < 0.007)] = (0.30, 0.30, 0.32)
    return make_image("tex_solar_cells", arr)


def tex_sar_disc():
    n = 256
    yy, xx = np.mgrid[0:n, 0:n] + 0.5
    c = n / 2
    r = np.hypot(xx - c, yy - c)
    arr = np.empty((n, n, 3))
    arr[:] = (0.90, 0.90, 0.88)
    pitch = 11.0
    row = np.round(yy / (pitch * 0.866))
    xo = xx - (row % 2) * pitch / 2
    hx = xo - np.round(xo / pitch) * pitch
    hy = yy - row * pitch * 0.866
    hole = np.hypot(hx, hy) < 3.0
    cross = (np.abs(xx - c) < 9) | (np.abs(yy - c) < 9)
    m = hole & ~cross & (r > 24) & (r < 118)
    arr[m] = (0.42, 0.42, 0.42)
    arr[r < 24] = (0.80, 0.80, 0.78)
    arr[r < 9] = (0.45, 0.45, 0.47)
    arr[(r > 118) & (r < 124)] = (0.78, 0.78, 0.76)
    return make_image("tex_sar_disc", arr)


IMG = {
    "mli": tex_mli(),
    "foil": tex_foil(),
    "osr": tex_osr(),
    "solar": tex_solar(),
    "sar": tex_sar_disc(),
}

# --------------------------------------------------------------------------------------
# Materials (glTF-friendly Principled BSDF only)
# --------------------------------------------------------------------------------------
MATS = {}


def principled(m):
    if m.node_tree is None:
        try:
            m.use_nodes = True
        except Exception:
            pass
    nt = m.node_tree
    for nd in nt.nodes:
        if nd.type == "BSDF_PRINCIPLED":
            return nt, nd
    out = None
    for nd in nt.nodes:
        if nd.type == "OUTPUT_MATERIAL":
            out = nd
    if out is None:
        out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    return nt, b


def material(name, color=(0.5, 0.5, 0.5), metallic=0.0, roughness=0.5, image=None):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt, b = principled(m)
    lin = s2l(color)
    b.inputs["Base Color"].default_value = (float(lin[0]), float(lin[1]), float(lin[2]), 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if image is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = image
        t.interpolation = "Linear"
        t.extension = "REPEAT"
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    m.diffuse_color = (float(lin[0]), float(lin[1]), float(lin[2]), 1.0)
    MATS[name] = m
    return m


material("mli_black", (0.11, 0.11, 0.12), 0.0, 0.36, IMG["mli"])
material("osr_radiator", (0.86, 0.87, 0.90), 0.75, 0.16, IMG["osr"])
material("ge_kapton_foil", (0.74, 0.74, 0.76), 0.9, 0.26, IMG["foil"])
material("solar_cells", (0.06, 0.06, 0.14), 0.0, 0.15, IMG["solar"])
material("panel_back_cfrp", (0.17, 0.16, 0.15), 0.1, 0.55)
material("panel_edge", (0.30, 0.30, 0.30), 0.3, 0.5)
material("yoke_cfrp", (0.62, 0.50, 0.32), 0.25, 0.45)
material("gold_kapton", (0.85, 0.63, 0.25), 1.0, 0.32)
material("aluminium", (0.78, 0.78, 0.80), 1.0, 0.35)
material("titanium_grey", (0.55, 0.55, 0.57), 1.0, 0.40)
material("white_paint", (0.90, 0.90, 0.88), 0.0, 0.50)
material("black_paint", (0.06, 0.06, 0.06), 0.0, 0.60)
material("lrr_cube_glass", (0.42, 0.46, 0.52), 0.9, 0.08)
material("sar_disc_white", (0.90, 0.90, 0.88), 0.0, 0.50, IMG["sar"])
material("bronze", (0.72, 0.45, 0.25), 0.8, 0.40)

# --------------------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------------------


class Part:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.verify()
        self.mats = []

    def mi(self, mname):
        names = [m.name for m in self.mats]
        if mname not in names:
            self.mats.append(MATS[mname])
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
    v = w.cross(u)
    return u, v, w


FACE_DEF = {
    "-x": [(0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)],
    "+x": [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
    "-y": [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)],
    "+y": [(0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)],
    "-z": [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)],
    "+z": [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
}
FACE_N = {"-x": (-1, 0, 0), "+x": (1, 0, 0), "-y": (0, -1, 0), "+y": (0, 1, 0),
          "-z": (0, 0, -1), "+z": (0, 0, 1)}


def box(part, c, s, mats, uv="fit", tile=1.0, skip=()):
    lo = [c[i] - s[i] / 2 for i in range(3)]
    hi = [c[i] + s[i] / 2 for i in range(3)]
    for key, idx in FACE_DEF.items():
        if key in skip:
            continue
        coords = [(lo[0] if i == 0 else hi[0], lo[1] if j == 0 else hi[1], lo[2] if k == 0 else hi[2])
                  for i, j, k in idx]
        vs = part.verts(coords)
        ax = "xyz".index(key[1])
        t1, t2 = [a for a in range(3) if a != ax]
        uvs = {}
        for v in vs:
            if uv == "fit":
                uvs[v] = ((v.co[t1] - lo[t1]) / s[t1], (v.co[t2] - lo[t2]) / s[t2])
            else:
                uvs[v] = (v.co[t1] / tile, v.co[t2] / tile)
        mname = mats if isinstance(mats, str) else mats.get(key, mats.get("default"))
        part.face(vs, mname, uvs, FACE_N[key])


def cylinder(part, base, axis, r0, length, segs, side, top=None, bottom=None, r1=None,
             smooth=True, side_tile=None, dome=0.0, uhint=None):
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
            u0, u1 = i / segs * circ / side_tile, (i + 1) / segs * circ / side_tile
            vv = length / side_tile
        else:
            u0, u1, vv = i / segs, (i + 1) / segs, 1.0
        uvs = {V0[i]: (u0, 0), V0[j]: (u1, 0), V1[j]: (u1, vv), V1[i]: (u0, vv)}
        mid = 2 * math.pi * (i + 0.5) / segs
        part.face(vs, side, uvs, u * math.cos(mid) + v * math.sin(mid), smooth)
    if top:
        ctr = base + w * length
        if dome > 0:
            fr = [1.0, 0.82, 0.6, 0.36, 0.14]
            rings = []
            for f_ in fr:
                rr = r1 * f_
                h = dome * (1 - f_ * f_)
                rings.append(part.verts([ctr + d * rr + w * h for d in dirs]))
            for a in range(len(rings) - 1):
                for i in range(segs):
                    j = (i + 1) % segs
                    vs = [rings[a][i], rings[a][j], rings[a + 1][j], rings[a + 1][i]]
                    uvs = {}
                    for vt in vs:
                        p = vt.co - ctr
                        uvs[vt] = (0.5 + 0.5 * p.dot(u) / r1, 0.5 + 0.5 * p.dot(v) / r1)
                    part.face(vs, top, uvs, w, True)
            cv = part.verts([ctr + w * dome])[0]
            last = rings[-1]
            for i in range(segs):
                j = (i + 1) % segs
                vs = [last[i], last[j], cv]
                uvs = {}
                for vt in vs:
                    p = vt.co - ctr
                    uvs[vt] = (0.5 + 0.5 * p.dot(u) / r1, 0.5 + 0.5 * p.dot(v) / r1)
                part.face(vs, top, uvs, w, True)
        else:
            Vt = part.verts([ctr + d * r1 for d in dirs])
            uvs = {Vt[i]: (0.5 + 0.5 * math.cos(angs[i]), 0.5 + 0.5 * math.sin(angs[i])) for i in range(segs)}
            part.face(Vt, top, uvs, w)
    if bottom:
        Vb = part.verts([base + d * r0 for d in dirs])
        uvs = {Vb[i]: (0.5 + 0.5 * math.cos(angs[i]), 0.5 + 0.5 * math.sin(angs[i])) for i in range(segs)}
        part.face(Vb, bottom, uvs, -w)


def prism(part, base, axis, pts2d, height, side, top, bottom=None, uhint=None):
    u, v, w = frame_from_axis(axis, uhint)
    base = Vector(base)
    r0 = [base + u * x + v * y for x, y in pts2d]
    r1 = [p + w * height for p in r0]
    n = len(pts2d)
    xs = [p[0] for p in pts2d]
    ys = [p[1] for p in pts2d]
    sx, sy = max(xs) - min(xs), max(ys) - min(ys)
    for i in range(n):
        j = (i + 1) % n
        vs = part.verts([r0[i], r0[j], r1[j], r1[i]])
        mid = (r0[i] + r0[j]) / 2 - base
        out = (mid - w * mid.dot(w)).normalized()
        uvs = {vs[0]: (0, 0), vs[1]: (1, 0), vs[2]: (1, 1), vs[3]: (0, 1)}
        part.face(vs, side, uvs, out)
    vt = part.verts(r1)
    uvs = {vt[i]: ((pts2d[i][0] - min(xs)) / sx, (pts2d[i][1] - min(ys)) / sy) for i in range(n)}
    part.face(vt, top, uvs, w)
    if bottom:
        vb = part.verts(r0)
        uvs = {vb[i]: ((pts2d[i][0] - min(xs)) / sx, (pts2d[i][1] - min(ys)) / sy) for i in range(n)}
        part.face(vb, bottom, uvs, -w)


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
        ring = [c + (b1 * math.cos(2 * math.pi * s / sides) + b2 * math.sin(2 * math.pi * s / sides)) * tube_r
                for s in range(sides)]
        rings.append(part.verts(ring))
        centres.append(c)
    for k in range(n - 1):
        for s in range(sides):
            s2 = (s + 1) % sides
            vs = [rings[k][s], rings[k][s2], rings[k + 1][s2], rings[k + 1][s]]
            cen = sum((x.co for x in vs), Vector()) / 4
            out = cen - (centres[k] + centres[k + 1]) / 2
            uvs = {x: (0.5, 0.5) for x in vs}
            part.face(vs, mname, uvs, out, True)


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


ROOTOBJ = bpy.data.objects.new("galileo_foc", None)
bpy.context.scene.collection.objects.link(ROOTOBJ)

# --------------------------------------------------------------------------------------
# Bus (box with small bevel, black MLI everywhere; radiators are separate plates)
# --------------------------------------------------------------------------------------
p = Part("bus")
ret = bmesh.ops.create_cube(p.bm, size=1.0)
for vt in p.bm.verts:
    vt.co = Vector((vt.co.x * BUS[0], vt.co.y * BUS[1], vt.co.z * BUS[2]))
bmesh.ops.bevel(p.bm, geom=list(p.bm.verts) + list(p.bm.edges), offset=0.015, segments=2,
                profile=0.5, affect="EDGES")
mi = p.mi("mli_black")
TILE_MLI = 0.45
for f in p.bm.faces:
    f.material_index = mi
    f.normal_update()
    n = f.normal
    ax = max(range(3), key=lambda i: abs(n[i]))
    t1, t2 = [a for a in range(3) if a != ax]
    for loop in f.loops:
        loop[p.uv].uv = (loop.vert.co[t1] / TILE_MLI, loop.vert.co[t2] / TILE_MLI)
finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Radiators (OSR).  Areas from GSC material "C" per face; placement est.
# --------------------------------------------------------------------------------------
p = Part("radiators_osr")
TO = 0.004   # plate thickness
OFF = 0.002  # stand-off from MLI
TILE_OSR = 0.16
osr_side = {"default": "osr_radiator"}
for sgn in (1, -1):  # +Y 1.654 m2 / -Y 1.539 m2 -> 1.60 x 1.00 m (est layout)
    x0, x1 = -0.38, 1.22
    box(p, ((x0 + x1) / 2, sgn * (HY + OFF + TO / 2), 0.0), (x1 - x0, TO, 1.00), osr_side,
        uv="tile", tile=TILE_OSR)
# +X clock panel radiator 0.88 m2
box(p, (HX + OFF + TO / 2, 0.0, 0.02), (TO, 0.90, 0.98), osr_side, uv="tile", tile=TILE_OSR)
# -Z radiator 0.959 m2
box(p, (0.76, 0.0, -(HZ + OFF + TO / 2)), (0.92, 1.04, TO), osr_side, uv="tile", tile=TILE_OSR)
finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# L-band navigation antenna (sun-shielded drum, Ge-coated Kapton)
# --------------------------------------------------------------------------------------
p = Part("nav_antenna")
cylinder(p, (ARP.x, ARP.y, HZ), (0, 0, 1), NAV_R, NAV_H - 0.02, 72, "ge_kapton_foil",
         top="ge_kapton_foil", side_tile=0.6, dome=0.02)
# base ring / mounting skirt (black)
cylinder(p, (ARP.x, ARP.y, HZ), (0, 0, 1), NAV_R + 0.012, 0.025, 72, "mli_black", top="mli_black",
         side_tile=TILE_MLI)
finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Search-and-rescue antenna: hexagonal plate, 6 UHF helices, white centre element
# --------------------------------------------------------------------------------------
p = Part("sar_antenna")
hexpts = [(SAR_PLATE_R * math.cos(math.radians(60 * k + 90)),
           SAR_PLATE_R * math.sin(math.radians(60 * k + 90))) for k in range(6)]
# frame for +Z with u=+X, v=+Y -> vertices at +/-Y (as in photos)
prism(p, (SAR_C.x, SAR_C.y, HZ), (0, 0, 1), hexpts, 0.035, "mli_black", "ge_kapton_foil",
      uhint=(1, 0, 0))
ztop = HZ + 0.035
cylinder(p, (SAR_C.x, SAR_C.y, ztop), (0, 0, 1), 0.19, 0.012, 48, "white_paint", top="sar_disc_white",
         uhint=(1, 0, 0))
cylinder(p, (SAR_C.x, SAR_C.y, ztop + 0.012), (0, 0, 1), 0.028, 0.05, 16, "aluminium", top="aluminium")
for k in range(6):
    a = math.radians(60 * k + 90)
    hc = Vector((SAR_C.x + SAR_HELIX_RING * math.cos(a), SAR_C.y + SAR_HELIX_RING * math.sin(a), ztop))
    cylinder(p, hc, (0, 0, 1), 0.052, 0.025, 16, "gold_kapton", top="gold_kapton")
    helix(p, hc + Vector((0, 0, 0.025)), (0, 0, 1), 0.042, 0.135, 3.0, 0.0055, 24, 6, "gold_kapton",
          phase=a)
    for q in range(3):  # dielectric support posts
        b = a + q * 2 * math.pi / 3
        pc = hc + Vector((0.042 * math.cos(b), 0.042 * math.sin(b), 0.025))
        cylinder(p, pc, (0, 0, 1), 0.004, 0.14, 4, "white_paint", smooth=False)
    cylinder(p, hc + Vector((0, 0, 0.16)), (0, 0, 1), 0.046, 0.008, 16, "gold_kapton", top="gold_kapton")
finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Laser retro-reflector array: 60 CCRs (ILRS), 350 x 253 x 48.5 mm
# --------------------------------------------------------------------------------------
p = Part("lrr")
lx, ly, lz = LRR_SIZE
box(p, (LRR_REF.x, LRR_REF.y, HZ + lz / 2), (lx + 0.016, ly + 0.016, lz), "aluminium")
for i in range(6):
    for j in range(10):
        cx = LRR_REF.x - lx / 2 + (i + 0.5) * lx / 6
        cy = LRR_REF.y - ly / 2 + (j + 0.5) * ly / 10
        cylinder(p, (cx, cy, HZ + lz - 0.002), (0, 0, 1), 0.0155, 0.007, 10, "aluminium",
                 top="black_paint", smooth=False)
        cylinder(p, (cx, cy, HZ + lz - 0.002), (0, 0, 1), 0.0125, 0.0075, 10, "aluminium",
                 top="lrr_cube_glass", smooth=False)
finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Small Earth-face and other equipment (positions est.)
# --------------------------------------------------------------------------------------
p = Part("sband_antenna_+Z")
tilt = Vector((-math.sin(math.radians(40)), 0, math.cos(math.radians(40))))
sb = Vector((-1.16, 0.40, HZ))
box(p, (sb.x, sb.y, HZ + 0.03), (0.10, 0.10, 0.06), "aluminium")
cylinder(p, sb + Vector((0, 0, 0.05)), tilt, 0.045, 0.17, 20, "gold_kapton", top="white_paint")
finish(p, ROOTOBJ)

p = Part("sband_antenna_-Z")
sb = Vector((-1.12, -0.40, -HZ))
box(p, (sb.x, sb.y, -HZ - 0.015), (0.10, 0.10, 0.03), "aluminium")
cylinder(p, sb + Vector((0, 0, -0.03)), (0, 0, -1), 0.045, 0.07, 20, "gold_kapton", top="white_paint")
finish(p, ROOTOBJ)

p = Part("cband_antenna")
cb = Vector((-0.80, -0.44, HZ))
cylinder(p, cb, (0, 0, 1), 0.035, 0.05, 16, "aluminium", top="aluminium")
cylinder(p, cb + Vector((0, 0, 0.05)), (0, 0, 1), 0.035, 0.10, 20, "black_paint", top="titanium_grey",
         r1=0.060)
finish(p, ROOTOBJ)

p = Part("earth_sensor")
es = Vector((-0.84, 0.44, HZ))
box(p, (es.x, es.y, HZ + 0.045), (0.16, 0.12, 0.09), "mli_black", uv="tile", tile=TILE_MLI)
cylinder(p, (es.x, es.y, HZ + 0.09), (0, 0, 1), 0.035, 0.015, 20, "titanium_grey", top="black_paint")
finish(p, ROOTOBJ)

p = Part("sun_sensors")
box(p, (-HX - 0.015, 0.0, 0.38), (0.03, 0.09, 0.09), "aluminium")
cylinder(p, (-HX - 0.03, 0.0, 0.38), (-1, 0, 0), 0.022, 0.006, 16, "aluminium", top="black_paint")
for sy in (0.45, -0.45):
    box(p, (-HX - 0.01, sy, 0.45), (0.02, 0.05, 0.05), "white_paint")
finish(p, ROOTOBJ)

p = Part("thrusters")
for sy in (0.48, -0.48):
    for sz in (0.42, -0.42):
        d = Vector((-1.0, 0.25 * math.copysign(1, sy), 0.25 * math.copysign(1, sz))).normalized()
        base = Vector((-HX, sy, sz))
        cylinder(p, base, d, 0.018, 0.04, 12, "titanium_grey", top="titanium_grey")
        cylinder(p, base + d * 0.04, d, 0.012, 0.05, 12, "titanium_grey", r1=0.026, top="black_paint")
finish(p, ROOTOBJ)

p = Part("launcher_interface")
for ix in (gsc(-805, 0, 0).x, gsc(805, 0, 0).x):
    for iy in (0.52, -0.52):
        box(p, (ix, iy, -HZ - 0.02), (0.12, 0.10, 0.04), "aluminium")
finish(p, ROOTOBJ)

p = Part("hold_down_points")
for sgn in (1, -1):
    for hx_ in (-1.12, 1.12):
        for hz_ in (-0.43, 0.43):
            cylinder(p, (hx_, sgn * HY, hz_), (0, sgn, 0), 0.045, 0.03, 16, "bronze", top="bronze")
finish(p, ROOTOBJ)

for sgn, tag in ((1, "+Y"), (-1, "-Y")):
    p = Part("sadm_" + tag)
    cylinder(p, (SADM_X, sgn * HY, SADM_Z), (0, sgn, 0), SADM_R + 0.03, 0.02, 32, "titanium_grey",
             top="titanium_grey")
    cylinder(p, (SADM_X, sgn * (HY + 0.02), SADM_Z), (0, sgn, 0), SADM_R, SADM_LEN - 0.02, 32,
             "gold_kapton", top="titanium_grey")
    finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Solar wings: yoke + 2 panels each.  Default pose: cell side faces -X (Sun side,
# = +X of the IGS/ANTEX frame); node origin on the SADM axis so a rotation about the
# node's local Y axis is the solar-array angle.
# --------------------------------------------------------------------------------------
for sgn, tag in ((1, "+Y"), (-1, "-Y")):
    p = Part("solar_wing_" + tag)
    y_flange = HY + SADM_LEN
    y_in = WING_IN
    # yoke: main flat bar from SADM flange to a T crossbar at the inner panel edge
    yc_end = y_in - 0.07
    box(p, (SADM_X, sgn * (y_flange + yc_end) / 2, SADM_Z), (0.03, yc_end - y_flange, 0.05), "yoke_cfrp")
    box(p, (SADM_X, sgn * (y_flange + 0.03), SADM_Z), (0.07, 0.06, 0.12), "titanium_grey")
    # T crossbar along Z
    box(p, (SADM_X, sgn * (y_in - 0.045), SADM_Z), (0.035, 0.05, 0.82), "yoke_cfrp")
    # diagonal struts from main bar to crossbar ends
    for zz in (0.38, -0.38):
        a = Vector((SADM_X, sgn * (y_in - 0.55), SADM_Z))
        b = Vector((SADM_X, sgn * (y_in - 0.06), zz))
        cylinder(p, a, b - a, 0.012, (b - a).length, 8, "yoke_cfrp", smooth=True)
    # yoke-to-panel hinges
    for zz in (0.36, -0.36):
        box(p, (SADM_X, sgn * (y_in - 0.012), zz), (0.05, 0.03, 0.08), "gold_kapton")
    # panels
    mats = {"-x": "solar_cells", "+x": "panel_back_cfrp", "default": "panel_edge"}
    for k in range(2):
        y0 = y_in + k * (PANEL_L + PANEL_GAP)
        box(p, (0.0, sgn * (y0 + PANEL_L / 2), 0.0), (PANEL_T, PANEL_L, PANEL_W), mats, uv="fit")
    # inter-panel hinges
    yh = y_in + PANEL_L + PANEL_GAP / 2
    for zz in (0.40, -0.40):
        box(p, (0.0, sgn * yh, zz), (0.035, 0.05, 0.07), "gold_kapton")
    finish(p, ROOTOBJ, location=(SADM_X, sgn * HY, SADM_Z))

# --------------------------------------------------------------------------------------
# Stats + export
# --------------------------------------------------------------------------------------
tri = 0
per = []
for ob in scene.objects:
    if ob.type == "MESH":
        ob.data.calc_loop_triangles()
        n = len(ob.data.loop_triangles)
        tri += n
        per.append((ob.name, n))
print("TRIANGLES", tri)
for nm, n in sorted(per, key=lambda x: -x[1]):
    print("  %-22s %6d" % (nm, n))
print("WING_IN", round(WING_IN, 4), "NAV_H", round(NAV_H, 4), "ARP", tuple(round(c, 4) for c in ARP),
      "LRR", tuple(round(c, 4) for c in LRR_REF), "COM", tuple(round(c, 4) for c in COM))

glb = os.path.join(ROOT, "galileo_foc.glb")
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB")
print("EXPORTED", glb, os.path.getsize(glb))

# --------------------------------------------------------------------------------------
# Renders
# --------------------------------------------------------------------------------------
if not args.render:
    sys.exit(0)

r = scene.render
r.resolution_x, r.resolution_y, r.resolution_percentage = 1600, 1000, 100
engine_set = None
for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
    try:
        r.engine = eng
        engine_set = eng
        break
    except TypeError:
        continue
print("ENGINE", engine_set)
if engine_set and engine_set.startswith("BLENDER_EEVEE"):
    ee = scene.eevee
    ee.taa_render_samples = args.samples
    for attr, val in (("use_raytracing", True), ("use_shadows", True), ("use_gtao", True)):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, val)
            except Exception:
                pass
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
except Exception as e:
    print("colour mgmt:", e)

world = bpy.data.worlds.new("render_world")
scene.world = world
try:
    world.use_nodes = True
except Exception:
    pass
wn = world.node_tree.nodes
wl = world.node_tree.links
for nd in list(wn):
    wn.remove(nd)
out = wn.new("ShaderNodeOutputWorld")
lp = wn.new("ShaderNodeLightPath")
bg_cam = wn.new("ShaderNodeBackground")
bg_cam.inputs["Color"].default_value = (0.004, 0.0045, 0.006, 1)
tc = wn.new("ShaderNodeTexCoord")
sep = wn.new("ShaderNodeSeparateXYZ")
ramp = wn.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.0
ramp.color_ramp.elements[0].color = (0.020, 0.022, 0.028, 1)
ramp.color_ramp.elements[1].position = 1.0
ramp.color_ramp.elements[1].color = (0.075, 0.085, 0.11, 1)
mapr = wn.new("ShaderNodeMapRange")
mapr.inputs["From Min"].default_value = -1.0
mapr.inputs["From Max"].default_value = 1.0
bg_env = wn.new("ShaderNodeBackground")
bg_env.inputs["Strength"].default_value = 1.0
mix = wn.new("ShaderNodeMixShader")
wl.new(tc.outputs["Generated"], sep.inputs["Vector"])
wl.new(sep.outputs["Z"], mapr.inputs["Value"])
wl.new(mapr.outputs["Result"], ramp.inputs["Fac"])
wl.new(ramp.outputs["Color"], bg_env.inputs["Color"])
wl.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
wl.new(bg_env.outputs["Background"], mix.inputs[1])
wl.new(bg_cam.outputs["Background"], mix.inputs[2])
wl.new(mix.outputs["Shader"], out.inputs["Surface"])

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 6.0
sun_data.angle = math.radians(0.6)
sun = bpy.data.objects.new("sun", sun_data)
scene.collection.objects.link(sun)
cam_data = bpy.data.cameras.new("cam")
cam_data.clip_start = 0.05
cam_data.clip_end = 500
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def orient(obj, forward, up):
    f = Vector(forward).normalized()
    rgt = f.cross(Vector(up)).normalized()
    u = rgt.cross(f)
    m = Matrix((rgt, u, -f)).transposed()
    obj.matrix_world = Matrix.Translation(obj.location) @ m.to_4x4()


def view(name, target, direction, dist, lens, sun_from, up=(0, 0, 1), shift=(0, 0)):
    target = Vector(target)
    d = Vector(direction).normalized()
    cam.location = target + d * dist
    orient(cam, -d, up)
    cam_data.lens = lens
    cam_data.shift_x, cam_data.shift_y = shift
    s = Vector(sun_from).normalized()
    sun.location = (0, 0, 0)
    orient(sun, -s, (0, 0, 1) if abs(s.z) < 0.95 else (0, 1, 0))
    r.filepath = os.path.join(ROOT, "renders", "%s%s.png" % (name, args.tag))
    bpy.ops.render.render(write_still=True)
    print("RENDERED", r.filepath)


VIEWS = {
    "01_earth_face": dict(target=(0.0, 0.0, 0.3), direction=(-0.18, -0.32, 1.0), dist=7.2, lens=50,
                          sun_from=(-0.55, -0.45, 0.75), up=(0, 1, 0)),
    "02_side_span": dict(target=(0.0, 0.0, 0.0), direction=(-1.0, -0.06, 0.16), dist=23.0, lens=50,
                         sun_from=(-0.85, -0.25, 0.45)),
    "03_three_quarter": dict(target=(0.0, -0.3, 0.0), direction=(-0.62, -0.62, 0.48), dist=19.5, lens=45,
                             sun_from=(-0.75, -0.35, 0.55)),
    "04_anti_earth": dict(target=(0.0, 0.0, -0.3), direction=(-0.22, 0.30, -1.0), dist=7.2, lens=50,
                          sun_from=(-0.5, 0.45, -0.75), up=(0, 1, 0)),
    "05_bus_closeup": dict(target=(-0.05, 0.0, 0.15), direction=(-0.72, -0.55, 0.62), dist=6.4, lens=50,
                           sun_from=(-0.6, -0.55, 0.6)),
}
sel = list(VIEWS) if args.views == "all" else [v for v in VIEWS if any(v.startswith(s) for s in args.views.split(","))]
for nm in sel:
    view(nm, **VIEWS[nm])
