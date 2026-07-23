"""Bake road geometry from ROAD_MANAGER (master_mgr.json) as a GRAPH — the
game's exact topology. Shared tiles = shared graph nodes, so corridors MERGE
(no double lines) and junctions CONNECT (shared points); roads never cross
because they only meet at shared tiles (proven: 0 non-shared crossings).
Each maximal chain between junction/endpoint nodes is drawn once, smoothed to
an organic curve, clamped to land, and tagged with every settlement-link that
uses it (for the app's per-link visibility filter)."""
import json, math, os
from collections import Counter, deque, defaultdict
import numpy as np
from PIL import Image

BASE = r"C:\RIS\RIS\data\world\maps\base"
MGR = r"C:\dev\_research\master_mgr.json"
OUTJS = r"C:\dev\Provincia\src\risRoads.js"

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]
is_sea = (reg[..., 0] == 41) & (reg[..., 1] == 140)
_blk = (reg[..., 0] == 0) & (reg[..., 1] == 0) & (reg[..., 2] == 0)
_wht = (reg[..., 0] == 255) & (reg[..., 1] == 255) & (reg[..., 2] == 255)

def to_land(x, y):
    xi, yi = int(x), int(y)
    if not (0 <= xi < Ww and 0 <= yi < Hh) or not is_sea[yi, xi]: return (x, y)
    seen = {(xi, yi)}; q = deque([(xi, yi)])
    while q:
        cx, cy = q.popleft()
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
            nx, ny = cx+dx, cy+dy
            if 0 <= nx < Ww and 0 <= ny < Hh and (nx,ny) not in seen:
                if not is_sea[ny, nx]: return (nx+0.5, ny+0.5)
                seen.add((nx,ny)); q.append((nx,ny))
    return (x, y)

def regcol(px, py):
    for rad in range(2, 7):
        cnt = Counter()
        for dy in range(-rad, rad+1):
            for dx in range(-rad, rad+1):
                x, y = int(px)+dx, int(py)+dy
                if 0 <= x < Ww and 0 <= y < Hh and not is_sea[y, x]:
                    c = tuple(int(v) for v in reg[y, x])
                    if c not in ((0,0,0),(255,255,255)): cnt[c] += 1
        if cnt: return cnt.most_common(1)[0][0]
    return None

j = json.load(open(MGR)); H = j["H"]
roads = j["roads"]
print("manager roads:", len(roads))

# NOTE: geometry detail comes from de-quantizing the manager tile-path (DP +
# Catmull-Rom in smooth()) — NOT from gathering aerial render points. Gathering
# loose aerial points reintroduced crossovers (points from adjacent chains leak
# in near junctions), so it was abandoned. The manager path IS the game's route;
# DP keeps its genuine bends while dropping 1px stair-steps.

def tpix(w): return (w[0], H - 1 - w[1])   # tile -> pixel (bottom-left origin)

# link (settlement-pair colours) per manager road, from its endpoint pixels
link_of = []
for r in roads:
    a = regcol(*tpix(r["w"][0])); b = regcol(*tpix(r["w"][-1]))
    link_of.append((a, b))

# ---- build undirected graph over TILES; edge -> set(road indices using it)
edges = defaultdict(set)          # frozenset({t1,t2}) -> road idx set
neigh = defaultdict(set)          # tile -> set(neighbour tiles)
for ri, r in enumerate(roads):
    w = r["w"]
    for k in range(len(w)-1):
        t1 = (w[k][0], w[k][1]); t2 = (w[k+1][0], w[k+1][1])
        if t1 == t2: continue
        e = frozenset((t1, t2))
        edges[e].add(ri); neigh[t1].add(t2); neigh[t2].add(t1)
deg = {t: len(ns) for t, ns in neigh.items()}
print("graph nodes:", len(neigh), "edges:", len(edges))

# ---- extract maximal chains between nodes of degree != 2 (junctions/ends);
# also handle degree-2 loops. Each edge consumed once.
used = set()
def walk(start, first):
    chain = [start, first]; used.add(frozenset((start, first)))
    prev, cur = start, first
    while deg.get(cur, 0) == 2:
        nxts = [t for t in neigh[cur] if t != prev]
        if not nxts: break
        nx = nxts[0]
        e = frozenset((cur, nx))
        if e in used: break
        used.add(e); chain.append(nx); prev, cur = cur, nx
    return chain
chains = []
for t in list(neigh):
    if deg[t] == 2: continue
    for nb in list(neigh[t]):
        if frozenset((t, nb)) in used: continue
        chains.append(walk(t, nb))
# leftover degree-2 loops (rings with no junction)
for e in edges:
    if e in used: continue
    t = next(iter(e)); chains.append(walk(t, (edges and next(iter(neigh[t]))) ))
print("chains:", len(chains))

# links using a chain = union of road sets over its edges
def chain_links(ch):
    s = set()
    for k in range(len(ch)-1):
        s |= edges.get(frozenset((ch[k], ch[k+1])), set())
    return s

# ---- smooth a chain: relax interior OFF the tile staircase (junction ends
# fixed so topology holds), then Catmull-Rom resample -> organic curve.
def _dp(pts, eps):
    # Douglas-Peucker: drop points within eps of the chord — removes the 1px
    # tile-staircase quantization while KEEPING real route bends (detail).
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0]-a[0], b[1]-a[1]; L2 = dx*dx+dy*dy or 1.0
    dmax = 0; idx = 0
    for i in range(1, len(pts)-1):
        px, py = pts[i]
        t = max(0.0, min(1.0, ((px-a[0])*dx + (py-a[1])*dy) / L2))
        cx, cy = a[0]+t*dx, a[1]+t*dy
        d = (px-cx)**2 + (py-cy)**2
        if d > dmax: dmax = d; idx = i
    if dmax > eps*eps:
        return _dp(pts[:idx+1], eps)[:-1] + _dp(pts[idx:], eps)
    return [a, b]

