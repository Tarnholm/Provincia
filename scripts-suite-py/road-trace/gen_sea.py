"""Bake the game's ACTUAL sea routes (AERIAL_MAP_SEA_ROUTES, dumped to
master_sea.json as integer tile paths) into src/risSea.js. Tile->pixel =
(x, H-1-y) (same convention as road waypoints). Smooth with Chaikin +
cubic resample so the coastal hops read as flowing lanes, and clamp EVERY
point to SEA (mirror of the road land-clamp: a sea lane may never sit on a
land pixel). Endpoints tagged with nearest PORT region for hover/trade."""
import json, math, os
from collections import Counter, deque
import numpy as np
from PIL import Image

BASE = r"C:\RIS\RIS\data\world\maps\base"
MASTER = r"C:\dev\_research\master_sea.json"
OUTJS = r"C:\dev\Provincia\src\risSea.js"

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]
is_sea = (reg[..., 0] == 41) & (reg[..., 1] == 140)          # exact sea signature
is_port = (reg[..., 0] > 240) & (reg[..., 1] > 240) & (reg[..., 2] > 240)
navigable = is_sea | is_port                                  # ports are lane endpoints

def to_sea(x, y):
    xi, yi = int(x), int(y)
    if 0 <= xi < Ww and 0 <= yi < Hh and navigable[yi, xi]: return (x, y)
    seen = {(xi, yi)}; q = deque([(xi, yi)])
    while q:
        cx, cy = q.popleft()
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
            nx, ny = cx+dx, cy+dy
            if 0 <= nx < Ww and 0 <= ny < Hh and (nx,ny) not in seen:
                if navigable[ny, nx]: return (nx+0.5, ny+0.5)
                seen.add((nx,ny)); q.append((nx,ny))
    return (x, y)

def chaikin(pts, rounds=2):
    for _ in range(rounds):
        if len(pts) < 3: break
        out = [pts[0]]
        for i in range(len(pts)-1):
            p, q = pts[i], pts[i+1]
            out.append((p[0]*0.75+q[0]*0.25, p[1]*0.75+q[1]*0.25))
            out.append((p[0]*0.25+q[0]*0.75, p[1]*0.25+q[1]*0.75))
        out.append(pts[-1]); pts = out
    return pts

def portcol(px, py):
    # nearest land region colour within a small ring (the port's owner)
    for rad in range(2, 7):
        cnt = Counter()
        for dy in range(-rad, rad+1):
            for dx in range(-rad, rad+1):
                x, y = int(px)+dx, int(py)+dy
                if 0 <= x < Ww and 0 <= y < Hh and not navigable[y, x]:
                    c = tuple(int(v) for v in reg[y, x])
                    if c not in ((0,0,0),(255,255,255)): cnt[c] += 1
        if cnt: return cnt.most_common(1)[0][0]
    return None

j = json.load(open(MASTER)); H = j["H"]
routes = [r for r in j["routes"] if len(r) >= 2]
print("raw sea routes:", len(routes))

curves = []
for tiles in routes:
    # tile -> pixel (bottom-left origin, same as road waypoints)
    px = [(x + 0.5, H - 1 - y + 0.5) for x, y in tiles]
    px = [to_sea(x, y) for x, y in px]
    px = chaikin(px, 2)
    px = [to_sea(x, y) for x, y in px]   # re-clamp after smoothing
    curves.append(px)

# dedup identical routes (A->B and B->A) by rounded endpoint pair + midpoint
def sig(c):
    e0=(round(c[0][0]/2)*2, round(c[0][1]/2)*2); e1=(round(c[-1][0]/2)*2, round(c[-1][1]/2)*2)
    m=c[len(c)//2]; return (tuple(sorted([e0,e1])), (round(m[0]/3)*3, round(m[1]/3)*3))
seen=set(); ded=[]
for c in curves:
    k=sig(c)
    if k in seen: continue
    seen.add(k); ded.append(c)
print("after dedup:", len(ded))

landpts = sum(1 for c in ded for x,y in c if 0<=int(x)<Ww and 0<=int(y)<Hh and not navigable[int(y),int(x)])
print("points on land:", landpts)

fp = tuple(int(v) for v in reg[313, 244])
entries = []
for c in ded:
    a = portcol(*c[0]); b = portcol(*c[-1])
    cs = lambda q: (f'"{q[0]},{q[1]},{q[2]}"' if q else '""')
    flat = ",".join(f"{round(v,2):g}" for p in c for v in p)
    entries.append(f'{{a:{cs(a)},b:{cs(b)},p:[{flat}]}}')
js = ("// The game's ACTUAL sea routes (AERIAL_MAP_SEA_ROUTES) read from memory as\n"
      "// integer tile paths, smoothed to flowing coastal lanes. Every point is on\n"
      "// navigable water (never a land pixel). a/b = nearest PORT region colour.\n"
      f"export const RIS_SEA_FINGERPRINT = {{ x: 244, y: 313, rgb: [{fp[0]}, {fp[1]}, {fp[2]}], mapW: {Ww}, mapH: {Hh} }};\n"
      "export const RIS_SEA = [\n" + ",\n".join(entries) + "\n];\n"
      "export const CAPTURED_SEA = [\n  { name: \"RIS grand campaign\", fingerprint: RIS_SEA_FINGERPRINT, routes: RIS_SEA },\n];\n")
open(OUTJS, "w").write(js)
print("sea routes", len(entries), "->", round(os.path.getsize(OUTJS)/1024), "KB")
