"""Procedural Galileo FOC (OHB) satellite model -> galileo_foc.glb (+ optional renders).  v2

Run headless:
  Blender -b --factory-startup -P scripts/build.py -- --root <galileo-foc dir> [--render] [--views a,b]

Frame (inside Blender): GSC/OHB mechanical body frame orientation, origin moved to the
geometric centre of the bus box:
  +Z = L-band navigation antenna boresight (Earth-facing panel)
  +Y = solar-array rotation axis (wings on +Y / -Y)
  +X = normal of the clock panel (deep-space side in nominal attitude)
Model coordinates = GSC mechanical coordinates - GSC_TO_MODEL_OFFSET.  Units: metres.
All textures are generated procedurally below (no photo textures); they are also written
to <root>/textures/ for inspection.
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
TEXDIR = os.path.join(ROOT, "textures")
os.makedirs(TEXDIR, exist_ok=True)

# --------------------------------------------------------------------------------------
# Dimensions (metres).  official / derived / measured (photo + camera model) / est.
# --------------------------------------------------------------------------------------
BUS = (2.530, 1.200, 1.100)                       # official (GSC FOC box)
HX, HY, HZ = BUS[0] / 2, BUS[1] / 2, BUS[2] / 2
GSC_TO_MODEL_OFFSET = Vector((0.415, 0.0, 0.550))  # X est./measured (Phenix: LRR 0.14 m from -X end), Z = dZ/2


def gsc(x_mm, y_mm, z_mm):
    return Vector((x_mm / 1000.0, y_mm / 1000.0, z_mm / 1000.0)) - GSC_TO_MODEL_OFFSET


ARP = gsc(140.00, 0.00, 1215.00)                  # official
LRR_REF = gsc(-703.00, -27.50, 1120.45)           # official
COM = gsc(261.0, -10.0, 565.3)                    # official (typical FOC)

PANEL_L, PANEL_W, PANEL_T = 2.500, 1.082, 0.025   # official L x W (GSC 5.000 x 1.082 per wing); T measured ~2.5 cm
PANEL_GAP = 0.075                                 # measured (side-view photo, 58 px @ 774 px/m)
FACE_TO_PANEL = 1.62                              # measured: bus +/-Y face -> inner panel edge
WING_IN = HY + FACE_TO_PANEL                      # 2.22
WING_TIP = WING_IN + 2 * PANEL_L + PANEL_GAP      # 7.295 -> span 14.59 (+tip brackets 14.66; official 14.67)
SADM_X, SADM_Z = 0.10, 0.0                        # measured (2013 photo: SADM ~1.37 m from -X end), +/-0.1
SADM_LEN, SADM_R = 0.12, 0.10                     # est. (photos)
ROOT_LEN = 0.12                                   # root hinge bracket length (est.)
BAR_W, BAR_T = 0.085, 0.030                       # measured width (side view 55 px @ 767 px/m); thickness est.
T_LEN, T_W = 0.70, 0.10                           # measured crossbar length (0.68-0.70 m); width est.

NAV_R = 0.64                                      # measured (Phenix, 1155 px/m: 1575 px incl. foil puff)
NAV_H = 0.135                                     # foil top; official ARP is 0.115 above the panel
SAR_C = Vector((0.83, 0.0, HZ))                   # measured (Phenix)
SAR_HELIX = [(0.0, 0.52), (0.34, 0.23), (0.34, -0.23), (0.0, -0.52), (-0.34, -0.23), (-0.34, 0.23)]  # measured
SAR_PLATE = [(0.0, 0.585), (0.395, 0.265), (0.395, -0.265), (0.0, -0.585), (-0.395, -0.265), (-0.395, 0.265)]
LRR_SIZE = (0.253, 0.350, 0.0485)                 # official (ILRS), 60 CCRs

# --------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"


def s2l(c):
    c = np.asarray(c, dtype=float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


RNG = np.random.default_rng(20261113)


def make_image(name, arr, non_color=False):
    """arr: H x W x 3, row 0 = bottom (v = 0).  Saved as PNG in textures/ and loaded from disk."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr, 0.0, 1.0)
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(TEXDIR, name + ".png")
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
    a = g[np.ix_(yi0, xi0)]; b = g[np.ix_(yi0, xi1)]
    c = g[np.ix_(yi1, xi0)]; d = g[np.ix_(yi1, xi1)]
    fy = fy[:, None]; fx = fx[None, :]
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
    h = np.zeros(len(P)); crease = np.zeros(len(P)); nx = np.zeros(len(P)); ny = np.zeros(len(P))
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
        nx[s:s + 8192] = gx[k]; ny[s:s + 8192] = gy[k]
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
        sx = sx * scale_px; sy = sy * scale_px
    return sx, sy


def downsample(a, k):
    h, w = a.shape[0] // k, a.shape[1] // k
    return a[:h * k, :w * k].reshape(h, k, w, k, -1).mean((1, 3))


# ---------------- black MLI: seams, tape, buttons, gentle wrinkles (tile 0.60 m) ----------
MLI_TILE = 0.60


