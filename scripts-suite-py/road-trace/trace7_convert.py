"""Convert hand-traced screenshot road waypoints to map_regions pixel space.

MLS (affine moving-least-squares) warp from shot->map, anchored on 4 certain
town pairs (heavy weight) + coastline ICP correspondences (from the affine fit).
Terminal endpoints snapped to exact settlement/port map pixels.
Output: traced road polylines + rasterized trench cells (JSON).
"""
import json
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

SHOT = r"C:\Users\vtarn\OneDrive\Skrivbord\images\Skärmbild 2026-07-19 002514.png"
TGA = r"C:\RIS\RIS\data\world\maps\base\map_regions.tga"
OUT = r"C:\Users\vtarn\AppData\Local\Temp\claude\C--Users-vtarn-OneDrive-Skrivbord\6fd4885d-f016-48c8-bf38-a20b78536fc3\scratchpad"

# ---------------- final road waypoints (shot px) ----------------
ROADS = {
    # name: (waypoints, snap_start_map, snap_end_map)  — snap=None keeps MLS result
    "north_to_J1":   ([(535, 92), (520, 100), (508, 108), (498, 120), (488, 134),
                       (478, 148), (468, 161), (459, 172), (452, 180)],
                      (248.5, 304.5), None),
    "J1_to_neast":   ([(452, 180), (467, 182), (482, 184), (497, 187), (512, 185),
                       (528, 182), (545, 180), (562, 178), (580, 175), (597, 172),
                       (612, 169), (624, 164), (632, 170)],
                      None, (251.5, 307.5)),
    "J1_to_cornus":  ([(452, 180), (435, 186), (420, 189), (405, 191), (390, 210),
                       (375, 217), (355, 222), (335, 228), (315, 233), (300, 239),
                       (287, 245), (277, 253), (269, 263), (262, 276), (256, 289),
                       (250, 301), (245, 313), (239, 326), (233, 339), (225, 352),
                       (219, 368), (214, 385), (209, 402), (208, 418), (211, 432),
                       (215, 448), (210, 462), (206, 480), (205, 495)],
                      None, (240.5, 319.5)),
    "cornus_to_J2":  ([(218, 506), (235, 496), (250, 486), (265, 478), (280, 472),
                       (295, 468), (308, 470), (318, 476)],
                      (240.5, 319.5), None),
    "J2_south":      ([(318, 476), (313, 488), (308, 498), (303, 510), (308, 522),
                       (310, 532), (304, 545), (296, 559), (288, 572), (281, 585),
                       (274, 598), (268, 610), (261, 622), (255, 635), (249, 648),
                       (243, 660), (240, 668)],
                      None, None),
    "J2_eastport":   ([(318, 476), (332, 468), (347, 463), (362, 458), (378, 450),
                       (388, 443), (398, 435), (408, 428), (418, 420), (428, 412),
                       (438, 405), (450, 398), (462, 392), (475, 385), (490, 378),
                       (505, 372), (520, 371), (540, 370), (570, 368), (600, 362),
                       (630, 355), (660, 345), (690, 340), (720, 333), (750, 328),
                       (757, 326)],
                      None, (252.5, 322.5)),
    "cornus_swest":  ([(205, 512), (196, 524), (188, 537), (179, 549), (170, 560),
                       (160, 570), (150, 578), (142, 583)],
                      (240.5, 319.5), (239.5, 325.5)),
}

# ---------------- rebuild coast correspondences (affine ICP) ----------------
shot = np.array(Image.open(SHOT).convert("RGB")).astype(int)
H, W = shot.shape[:2]
mapa = np.array(Image.open(TGA).convert("RGB"))
R, G, B = shot[..., 0], shot[..., 1], shot[..., 2]
water = ((B > 110) & (B > R + 25) & (G > R - 10)) | ((R > 195) & (G > 200) & (B > 200))
water[655:, :] = True
land_shot = ~water
sea_map = np.all(mapa == (41, 140, 232), axis=-1) | np.all(mapa == (41, 140, 233), axis=-1)
land_map = ~sea_map
MX0, MY0, MX1, MY1 = 228, 299, 266, 348
sard = np.zeros_like(land_map)
sard[MY0:MY1, MX0:MX1] = land_map[MY0:MY1, MX0:MX1]
cst = []
for y in range(MY0, MY1):
    for x in range(MX0, MX1):
        if not sard[y, x]: continue
        if not (sard[y-1,x] and sard[y+1,x] and sard[y,x-1] and sard[y,x+1]):
            cst.append((x + 0.5, y + 0.5))
cst = np.array(cst)
er = np.zeros_like(land_shot)
er[1:-1,1:-1] = (land_shot[1:-1,1:-1] & land_shot[:-2,1:-1] & land_shot[2:,1:-1]
                 & land_shot[1:-1,:-2] & land_shot[1:-1,2:])