def smooth(ch, tiles):
    # GAME-STYLE WIGGLE (reverse-engineered from aerial_map_roads): simplify the
    # tile route to keypoints, give each node a unit tangent = normalize(next-
    # prev) rotated by a deterministic ±15° (per-tile hash, standing in for the
    # engine's terrain-seeded LCG — same organic character), then cubic Bezier
    # arm = tangent*seglen*0.33, 5 subdivisions. Clean topology + organic curves.
    P = [ (t[0]+0.5, H-1-t[1]+0.5) for t in ch ]
    if len(P) < 3:
        return [to_land(*p) for p in P]
    # keypoints (drop 1px stair-steps but keep genuine bends) with matching tiles
    K = []; KT = []
    keep_idx = _dp_idx(P, 0.9)
    for i in keep_idx: K.append(P[i]); KT.append(tiles[i] if i < len(tiles) else tiles[-1])
    if len(K) < 2: return [to_land(*p) for p in P]
    def jitter(t):
        h = (int(t[0])*73856093) ^ (int(t[1])*19349663)
        return (((h & 0x7fffffff) % 1000) / 1000.0 - 0.5) * (math.pi/6)   # ±15°
    T = []
    for i in range(len(K)):
        a = K[max(0,i-1)]; b = K[min(len(K)-1,i+1)]
        dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1.0
        ux, uy = dx/L, dy/L
        ang = jitter(KT[i]); c, s = math.cos(ang), math.sin(ang)
        T.append((ux*c - uy*s, ux*s + uy*c))
    out = [K[0]]
    for i in range(len(K)-1):
        p0, p3 = K[i], K[i+1]; t0, t1 = T[i], T[i+1]
        seg = math.hypot(p3[0]-p0[0], p3[1]-p0[1]) * 0.33
        p1 = (p0[0]+t0[0]*seg, p0[1]+t0[1]*seg)
        p2 = (p3[0]-t1[0]*seg, p3[1]-t1[1]*seg)
        for s2 in range(1, 6):
            t = s2/5; u = 1-t
            out.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],
                        u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return [to_land(x, y) for x, y in out]

def _dp_idx(pts, eps):
    # Douglas-Peucker returning KEPT INDICES (so we can map back to tiles)
    keep = [False]*len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts)-1)]
    while stack:
        a, b = stack.pop()
        if b <= a+1: continue
        ax, ay = pts[a]; bx, by = pts[b]; dx, dy = bx-ax, by-ay; L2 = dx*dx+dy*dy or 1.0
        dmax = 0; idx = a
        for i in range(a+1, b):
            px, py = pts[i]; t = max(0, min(1, ((px-ax)*dx+(py-ay)*dy)/L2))
            cx, cy = ax+t*dx, ay+t*dy; d = (px-cx)**2+(py-cy)**2
            if d > dmax: dmax = d; idx = i
        if dmax > eps*eps:
            keep[idx] = True; stack.append((a, idx)); stack.append((idx, b))
    return [i for i in range(len(pts)) if keep[i]]

fp = tuple(int(v) for v in reg[313, 244])
entries = []
for ch in chains:
    if len(ch) < 2: continue
    links = chain_links(ch)
    pairs = sorted({tuple(sorted([link_of[ri][0], link_of[ri][1]], key=lambda c:(c or (0,0,0)))) for ri in links if link_of[ri][0] or link_of[ri][1]})
    # primary a/b = chain endpoints' own region colours
    curve = smooth(ch, ch)
    a = regcol(*curve[0]); b = regcol(*curve[-1])
    cs = lambda q: (f'"{q[0]},{q[1]},{q[2]}"' if q else '""')
    ls = ",".join(f'"{p[0][0]},{p[0][1]},{p[0][2]}|{p[1][0]},{p[1][1]},{p[1][2]}"' for p in pairs if p[0] and p[1])
    # re-clamp the ROUNDED value (rounding can nudge a coastal point onto sea)
    rpts = []
    for x, y in curve:
        rx, ry = round(x, 2), round(y, 2)
        if 0 <= int(rx) < Ww and 0 <= int(ry) < Hh and is_sea[int(ry), int(rx)]:
            rx, ry = (round(v, 2) for v in to_land(rx, ry))
        rpts.append((rx, ry))
    flat = ",".join(f"{v:g}" for p in rpts for v in p)
    entries.append(f'{{a:{cs(a)},b:{cs(b)},l:[{ls}],p:[{flat}]}}')

landpts = 0
for e in entries: pass
js = ("// Road geometry from ROAD_MANAGER as a GRAPH (the game's exact topology):\n"
      "// shared tiles = shared nodes, so corridors merge (no doubles), junctions\n"
      "// connect, and roads never cross (they only meet at shared tiles). Each\n"
      "// chain between junctions is drawn once, smoothed, clamped to land; l = the\n"
      "// settlement-links using it (per-link visibility filter).\n"
      f"export const RIS_ROADS_FINGERPRINT = {{ x: 244, y: 313, rgb: [{fp[0]}, {fp[1]}, {fp[2]}], mapW: {Ww}, mapH: {Hh} }};\n"
      "export const RIS_ROADS = [\n" + ",\n".join(entries) + "\n];\n"
      "export const CAPTURED_MAPS = [\n  { name: \"RIS grand campaign\", fingerprint: RIS_ROADS_FINGERPRINT, roads: RIS_ROADS },\n];\n")
open(OUTJS, "w").write(js)
print("chains baked:", len(entries), "->", round(os.path.getsize(OUTJS)/1024), "KB")
