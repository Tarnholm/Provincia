"""Georeference: initial affine from town anchors, then coastline ICP refine.

Shot space: Skärmbild 2026-07-19 002514.png (806x671)
Map space: map_regions.tga pixels (1020x700), Sardinia ~x[230,262] y[300,345]
"""
import numpy as np
from PIL import Image, ImageDraw

SHOT = r"C:\Users\vtarn\OneDrive\Skrivbord\images\Skärmbild 2026-07-19 002514.png"
TGA = r"C:\RIS\RIS\data\world\maps\base\map_regions.tga"
OUT = r"C:\Users\vtarn\AppData\Local\Temp\claude\C--Users-vtarn-OneDrive-Skrivbord\6fd4885d-f016-48c8-bf38-a20b78536fc3\scratchpad"

shot = np.array(Image.open(SHOT).convert("RGB")).astype(int)
H, W = shot.shape[:2]
mapa = np.array(Image.open(TGA).convert("RGB"))

# ---------- screenshot sea mask ----------
R, G, B = shot[..., 0], shot[..., 1], shot[..., 2]
sea = (B > 110) & (B > R + 25) & (G > R - 10)         # blue + turquoise water
foam = (R > 195) & (G > 200) & (B > 200)              # breaking foam
water = sea | foam
water[655:, :] = True   # bottom UI bar -> ignore as non-land
# land = not water
land_shot = ~water

# ---------- map land mask (Sardinia neighborhood) ----------
SEA1, SEA2 = (41, 140, 232), (41, 140, 233)
sea_map = np.all(mapa == SEA1, axis=-1) | np.all(mapa == SEA2, axis=-1)
land_map = ~sea_map
# restrict to Sardinia box (exclude Corsica top rows to avoid matching its coast wrongly:
# Corsica IS partially visible in shot top?  No — shot top is Sardinia's north tip; Corsica not visible.)
MX0, MY0, MX1, MY1 = 228, 299, 266, 348
sard = np.zeros_like(land_map)
sard[MY0:MY1, MX0:MX1] = land_map[MY0:MY1, MX0:MX1]

# map coastline points = land px with a sea 4-neighbour (pixel centers +0.5)
cst = []
for y in range(MY0, MY1):
    for x in range(MX0, MX1):
        if not sard[y, x]: continue
        if not (sard[y-1,x] and sard[y+1,x] and sard[y,x-1] and sard[y,x+1]):
            cst.append((x + 0.5, y + 0.5))
cst = np.array(cst)
print("map coastline pts:", len(cst))

# ---------- shot coastline distance field ----------
# boundary of land_shot (land px adjacent to water)
from scipy import ndimage  # may not exist; fallback below
er = np.zeros_like(land_shot)
er[1:-1,1:-1] = (land_shot[1:-1,1:-1] & land_shot[:-2,1:-1] & land_shot[2:,1:-1]
                 & land_shot[1:-1,:-2] & land_shot[1:-1,2:])
edge_shot = land_shot & ~er
eys, exs = np.nonzero(edge_shot)
shot_edge_pts = np.stack([exs, eys], 1).astype(float)
print("shot coastline pts:", len(shot_edge_pts))
# grid index for nearest-neighbour queries
from scipy.spatial import cKDTree
tree = cKDTree(shot_edge_pts)

# ---------- initial affine from town anchors (map -> shot) ----------
ANCH = [  # (map_x, map_y) -> (shot_x, shot_y)
    ((248.5, 304.5), (535, 85)),    # north town
    ((251.5, 307.5), (632, 172)),   # NE town
    ((240.5, 319.5), (205, 500)),   # Cornus
    ((239.5, 325.5), (139, 585)),   # SW town
]
def fit_affine(src, dst, w=None):
    src = np.asarray(src, float); dst = np.asarray(dst, float)
    n = len(src)
    if w is None: w = np.ones(n)
    A = np.zeros((2 * n, 6)); b = np.zeros(2 * n)
    A[0::2, 0] = src[:, 0]; A[0::2, 1] = src[:, 1]; A[0::2, 2] = 1
    A[1::2, 3] = src[:, 0]; A[1::2, 4] = src[:, 1]; A[1::2, 5] = 1
    b[0::2] = dst[:, 0]; b[1::2] = dst[:, 1]
    ww = np.repeat(w, 2)
    sol, *_ = np.linalg.lstsq(A * ww[:, None], b * ww, rcond=None)
    return sol
def apply_affine(p, s):
    p = np.asarray(p, float)
    return np.stack([s[0]*p[:,0]+s[1]*p[:,1]+s[2], s[3]*p[:,0]+s[4]*p[:,1]+s[5]], 1)

src0 = [a[0] for a in ANCH]; dst0 = [a[1] for a in ANCH]
aff = fit_affine(src0, dst0)
res = apply_affine(src0, aff) - np.array(dst0, float)
print("anchor residuals after town-only affine:\n", res.round(1))

# ---------- ICP refine (map coast -> shot coast), trimmed LSQ ----------
for it in range(12):
    proj = apply_affine(cst, aff)
    d, idx = tree.query(proj)
    keep = d < np.percentile(d, 70)          # trimmed: drop worst 30%
    aff = fit_affine(cst[keep], shot_edge_pts[idx[keep]])
    print(f"iter {it}: median coast err {np.median(d):.1f}px  kept {keep.sum()}")

np.save(OUT + r"\affine_map2shot.npy", aff)

# ---------- verification overlay ----------
vis = shot.clip(0, 255).astype(np.uint8).copy()
proj = apply_affine(cst, aff).round().astype(int)
for x, y in proj:
    if 0 <= x < W and 0 <= y < H:
        vis[max(0,y-1):y+2, max(0,x-1):x+2] = (255, 0, 255)
# also project settlement pixels (black) and ports (white)
for col, mark in [((0,0,0),(255,0,0)), ((255,255,255),(0,255,255))]:
    yy, xx = np.nonzero(np.all(mapa == col, axis=-1) & sard)
    pts = apply_affine(np.stack([xx + 0.5, yy + 0.5], 1), aff).round().astype(int)
    for x, y in pts:
        if 0 <= x < W and 0 <= y < H:
            vis[max(0,y-4):y+5, max(0,x-4):x+5] = mark
Image.fromarray(vis).save(OUT + r"\overlay_coast.png")
print("saved overlay_coast.png; affine:", aff.round(3))
