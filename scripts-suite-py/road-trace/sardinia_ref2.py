"""Wider Sardinia crop: all regions, all settlements/ports, land mask."""
import numpy as np
from PIL import Image

TGA = r"C:\RIS\RIS\data\world\maps\base\map_regions.tga"
OUT = r"C:\Users\vtarn\AppData\Local\Temp\claude\C--Users-vtarn-OneDrive-Skrivbord\6fd4885d-f016-48c8-bf38-a20b78536fc3\scratchpad"

a = np.array(Image.open(TGA).convert("RGB"))
x0, y0, x1, y1 = 215, 296, 280, 360
crop = a[y0:y1, x0:x1].copy()
sea = (np.all(crop == (41, 140, 232), axis=-1)) | (np.all(crop == (41, 140, 233), axis=-1))
print("distinct colors and counts:")
cols, counts = np.unique(crop.reshape(-1, 3), axis=0, return_counts=True)
for c, n in sorted(zip(cols.tolist(), counts.tolist()), key=lambda t: -t[1]):
    tag = "SEA" if tuple(c) in ((41,140,232),(41,140,233)) else ("SETTLEMENT" if tuple(c)==(0,0,0) else ("PORT" if tuple(c)==(255,255,255) else ""))
    print(c, n, tag)
print()
for tag, col in [("settlement", (0,0,0)), ("port", (255,255,255))]:
    yy, xx = np.nonzero(np.all(crop == col, axis=-1))
    for y, x in zip(yy, xx):
        print(tag, "at map", (x0 + x, y0 + y))

S = 10
up = np.kron(crop, np.ones((S, S, 1), dtype=np.uint8))
# mark 5-map-px grid lines faintly for coordinate reading
for gx in range(0, x1 - x0):
    if (x0 + gx) % 5 == 0: up[:, gx * S] = np.minimum(255, up[:, gx * S].astype(int) + 60).astype(np.uint8)
for gy in range(0, y1 - y0):
    if (y0 + gy) % 5 == 0: up[gy * S] = np.minimum(255, up[gy * S].astype(int) + 60).astype(np.uint8)
sy, sx = np.nonzero(np.all(crop == (0, 0, 0), axis=-1))
for yy, xx in zip(sy, sx):
    up[yy*S:(yy+1)*S, xx*S:(xx+1)*S] = (255, 0, 0)
py, px = np.nonzero(np.all(crop == (255, 255, 255), axis=-1))
for yy, xx in zip(py, px):
    up[yy*S:(yy+1)*S, xx*S:(xx+1)*S] = (255, 255, 0)
Image.fromarray(up).save(OUT + r"\sardinia_ref2.png")
print("saved sardinia_ref2.png  origin", (x0, y0), "scale", S, " (5px grid brightened)")