def tex_mli():
    n = 512
    m_per_px = MLI_TILE / n
    hA, _, _, cA = facet_field(n, 10, RNG, True, tilt=0.6)
    hB, _, _, cB = facet_field(n, 36, RNG, True, tilt=0.4)
    wr = blur(hA, 14, wrap=True) * 1.0 + blur(hB, 6, wrap=True) * 0.35   # soft wrinkles (relative)
    yy, xx = np.mgrid[0:n, 0:n] * m_per_px
    height = wr * 0.004                                                # metres
    lum = 0.085 + 0.012 * (periodic_noise(n, 3, RNG) - 0.5)
    lum = np.full((n, n), 1.0) * lum
    # blanket seams at tile borders (overlap + black tape 2.5 cm wide)
    dx = np.minimum(xx, MLI_TILE - xx)
    dy = np.minimum(yy, MLI_TILE - yy)
    tape = (dx < 0.0125) | (dy < 0.0125)
    lum[tape] = 0.06
    height[tape] += 0.0015
    seam = (np.abs(xx - 0.0125) < 0.0012) | (np.abs(yy - 0.0125) < 0.0012)
    lum[seam] = 0.03
    height[seam] -= 0.001
    # an inner overlap line (blanket panel split) at 0.3 m in one direction
    seam2 = np.abs(yy - 0.30) < 0.0012
    lum[seam2] = 0.035
    height[seam2] -= 0.0008
    # MLI buttons / grounding studs (gold-brown) along tape and on a coarse grid
    col = np.stack([lum, lum, lum * 1.05], -1)
    btn = []
    for t in np.arange(0.075, MLI_TILE, 0.15):
        btn += [(t, 0.006), (0.006, t)]
    btn.append((0.30, 0.30))
    for bx, by in btn:
        d = np.hypot(xx - bx, yy - by)
        d = np.minimum(d, np.hypot(xx - bx - MLI_TILE * np.sign(bx - 0.3), yy - by))
        m = d < 0.005
        col[m] = (0.40, 0.30, 0.15)
        height[m] += 0.0015 * (1 - (d[m] / 0.005) ** 2)
    sx, sy = slopes(height, 1.0 / m_per_px, True)
    nrm = normal_from_slopes(sx, sy, 1.0)
    return make_image("tex_mli_black", col), make_image("tex_mli_black_nrm", nrm, True)


# ---------------- crumpled silver foil (Ge-coated Kapton sunshield) ------------------------
def tex_foil():
    n = 512
    _, gx1, gy1, cr1 = facet_field(n, 520, RNG, False, stretch=0.45, tilt=0.30)
    _, gx2, gy2, _ = facet_field(n, 45, RNG, False, stretch=0.6, tilt=0.35)
    sx = blur(gx1, 1) + blur(gx2, 6)
    sy = blur(gy1, 1) + blur(gy2, 6)
    nrm = normal_from_slopes(sx, sy, 0.9)
    lum = 0.82 + 0.03 * (periodic_noise(n, 7, RNG) - 0.5)
    lum = lum - 0.06 * np.clip(1.0 - cr1 * n / 1.5, 0, 1)
    col = np.stack([lum, lum, lum * 1.015], -1)
    return make_image("tex_foil_silver", col), make_image("tex_foil_silver_nrm", nrm, True)


