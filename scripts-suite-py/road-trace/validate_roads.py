"""Road-quality validator for src/risRoads.js. Reports, map-wide:
  SPIKE     : an interior vertex where the road reverses >123 deg (a spike /
              hairpin artifact — the game's roads never do this).
  CROSSOVER : two different chains' segments cross away from a shared point.
  DANGLE    : a chain end that is NOT on a settlement/port anchor, NOT sharing
              an endpoint with another chain, and NOT lying on another chain's
              body (a gap the network left open).
  SEA       : a road point on a sea pixel.
Exit code 0 and "ALL CLEAN" only when every count is 0 (SPIKE/CROSSOVER/SEA;
DANGLE is reported but not fatal — the aerial capture has inherent gaps).
Usage: python validate_roads.py [path-to-risRoads.js]
"""
import re, sys, math
import numpy as np
from PIL import Image

RIS = sys.argv[1] if len(sys.argv) > 1 else r"C:\dev\Provincia\src\risRoads.js"
BASE = r"C:\RIS\RIS\data\world\maps\base"
reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]
is_sea = (reg[..., 0] == 41) & (reg[..., 1] == 140)
anset = set(zip(*[a.tolist() for a in np.nonzero(
    ((reg[...,0]==0)&(reg[...,1]==0)&(reg[...,2]==0)) |
    ((reg[...,0]==255)&(reg[...,1]==255)&(reg[...,2]==255)))][::-1]))

js = open(RIS, encoding="utf-8").read()
chains = []
for m in re.finditer(r'p:\[([-0-9.,]+)\]', js):
    v = [float(x) for x in m.group(1).split(",")]
    chains.append([(v[k], v[k+1]) for k in range(0, len(v), 2)])
print(f"chains: {len(chains)}")

# ---- SPIKE: interior vertex whose in/out directions reverse (dot < -0.55 =
# turn > ~123 deg). Report worst per chain.
SPIKE_DOT = -0.30
spikes = []
for ri, p in enumerate(chains):
    for k in range(1, len(p)-1):
        ax, ay = p[k][0]-p[k-1][0], p[k][1]-p[k-1][1]
        bx, by = p[k+1][0]-p[k][0], p[k+1][1]-p[k][1]
        la, lb = math.hypot(ax, ay), math.hypot(bx, by)
        if la < 0.1 or lb < 0.1: continue
        dot = (ax*bx+ay*by)/(la*lb)
        if dot < SPIKE_DOT:
            spikes.append((ri, p[k], round(dot, 2)))

# ---- CROSSOVER: segment intersection between different chains, not at a shared pt
from collections import defaultdict
def ccw(a, b, c): return (c[1]-a[1])*(b[0]-a[0]) - (b[1]-a[1])*(c[0]-a[0])
def seg_int(a, b, c, d):
    for e in (a, b):
        for f in (c, d):
            if abs(e[0]-f[0]) < 0.7 and abs(e[1]-f[1]) < 0.7: return False
    return (ccw(c,d,a) > 0) != (ccw(c,d,b) > 0) and (ccw(a,b,c) > 0) != (ccw(a,b,d) > 0)
buck = defaultdict(list); segs = []
for ri, p in enumerate(chains):
    for k in range(len(p)-1):
        si = len(segs); segs.append((p[k], p[k+1], ri))
        for bx in range(int(min(p[k][0], p[k+1][0]))//8, int(max(p[k][0], p[k+1][0]))//8 + 1):
            for by in range(int(min(p[k][1], p[k+1][1]))//8, int(max(p[k][1], p[k+1][1]))//8 + 1):
                buck[(bx, by)].append(si)
cross = set()
for ids in buck.values():
    for ii in range(len(ids)):
        for jj in range(ii+1, len(ids)):
            s1, s2 = segs[ids[ii]], segs[ids[jj]]
            if s1[2] == s2[2]: continue
            if seg_int(s1[0], s1[1], s2[0], s2[1]): cross.add((min(s1[2],s2[2]), max(s1[2],s2[2])))

# ---- DANGLE
eg = {}; pg = {}
for ci, c in enumerate(chains):
    for e in (c[0], c[-1]): eg.setdefault((int(e[0]), int(e[1])), []).append((e[0], e[1], ci))
    for e in c: pg.setdefault((int(e[0]), int(e[1])), []).append((e[0], e[1], ci))
def anc(p): return any((int(p[0])+dx, int(p[1])+dy) in anset for dx in range(-2, 3) for dy in range(-2, 3))
def near(g, p, ci, r):
    for dx in range(-int(r)-1, int(r)+2):
        for dy in range(-int(r)-1, int(r)+2):
            for (x, y, cj) in g.get((int(p[0])+dx, int(p[1])+dy), ()):
                if cj != ci and (x-p[0])**2 + (y-p[1])**2 <= r*r: return True
    return False
dangles = []
for ci, c in enumerate(chains):
    for e in (c[0], c[-1]):
        if anc(e) or near(eg, e, ci, 0.6) or near(pg, e, ci, 0.9): continue
        dangles.append((ci, e))

# ---- SEA
sea = [(ci, x, y) for ci, c in enumerate(chains) for (x, y) in c
       if 0 <= int(x) < Ww and 0 <= int(y) < Hh and is_sea[int(y), int(x)]]

print(f"SPIKE: {len(spikes)}   CROSSOVER: {len(cross)}   DANGLE: {len(dangles)}   SEA: {len(sea)}")
for ri, pt, dot in spikes[:15]: print(f"  SPIKE chain {ri} at ({pt[0]:.1f},{pt[1]:.1f}) dot={dot}")
fatal = len(spikes) + len(cross) + len(sea)
if fatal == 0:
    print("ALL CLEAN (spikes/crossovers/sea = 0)" + (f"; {len(dangles)} dangles (aerial gaps)" if dangles else ""))
    sys.exit(0)
else:
    print(f"NOT CLEAN: {fatal} fatal issues (spikes+crossovers+sea)")
    sys.exit(1)
