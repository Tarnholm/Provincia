"""Add per-region RUNS to src/risRoads.js entries: s:[[pointIdx,"r,g,b"],...]
Each run = the stretch of the road inside one region, so the app can clip a
road at region borders (show only the part inside regions that have roads
built). MUST run AFTER despike.py (vertex deletion shifts indices).
Border/settlement/sea pixels carry the previous region; micro-runs (<2 pts)
merge into their neighbour so the border doesn't flip-flop."""
import re, sys
import numpy as np
from PIL import Image

IN = sys.argv[1] if len(sys.argv) > 1 else r"C:\dev\Provincia\src\risRoads.js"
BASE = r"C:\RIS\RIS\data\world\maps\base"
reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]
is_sea = (reg[..., 0] == 41) & (reg[..., 1] == 140)

def region_at(x, y):
    xi, yi = int(x), int(y)
    if not (0 <= xi < Ww and 0 <= yi < Hh) or is_sea[yi, xi]: return None
    t = (int(reg[yi, xi, 0]), int(reg[yi, xi, 1]), int(reg[yi, xi, 2]))
    return None if t in ((0, 0, 0), (255, 255, 255)) else t

def runs_of(pts):
    runs = []                       # [startIdx, color]
    cur = None
    for i, (x, y) in enumerate(pts):
        c = region_at(x, y) or cur  # carry over border/settlement/sea px
        if c is None: continue      # leading unknowns: patched below
        if not runs or runs[-1][1] != c: runs.append([i, c])
        cur = c
    if not runs: return []
    runs[0][0] = 0                  # leading unknown points join the first run
    # merge micro-runs (<2 points) into the previous run, then re-merge same colours
    n = len(pts)
    out = []
    for k, r in enumerate(runs):
        end = runs[k+1][0] if k+1 < len(runs) else n
        if out and (end - r[0] < 2 or out[-1][1] == r[1]):
            continue                # absorbed by previous run
        out.append(r)
    return out

js = open(IN, encoding="utf-8").read()
head = js[:js.index("export const RIS_ROADS = [")]
tail = js[js.index("export const CAPTURED_MAPS"):]
pres = []; ptss = []
for m in re.finditer(r'(\{a:"[^"]*",b:"[^"]*",l:\[[^\]]*\],p:)\[([-0-9.,]+)\]', js):
    v = [float(x) for x in m.group(2).split(",")]
    pres.append(m.group(1))
    ptss.append([(v[k], v[k+1]) for k in range(0, len(v), 2)])

# ---- PORT-CONNECTOR chains (t:1): for each region with a port, the chains on
# the shortest settlement→port path through the network. Only these qualify in
# a port-only region (a===b is meaningless in the graph bake — many interior
# junction-to-junction chains start and end in one region).
import math, heapq
from collections import Counter, defaultdict

def anchor_region(x, y):
    cnt = Counter()
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            xi, yi = x+dx, y+dy
            if 0 <= xi < Ww and 0 <= yi < Hh and not is_sea[yi, xi]:
                t = (int(reg[yi, xi, 0]), int(reg[yi, xi, 1]), int(reg[yi, xi, 2]))
                if t not in ((0, 0, 0), (255, 255, 255)): cnt[t] += 1
    return cnt.most_common(1)[0][0] if cnt else None

blk = np.nonzero((reg[..., 0] == 0) & (reg[..., 1] == 0) & (reg[..., 2] == 0))
wht = np.nonzero((reg[..., 0] == 255) & (reg[..., 1] == 255) & (reg[..., 2] == 255))
settle = {}; ports = {}
for y, x in zip(*blk):
    rc = anchor_region(int(x), int(y))
    if rc: settle.setdefault(rc, (int(x)+0.5, int(y)+0.5))
for y, x in zip(*wht):
    rc = anchor_region(int(x), int(y))
    if rc: ports.setdefault(rc, (int(x)+0.5, int(y)+0.5))

def nkey(p): return (round(p[0]*2)/2, round(p[1]*2)/2)
adj = defaultdict(list)          # node -> [(other, chainIdx, length)]
for ci, pts in enumerate(ptss):
    L = sum(math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]) for i in range(len(pts)-1))
    a, b = nkey(pts[0]), nkey(pts[-1])
    adj[a].append((b, ci, L)); adj[b].append((a, ci, L))
nodes = list(adj)
ngrid = defaultdict(list)
for nd in nodes: ngrid[(int(nd[0]), int(nd[1]))].append(nd)
def nearest_node(p, r=3.0):
    best = None; bd = r*r
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            for nd in ngrid.get((int(p[0])+dx, int(p[1])+dy), ()):
                d = (nd[0]-p[0])**2 + (nd[1]-p[1])**2
                if d < bd: bd = d; best = nd
    return best

port_chains = set()
n_conn = 0
for rc, pp in ports.items():
    sp = settle.get(rc)
    if not sp: continue
    a = nearest_node(sp); b = nearest_node(pp)
    if not a or not b: continue
    # Dijkstra a->b, capped at 40px (connector is a short local path)
    dist = {a: 0.0}; prevc = {}; pq = [(0.0, a)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == b: break
        if d > dist.get(u, 1e18) or d > 40: continue
        for v, ci, w in adj[u]:
            nd = d + w
            if nd < dist.get(v, 1e18): dist[v] = nd; prevc[v] = (u, ci); heapq.heappush(pq, (nd, v))
    if b not in prevc: continue
    n_conn += 1
    u = b
    while u != a:
        u, ci = prevc[u]; port_chains.add(ci)

entries = []
n_multi = 0
for i, pts in enumerate(ptss):
    rs = runs_of(pts)
    if len(rs) > 1: n_multi += 1
    ss = ",".join(f'[{k},"{c[0]},{c[1]},{c[2]}"]' for k, c in rs)
    flat = ",".join(f"{x:g}" for pt in pts for x in pt)
    tflag = ",t:1" if i in port_chains else ""
    entries.append(f'{pres[i]}[{flat}],s:[{ss}]{tflag}}}')
open(IN, "w", encoding="utf-8").write(
    head + "export const RIS_ROADS = [\n" + ",\n".join(entries) + "\n];\n" + tail)
print(f"runs added: {len(entries)} roads, {n_multi} cross-region; "
      f"port connectors: {n_conn} regions, {len(port_chains)} chains flagged t:1")
