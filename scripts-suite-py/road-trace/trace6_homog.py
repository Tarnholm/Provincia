"""Homography ICP: map coast -> shot coast, warm-started from the affine."""
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

SHOT = r"C:\Users\vtarn\OneDrive\Skrivbord\images\Skärmbild 2026-07-19 002514.png"
TGA = r"C:\RIS\RIS\data\world\maps\base\map_regions.tga"
OUT = r"C:\Users\vtarn\AppData\Local\Temp\claude\C--Users-vtarn-OneDrive-Skrivbord\6fd4885d-f016-48c8-bf38-a20b78536fc3\scratchpad"

shot = np.array(Image.open(SHOT).convert("RGB")).astype(int)
H, W = shot.shape[:2]
mapa = np.array(Image.open(TGA).convert("RGB"))

R, G, B = shot[..., 0], shot[..., 1], shot[..., 2]
sea = (B > 110) & (B > R + 25) & (G > R - 10)
foam = (R > 195) & (G > 200) & (B > 200)
water = sea | foam
water[655:, :] = True
land_shot = ~water

SEA1, SEA2 = (41, 140, 232), (41, 140, 233)
sea_map = np.all(mapa == SEA1, axis=-1) | np.all(mapa == SEA2, axis=-1)
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
# exclude a border margin: coast whose true match is off-frame must not attract
edge_shot[:6, :] = False; edge_shot[-20:, :] = False
edge_shot[:, :6] = False; edge_shot[:, -6:] = False
eys, exs = np.nonzero(edge_shot)
shot_edge_pts = np.stack([exs, eys], 1).astype(float)
tree = cKDTree(shot_edge_pts)

aff = np.load(OUT + r"\affine_map2shot.npy")
Hm = np.array([[aff[0], aff[1], aff[2]], [aff[3], aff[4], aff[5]], [0, 0, 1.0]])

def apply_h(Hm, p):
    p = np.asarray(p, float)
    q = np.stack([p[:, 0], p[:, 1], np.ones(len(p))], 1) @ Hm.T
    return q[:, :2] / q[:, 2:3]

def fit_h(src, dst, w):
    """DLT with weights; src->dst homography (normalized)."""
    src = np.asarray(src, float); dst = np.asarray(dst, float); w = np.asarray(w, float)
    ms, ss = src.mean(0), src.std(0).mean() + 1e-9
    md, sd = dst.mean(0), dst.std(0).mean() + 1e-9
    S = np.array([[1/ss, 0, -ms[0]/ss], [0, 1/ss, -ms[1]/ss], [0, 0, 1]])
    D = np.array([[1/sd, 0, -md[0]/sd], [0, 1/sd, -md[1]/sd], [0, 0, 1]])
    s = (src - ms) / ss; d = (dst - md) / sd
    n = len(s)
    A = np.zeros((2 * n, 9))
    A[0::2, 0:2] = s; A[0::2, 2] = 1
    A[0::2, 6:8] = -s * d[:, 0:1]; A[0::2, 8] = -d[:, 0]
    A[1::2, 3:5] = s; A[1::2, 5] = 1
    A[1::2, 6:8] = -s * d[:, 1:2]; A[1::2, 8] = -d[:, 1]
    A *= np.repeat(w, 2)[:, None]
    _, _, Vt = np.linalg.svd(A, full_matrices=False)
    Hn = Vt[-1].reshape(3, 3)
    Hm = np.linalg.inv(D) @ Hn @ S
    return Hm / Hm[2, 2]

# strong town anchors (the two visually certain ones) with high weight
TOWNS_SRC = np.array([(248.5, 304.5), (251.5, 307.5)])
TOWNS_DST = np.array([(535, 85), (632, 172)])

for it in range(20):
    proj = apply_h(Hm, cst)
    d, idx = tree.query(proj)
    keep = d < np.percentile(d, 70)
    src = np.concatenate([cst[keep], TOWNS_SRC])
    dst = np.concatenate([shot_edge_pts[idx[keep]], TOWNS_DST])
    w = np.concatenate([np.ones(keep.sum()), np.full(2, 8.0)])
    Hm = fit_h(src, dst, w)
    if it % 4 == 3 or it == 0:
        print(f"iter {it}: median coast err {np.median(d):.1f}px")

proj = apply_h(Hm, cst)
d, _ = tree.query(proj)
print("final: median", np.median(d).round(1), " p80", np.percentile(d, 80).round(1))
np.save(OUT + r"\homography_map2shot.npy", Hm)

vis = shot.clip(0, 255).astype(np.uint8).copy()
for x, y in proj.round().astype(int):
    if 0 <= x < W and 0 <= y < H:
        vis[max(0,y-1):y+2, max(0,x-1):x+2] = (255, 0, 255)
for col, mark in [((0,0,0),(255,0,0)), ((255,255,255),(0,255,255))]:
    yy, xx = np.nonzero(np.all(mapa == col, axis=-1) & sard)
    pts = apply_h(Hm, np.stack([xx + 0.5, yy + 0.5], 1)).round().astype(int)
    for x, y in pts:
        if 0 <= x < W and 0 <= y < H:
            vis[max(0,y-4):y+5, max(0,x-4):x+5] = mark
Image.fromarray(vis).save(OUT + r"\overlay_homog.png")
print("saved overlay_homog.png")
print(Hm)
