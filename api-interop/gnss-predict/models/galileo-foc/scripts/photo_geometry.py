"""Shared photo geometry: measured image points + pinhole pose solver (numpy only).

All pixel coordinates are full-resolution image px, origin top-left, read off gridded
crops made with scripts/gridcrop.py.  Focal lengths from EXIF (Nikon D4, 36 x 24 mm).
"""
import numpy as np

IMG_W, IMG_H = 4928, 3280


def f_px(focal_mm):
    return focal_mm / 36.0 * IMG_W


PANEL_W = 1.082   # GSC

# --- refs/esa_wing_deploy.jpg (ESTEC 2013, 24 mm): -Y wing, cell side, bus on the left ----
WD_FOCAL = 24.0
WD_PTS = {  # (s, t) on the wing plane [m] -> (u, v) px.  s from inner edge, t from top edge
    "A_inner_top": ((0.00, 0.0), (1622, 1749)),
    "B_inner_bot": ((0.00, PANEL_W), (1598, 2333)),
    "D_hinge_top": ((2.50, 0.0), (2200, 1375)),
    "C_hinge_bot": ((2.50, PANEL_W), (2214, 2234)),
    "E_tip_top": ((5.075, 0.0), (4030, 205)),
    "F_tip_bot": ((5.075, PANEL_W), (4278, 1982)),
}
WD_ROOT_HINGE_PX = (1410, 2080)      # yoke root hinge / spring units next to the SADM
WD_YOKE_AT_PANEL_PX = (1603, 2016)
WD_BUS_LEFT_TOP_PX = (817, 1846)     # bus -X/-Y/+Z edge (top of the -Y face, -X end)
WD_BUS_LEFT_BOT_PX = (817, 2346)     # bus -X/-Y/-Z edge
WD_BUS_FACE_PX_PER_M = 500.0 / 1.100

# --- refs/esa_phenix.jpg (2013, 24 mm): +Z face nearly frontal, +X right, +Y up ----------
PH_FOCAL = 24.0
PH_FACE_PX_PER_M = 1155.0            # +Z face plane scale (2.53 m -> ~2891 px, 1.2 m -> ~1406 px)
PH_FACE_MINUS_X_END_U = 1684         # -X end of the face
PH_FACE_CENTRE_V = 1123              # Y = 0 line
# --- refs/esa_side_view_wing.jpg (2017, 27 mm): -Y wing frontal, cell side --------------
SV_FOCAL = 27.0
SV_SCALE_PX_PER_M = 774.0            # panel 1: 2.5 m -> 1936 px at the wing plane
SV_PANEL1_INNER_U = 637              # inner edge of panel 1
SV_PANEL_CENTRE_V = 1936             # panel centre line


def rodrigues(r):
    th = np.linalg.norm(r)
    if th < 1e-12:
        return np.eye(3)
    k = r / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(th) * K + (1 - np.cos(th)) * K @ K


def solve_plane_pose(st, uv, F):
    """Pose of a planar target (points (s,t,0)) for a centred pinhole camera with focal F px.
    Returns R (3x3), t (3,), per-point reprojection error.  Camera frame: x right, y down, z fwd."""
    CX, CY = IMG_W / 2.0, IMG_H / 2.0
    st = np.asarray(st, float)
    uv = np.asarray(uv, float)

    def project(p):
        R = rodrigues(p[:3])
        P = np.c_[st, np.zeros(len(st))]
        C = P @ R.T + p[3:]
        return np.stack([F * C[:, 0] / C[:, 2] + CX, F * C[:, 1] / C[:, 2] + CY], 1)

    xn = (uv - [CX, CY]) / F
    A = []
    for (s, t_), (x, y) in zip(st, xn):
        A.append([s, t_, 1, 0, 0, 0, -x * s, -x * t_, -x])
        A.append([0, 0, 0, s, t_, 1, -y * s, -y * t_, -y])
    H = np.linalg.svd(np.array(A))[2][-1].reshape(3, 3)
    lam = 1.0 / np.linalg.norm(H[:, 0])
    if (H[:, 2] * lam)[2] < 0:
        lam = -lam
    r1, r2, tt = H[:, 0] * lam, H[:, 1] * lam, H[:, 2] * lam
    U, _, Vt = np.linalg.svd(np.stack([r1, r2, np.cross(r1, r2)], 1))
    R = U @ Vt
    ang = np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))
    rv = np.zeros(3) if ang < 1e-9 else ang / (2 * np.sin(ang)) * np.array(
        [R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])
    p = np.concatenate([rv, tt])
    for _ in range(200):
        res = (project(p) - uv).ravel()
        J = np.zeros((len(res), 6))
        for k in range(6):
            dp = np.zeros(6)
            dp[k] = 1e-6
            J[:, k] = ((project(p + dp) - uv).ravel() - res) / 1e-6
        step = np.linalg.lstsq(J, -res, rcond=None)[0]
        p = p + step
        if np.linalg.norm(step) < 1e-10:
            break
    err = np.sqrt(((project(p) - uv) ** 2).sum(1))
    return rodrigues(p[:3]), p[3:], err


def ray(px, F):
    d = np.array([(px[0] - IMG_W / 2.0) / F, (px[1] - IMG_H / 2.0) / F, 1.0])
    return d / np.linalg.norm(d)


def project_cam(Pc, F):
    Pc = np.atleast_2d(Pc)
    return np.stack([F * Pc[:, 0] / Pc[:, 2] + IMG_W / 2.0, F * Pc[:, 1] / Pc[:, 2] + IMG_H / 2.0], 1)
