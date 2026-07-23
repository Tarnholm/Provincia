"""Close the gaps in the AERIAL road bake (src/risRoads.js) WITHOUT touching
the game's organic curve shapes. Only the ENDPOINTS move: cluster endpoints
that are within R px of each other (a junction the capture left fragmented) and
snap each cluster to its centroid. The move is FEATHERED over the last few
points so the curve eases into the junction with no kink. A piece's own two
ends are never merged (no collapse to a loop). Settlement/port ends snap to the
anchor centre so roads meet exactly at the town. Interiors are untouched."""
import re, math, os
import numpy as np
from PIL import Image
IN = r"C:\dev\Provincia\src\risRoads.js"
BASE = r"C:\RIS\RIS\data\world\maps\base"
R = 2.0        # endpoints within this are the same junction
FEATHER = 4    # points over which the endpoint shift decays

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]
is_sea = (reg[..., 0] == 41) & (reg[..., 1] == 140)
_an = {}
ys, xs = np.nonzero(((reg[...,0]==0)&(reg[...,1]==0)&(reg[...,2]==0)) | ((reg[...,0]==255)&(reg[...,1]==255)&(reg[...,2]==255)))
_anset = set(zip(xs.tolist(), ys.tolist()))
def anchor_near(p):
    best = None; bd = 2.2*2.2
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            a = (int(p[0])+dx, int(p[1])+dy)
            if a in _anset:
                d = (a[0]+0.5-p[0])**2 + (a[1]+0.5-p[1])**2
                if d < bd: bd = d; best = (a[0]+0.5, a[1]+0.5)
    return best
def to_land(x, y):
    from collections import deque
    xi, yi = int(x), int(y)
    if not (0<=xi<Ww and 0<=yi<Hh) or not is_sea[yi, xi]: return (x, y)
    seen={(xi,yi)}; q=deque([(xi,yi)])
    while q:
        cx,cy=q.popleft()
        for dx,dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
            nx,ny=cx+dx,cy+dy
            if 0<=nx<Ww and 0<=ny<Hh and (nx,ny) not in seen:
                if not is_sea[ny,nx]: return (nx+0.5,ny+0.5)
                seen.add((nx,ny)); q.append((nx,ny))
    return (x,y)

js = open(IN, encoding="utf-8").read()
head = js[:js.index("export const RIS_ROADS = [")]
tail = js[js.index("export const CAPTURED_MAPS"):]
chains = []
for m in re.finditer(r'(\{a:"[^"]*",b:"[^"]*",l:\[[^\]]*\],p:)\[([-0-9.,]+)\]', js):
    v = [float(x) for x in m.group(2).split(",")]
    chains.append({"pre": m.group(1), "pts": [(v[k], v[k+1]) for k in range(0, len(v), 2)]})
print("chains:", len(chains))

# endpoint list: (x, y, chain_idx, is_start)
pts = []
for ci, c in enumerate(chains):
    pts.append([c["pts"][0][0], c["pts"][0][1], ci, True])
    pts.append([c["pts"][-1][0], c["pts"][-1][1], ci, False])
partner = {}   # endpoint index -> the same chain's other endpoint index
for i in range(0, len(pts), 2): partner[i] = i+1; partner[i+1] = i

# union-find with "never merge a chain's own two ends" constraint
parent = list(range(len(pts)))
members = {i: [i] for i in range(len(pts))}
def find(i):
    while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
    return i
def try_union(i, j):
    ri, rj = find(i), find(j)
    if ri == rj: return
    a, b = (ri, rj) if len(members[ri]) >= len(members[rj]) else (rj, ri)
    for e in members[b]:
        if find(partner[e]) == a: return   # would put a chain's two ends together
    parent[b] = a; members[a].extend(members[b]); del members[b]

grid = {}
def cell(x, y): return (int(x/R), int(y/R))
for i, (x, y, ci, st) in enumerate(pts): grid.setdefault(cell(x, y), []).append(i)
cand = []
for i, (x, y, ci, st) in enumerate(pts):
    cx, cy = cell(x, y)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for j in grid.get((cx+dx, cy+dy), ()):
                if j > i:
                    d2 = (pts[j][0]-x)**2 + (pts[j][1]-y)**2
                    if d2 <= R*R: cand.append((d2, i, j))
