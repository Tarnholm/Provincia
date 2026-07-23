"""FINAL spike-elimination pass (Option B: bias to zero spikes, accept gaps).
Run LAST, after snap+dedup+snap. Iterates until the map has NO hairpin spikes
and NO junction-spikes:
  * hairpin (single chain reverses >135 deg over a 2px window): remove the
    offending vertices.
  * junction-spike (two chains meet at a point leaving <30 deg apart = ^ /
    double): trim the SHORTER chain's parallel prefix so it branches off the
    longer (reseated straight onto it), or drop it if nothing meaningful is
    left. Never snaps ends together afterwards (that is what re-creates spikes).
Protects the last road to any settlement/port. Gaps (dangles) are acceptable.
"""
import re, math, os
import numpy as np
from PIL import Image
IN = r"C:\dev\Provincia\src\risRoads.js"
BASE = r"C:\RIS\RIS\data\world\maps\base"
WIN = 2.0; HAIRPIN = -0.7; PARALLEL = 0.87; ALONG = 1.7; FEATHER = 4

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
def is_anchor(p):
    return any((int(p[0])+dx, int(p[1])+dy) in anset for dx in range(-2,3) for dy in range(-2,3))

js = open(IN, encoding="utf-8").read()
head = js[:js.index("export const RIS_ROADS = [")]
tail = js[js.index("export const CAPTURED_MAPS"):]
chains = []
for m in re.finditer(r'(\{a:"[^"]*",b:"[^"]*",l:\[[^\]]*\],p:)\[([-0-9.,]+)\]', js):
    v = [float(x) for x in m.group(2).split(",")]
    chains.append({"pre": m.group(1), "pts": [(v[k], v[k+1]) for k in range(0, len(v), 2)]})
print("chains in:", len(chains))
orig_ends = set()
for c in chains:
    orig_ends.add((round(c["pts"][0][0],1), round(c["pts"][0][1],1)))
    orig_ends.add((round(c["pts"][-1][0],1), round(c["pts"][-1][1],1)))

def wdir_fwd(p, k):
    x0, y0 = p[k]; acc = 0.0
    for j in range(k+1, len(p)):
        acc += math.hypot(p[j][0]-p[j-1][0], p[j][1]-p[j-1][1])
        if acc >= WIN or j == len(p)-1:
            dx, dy = p[j][0]-x0, p[j][1]-y0; L = math.hypot(dx, dy)
            return (dx/L, dy/L) if L > 0.3 else None
    return None
def wdir_back(p, k):
    x0, y0 = p[k]; acc = 0.0
    for j in range(k-1, -1, -1):
        acc += math.hypot(p[j+1][0]-p[j][0], p[j+1][1]-p[j][1])
        if acc >= WIN or j == 0:
            dx, dy = x0-p[j][0], y0-p[j][1]; L = math.hypot(dx, dy)
            return (dx/L, dy/L) if L > 0.3 else None
    return None
def clen(c): return sum(math.hypot(c[i+1][0]-c[i][0], c[i+1][1]-c[i][1]) for i in range(len(c)-1))

def despike_chain(c):
    # remove interior vertices that form a >135deg hairpin (windowed), iterate
    changed = True; guard = 0
    while changed and len(c) > 3 and guard < 200:
        changed = False; guard += 1
        for k in range(1, len(c)-1):
            db, df = wdir_back(c, k), wdir_fwd(c, k)
            if db and df and db[0]*df[0]+db[1]*df[1] < HAIRPIN:
                del c[k]; changed = True; break

def poly_grid():
    g = {}
    for ci, c in enumerate(chains):
        for p in c["pts"]: g.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1], ci))
    return g
def near_road(pg, x, y, ci, r):
    for dx in range(-int(r)-1, int(r)+2):
        for dy in range(-int(r)-1, int(r)+2):
            for (px, py, cj) in pg.get((int(x)+dx, int(y)+dy), ()):
                if cj != ci and (px-x)**2 + (py-y)**2 <= r*r: return cj
    return None
def nearest_on(pg, x, y, ci, r):
    best=None; bd=r*r
    for dx in range(-int(r)-1, int(r)+2):
        for dy in range(-int(r)-1, int(r)+2):
            for (px, py, cj) in pg.get((int(x)+dx, int(y)+dy), ()):
                if cj == ci: continue
                d=(px-x)**2+(py-y)**2
                if d<bd: bd=d; best=(px,py)
    return best
def reseat(seq, target):
    F = min(FEATHER, len(seq)-1); piv = seq[F]
    for k in range(F+1):
        t = k/F if F else 0.0
        seq[k] = to_land(target[0]*(1-t)+piv[0]*t, target[1]*(1-t)+piv[1]*t)
def _ccw(a,b,c): return (c[1]-a[1])*(b[0]-a[0])-(b[1]-a[1])*(c[0]-a[0])
def _cross(a,b,c,d):
    for e in (a,b):
        for f in (c,d):
            if abs(e[0]-f[0])<0.7 and abs(e[1]-f[1])<0.7: return False
    return (_ccw(c,d,a)>0)!=(_ccw(c,d,b)>0) and (_ccw(a,b,c)>0)!=(_ccw(a,b,d)>0)