def tex_osr():
    n, tiles = 256, 4
    t = n // tiles
    yy, xx = np.mgrid[0:n, 0:n]
    tid = (yy // t) * tiles + (xx // t)
    var = RNG.uniform(-0.03, 0.03, tiles * tiles)[tid]
    base = np.stack([0.80 + var, 0.82 + var, 0.86 + var], -1)
    line = ((xx % t) < 2) | ((yy % t) < 2)
    base[line] = (0.56, 0.57, 0.60)
    return make_image("tex_osr_tiles", base)


# ---------------- solar panel front atlas (measured layout, ESA side-view photo) ----------
CELL_U, CELL_V, CELL_GAP = 0.0385, 0.0755, 0.002
ROW_PITCH = CELL_V + CELL_GAP
COL_PITCH = CELL_U + CELL_GAP
T_ROWS = [0.030 + i * ROW_PITCH for i in range(2)] + \
         [0.270 + i * ROW_PITCH for i in range(7)] + \
         [0.897 + i * ROW_PITCH for i in range(2)]                 # t from top edge (measured bands)
STRIPS_T = [(0.185, 0.268), (0.8125, 0.895)]
S_COLS = [0.035 + i * COL_PITCH for i in range(29)] + [1.2905 + i * COL_PITCH for i in range(29)]
# blanks (white, cell-free) and round inserts: measured on panel 2; panel 1 only has inserts
P2_BLANKS = [((0.052, 0.217), 0), ((0.268, 0.434), 0), ((1.21, 1.37), 0), ((1.43, 1.59), 0),
             ((1.84, 2.00), 0), ((2.07, 2.23), 0),
             ((0.06, 0.22), 1), ((0.27, 0.45), 1), ((1.25, 1.41), 1), ((1.47, 1.64), 1),
             ((1.89, 2.05), 1), ((2.12, 2.29), 1)]
P2_INSERTS = [(0.24, 0), (1.40, 0), (2.035, 0), (0.245, 1), (1.44, 1), (2.085, 1)]
P1_INSERTS = [(0.46, 0), (1.085, 0), (2.245, 0), (0.40, 1), (1.04, 1), (2.245, 1)]


def draw_panel_front(W, H, panel):
    s = (np.arange(W) + 0.5) / W * PANEL_L
    t = (np.arange(H) + 0.5) / H * PANEL_W
    S, T = np.meshgrid(s, t)                                   # T: from top edge, row 0 = top
    img = np.empty((H, W, 3))
    img[:] = (0.15, 0.13, 0.08)                                  # substrate between cells
    # cells (cut corners)
    cut = 0.009
    for t0 in T_ROWS:
        mv = (T >= t0) & (T < t0 + CELL_V)
        if not mv.any():
            continue
        for s0 in S_COLS:
            m = mv & (S >= s0) & (S < s0 + CELL_U)
            if not m.any():
                continue
            a = S[m] - s0; b = T[m] - t0
            ok = ((a + b) > cut) & ((CELL_U - a + b) > cut) & ((a + CELL_V - b) > cut) & \
                 ((CELL_U - a + CELL_V - b) > cut)
            sh = RNG.uniform(-0.008, 0.008)
            c = np.array([0.050 + sh, 0.052 + sh, 0.108 + sh * 1.5])
            vals = np.where(ok[:, None], c + np.c_[b, b, b] / CELL_V * 0.012, img[m])
            img[m] = vals
            # interconnect dashes along the cell's inner column edge (as in the photos)
            okf = np.zeros_like(m)
            okf[m] = ok
            dash = okf & ((S - s0) < 0.0022) & (((T - t0) % 0.025) < 0.011)
            img[dash] = (0.36, 0.36, 0.39)
    # substrate strips (olive-brown Kapton)
    for t0, t1 in STRIPS_T:
        img[(T >= t0) & (T < t1)] = (0.235, 0.195, 0.105)
    # central harness gap + gold harness lines and tie points
    gap = (S > 1.2105) & (S < 1.2895)
    img[gap] = (0.16, 0.13, 0.07)
    for sl in (1.236, 1.264):
        img[np.abs(S - sl) < 0.0025] = (0.80, 0.62, 0.20)
    for tt in np.arange(0.06, PANEL_W, 0.09):
        img[(np.abs(S - 1.25) < 0.012) & (np.abs(T - tt) < 0.008)] = (0.92, 0.80, 0.30)
    # edges: black frame, gold harness along the short edges with tie points
    img[(S < 0.007) | (S > PANEL_L - 0.007) | (T < 0.006) | (T > PANEL_W - 0.006)] = (0.04, 0.04, 0.045)
    for se in (0.020, PANEL_L - 0.020):
        img[(np.abs(S - se) < 0.0025) & (T > 0.02) & (T < PANEL_W - 0.02)] = (0.80, 0.62, 0.20)
        for tt in np.arange(0.05, PANEL_W - 0.03, 0.085):
            img[(np.abs(S - se) < 0.007) & (np.abs(T - tt) < 0.012)] = (0.93, 0.82, 0.32)
    for te in (0.016, PANEL_W - 0.016):
        img[(np.abs(T - te) < 0.0015) & (S > 0.02) & (S < PANEL_L - 0.02)] = (0.40, 0.31, 0.12)
    # blanks and inserts
    blanks = P2_BLANKS if panel == 2 else []
    inserts = P2_INSERTS if panel == 2 else P1_INSERTS
    for (s0, s1), k in blanks:
        t0, t1 = STRIPS_T[k]
        m = (S >= s0) & (S < s1) & (T >= t0 - 0.004) & (T < t1 + 0.004)
        img[m] = (0.86, 0.87, 0.87)
        img[m & ((((S - s0) % 0.04) < 0.0016))] = (0.70, 0.71, 0.72)
    for sc, k in inserts:
        t0, t1 = STRIPS_T[k]
        d = np.hypot(S - sc, T - (t0 + t1) / 2)
        img[d < 0.024] = (0.78, 0.79, 0.80)
        img[d < 0.016] = (0.33, 0.33, 0.35)
        img[d < 0.008] = (0.60, 0.60, 0.62)
    return img


def tex_solar_front():
    k = 2
    W, H = 1024 * k, 512 * k
    p1 = draw_panel_front(W, H, 1)
    p2 = draw_panel_front(W, H, 2)
    atlas = np.concatenate([p2, p1], 0)       # rows top->bottom; after the flip below: v<0.5 = panel 1
    atlas = downsample(atlas, k)
    return make_image("tex_solar_front_atlas", atlas[::-1])   # flip so row 0 = bottom


def tex_solar_back():
    k = 2
    W, H = 512 * k, 256 * k
    s = (np.arange(W) + 0.5) / W * PANEL_L
    t = (np.arange(H) + 0.5) / H * PANEL_W
    S, T = np.meshgrid(s, t)
    lum = 0.20 + 0.03 * (periodic_noise(H, 24, RNG, W) - 0.5) + 0.015 * (RNG.random((H, W)) - 0.5)
    img = np.stack([lum * 0.95, lum * 0.93, lum * 1.10], -1)
    rng = np.random.default_rng(7)
    for i in range(6):                       # black cable runs with red tie points
        t0 = 0.10 + i * 0.17
        amp = rng.uniform(0.02, 0.06)
        ph = rng.uniform(0, 6.28)
        tc = t0 + amp * np.sin(S * rng.uniform(2.0, 4.0) + ph)
        m = np.abs(T - tc) < 0.004
        img[m] = (0.03, 0.03, 0.035)
        for sd in np.arange(0.1, PANEL_L, 0.16):
            tcd = t0 + amp * np.sin(sd * 3.0 + ph)
            img[np.hypot(S - sd, T - tc) < 0.008] = (0.72, 0.12, 0.08)
    for sc, tc in ((0.55, 0.38), (1.85, 0.70)):    # orange-red connector patches
        m = (np.abs(S - sc) < 0.065) & (np.abs(T - tc) < 0.085)
        img[m] = (0.80, 0.22, 0.10)
        g = m & ((((S - sc) % 0.03) < 0.012) & (((T - tc) % 0.04) < 0.016))
        img[g] = (0.85, 0.65, 0.25)
    for sc, k_ in P1_INSERTS:
        tcen = sum(STRIPS_T[k_]) / 2
        d = np.hypot(S - sc, T - tcen)
        img[d < 0.022] = (0.75, 0.76, 0.78)
        img[d < 0.012] = (0.30, 0.30, 0.32)
    img[(S < 0.006) | (S > PANEL_L - 0.006) | (T < 0.006) | (T > PANEL_W - 0.006)] = (0.04, 0.04, 0.045)
    return make_image("tex_solar_back", downsample(img, k)[::-1])


def tex_sar_disc():
    n = 256
    yy, xx = np.mgrid[0:n, 0:n] + 0.5
    c = n / 2
    r = np.hypot(xx - c, yy - c)
    arr = np.empty((n, n, 3)); arr[:] = (0.90, 0.90, 0.88)
    pitch = 11.0
    row = np.round(yy / (pitch * 0.866))
    xo = xx - (row % 2) * pitch / 2
    hx = xo - np.round(xo / pitch) * pitch
    hy = yy - row * pitch * 0.866
    hole = np.hypot(hx, hy) < 3.0
    cross = (np.abs(xx - c) < 9) | (np.abs(yy - c) < 9)
    arr[hole & ~cross & (r > 24) & (r < 118)] = (0.42, 0.42, 0.42)
    arr[r < 24] = (0.80, 0.80, 0.78)
    arr[(r > 118) & (r < 124)] = (0.78, 0.78, 0.76)
    return make_image("tex_sar_disc", arr)


MLI_IMG, MLI_NRM = tex_mli()
FOIL_IMG, FOIL_NRM = tex_foil()
IMG = {"osr": tex_osr(), "solar_front": tex_solar_front(), "solar_back": tex_solar_back(),
       "sar": tex_sar_disc()}

# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
MATS = {}


def material(name, color=(0.5, 0.5, 0.5), metallic=0.0, roughness=0.5, image=None, normal=None,
             normal_strength=1.0):
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
    MATS[name] = m
    return m


material("mli_black", (0.09, 0.09, 0.10), 0.0, 0.34, MLI_IMG, MLI_NRM, 1.0)
material("osr_radiator", (0.86, 0.87, 0.90), 0.75, 0.16, IMG["osr"])
material("ge_kapton_foil", (0.80, 0.80, 0.82), 0.70, 0.30, FOIL_IMG, FOIL_NRM, 0.55)
material("solar_cells", (0.06, 0.06, 0.12), 0.0, 0.14, IMG["solar_front"])
material("panel_back_cfrp", (0.20, 0.19, 0.22), 0.15, 0.55, IMG["solar_back"])
material("panel_edge", (0.05, 0.05, 0.055), 0.2, 0.5)
material("yoke_orange", (0.90, 0.58, 0.14), 0.15, 0.42)
material("gold_kapton", (0.85, 0.63, 0.25), 1.0, 0.32)
material("gold_flex", (0.88, 0.70, 0.30), 0.9, 0.35)
material("aluminium", (0.78, 0.78, 0.80), 1.0, 0.35)
material("titanium_grey", (0.55, 0.55, 0.57), 1.0, 0.40)
material("bronze_anodised", (0.62, 0.48, 0.28), 0.8, 0.40)
material("white_paint", (0.90, 0.90, 0.88), 0.0, 0.50)
material("black_paint", (0.05, 0.05, 0.05), 0.0, 0.60)
material("lrr_cube_glass", (0.42, 0.46, 0.52), 0.9, 0.08)
material("lrr_holder", (0.86, 0.86, 0.88), 0.6, 0.30)
material("sar_disc_white", (0.90, 0.90, 0.88), 0.0, 0.50, IMG["sar"])
material("hdrm_orange", (0.78, 0.38, 0.16), 0.5, 0.45)

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
    return u, w.cross(u), w


FACE_DEF = {
    "-x": [(0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)], "+x": [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)],
    "-y": [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)], "+y": [(0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)],
    "-z": [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], "+z": [(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)],
}
FACE_N = {"-x": (-1, 0, 0), "+x": (1, 0, 0), "-y": (0, -1, 0), "+y": (0, 1, 0), "-z": (0, 0, -1), "+z": (0, 0, 1)}


