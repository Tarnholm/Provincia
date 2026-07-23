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

def snap_end(c, st, target):
    # Move an endpoint to `target` by replacing the last FEATHER points with a
    # STRAIGHT interpolation from target to the pivot (point FEATHER in). A
    # straight tail into the junction can't spike (the old decaying-feather bent
    # the tail sideways and made hairpins). Interior beyond the pivot untouched.
    n = len(c)
    F = min(FEATHER, n-1)
    pivot = c[F] if st else c[n-1-F]
    for k in range(F+1):
        t = k / F if F else 0.0
        x = target[0]*(1-t) + pivot[0]*t
        y = target[1]*(1-t) + pivot[1]*t
        c[k if st else n-1-k] = to_land(x, y)

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
        snap_end(c, st, tgt)
        snapped += 1
print("endpoints snapped:", snapped, "clusters:", len(comp))

# ---- second pass: any end still floating (not at an anchor, not sharing an
# endpoint, not on another road) is a real gap the capture left. Extend it to
# the NEAREST point of another chain within WIDE px (endpoint or body), so the
# gap closes into a junction. Feathered; skip if it would fold the chain.
WIDE = 7.0
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
def nearest_on_road_fwd(p, outdir, ci, r):
    # nearest point on another road within r, but ONLY in the road's FORWARD
    # direction (dot with outgoing dir > 0) so the extension continues the road
    # instead of doubling back and making a spike.
    best = None; bd = r*r
    for dx in range(-int(r)-1, int(r)+2):
        for dy in range(-int(r)-1, int(r)+2):
            for (x, y, cj) in pgr.get((int(p[0])+dx, int(p[1])+dy), ()):
                if cj == ci: continue
                vx, vy = x-p[0], y-p[1]
                d = vx*vx + vy*vy
                if d >= bd or d < 1e-9: continue
                L = math.sqrt(d)
                if (vx/L)*outdir[0] + (vy/L)*outdir[1] < -0.25: continue   # allow perpendicular T-junctions, block ~180 backward spikes
                bd = d; best = (x, y)
    return best
extended = 0
for ci, c in enumerate(chains):
    P = c["pts"]
    if len(P) < 3: continue
    for st in (True, False):
        end = P[0] if st else P[-1]
        if anchor_near(end): continue
        if has_near(eg, end, ci, 0.6): continue
        if has_near(pgr, end, ci, 0.9): continue    # already on another road
        # outgoing direction = from the 3rd point toward the end (where the road
        # is heading as it leaves); we extend further along THAT heading.
        nb = P[2] if st else P[-3]
        ox, oy = end[0]-nb[0], end[1]-nb[1]; L = math.hypot(ox, oy) or 1.0
        outdir = (ox/L, oy/L)
        tgt = nearest_on_road_fwd(end, outdir, ci, WIDE)
        if not tgt: continue
        other = P[-1] if st else P[0]
        if (other[0]-tgt[0])**2 + (other[1]-tgt[1])**2 < 4: continue  # would fold
        snap_end(P, st, to_land(*tgt))
        extended += 1
print("dangling ends extended (forward-only):", extended)

# ---- FINAL DESPIKE: any interior vertex that reverses >123 deg (dot<-0.55) is
# a spike; pull it to the midpoint of its neighbours until none remain. Endpoints
# are never moved (topology/junctions preserved). Also clears the 6 spikes that
# were already in the raw capture.
import math as _m
def spike_ks(c):
    out = []
    for k in range(1, len(c)-1):
        ax, ay = c[k][0]-c[k-1][0], c[k][1]-c[k-1][1]
        bx, by = c[k+1][0]-c[k][0], c[k+1][1]-c[k][1]
        la, lb = _m.hypot(ax, ay), _m.hypot(bx, by)
        if la < 0.05 or lb < 0.05: continue
        if (ax*bx+ay*by)/(la*lb) < -0.30: out.append(k)
    return out
def despike(c, rounds=40):
    # first try gentle averaging (keeps the curve); if a spike persists, REMOVE
    # the offending vertex (connect neighbours directly) — definitive, and safe
    # since only interior points are touched (endpoints/junctions stay).
    for _ in range(rounds):
        ks = spike_ks(c)
        if not ks: return True
        for k in ks:
            c[k] = to_land((c[k-1][0]+c[k+1][0])/2, (c[k-1][1]+c[k+1][1])/2)
    while len(c) > 3:
        ks = spike_ks(c)
        if not ks: break
        for k in reversed(ks):
            if len(c) > 3: del c[k]
    return not spike_ks(c)
despiked = 0; stubborn = 0
for c in chains:
    if spike_ks(c["pts"]):
        despiked += 1
        if not despike(c["pts"]): stubborn += 1
print(f"chains despiked: {despiked} (stubborn remaining: {stubborn})")

out = []
for c in chains:
    flat = ",".join(f"{round(v,2):g}" for p in c["pts"] for v in p)
    out.append(c["pre"] + "[" + flat + "]}")
open(IN, "w").write(head + "export const RIS_ROADS = [\n" + ",\n".join(out) + "\n];\n" + tail)
print("wrote", round(os.path.getsize(IN)/1024), "KB")
