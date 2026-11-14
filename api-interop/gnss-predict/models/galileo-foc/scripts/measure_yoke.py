"""Measure the Galileo FOC yoke from refs/esa_wing_deploy.jpg (ESA/ESTEC 2013, 24 mm, f=3285 px).

Method: solve the pose of the deployed -Y wing (a known 1.082 m wide plane, panels 2.5 m,
hinge gap 0.075 m) from its corners, then intersect the camera ray through the yoke root
hinge with the wing centre line.  Cross-check: the depth this gives must equal the depth of
the bus face implied by its own pixel scale (1.100 m tall face).
Run: Blender -b --factory-startup -P scripts/measure_yoke.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import photo_geometry as pg  # noqa: E402

F = pg.f_px(pg.WD_FOCAL)
for names in (["A_inner_top", "B_inner_bot", "D_hinge_top", "C_hinge_bot"], list(pg.WD_PTS)):
    st = [pg.WD_PTS[n][0] for n in names]
    uv = [pg.WD_PTS[n][1] for n in names]
    R, t, err = pg.solve_plane_pose(st, uv, F)
    s_axis = R[:, 0]
    mid_in = R @ np.array([0.0, pg.PANEL_W / 2, 0]) + t
    d = pg.ray(pg.WD_ROOT_HINGE_PX, F)
    a, b = np.linalg.lstsq(np.stack([s_axis, -d], 1), -mid_in, rcond=None)[0]
    miss = np.linalg.norm(mid_in + a * s_axis - b * d)
    n = R[:, 2]
    d2 = pg.ray(pg.WD_YOKE_AT_PANEL_PX, F)
    q = ((n @ t) / (n @ d2)) * d2
    loc = R.T @ (q - t)
    print("\nfit on %d points: reprojection error px %s" % (len(names), np.round(err, 1)))
    print("  inner panel edge depth %.2f m; wing axis %.1f deg from optical axis"
          % (mid_in[2], np.degrees(np.arccos(abs(s_axis[2])))))
    print("  yoke root hinge -> inner panel edge along wing axis: %.3f m (ray miss %.3f m)" % (-a, miss))
    print("  root hinge depth %.2f m  vs  bus-face depth from its pixel scale %.2f m"
          % (b * d[2], F / pg.WD_BUS_FACE_PX_PER_M))
    print("  yoke meets panel at s=%.3f, t=%.3f (centre line t=%.3f)" % (loc[0], loc[1], pg.PANEL_W / 2))