def box(part, c, s, mats, uv="fit", tile=1.0, skip=(), uvmap=None):
    """uvmap: optional {face_key: f(u_fit, v_fit) -> (u, v)}"""
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
                uu, vv = (v.co[t1] - lo[t1]) / s[t1], (v.co[t2] - lo[t2]) / s[t2]
                if uvmap and key in uvmap:
                    uu, vv = uvmap[key](uu, vv)
                uvs[v] = (uu, vv)
            else:
                uvs[v] = (v.co[t1] / tile, v.co[t2] / tile)
        mname = mats if isinstance(mats, str) else mats.get(key, mats.get("default"))
        part.face(vs, mname, uvs, FACE_N[key])


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
        if not cap:
            continue
        ctr = base + (w * length if nrm is w else Vector())
        Vt = part.verts([ctr + d * rr for d in dirs])
        uvs = {Vt[i]: (0.5 + 0.5 * math.cos(angs[i]), 0.5 + 0.5 * math.sin(angs[i])) for i in range(segs)}
        part.face(Vt, mat, uvs, nrm)


def lathe(part, base, axis, profile, segs, mname, uv_r):
    """Revolve profile [(r, h), ...] (outer edge first, ending at r=0) about axis; planar UVs."""
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
    xs = [p[0] for p in pts2d]; ys = [p[1] for p in pts2d]
    sx, sy = max(xs) - min(xs), max(ys) - min(ys)
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
        rings.append(part.verts([c + (b1 * math.cos(2 * math.pi * s / sides) + b2 * math.sin(2 * math.pi * s / sides))
                                 * tube_r for s in range(sides)]))
        centres.append(c)
    for k in range(n - 1):
        for s in range(sides):
            s2 = (s + 1) % sides
            vs = [rings[k][s], rings[k][s2], rings[k + 1][s2], rings[k + 1][s]]
            cen = sum((x.co for x in vs), Vector()) / 4
            part.face(vs, mname, {x: (0.5, 0.5) for x in vs}, cen - (centres[k] + centres[k + 1]) / 2, True)


