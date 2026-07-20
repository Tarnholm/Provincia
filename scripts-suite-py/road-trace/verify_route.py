"""Replicate App.js road routing over real RIS map data for Sardinia,
with and without the traced trench, and render both for comparison."""
import heapq
import json
import numpy as np
from PIL import Image, ImageDraw

BASE = r"C:\RIS\RIS\data\world\maps\base"
OUT = r"C:\Users\vtarn\AppData\Local\Temp\claude\C--Users-vtarn-OneDrive-Skrivbord\6fd4885d-f016-48c8-bf38-a20b78536fc3\scratchpad"

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB")).astype(int)
gt = np.array(Image.open(BASE + r"\map_ground_types.tga").convert("RGB")).astype(int)
H, W = reg.shape[:2]
gH, gW = gt.shape[:2]
print("regions", W, H, " ground", gW, gH)

# land grid — same isSea heuristic as App.js
Rr, Gg, Bb = reg[..., 0], reg[..., 1], reg[..., 2]
is_sea = (Rr < 90) & (Gg > 110) & (Gg < 175) & (Bb > 190)
land = ~is_sea

PAL = {  # ground_types key color -> cost (App.js COST via GROUND_TYPE_PALETTE)
    (196,0,0): 999, (128,0,0): 15, (64,0,0): 14, (196,128,128): 15, (98,65,65): 12,
    (128,128,64): 12, (0,0,0): 12, (0,64,0): 999, (0,128,0): 13, (96,160,64): 13,
    (0,128,128): 10, (101,124,0): 11, (0,255,128): 20, (255,255,255): 14,
}
cost = np.full((H, W), 11.0)
for y in range(295, 350):        # Sardinia box only (speed)
    for x in range(225, 270):
        if not land[y, x]: continue
        tx = min(gW - 1, int(x / W * gW)); ty = min(gH - 1, int(y / H * gH))
        c = PAL.get(tuple(gt[ty, tx]))
        if c: cost[y, x] = c

trench = json.load(open(OUT + r"\traced_roads_map.json"))["cells"]

# Sardinia settlements + which region color each sits in (probe 3x3 around px)
SETTS = [(248,304),(251,307),(240,319),(243,323),(239,325),(246,332),(238,334)]
def region_of(px, py):
    from collections import Counter
    cnt = Counter()
    for dy in (-1,0,1):
        for dx in (-1,0,1):
            c = tuple(reg[py+dy, px+dx])
            if c not in ((0,0,0),(255,255,255)) and not is_sea[py+dy,px+dx]:
                cnt[c] += 1
    return cnt.most_common(1)[0][0]
rby = {s: region_of(*s) for s in SETTS}
for s, c in rby.items(): print("settlement", s, "region", c)

# adjacency: regions sharing a border (4-neigh) in the Sardinia box
adj = set()
for y in range(295, 350):
    for x in range(225, 270):
        c1 = tuple(reg[y, x])
        for dx, dy in ((1,0),(0,1)):
            c2 = tuple(reg[y+dy, x+dx])
            if c1 != c2 and c1 not in ((0,0,0),(255,255,255)) and c2 not in ((0,0,0),(255,255,255)):
                if not is_sea[y,x] and not is_sea[y+dy,x+dx]:
                    adj.add(frozenset((c1, c2)))
pairs = []
for i in range(len(SETTS)):
    for j in range(i+1, len(SETTS)):
        a, b = SETTS[i], SETTS[j]
        if frozenset((rby[a], rby[b])) in adj:
            d = np.hypot(a[0]-b[0], a[1]-b[1])
            pairs.append((d, a, b))
pairs.sort()
print("adjacent settlement pairs:", [(a, b) for _, a, b in pairs])

SQ2 = 2 ** 0.5
def astar(cost2, a, b):
    si, gi = (a[1], a[0]), (b[1], b[0])
    dist = {si: 0.0}; prev = {}
    pq = [(0.0, si)]
    closed = set()
    while pq:
        f, cur = heapq.heappop(pq)
        if cur in closed: continue
        closed.add(cur)
        if cur == gi: break
        cy, cx = cur
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                if dx == 0 and dy == 0: continue
                ny, nx = cy+dy, cx+dx
                if not (0 <= ny < H and 0 <= nx < W) or not land[ny, nx]: continue
                if dx and dy and (not land[cy, cx+dx] or not land[cy+dy, cx]): continue
                step = (SQ2 if dx and dy else 1.0) * cost2[ny, nx]
                nd = dist[cur] + step
                if nd < dist.get((ny, nx), 1e18):
                    dist[(ny, nx)] = nd; prev[(ny, nx)] = cur
                    h = 0.5 * ((nx-b[0])**2 + (ny-b[1])**2) ** 0.5
                    heapq.heappush(pq, (nd + h, (ny, nx)))
    if gi not in prev and gi != si: return None
    path = [gi]
    while path[-1] != si: path.append(prev[path[-1]])
    return path[::-1]

PORTS = [((248,304),(247,305)),((251,307),(251,308)),((240,319),(239,321)),
         ((243,323),(252,322)),((239,325),(239,326)),((238,334),(237,334)),
         ((246,332),(244,335))]

def run(with_trench):
    c2 = cost.copy()
    if with_trench:
        for x, y in trench:
            if land[y, x]: c2[y, x] = 2.0
    REUSE = 3.0
    out = {}
    for a, b in PORTS:  # port connectors routed first, like the app
        p = astar(c2, a, b)
        if not p: continue
        for (py, px) in p:
            if c2[py, px] > REUSE: c2[py, px] = REUSE
        out[("port", a)] = p
    for _, a, b in pairs:
        p = astar(c2, a, b)
        if not p: continue
        for (py, px) in p:
            if c2[py, px] > REUSE: c2[py, px] = REUSE
        out[(a, b)] = p
    return out

for tag in ("plain", "trench"):
    routes = run(tag == "trench")
    S = 20; X0, Y0, X1, Y1 = 228, 296, 266, 348
    crop = np.array(reg[Y0:Y1, X0:X1], dtype=np.uint8)
    up = np.kron(crop, np.ones((S, S, 1), dtype=np.uint8)) // 2 + 70
    if tag == "trench":
        for x, y in trench:
            if X0 <= x < X1 and Y0 <= y < Y1:
                up[(y-Y0)*S:(y-Y0+1)*S, (x-X0)*S:(x-X0+1)*S] = (110, 90, 60)
    im = Image.fromarray(up); dr = ImageDraw.Draw(im)
    for (a, b), p in routes.items():
        pts = [((px-X0)*S+S//2, (py-Y0)*S+S//2) for py, px in p]
        dr.line(pts, fill=(255, 230, 140), width=6)
    for sx, sy in SETTS:
        dr.rectangle([(sx-X0)*S+4, (sy-Y0)*S+4, (sx-X0+1)*S-4, (sy-Y0+1)*S-4], fill=(255,0,0))
    im.save(OUT + f"\\route_{tag}.png")
    print(f"saved route_{tag}.png  ({len(routes)} routes)")