edge_shot = land_shot & ~er
edge_shot[:6, :] = False; edge_shot[-20:, :] = False
edge_shot[:, :6] = False; edge_shot[:, -6:] = False
eys, exs = np.nonzero(edge_shot)
shot_edge_pts = np.stack([exs, eys], 1).astype(float)
tree = cKDTree(shot_edge_pts)
aff = np.load(OUT + r"\affine_map2shot.npy")
def apply_affine(p, s):
    p = np.asarray(p, float)
    return np.stack([s[0]*p[:,0]+s[1]*p[:,1]+s[2], s[3]*p[:,0]+s[4]*p[:,1]+s[5]], 1)
proj = apply_affine(cst, aff)
d, idx = tree.query(proj)
keep = d < np.percentile(d, 60)   # only confident coast pairs
coast_shot = shot_edge_pts[idx[keep]]
coast_map = cst[keep]
print("coast pairs used:", keep.sum())

# ---------------- MLS anchors (shot -> map) ----------------
TOWNS = [((535, 88), (248.5, 304.5), 40.0),
         ((632, 170), (251.5, 307.5), 40.0),
         ((205, 500), (240.5, 319.5), 40.0),
         ((139, 585), (239.5, 325.5), 40.0)]
src = np.concatenate([np.array([t[0] for t in TOWNS], float), coast_shot])
dst = np.concatenate([np.array([t[1] for t in TOWNS], float), coast_map])
wts = np.concatenate([np.array([t[2] for t in TOWNS]), np.ones(len(coast_shot))])

def mls_affine(p):
    """Affine MLS at point p (shot) -> map coords."""
    dd = np.sum((src - p) ** 2, axis=1)
    w = wts / (dd + 25.0)          # +25: soften very-near anchor domination
    sw = w.sum()
    cs = (src * w[:, None]).sum(0) / sw
    cd = (dst * w[:, None]).sum(0) / sw
    s2 = src - cs; d2 = dst - cd
    Mtl = (w[:, None, None] * (s2[:, :, None] * s2[:, None, :])).sum(0)
    Mtr = (w[:, None, None] * (s2[:, :, None] * d2[:, None, :])).sum(0)
    A = np.linalg.solve(Mtl, Mtr)
    return (p - cs) @ A + cd

# ---------------- convert roads ----------------
out_polys = {}
for name, (pts, snapA, snapB) in ROADS.items():
    m = np.array([mls_affine(np.array(p, float)) for p in pts])
    # endpoint snapping with linear blend along arc length
    t = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(m, axis=0).T))])
    t = t / (t[-1] if t[-1] > 0 else 1)
    if snapA is not None:
        m += (np.array(snapA) - m[0]) * (1 - t)[:, None]
    if snapB is not None:
        m += (np.array(snapB) - m[-1]) * t[:, None]
    out_polys[name] = m.round(2).tolist()
    print(f"{name}: {pts[0]}->{pts[-1]} shot  =>  ({m[0][0]:.1f},{m[0][1]:.1f})->({m[-1][0]:.1f},{m[-1][1]:.1f}) map")

# ---------------- rasterize to trench cells (integer map px, 8-connected) ----------------
cells = set()
def bres(x0, y0, x1, y1):
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx, sy = (1 if x1 > x0 else -1), (1 if y1 > y0 else -1)
    err = dx - dy
    while True:
        yield x0, y0
        if x0 == x1 and y0 == y1: return
        e2 = 2 * err
        if e2 > -dy: err -= dy; x0 += sx
        if e2 < dx: err += dx; y0 += sy
for name, poly in out_polys.items():
    p = np.array(poly)
    q = np.floor(p).astype(int)
    for i in range(len(q) - 1):
        for c in bres(q[i][0], q[i][1], q[i+1][0], q[i+1][1]):
            cells.add(c)
cells = sorted(cells)
print("trench cells:", len(cells))

with open(OUT + r"\traced_roads_map.json", "w") as f:
    json.dump({"space": "map_regions_px_1020x700", "campaign": "ris",
               "island": "sardinia", "polylines": out_polys,
               "cells": [[int(c[0]), int(c[1])] for c in cells]}, f, indent=1)

# ---------------- verification render (map space, x20) ----------------
S = 20
X0, Y0, X1, Y1 = 228, 296, 266, 348
crop = mapa[Y0:Y1, X0:X1]
up = np.kron(crop, np.ones((S, S, 1), dtype=np.uint8)) // 2 + 60
for cx, cy in cells:
    if X0 <= cx < X1 and Y0 <= cy < Y1:
        up[(cy-Y0)*S+2:(cy-Y0+1)*S-2, (cx-X0)*S+2:(cx-X0+1)*S-2] = (255, 220, 120)
for col, mark in [((0,0,0),(255,0,0)), ((255,255,255),(0,255,255))]:
    yy, xx = np.nonzero(np.all(crop == col, axis=-1))
    for y, x in zip(yy, xx):
        up[y*S+6:y*S+S-6, x*S+6:x*S+S-6] = mark
# polyline overdraw (sub-pixel, blue)
from PIL import ImageDraw
im = Image.fromarray(up); dr = ImageDraw.Draw(im)
for poly in out_polys.values():
    pts = [((px - X0) * S, (py - Y0) * S) for px, py in poly]
    dr.line(pts, fill=(0, 90, 255), width=3)
im.save(OUT + r"\map_space_render.png")
print("saved map_space_render.png + traced_roads_map.json")