def bar(part, a, b, width, thick, mname, wdir):
    """Rectangular bar from a to b; width along wdir (projected perpendicular to the bar)."""
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
# Bus: black MLI box with soft (bevelled) edges; seams/tape/buttons/wrinkles via textures
# --------------------------------------------------------------------------------------
p = Part("bus")
bmesh.ops.create_cube(p.bm, size=1.0)
for vt in p.bm.verts:
    vt.co = Vector((vt.co.x * BUS[0], vt.co.y * BUS[1], vt.co.z * BUS[2]))
bmesh.ops.bevel(p.bm, geom=list(p.bm.verts) + list(p.bm.edges), offset=0.022, segments=3,
                profile=0.5, affect="EDGES")
mi = p.mi("mli_black")
for f in p.bm.faces:
    f.material_index = mi
    f.smooth = True
    f.normal_update()
    n = f.normal
    ax = max(range(3), key=lambda i: abs(n[i]))
    t1, t2 = [a for a in range(3) if a != ax]
    for loop in f.loops:
        loop[p.uv].uv = ((loop.vert.co[t1] + 0.07) / MLI_TILE, (loop.vert.co[t2] + 0.11) / MLI_TILE)
# raised MLI blanket boxes over units (photos: -Y/+Y upper band, -X face)
for sgn in (1, -1):
    box(p, (0.03, sgn * (HY + 0.012), 0.43), (0.78, 0.024, 0.20), "mli_black", uv="tile", tile=MLI_TILE)
box(p, (-HX - 0.015, -0.20, 0.05), (0.03, 0.42, 0.38), "mli_black", uv="tile", tile=MLI_TILE)
finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Radiators (OSR, GSC material "C"); areas official, layout est./photo
# --------------------------------------------------------------------------------------
p = Part("radiators_osr")
TO, OFF, TILE_OSR = 0.004, 0.002, 0.16
osr = {"default": "osr_radiator"}
for sgn, (x0, x1, z0, z1) in ((1, (-0.80, 1.20, -0.50, 0.327)), (-1, (-0.72, 1.20, -0.50, 0.30))):
    box(p, ((x0 + x1) / 2, sgn * (HY + OFF + TO / 2), (z0 + z1) / 2), (x1 - x0, TO, z1 - z0), osr,
        uv="tile", tile=TILE_OSR)          # +Y 1.654 m2, -Y 1.536 m2 (GSC 1.654 / 1.539)
box(p, (HX + OFF + TO / 2, 0.0, 0.02), (TO, 0.90, 0.98), osr, uv="tile", tile=TILE_OSR)    # +X 0.882 (0.880)
box(p, (0.76, 0.0, -(HZ + OFF + TO / 2)), (0.92, 1.04, TO), osr, uv="tile", tile=TILE_OSR)  # -Z 0.957 (0.959)
finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# L-band navigation antenna: drum wrapped in crumpled Ge-Kapton sunshield (flight config)
# --------------------------------------------------------------------------------------
p = Part("nav_antenna")
base = (ARP.x, ARP.y, HZ)
prof = [(0.615, 0.0), (0.640, 0.010), (0.646, 0.040), (0.644, 0.090), (0.632, 0.118),
        (0.605, 0.130), (0.50, 0.134), (0.32, 0.137), (0.14, 0.139), (0.0, 0.140)]
