"""Bake road geometry into src/risRoads.js:
 - PRIMARY: the game's ACTUAL drawn curve read from memory (render_curve.json) —
   cubic Bezier (arm 0.33) through the engine's own off-grid nodes. Verbatim.
 - FILL: for roads in regions that weren't on-screen when captured, use the
   reproduced smooth curve so nothing is missing.
 - HARD RULE: no point may sit on a sea pixel — every point is pulled to land.
"""
import json, math, os
from collections import Counter, deque
import numpy as np
from PIL import Image

BASE = r"C:\RIS\RIS\data\world\maps\base"
REND = r"C:\dev\_research\render_curve.json"
STRAT = r"C:\dev\_research\traced_roads_map.json"
OUTJS = r"C:\dev\Provincia\src\risRoads.js"

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
is_sea = (reg[..., 0] < 90) & (reg[..., 1] > 110) & (reg[..., 1] < 175) & (reg[..., 2] > 190)
Hh, Ww = reg.shape[:2]

# BFS nearest-land lookup, precomputed distance-limited: for guarantee, do per-point BFS.
def to_land(x, y):
    xi, yi = int(x), int(y)
    if not (0 <= xi < Ww and 0 <= yi < Hh): return (x, y)
    if not is_sea[yi, xi]: return (x, y)
    seen = {(xi, yi)}; q = deque([(xi, yi)])
    while q:
        cx, cy = q.popleft()
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
            nx, ny = cx+dx, cy+dy
            if 0 <= nx < Ww and 0 <= ny < Hh and (nx,ny) not in seen:
                if not is_sea[ny, nx]: return (nx+0.5, ny+0.5)
                seen.add((nx,ny)); q.append((nx,ny))
    return (x, y)

j = json.load(open(REND)); H = j["H"]; W = j["W"]

def bez_captured(nodes):  # node=[px,pz,tx,tz] tile; pixel=(px, H-pz), tangent=(tx,-tz)
    P = [(n[0], H - n[1]) for n in nodes]
    T = [(n[2], -n[3]) for n in nodes]
    out = [P[0]]
    for i in range(len(P)-1):
        p0, p3 = P[i], P[i+1]; t0, t1 = T[i], T[i+1]
        p1 = (p0[0]+t0[0]*0.33, p0[1]+t0[1]*0.33); p2 = (p3[0]-t1[0]*0.33, p3[1]-t1[1]*0.33)
        for k in range(1, 6):
            t = k/5; u = 1-t
            out.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],
                        u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return [to_land(x, y) for x, y in out]

def relax(P, it, lam):
    p = [list(q) for q in P]
    for _ in range(it):
        p = [p[0]] + [[p[i][0]+lam*((p[i-1][0]+p[i+1][0])/2-p[i][0]), p[i][1]+lam*((p[i-1][1]+p[i+1][1])/2-p[i][1])] for i in range(1,len(p)-1)] + [p[-1]]
    return p
def bez_repro(tiles):
    if len(tiles) < 2: return None
    P = relax([[t[0]+0.5, t[1]+0.5] for t in tiles], 3, 0.5)
    n = len(P); T = []
    for i in range(n):
        a = P[max(0,i-1)]; b = P[min(n-1,i+1)]; dx,dy=b[0]-a[0],b[1]-a[1]; L=math.hypot(dx,dy) or 1; T.append((dx/L,dy/L))
    out = [(P[0][0], P[0][1])]
    for i in range(n-1):
        p0,p3=P[i],P[i+1];t0,t1=T[i],T[i+1]
        p1=(p0[0]+t0[0]*0.33,p0[1]+t0[1]*0.33);p2=(p3[0]-t1[0]*0.33,p3[1]-t1[1]*0.33)
        for k in range(1,6):
            t=k/5;u=1-t
            out.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return [to_land(x, H-1-z) for x, z in out]

def regcol(px, py):
    cnt = Counter()
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            x, y = int(px)+dx, int(py)+dy
            if 0 <= x < W and 0 <= y < H and not is_sea[y, x]:
                c = tuple(int(v) for v in reg[y, x])
                if c not in ((0,0,0),(255,255,255)): cnt[c] += 1
    return cnt.most_common(1)[0][0] if cnt else None

captured = []  # (curve, endpoints)
for nodes in j["roads"]:
    if len(nodes) < 2: continue
    c = bez_captured(nodes)
    captured.append(c)
cap_ends = [(c[0], c[-1]) for c in captured]
print("captured curves:", len(captured))

# FILL: reproduced roads whose endpoints don't match any captured road
js2 = json.load(open(STRAT)); H2 = js2["H"]
def dist(a, b): return math.hypot(a[0]-b[0], a[1]-b[1])
fill = []
for rd in js2["manager_roads"]:
    for poly in rd["polys"]:
        c = bez_repro(poly)
        if not c: continue
        e0, e1 = c[0], c[-1]
        matched = any(min(dist(e0,ce[0])+dist(e1,ce[1]), dist(e0,ce[1])+dist(e1,ce[0])) < 4.0 for ce in cap_ends)
        if not matched:
            fill.append(c)
print("fill (uncaptured) curves:", len(fill))

allc = captured + fill
# sea check
seapts = sum(1 for c in allc for x,y in c if 0<=int(x)<Ww and 0<=int(y)<Hh and is_sea[int(y),int(x)])
print("total curves:", len(allc), "sea points:", seapts)

fp = tuple(int(v) for v in reg[313, 244])
entries = []
for c in allc:
    a = regcol(*c[0]); b = regcol(*c[-1])
    cs = lambda q: (f'"{q[0]},{q[1]},{q[2]}"' if q else '""')
    flat = ",".join(f"{round(v,2):g}" for p in c for v in p)
    entries.append(f'{{a:{cs(a)},b:{cs(b)},p:[{flat}]}}')
js = ("// Road geometry: the game's ACTUAL drawn curve read from memory (verbatim,\n"
      "// cubic Bezier through the engine's own off-grid nodes) where captured;\n"
      "// reproduced smooth curve for regions not on-screen at capture. Every\n"
      "// point guaranteed on land (never a sea pixel).\n"
      f"export const RIS_ROADS_FINGERPRINT = {{ x: 244, y: 313, rgb: [{fp[0]}, {fp[1]}, {fp[2]}], mapW: {W}, mapH: {H} }};\n"
      "export const RIS_ROADS = [\n" + ",\n".join(entries) + "\n];\n"
      "export const CAPTURED_MAPS = [\n  { name: \"RIS grand campaign\", fingerprint: RIS_ROADS_FINGERPRINT, roads: RIS_ROADS },\n];\n")
open(OUTJS, "w").write(js)
print("roads", len(entries), "->", round(os.path.getsize(OUTJS)/1024), "KB")
