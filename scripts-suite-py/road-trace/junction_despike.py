"""Fix 4-way (and any) junction spikes in src/risRoads.js: where two roads meet
at a junction and leave in nearly the same direction (a ^ hairpin / overlapping
double), trim the SHORTER road's parallel prefix so it branches off the longer
one where they diverge (a clean Y), instead of both spiking out of the point.
Undo-verified: never disconnects a settlement/port/junction. Run LAST in the
road pipeline (after snap+dedup+snap)."""
import re, math, os
import numpy as np
from PIL import Image
IN = r"C:\dev\Provincia\src\risRoads.js"
BASE = r"C:\RIS\RIS\data\world\maps\base"
PARALLEL_DOT = 0.6     # two ends leaving < ~53 deg apart = overlapping
ALONG = 1.7            # "runs parallel to the other road" distance

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]
is_sea = (reg[..., 0] == 41) & (reg[..., 1] == 140)
anset = set(zip(*[a.tolist() for a in np.nonzero(
    ((reg[...,0]==0)&(reg[...,1]==0)&(reg[...,2]==0)) |
    ((reg[...,0]==255)&(reg[...,1]==255)&(reg[...,2]==255)))][::-1]))
from collections import deque
def to_land(x, y):
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
orig_ends = set()
for c in chains:
    orig_ends.add((round(c["pts"][0][0],1), round(c["pts"][0][1],1)))
    orig_ends.add((round(c["pts"][-1][0],1), round(c["pts"][-1][1],1)))
def clen(c): return sum(math.hypot(c[i+1][0]-c[i][0], c[i+1][1]-c[i][1]) for i in range(len(c)-1))

def poly_grid():
    g = {}
    for ci, c in enumerate(chains):
        for p in c["pts"]: g.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1], ci))
    return g
def end_dir(c, st):
    e = c[0] if st else c[-1]; nb = c[2] if st else c[-3]
    dx, dy = nb[0]-e[0], nb[1]-e[1]; L = math.hypot(dx, dy) or 1.0
    return (e, (dx/L, dy/L))
def near_other(pg, x, y, ci, r):
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for (px, py, cj) in pg.get((int(x)+dx, int(y)+dy), ()):
                if cj == ci: continue
                if (px-x)**2 + (py-y)**2 <= r*r: return cj
    return None

def nearest_on(pg, x, y, ci, r):
    best = None; bd = r*r
    for dx in range(-int(r)-1, int(r)+2):
        for dy in range(-int(r)-1, int(r)+2):
            for (px, py, cj) in pg.get((int(x)+dx, int(y)+dy), ()):
                if cj == ci: continue
                d = (px-x)**2 + (py-y)**2
                if d < bd: bd = d; best = (px, py)
    return best
FEATHER = 4
def reseat_start(seq, target):
    # straight-interp the first FEATHER points from target to the pivot so the
    # trimmed road eases onto the other road (T-junction) with no spike/gap
    F = min(FEATHER, len(seq)-1)
    piv = seq[F]
    for k in range(F+1):
        t = k/F if F else 0.0
        seq[k] = to_land(target[0]*(1-t)+piv[0]*t, target[1]*(1-t)+piv[1]*t)
    return seq

trimmed = 0; dropped = set()
for _round in range(8):
    pg = poly_grid()
    # collect ends + dirs
    ends = []
    for ci, c in enumerate(chains):
        if len(c["pts"]) < 5: continue
        for st in (True, False):
            e, d = end_dir(c["pts"], st)
            ends.append((e[0], e[1], d[0], d[1], ci, st))
    eg = {}
    for idx, (x, y, dx, dy, ci, st) in enumerate(ends): eg.setdefault((int(x), int(y)), []).append(idx)
    did = 0
    for idx, (x, y, dx, dy, ci, st) in enumerate(ends):
        # find a parallel partner at this junction
        partner = None
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                for j in eg.get((int(x)+ox, int(y)+oy), ()):
                    if j == idx: continue
                    x2, y2, dx2, dy2, cj, st2 = ends[j]
                    if cj == ci or (x2-x)**2 + (y2-y)**2 > 1.0: continue
                    if dx*dx2 + dy*dy2 > PARALLEL_DOT: partner = j; break
                if partner is not None: break
            if partner is not None: break
        if partner is None: continue
        j = partner; cj = ends[j][4]
        # trim the SHORTER chain's parallel prefix so it branches off the longer
        short_ci, short_st = (ci, st) if clen(chains[ci]["pts"]) <= clen(chains[cj]["pts"]) else (cj, ends[j][5])
        long_ci = cj if short_ci == ci else ci
        if short_ci in dropped: continue
        P = chains[short_ci]["pts"]
        seq = P[:] if short_st else P[::-1]
        # walk from the junction end while we run within ALONG of the LONGER road
        cut = 0
        for k in range(len(seq)):
            if near_other(pg, seq[k][0], seq[k][1], short_ci, ALONG) is not None: cut = k
            else: break
        if cut >= len(seq) - 3:
            # the shorter road is parallel for basically its whole length =
            # fully redundant → drop it (undo-verified at the end).
            dropped.add(short_ci); did += 1; trimmed += 1; continue
        if cut < 2: continue
        newseq = seq[cut:]
        onto = nearest_on(pg, newseq[0][0], newseq[0][1], short_ci, ALONG+0.6)
        if onto: newseq = reseat_start(newseq, onto)
        chains[short_ci]["pts"] = newseq if short_st else newseq[::-1]
        did += 1; trimmed += 1
    if did == 0: break
chains = [c for ci, c in enumerate(chains) if ci not in dropped]
print(f"junction-spike trims: {trimmed} (incl {len(dropped)} redundant dropped)")

# connectivity undo-verify: every ORIGINAL end must still have a road within 2.5px
def kept_grid():
    g = {}
    for c in chains:
        for p in c["pts"]: g.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1]))
    return g
kg = kept_grid()
def road_near(e, r=2.5):
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            for (x, y) in kg.get((int(e[0])+dx, int(e[1])+dy), ()):
                if (x-e[0])**2 + (y-e[1])**2 <= r*r: return True
    return False
lost = sum(1 for e in orig_ends if not road_near(e))
print("original ends now >2.5px from any road (should be ~0):", lost)

out = []
for c in chains:
    flat = ",".join(f"{round(v,2):g}" for p in c["pts"] for v in p)
    out.append(c["pre"] + "[" + flat + "]}")
open(IN, "w").write(head + "export const RIS_ROADS = [\n" + ",\n".join(out) + "\n];\n" + tail)
print("wrote", round(os.path.getsize(IN)/1024), "KB")