lathe(p, base, (0, 0, 1), prof, 96, "ge_kapton_foil", 0.66)
cylinder(p, base, (0, 0, 1), 0.625, 0.012, 96, "mli_black", side_tile=MLI_TILE)
finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Search-and-rescue antenna: elongated hexagonal foil-wrapped plate, 6 gold UHF helix cages,
# white perforated centre element with a crossed feed
# --------------------------------------------------------------------------------------
p = Part("sar_antenna")
c0 = Vector((SAR_C.x, SAR_C.y, HZ))
prism(p, c0, (0, 0, 1), SAR_PLATE, 0.028, "ge_kapton_foil", "ge_kapton_foil", uhint=(1, 0, 0))
inset = [(x * 0.93, y * 0.95) for x, y in SAR_PLATE]
prism(p, c0 + Vector((0, 0, 0.028)), (0, 0, 1), inset, 0.008, "ge_kapton_foil", "ge_kapton_foil", uhint=(1, 0, 0))
ztop = HZ + 0.036
cylinder(p, (SAR_C.x, 0, ztop), (0, 0, 1), 0.18, 0.012, 48, "white_paint", top="sar_disc_white", uhint=(1, 0, 0))
cylinder(p, (SAR_C.x, 0, ztop + 0.012), (0, 0, 1), 0.022, 0.06, 12, "gold_kapton", top="gold_kapton")
for ang in (0, 90):
    a = math.radians(ang)
    d = Vector((math.cos(a), math.sin(a), 0))
    bar(p, Vector((SAR_C.x, 0, ztop + 0.065)) - d * 0.06, Vector((SAR_C.x, 0, ztop + 0.065)) + d * 0.06,
        0.012, 0.006, "gold_kapton", (0, 0, 1))
for hx_, hy_ in SAR_HELIX:
    hc = Vector((SAR_C.x + hx_, SAR_C.y + hy_, ztop))
    cylinder(p, hc, (0, 0, 1), 0.055, 0.022, 16, "gold_kapton", top="gold_kapton")
    helix(p, hc + Vector((0, 0, 0.022)), (0, 0, 1), 0.046, 0.115, 2.5, 0.0055, 24, 6, "gold_kapton",
          phase=math.atan2(hy_, hx_))
    for q in range(4):
        b_ = q * math.pi / 2 + 0.4
        pc = hc + Vector((0.050 * math.cos(b_), 0.050 * math.sin(b_), 0.022))
        cylinder(p, pc, (0, 0, 1), 0.004, 0.12, 4, "gold_kapton", smooth=False)
    cylinder(p, hc + Vector((0, 0, 0.142)), (0, 0, 1), 0.052, 0.008, 16, "gold_kapton", top="gold_kapton")
finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Laser retro-reflector array: 60 CCRs in silver hexagonal holders, staggered 6 x 10
# --------------------------------------------------------------------------------------
p = Part("lrr")
lx, ly, lz = LRR_SIZE
box(p, (LRR_REF.x, LRR_REF.y, HZ + 0.010), (lx + 0.02, ly + 0.02, 0.020), "aluminium")
pitch_x = lx / 6.25
hexr = pitch_x / math.sqrt(3) * 0.97
pitch_y = ly / 10
for j in range(10):
    for i in range(6):
        cx = LRR_REF.x - lx / 2 + (i + 0.5) * pitch_x + (pitch_x / 2 if j % 2 else 0.0)
        cy = LRR_REF.y - ly / 2 + (j + 0.5) * pitch_y
        hexo = [(hexr * math.cos(math.radians(60 * k + 90)), hexr * math.sin(math.radians(60 * k + 90))) for k in range(6)]
        hexi = [(x * 0.78, y * 0.78) for x, y in hexo]
        prism(p, (cx, cy, HZ + 0.02), (0, 0, 1), hexo, lz - 0.02, "lrr_holder", None, uhint=(1, 0, 0))
        prism(p, (cx, cy, HZ + lz - 0.006), (0, 0, 1), hexi, 0.0055, "lrr_holder", "lrr_cube_glass", uhint=(1, 0, 0))
finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Small equipment (positions measured on the Phenix photo where visible, else est.)
# --------------------------------------------------------------------------------------
p = Part("sband_antenna_+Z")
d45 = Vector((-math.sin(math.radians(45)), 0, math.cos(math.radians(45))))
sb = Vector((-1.20, 0.23, HZ))
box(p, (sb.x, sb.y, HZ + 0.03), (0.12, 0.12, 0.06), "black_paint")
cylinder(p, sb + Vector((0, 0, 0.05)), d45, 0.055, 0.20, 24, "gold_kapton", top="white_paint")
cylinder(p, sb + Vector((0, 0, 0.05)) + d45 * 0.06, d45, 0.058, 0.02, 24, "aluminium")
finish(p, ROOTOBJ)

p = Part("sband_antenna_-Z")
sb = Vector((-1.12, -0.23, -HZ))
box(p, (sb.x, sb.y, -HZ - 0.015), (0.10, 0.10, 0.03), "black_paint")
cylinder(p, sb + Vector((0, 0, -0.03)), (0, 0, -1), 0.050, 0.07, 24, "gold_kapton", top="white_paint")
finish(p, ROOTOBJ)

p = Part("cband_antenna")
cb = Vector((-1.06, -0.42, HZ))
cylinder(p, cb, (0, 0, 1), 0.045, 0.04, 20, "black_paint", top="black_paint")
cylinder(p, cb + Vector((0, 0, 0.04)), (0, 0, 1), 0.045, 0.09, 24, "black_paint", top="titanium_grey", r1=0.065)
finish(p, ROOTOBJ)