def reseat_crosses(sc, a, b):
    # would a segment a->b cross any OTHER road segment nearby?
    for dx in (-2,-1,0,1,2):
        for dy in (-2,-1,0,1,2):
            for (px, py, cj) in pg.get((int(a[0])+dx, int(a[1])+dy), ()):
                if cj == sc: continue
                c = chains[cj]["pts"]
                for k in range(len(c)-1):
                    if abs(c[k][0]-a[0])<4 and abs(c[k][1]-a[1])<4 and _cross(a,b,c[k],c[k+1]): return True
    return False

def anchor_end_count():
    # how many chain-ends sit on each anchor cell (to protect last road)
    cnt = {}
    for c in chains:
        for p in (c["pts"][0], c["pts"][-1]):
            k = (int(p[0]), int(p[1])); cnt[k] = cnt.get(k, 0) + 1
    return cnt

for it in range(25):
    # 1) hairpins
    for c in chains: despike_chain(c["pts"])
    # 2) junction-spikes
    pg = poly_grid()
    jends = []
    for ci, c in enumerate(chains):
        p = c["pts"]
        if len(p) < 3: continue
        ds = wdir_fwd(p, 0); de = wdir_back(p, len(p)-1)
        if ds: jends.append((p[0][0], p[0][1], ds[0], ds[1], ci, True))
        if de: jends.append((p[-1][0], p[-1][1], -de[0], -de[1], ci, False))
    jg = {}
    for i, e in enumerate(jends): jg.setdefault((int(e[0]), int(e[1])), []).append(i)
    drop = set(); trimmed = 0
    handled_ci = set()
    for i, (x, y, dx, dy, ci, st) in enumerate(jends):
        if ci in handled_ci or ci in drop: continue
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                for j in jg.get((int(x)+ox, int(y)+oy), ()):
                    if j == i: continue
                    x2, y2, dx2, dy2, cj, st2 = jends[j]
                    if cj == ci or cj in drop or (x2-x)**2+(y2-y)**2 > 1.0: continue
                    if dx*dx2+dy*dy2 <= PARALLEL: continue
                    # parallel pair: trim shorter's prefix to branch off longer
                    if clen(chains[ci]["pts"]) <= clen(chains[cj]["pts"]): sc, ss, lc = ci, st, cj
                    else: sc, ss, lc = cj, st2, ci
                    P = chains[sc]["pts"]; seq = P[:] if ss else P[::-1]
                    cut = 0
                    for k in range(len(seq)):
                        if near_road(pg, seq[k][0], seq[k][1], sc, ALONG) is not None: cut = k
                        else: break
                    far = seq[-1]  # the shorter chain's non-junction end
                    if cut >= 2 and cut < len(seq)-3:
                        # trim the parallel prefix → branch off the longer road.
                        # Reseat onto it ONLY if that doesn't cross another road;
                        # otherwise leave the small gap.
                        newseq = seq[cut:]
                        onto = nearest_on(pg, newseq[0][0], newseq[0][1], sc, ALONG+0.6)
                        if onto and not reseat_crosses(sc, onto, newseq[min(FEATHER,len(newseq)-1)]):
                            reseat(newseq, onto)
                        chains[sc]["pts"] = newseq if ss else newseq[::-1]
                        handled_ci.add(sc); trimmed += 1
                    elif cut >= len(seq)-3 and not is_anchor(far):
                        # fully parallel to the longer + far end not a settlement
                        # → redundant, drop it (accept the gap).
                        drop.add(sc); handled_ci.add(sc); trimmed += 1
                    else:
                        # short parallel overlap (can't trim to a branch) OR a
                        # settlement road: SEPARATE the ends by pulling the
                        # shorter's junction end back along its OWN direction a
                        # few points, so the two no longer share the point (no
                        # spike). Tiny gap, no crossover (moves along itself).
                        P = chains[sc]["pts"]; n = len(P)
                        rm = min(3, n-4)
                        if rm >= 1:
                            chains[sc]["pts"] = P[rm:] if ss else P[:n-rm]
                        handled_ci.add(sc); trimmed += 1
                    break
                else: continue
                break
            else: continue
            break
    chains = [c for k, c in enumerate(chains) if k not in drop]
    if trimmed == 0:
        break
print("iterations done; chains now:", len(chains))
for c in chains: despike_chain(c["pts"])

out = []
for c in chains:
    if len(c["pts"]) < 2: continue
    flat = ",".join(f"{round(v,2):g}" for p in c["pts"] for v in p)
    out.append(c["pre"] + "[" + flat + "]}")
open(IN, "w").write(head + "export const RIS_ROADS = [\n" + ",\n".join(out) + "\n];\n" + tail)
print("wrote", round(os.path.getsize(IN)/1024), "KB,", len(out), "chains")