cand.sort(key=lambda t: t[0])           # closest first
for d2, i, j in cand: try_union(i, j)

# snap target per cluster: an anchor if one is near, else the centroid
comp = {}
for i in range(len(pts)): comp.setdefault(find(i), []).append(i)
snapped = 0
for root, mem in comp.items():
    if len(mem) < 2:
        # lone end: still pull it onto an anchor if it's sitting just off one
        pass
    ax = sum(pts[i][0] for i in mem)/len(mem); ay = sum(pts[i][1] for i in mem)/len(mem)
    anc = anchor_near((ax, ay)) or (anchor_near((pts[mem[0]][0], pts[mem[0]][1])) if len(mem)==1 else None)
    tgt = to_land(*(anc if anc else (ax, ay)))
    for i in mem:
        _, _, ci, st = pts[i]
        c = chains[ci]["pts"]
        end = c[0] if st else c[-1]
        if abs(end[0]-tgt[0]) < 1e-6 and abs(end[1]-tgt[1]) < 1e-6: continue
        ddx, ddy = tgt[0]-end[0], tgt[1]-end[1]
        n = len(c)
        for k in range(min(FEATHER, n)):
            w = 1.0 - k/FEATHER
            idx = k if st else n-1-k
            c[idx] = to_land(c[idx][0]+ddx*w, c[idx][1]+ddy*w)
        snapped += 1
print("endpoints snapped:", snapped, "clusters:", len(comp))

# ---- second pass: any end still floating (not at an anchor, not sharing an
# endpoint, not on another road) is a real gap the capture left. Extend it to
# the NEAREST point of another chain within WIDE px (endpoint or body), so the
# gap closes into a junction. Feathered; skip if it would fold the chain.
WIDE = 5.0
def build_end_grid():
    g = {}
    for ci, c in enumerate(chains):
        for p in (c["pts"][0], c["pts"][-1]): g.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1], ci))
    return g
def build_poly_grid():
    g = {}
    for ci, c in enumerate(chains):
        for p in c["pts"]: g.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1], ci))
    return g
eg = build_end_grid(); pgr = build_poly_grid()
def has_near(g, p, ci, r):
    for dx in range(-int(r)-1, int(r)+2):
        for dy in range(-int(r)-1, int(r)+2):
            for (x, y, cj) in g.get((int(p[0])+dx, int(p[1])+dy), ()):
                if cj != ci and (x-p[0])**2 + (y-p[1])**2 <= r*r: return True
    return False
def nearest_on_road(p, ci, r):
    best = None; bd = r*r
    for dx in range(-int(r)-1, int(r)+2):
        for dy in range(-int(r)-1, int(r)+2):
            for (x, y, cj) in pgr.get((int(p[0])+dx, int(p[1])+dy), ()):
                if cj == ci: continue
                d = (x-p[0])**2 + (y-p[1])**2
                if d < bd: bd = d; best = (x, y)
    return best
extended = 0
for ci, c in enumerate(chains):
    for st in (True, False):
        end = c["pts"][0] if st else c["pts"][-1]
        if anchor_near(end): continue
        if has_near(eg, end, ci, 0.6): continue
        if has_near(pgr, end, ci, 0.9): continue    # already on another road
        tgt = nearest_on_road(end, ci, WIDE)
        if not tgt: continue
        other = c["pts"][-1] if st else c["pts"][0]
        if (other[0]-tgt[0])**2 + (other[1]-tgt[1])**2 < 4: continue  # would fold
        t = to_land(*tgt)
        ddx, ddy = t[0]-end[0], t[1]-end[1]
        n = len(c["pts"])
        for k in range(min(FEATHER, n)):
            w = 1.0 - k/FEATHER
            idx = k if st else n-1-k
            c["pts"][idx] = to_land(c["pts"][idx][0]+ddx*w, c["pts"][idx][1]+ddy*w)
        extended += 1
print("dangling ends extended to nearest road:", extended)

out = []
for c in chains:
    flat = ",".join(f"{round(v,2):g}" for p in c["pts"] for v in p)
    out.append(c["pre"] + "[" + flat + "]}")
open(IN, "w").write(head + "export const RIS_ROADS = [\n" + ",\n".join(out) + "\n];\n" + tail)
print("wrote", round(os.path.getsize(IN)/1024), "KB")