p = Part("earth_sensor")
box(p, (-0.87, 0.485, HZ + 0.05), (0.20, 0.13, 0.10), "mli_black", uv="tile", tile=MLI_TILE)
cylinder(p, (-0.82, 0.485, HZ + 0.10), (0, 0, 1), 0.035, 0.02, 20, "titanium_grey", top="black_paint")
finish(p, ROOTOBJ)

p = Part("sun_sensors")
box(p, (-1.01, 0.52, HZ + 0.03), (0.09, 0.09, 0.06), "black_paint")         # +Z, -X/+Y corner (Phenix)
cylinder(p, (-1.01, 0.52, HZ + 0.06), (0, 0, 1), 0.022, 0.006, 20, "titanium_grey", top="lrr_cube_glass")
box(p, (0.40, 0.45, HZ + 0.025), (0.08, 0.08, 0.05), "black_paint")           # between nav and SAR (Phenix)
box(p, (0.40, 0.45, HZ + 0.051), (0.03, 0.05, 0.003), "white_paint")
for sy, sz in ((0.30, 0.30), (0.12, 0.22)):                                   # -X face, white CSS (TVAC photo)
    box(p, (-HX - 0.012, sy, sz), (0.024, 0.075, 0.075), "white_paint")
finish(p, ROOTOBJ)

