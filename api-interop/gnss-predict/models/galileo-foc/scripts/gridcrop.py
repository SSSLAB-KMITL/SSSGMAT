"""Crop a reference photo and overlay a labelled pixel grid (full-res image coords, origin top-left).

Blender -b --factory-startup -P scripts/gridcrop.py -- IN OUT x0 y0 w h out_w step
Reads the image only as pixel data (analysis aid; output is never used in the model).
"""
import sys

import bpy
import numpy as np

a = sys.argv[sys.argv.index("--") + 1:]
src, dst = a[0], a[1]
x0, y0, w, h, out_w, step = (int(v) for v in a[2:8])

img = bpy.data.images.load(src)
W, H = img.size
px = np.empty(W * H * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(H, W, 4)[::-1]          # now row 0 = top
crop = px[y0:y0 + h, x0:x0 + w, :3].copy()
h, w = crop.shape[:2]
sc = out_w / w
out_h = int(round(h * sc))
yi = np.clip((np.arange(out_h) / sc).astype(int), 0, h - 1)
xi = np.clip((np.arange(out_w) / sc).astype(int), 0, w - 1)
out = crop[yi][:, xi]

FONT = {
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
}


def text(img_, s, x, y, k=3, col=(1, 1, 0)):
    for ci, ch in enumerate(s):
        rows = FONT[ch]
        for r, row in enumerate(rows):
            for c, bit in enumerate(row):
                if bit == "1":
                    yy, xx = y + r * k, x + (ci * 4 + c) * k
                    img_[max(0, yy):yy + k, max(0, xx):xx + k] = (0, 0, 0)
    for ci, ch in enumerate(s):
        rows = FONT[ch]
        for r, row in enumerate(rows):
            for c, bit in enumerate(row):
                if bit == "1":
                    yy, xx = y + r * k + 1, x + (ci * 4 + c) * k + 1
                    img_[max(0, yy):yy + k - 1, max(0, xx):xx + k - 1] = col


first_x = ((x0 + step - 1) // step) * step
for gx in range(first_x, x0 + w, step):
    c = int(round((gx - x0) * sc))
    major = gx % (step * 5) == 0
    out[:, c:c + (2 if major else 1)] = (1, 0.1, 0.1) if major else (1, 0.5, 0.2)
    if major or step >= 50:
        text(out, str(gx), c + 3, 3)
first_y = ((y0 + step - 1) // step) * step
for gy in range(first_y, y0 + h, step):
    r = int(round((gy - y0) * sc))
    major = gy % (step * 5) == 0
    out[r:r + (2 if major else 1), :] = (0.1, 0.6, 1) if major else (0.3, 0.8, 1)
    if major or step >= 50:
        text(out, str(gy), 3, r + 3, col=(0.4, 1, 1))

oi = bpy.data.images.new("out", out_w, out_h, alpha=False)
rgba = np.ones((out_h, out_w, 4), dtype=np.float32)
rgba[..., :3] = out[::-1]
oi.pixels.foreach_set(rgba.ravel())
oi.filepath_raw = dst
oi.file_format = "PNG"
oi.save()
print("WROTE", dst, out_w, out_h)