p = Part("egse_connector_panel")
box(p, (0.43, -0.42, HZ + 0.01), (0.10, 0.13, 0.02), "titanium_grey")
for k in range(6):
    cylinder(p, (0.41 + 0.04 * (k % 2), -0.46 + 0.035 * (k // 2), HZ + 0.02), (0, 0, 1), 0.008, 0.006, 8,
             "black_paint", top="black_paint")
finish(p, ROOTOBJ)

p = Part("thrusters")
for sy in (0.48, -0.48):
    for sz in (0.42, -0.42):
        d = Vector((-1.0, 0.25 * math.copysign(1, sy), 0.25 * math.copysign(1, sz))).normalized()
        b0 = Vector((-HX, sy, sz))
        cylinder(p, b0, d, 0.018, 0.04, 12, "titanium_grey", top="titanium_grey")
        cylinder(p, b0 + d * 0.04, d, 0.012, 0.05, 12, "titanium_grey", r1=0.026, top="black_paint")
finish(p, ROOTOBJ)

p = Part("launcher_interface")
for ix in (gsc(-805, 0, 0).x, gsc(805, 0, 0).x):
    for iy in (0.52, -0.52):
        box(p, (ix, iy, -HZ - 0.02), (0.12, 0.10, 0.04), "aluminium")
finish(p, ROOTOBJ)

p = Part("hold_down_points")
for sgn in (1, -1):
    for hx_ in (-0.75, 0.39, 1.10):            # -0.75 / +0.39 measured (2013 photo), +1.10 est.
        for hz_ in (0.33, -0.35):              # measured
            cylinder(p, (hx_, sgn * HY, hz_), (0, sgn, 0), 0.045, 0.025, 16, "hdrm_orange", top="bronze_anodised")
            cylinder(p, (hx_, sgn * (HY + 0.025), hz_), (0, sgn, 0), 0.015, 0.02, 8, "titanium_grey", top="titanium_grey")
finish(p, ROOTOBJ)

for sgn, tag in ((1, "+Y"), (-1, "-Y")):
    p = Part("sadm_" + tag)
    cylinder(p, (SADM_X, sgn * HY, SADM_Z), (0, sgn, 0), SADM_R + 0.04, 0.015, 32, "mli_black",
             top="mli_black", side_tile=MLI_TILE)
    cylinder(p, (SADM_X, sgn * (HY + 0.015), SADM_Z), (0, sgn, 0), SADM_R, SADM_LEN - 0.035, 32,
             "titanium_grey", top="titanium_grey")
    cylinder(p, (SADM_X, sgn * (HY + SADM_LEN - 0.02), SADM_Z), (0, sgn, 0), SADM_R * 0.8, 0.02, 32,
             "bronze_anodised", top="bronze_anodised")
    finish(p, ROOTOBJ)

# --------------------------------------------------------------------------------------
# Solar wings (measured): root hinge + single flat orange yoke bar + T crossbar + hinge
# fitting + gold flex harness; 2 panels 2.5 x 1.082 m with a 75 mm hinge gap.
# Default pose: cell side faces -X (= +X_IGS, Sun side); node origin on the SADM axis.
# --------------------------------------------------------------------------------------
for sgn, tag in ((1, "+Y"), (-1, "-Y")):
    p = Part("solar_wing_" + tag)
    Y = lambda y: sgn * y
    y_root0 = HY + SADM_LEN
    y_root1 = y_root0 + ROOT_LEN
    # root hinge bracket (bronze) with two spring/damper canisters
    box(p, (SADM_X, Y((y_root0 + y_root1) / 2), SADM_Z), (0.05, ROOT_LEN, 0.16), "bronze_anodised")
    for zz in (0.075, -0.075):
        cylinder(p, (SADM_X - 0.04, Y(y_root0 + 0.06), zz), (0, 0, 1 if zz > 0 else -1), 0.035, 0.07, 16,
                 "aluminium", top="titanium_grey")
    # yoke bar: flat, 85 mm wide (in the wing plane, along Z), orange
    y_t = WING_IN - 0.12                        # T crossbar centre line
    bar(p, (SADM_X, Y(y_root1 - 0.01), SADM_Z), (SADM_X, Y(y_t - T_W / 2), SADM_Z), BAR_W, BAR_T, "yoke_orange",
        (0, 0, 1))
    for yy in (y_root1 + 0.06, y_t - T_W / 2 - 0.07):          # bolted grey splice plates
        box(p, (SADM_X - BAR_T / 2 - 0.002, Y(yy), SADM_Z), (0.006, 0.11, BAR_W + 0.01), "titanium_grey")
    # T crossbar: flat tapered plate along Z
    plate = [(-T_W / 2, T_LEN * 0.18), (-T_W * 0.32, T_LEN / 2), (T_W * 0.32, T_LEN / 2), (T_W / 2, T_LEN * 0.18),
             (T_W / 2, -T_LEN * 0.18), (T_W * 0.32, -T_LEN / 2), (-T_W * 0.32, -T_LEN / 2), (-T_W / 2, -T_LEN * 0.18)]
    plate2 = [(sgn * a, b) for a, b in plate]
    prism(p, (SADM_X - 0.012, Y(y_t), SADM_Z), (1, 0, 0), plate2, 0.024, "yoke_orange", "yoke_orange",
          "yoke_orange", uhint=(0, 1, 0))
    # hinge fitting T -> panel: grey block + two silver spring units
    box(p, (SADM_X, Y((y_t + WING_IN) / 2 + 0.01), SADM_Z), (0.05, WING_IN - y_t - 0.02, 0.12), "titanium_grey")
    for zz in (0.045, -0.045):
        cylinder(p, (SADM_X - 0.03, Y(WING_IN - 0.06), zz), (0, sgn, 0), 0.022, 0.05, 12, "aluminium",
                 top="aluminium")
    # gold flex harness straps: crossbar -> panel edge (2 groups of 3)
    for zc in (0.22, -0.22):
        for k in range(3):
            zz = zc + (k - 1) * 0.03
            box(p, (SADM_X - 0.016, Y((y_t + T_W / 2 + WING_IN) / 2), zz),
                (0.004, WING_IN - y_t - T_W / 2 + 0.01, 0.022), "gold_flex")
    # panels (front atlas: v 0..0.5 = inner panel 1, v 0.5..1 = outer panel 2; t = 0 at the +Z edge)
    mats = {"-x": "solar_cells", "+x": "panel_back_cfrp", "default": "panel_edge"}
    for k in range(2):
        y0 = WING_IN + k * (PANEL_L + PANEL_GAP)
        vo = 0.0 if k == 0 else 0.5
        def fmap(uu, vv, vo=vo):
            uu = uu if sgn > 0 else 1.0 - uu       # u = 0 at the panel's inner end on both wings
            return uu, vo + 0.5 * vv
        def bmap(uu, vv):
            uu = uu if sgn > 0 else 1.0 - uu
            return uu, vv
        box(p, (SADM_X, Y(y0 + PANEL_L / 2), SADM_Z), (PANEL_T, PANEL_L, PANEL_W), mats, uv="fit",
            uvmap={"-x": fmap, "+x": bmap})
    # inter-panel hinges (2 near the centre line) + gold flex straps at +/-0.15 m
    yh = WING_IN + PANEL_L + PANEL_GAP / 2
    for zz in (0.045, -0.045):
        box(p, (SADM_X, Y(yh), zz), (0.04, PANEL_GAP + 0.06, 0.035), "titanium_grey")
        cylinder(p, (SADM_X - 0.02, Y(yh), zz - 0.02), (0, 0, 1), 0.012, 0.04, 10, "aluminium", top="aluminium")
    for zc in (0.15, -0.15):
        for k in range(3):
            box(p, (SADM_X - 0.016, Y(yh), zc + (k - 1) * 0.022), (0.004, PANEL_GAP + 0.05, 0.016), "gold_flex")
    # tip snubber bracket (gold anodised) at the outer edge centre
    box(p, (SADM_X, Y(WING_TIP + 0.02), SADM_Z), (0.03, 0.04, 0.16), "bronze_anodised")
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
print("WING_IN", round(WING_IN, 4), "WING_TIP", round(WING_TIP, 4), "SPAN", round(2 * WING_TIP, 3))

glb = os.path.join(ROOT, "galileo_foc.glb")
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB")
print("EXPORTED", glb, os.path.getsize(glb))

if not args.render:
    sys.exit(0)

# --------------------------------------------------------------------------------------
# Renders
# --------------------------------------------------------------------------------------
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_setup  # noqa: E402

render_setup.setup(scene, args.samples)
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
    "06_yoke_closeup": dict(target=(0.1, -1.5, 0.0), direction=(-0.75, -0.35, 0.40), dist=4.2, lens=45,
                            sun_from=(-0.7, -0.3, 0.6)),
    "07_wing_back": dict(target=(0.0, 3.5, 0.0), direction=(0.85, 0.25, 0.30), dist=13.0, lens=45,
                         sun_from=(0.6, 0.3, 0.7)),
}
sel = list(VIEWS) if args.views == "all" else [v for v in VIEWS if any(v.startswith(s) for s in args.views.split(","))]
for nm in sel:
    render_setup.view(scene, os.path.join(ROOT, "renders", nm + args.tag + ".png"), **VIEWS[nm])
