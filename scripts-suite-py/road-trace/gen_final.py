"""Bake the WHOLE-MAP road network into src/risRoads.js from the accumulated
game capture (master_render.json). Captured-only (no reproduced fill -> no
double lines), cubic Bezier (arm 0.33) through the engine's own nodes, deduped,
every point hard-clamped to land (never a sea pixel)."""
import json, math, os
from collections import Counter, deque
import numpy as np
from PIL import Image

BASE = r"C:\RIS\RIS\data\world\maps\base"
MASTER = r"C:\dev\_research\master_render.json"
OUTJS = r"C:\dev\Provincia\src\risRoads.js"

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]              # 700, 1020
H, W = Hh, Ww
# sea in map_regions is EXACTLY r=41,g=140 (blue varies with depth shading).
# The old range test also matched cyan-ish REGION colours (e.g. Velzna
# 14,171,199) and silently deleted their roads as "sea" — validator caught it.
is_sea = (reg[..., 0] == 41) & (reg[..., 1] == 140)

def to_land(x, y):
    xi, yi = int(x), int(y)
    if not (0 <= xi < Ww and 0 <= yi < Hh) or not is_sea[yi, xi]:
        return (x, y)
    seen = {(xi, yi)}; q = deque([(xi, yi)])
    while q:
        cx, cy = q.popleft()
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
            nx, ny = cx+dx, cy+dy
            if 0 <= nx < Ww and 0 <= ny < Hh and (nx,ny) not in seen:
                if not is_sea[ny, nx]: return (nx+0.5, ny+0.5)
                seen.add((nx,ny)); q.append((nx,ny))
    return (x, y)

def bez(nodes):  # node=[px,pz,tx,tz] tile; pixel=(px, H-pz), tangent=(tx,-tz)
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
    # roads the game draws along land strips too narrow to exist at map
    # resolution (e.g. the Gades spit) sit mostly on sea pixels here; clamping
    # them collapses the whole piece onto one shore pixel (degenerate dot /
    # tangle). Drop those instead — the app map shows blue there and roads may
    # never be on blue.
    sea_frac = sum(1 for x, y in out
                   if 0 <= int(x) < Ww and 0 <= int(y) < Hh and is_sea[int(y), int(x)]) / len(out)
    if sea_frac > 0.5: return None
    return [to_land(x, y) for x, y in out]

def regcol(px, py):
    cnt = Counter()
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            x, y = int(px)+dx, int(py)+dy
            if 0 <= x < W and 0 <= y < H and not is_sea[y, x]:
                c = tuple(int(v) for v in reg[y, x])
                if c not in ((0,0,0),(255,255,255)): cnt[c] += 1
    return cnt.most_common(1)[0][0] if cnt else None

j = json.load(open(MASTER))
raw = [nd for nd in j["roads"] if len(nd) >= 2]
print("master roads:", len(raw))

curves = []
dropped_sea = 0
for nd in raw:
    c = bez(nd)
    if c is None: dropped_sea += 1
    else: curves.append(c)
print("dropped (majority sub-resolution sea):", dropped_sea)

# dedup: A->B and B->A over the same path (sorted rounded endpoints + midpoint)
def sig(c):
    e0 = (round(c[0][0]/2)*2, round(c[0][1]/2)*2); e1 = (round(c[-1][0]/2)*2, round(c[-1][1]/2)*2)
    m = c[len(c)//2]; mid = (round(m[0]/3)*3, round(m[1]/3)*3)
    return (tuple(sorted([e0, e1])), mid)
seen = set(); ded = []
for c in curves:
    k = sig(c)
    if k in seen: continue
    seen.add(k); ded.append(c)
print("after dedup:", len(ded), "(from", len(curves), ")")

# snapshot of ALL raw curve endpoints (pre-mutation) — used by the final
# attach-loose-ends pass to know which ends were CONNECTED in the game data
raw_ends_all = []
for c in curves:
    raw_ends_all.append(tuple(c[0])); raw_ends_all.append(tuple(c[-1]))
raw_grid = {}
for i, p in enumerate(raw_ends_all): raw_grid.setdefault((int(p[0]), int(p[1])), []).append(i)
def raw_shared(p):
    # was this raw endpoint shared with a DIFFERENT raw endpoint (within 0.6)?
    n = 0
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for i in raw_grid.get((int(p[0]) + dx, int(p[1]) + dy), ()):
                q = raw_ends_all[i]
                if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= 0.36: n += 1
    return n >= 2  # itself + at least one partner
class Curve(list): pass
ded = [Curve(c) for c in ded]
for c in ded: c.orig = (tuple(c[0]), tuple(c[-1]))

# ---- endpoint joining, CONTINUATION-ONLY: in the raw game data, pieces at a
# junction already share EXACT points; settlement anchors are separate nodes
# ~1px away (must NOT be merged — doing so kinked the curve into a spike, the
# "bad Y" bug). The only real gaps are border joins where one piece ends
# heading a direction and the next continues it (~1px offset). Merge ONLY
# pairs whose into-piece direction vectors are near-opposite, and FEATHER the
# correction over several points so the curve stays smooth (no endpoint kink).
RJOIN = 1.6
FEATHER = 6
# settlement (black px) / port (white px) anchors from map_regions — road ends
# sitting on these are the game's own anchor nodes and must NEVER be moved,
# joined, or removed (removing the short Olbia->junction piece as a "triangle
# sliver" pulled the road off the settlement — user caught it).
_blk = (reg[..., 0] == 0) & (reg[..., 1] == 0) & (reg[..., 2] == 0)
_wht = (reg[..., 0] == 255) & (reg[..., 1] == 255) & (reg[..., 2] == 255)
ANCH = set()
ys, xs = np.nonzero(_blk | _wht)
for yy, xx in zip(ys.tolist(), xs.tolist()): ANCH.add((xx, yy))
def is_anchor(p):
    for dx in (-1, 0):
        for dy in (-1, 0):
            if (int(p[0] + 0.5) + dx, int(p[1] + 0.5) + dy) in ANCH:
                ax, ay = int(p[0] + 0.5) + dx + 0.5, int(p[1] + 0.5) + dy + 0.5
                if (p[0] - ax) ** 2 + (p[1] - ay) ** 2 <= 0.81: return True
    return False
def into_dir(c, at_start):
    # unit vector pointing from the endpoint INTO the piece
    a = c[0] if at_start else c[-1]
    b = c[min(2, len(c) - 1)] if at_start else c[max(-3, -len(c))]
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy) or 1.0
    return (dx / L, dy / L)
def feather_move(c, at_start, target):
    # move the endpoint to target, decaying the shift over FEATHER points
    a = c[0] if at_start else c[-1]
    ddx, ddy = target[0] - a[0], target[1] - a[1]
    n = len(c)
    for k in range(min(FEATHER, n)):
        w = 1.0 - k / FEATHER
        i = k if at_start else n - 1 - k
        c[i] = to_land(c[i][0] + ddx * w, c[i][1] + ddy * w)
pts = []  # (x, y, piece_idx, at_start)
for ci, c in enumerate(ded):
    pts.append((c[0][0], c[0][1], ci, True)); pts.append((c[-1][0], c[-1][1], ci, False))
grid = {}
def cell(x, y): return (int(x / RJOIN), int(y / RJOIN))
for i, (x, y, ci, st) in enumerate(pts): grid.setdefault(cell(x, y), []).append(i)
used = set()  # endpoint indices already joined
joined = 0
pairs = []
for i, (x, y, ci, st) in enumerate(pts):
    cx, cy = cell(x, y)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for j in grid.get((cx + dx, cy + dy), ()):
                if j <= i: continue
                x2, y2, cj, st2 = pts[j]
                if cj == ci: continue                      # never join a piece to itself
                d2 = (x2 - x) ** 2 + (y2 - y) ** 2
                if d2 < 1e-9 or d2 > RJOIN * RJOIN: continue  # exact-shared already fine
                if is_anchor((x, y)) or is_anchor((x2, y2)): continue  # anchors stay put
                u1 = into_dir(ded[ci], st); u2 = into_dir(ded[cj], st2)
                dot = u1[0] * u2[0] + u1[1] * u2[1]
                if dot < -0.7:                              # continuation join only
                    pairs.append((d2, i, j))
pairs.sort(key=lambda t: t[0])
for d2, i, j in pairs:
    if i in used or j in used: continue
    x, y, ci, st = pts[i]; x2, y2, cj, st2 = pts[j]
    mid = to_land((x + x2) / 2, (y + y2) / 2)
    feather_move(ded[ci], st, mid); feather_move(ded[cj], st2, mid)
    used.add(i); used.add(j); joined += 1
print(f"continuation joins: {joined} border gaps closed (feathered)")

# ---- near-duplicate collapse: adjacent regions each store their own copy of
# a shared-border piece; the copies follow the same route within ~1px. Drawn
# as thin lines they read as tangles. Collapse groups sharing BOTH endpoints
# whose max route deviation < 1.5px to ONE piece. DIVERGENT alternates (e.g.
# the road through Olbia's settlement vs around it, dev >= 1.5px) are two REAL
# roads the game draws — keep both. (Earlier "keep shortest per pair" deleted
# those real roads — user caught it.)
def maxdev(a, b):
    m = 0.0
    for x, y in a:
        best = 1e18
        for u, v in b:
            d = (x - u) ** 2 + (y - v) ** 2
            if d < best: best = d
        if best > m: m = best
    return math.sqrt(m)
# grid-based candidate matching (endpoints are unsnapped, copies can sit up to
# ~1.2px apart — exact-key grouping would miss them)
def ecell(x, y): return (int(x / 1.5), int(y / 1.5))
egrid = {}
for ci, c in enumerate(ded):
    for p in (c[0], c[-1]): egrid.setdefault(ecell(*p), set()).add(ci)
def near(p, q): return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= 1.2 * 1.2
# keeper preference: keep the copy whose ends sit ON settlement/port anchors
# and on junction-shared points — dropping the anchored copy disconnected
# settlements (Velzna/Arpi bug, caught by validate.py).
endcount = {}
for c in ded:
    for p in (c[0], c[-1]):
        k = (round(p[0], 1), round(p[1], 1)); endcount[k] = endcount.get(k, 0) + 1
def keep_score(c):
    s = 0
    for p in (c[0], c[-1]):
        if is_anchor(p): s += 10
        s += min(endcount.get((round(p[0], 1), round(p[1], 1)), 1) - 1, 3)
    return s
removed = set()
collapsed = 0
for ci, c in enumerate(ded):
    if ci in removed: continue
    cands = set()
    for p in (c[0], c[-1]):
        cx, cy = ecell(*p)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1): cands |= egrid.get((cx + dx, cy + dy), set())
    for cj in sorted(cands):
        if cj == ci or cj in removed: continue
        d = ded[cj]
        same = (near(c[0], d[0]) and near(c[-1], d[-1])) or (near(c[0], d[-1]) and near(c[-1], d[0]))
        if same and maxdev(c, d) < 1.5 and maxdev(d, c) < 1.5:
            # remove the copy with the LOWER keep score
            if keep_score(d) > keep_score(c):
                removed.add(ci); collapsed += 1; break
            removed.add(cj); collapsed += 1
ded = [c for ci, c in enumerate(ded) if ci not in removed]
print(f"near-duplicate collapse: removed {collapsed} same-route copies -> {len(ded)}")

# ---- junction triangle cleanup: the game data holds tiny 1-2px connector
# pieces between junction points; under the game's thick road texture they
# vanish (junction reads as a clean Y), but thin lines show them as small
# triangles (user-reported). Remove a tiny piece ONLY when BOTH its ends are
# through-junctions (>=1 other piece attached on each side), and merge the two
# junctions into one point. Dead-end stubs (settlement/port links) are kept.
def plen2(c):
    return sum(math.hypot(c[i+1][0]-c[i][0], c[i+1][1]-c[i][1]) for i in range(len(c)-1))
def jkey(p): return (round(p[0], 2), round(p[1], 2))
changed = True; tri_removed = 0
while changed:
    changed = False
    deg = {}
    for c in ded:
        deg[jkey(c[0])] = deg.get(jkey(c[0]), 0) + 1
        deg[jkey(c[-1])] = deg.get(jkey(c[-1]), 0) + 1
    for i, c in enumerate(ded):
        j0, j1 = jkey(c[0]), jkey(c[-1])
        if j0 == j1: continue
        if plen2(c) < 2.2 and deg.get(j0, 0) >= 2 and deg.get(j1, 0) >= 2 \
                and not is_anchor(c[0]) and not is_anchor(c[-1]):
            m = to_land((c[0][0] + c[-1][0]) / 2, (c[0][1] + c[-1][1]) / 2)
            del ded[i]
            for c2 in ded:
                if jkey(c2[0]) in (j0, j1): feather_move(c2, True, m)
                if jkey(c2[-1]) in (j0, j1): feather_move(c2, False, m)
            tri_removed += 1; changed = True; break
print(f"junction triangles removed: {tri_removed} tiny connector pieces merged into junctions")

# ---- UNIFIED connection pass (validator invariant: every end terminates at
# a settlement/port anchor or a junction with another road). For each dead end
# take the NEAREST target across ALL kinds — other endpoints, other pieces'
# polylines (T-junction), anchors — in growing radii. Running these as
# SEPARATE passes caused visible diagonal yanks: endpoint-attach grabbed a far
# endpoint (1.5px) when the true continuation polyline passed 0.3px away
# (Uselis mess), and anchor-snap dragged an end 2.3px straight to a settlement
# across terrain when the road it should T-join ran right beside it (Sulci).
# Nothing is ever deleted here (deletion broke Syracuse's only port road).
anch_grid = {}
for (ax, ay) in ANCH: anch_grid.setdefault((ax // 2, ay // 2), []).append((ax + 0.5, ay + 0.5))
def anchors_near(p, rad):
    out = []
    cx, cy = int(p[0]) // 2, int(p[1]) // 2
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for a in anch_grid.get((cx + dx, cy + dy), ()):
                d = (a[0] - p[0]) ** 2 + (a[1] - p[1]) ** 2
                if d <= rad * rad: out.append((d, a))
    return [a for d, a in sorted(out)]
def has_partner(g, p, ci, rad=0.55):
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for q, cj in g.get((int(p[0]) + dx, int(p[1]) + dy), ()):
                if cj != ci and (q[0]-p[0])**2 + (q[1]-p[1])**2 <= rad*rad: return True
    return False
def append_connector(c, at_start, target):
    # extend the tip to target with a short quadratic-Bezier blend that leaves
    # the piece's own geometry untouched — feather-dragging the tip sideways
    # painted visible straight diagonals (Uselis / Sulci mess).
    tip = c[0] if at_start else c[-1]
    nxt = c[min(2, len(c) - 1)] if at_start else c[max(-3, -len(c))]
    tx, ty = tip[0] - nxt[0], tip[1] - nxt[1]
    L = math.hypot(tx, ty) or 1.0
    dist = math.hypot(target[0] - tip[0], target[1] - tip[1])
    ctrl = (tip[0] + tx / L * dist * 0.4, tip[1] + ty / L * dist * 0.4)
    seg = []
    for k in range(1, 6):
        t = k / 5.0; u = 1 - t
        seg.append(to_land(u*u*tip[0] + 2*u*t*ctrl[0] + t*t*target[0],
                           u*u*tip[1] + 2*u*t*ctrl[1] + t*t*target[1]))
    if at_start:
        for q in seg: c.insert(0, q)
    else:
        c.extend(seg)
stats = Counter()
for _round, _rad in enumerate((1.6, 2.5, 4.5)):
    egrid2 = {}
    pgrid = {}
    for ci, c in enumerate(ded):
        for p in (c[0], c[-1]): egrid2.setdefault((int(p[0]), int(p[1])), []).append((tuple(p), ci))
        for k in range(1, len(c) - 1):
            p = c[k]
            pgrid.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1], ci))
    moved = 0
    for ci, c in enumerate(ded):
        for at_start in (True, False):
            p = c[0] if at_start else c[-1]
            if is_anchor(p): continue
            if has_partner(egrid2, p, ci): continue
            o = c.orig[0] if at_start else c.orig[1]
            if _rad == 4.5 and not raw_shared(o):
                continue  # widest radius only for ends the game itself had connected
            other = c[-1] if at_start else c[0]
            cand = []   # (dist2, point, kind)
            rr = 1 + int(_rad)
            for dx in range(-rr, rr + 1):
                for dy in range(-rr, rr + 1):
                    for q, cj in egrid2.get((int(p[0]) + dx, int(p[1]) + dy), ()):
                        if cj == ci: continue
                        d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
                        if 1e-9 < d <= _rad * _rad: cand.append((d, q, "end"))
                    for x, y, cj in pgrid.get((int(p[0]) + dx, int(p[1]) + dy), ()):
                        if cj == ci: continue
                        d = (x - p[0]) ** 2 + (y - p[1]) ** 2
                        if 1e-9 < d <= _rad * _rad: cand.append((d, (x, y), "poly"))
            arad = min(_rad, 2.5)
            for a in anchors_near(p, arad):
                if (other[0] - a[0]) ** 2 + (other[1] - a[1]) ** 2 <= 0.25: continue  # fold-back
                cand.append(((a[0] - p[0]) ** 2 + (a[1] - p[1]) ** 2, a, "anchor"))
            if not cand: continue
            cand.sort(key=lambda t: t[0])
            d, q, kind = cand[0]
            # a RAW dead end near a settlement/port is the game's settlement
            # approach (city model hides the last 1-2px): it must reach the
            # ANCHOR, not T-join a road passing slightly nearer (Praeneste).
            # Raw-SHARED ends are junction ends — nearest target is correct.
            if not raw_shared(o):
                anch = [t for t in cand if t[2] == "anchor"]
                if anch: d, q, kind = anch[0]
            if d <= 0.6 * 0.6:
                feather_move(c, at_start, q)   # sub-pixel: plain snap is invisible
            else:
                append_connector(c, at_start, q)
            stats[kind] += 1; moved += 1
    print(f"unified connect round {_round + 1} (rad {_rad}): {moved}")
    if not moved and _rad != 4.5: break
print(f"connections: {dict(stats)}")
# rebuild pgrid over FULL curves for the link-graph section below
pgrid = {}
for ci, c in enumerate(ded):
    for k in range(len(c)):
        p = c[k]
        pgrid.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1], ci))

seapts = sum(1 for c in ded for x,y in c if 0<=int(x)<Ww and 0<=int(y)<Hh and is_sea[int(y),int(x)])
print("sea points:", seapts)

def nearcols(px, py, rad=2):
    # all region colours within rad of the point — a border junction returns
    # BOTH regions of the link, so the app can filter at link level (game
    # rule: link drawn iff >=1 side has roads).
    cols = set()
    for dy in range(-rad, rad + 1):
        for dx in range(-rad, rad + 1):
            x, y = int(px) + dx, int(py) + dy
            if 0 <= x < W and 0 <= y < H and not is_sea[y, x]:
                c = tuple(int(v) for v in reg[y, x])
                if c not in ((0, 0, 0), (255, 255, 255)): cols.add(c)
    return cols

# ---- LINK terminal assignment: the game draws roads per LINK (settlement to
# settlement; drawn iff EITHER side has roads, even across roadless middle
# regions — Cornus reaches Pluvium across roadless Corsicosardinia). Filtering
# by the piece's LOCAL endpoint regions hid middle pieces of cross-region
# links (Friniatia / Vocontia / Turonia bugs). So: build the road graph, run a
# multi-source Dijkstra from every settlement/port anchor, and tag each piece
# with its two LINK TERMINAL regions (nearest anchor through the graph from
# each end, second-nearest when both ends see the same anchor).
import heapq
def nk(p): return (round(p[0], 1), round(p[1], 1))
node_id = {}; node_pos = []
def get_node(p):
    k = nk(p)
    if k not in node_id:
        node_id[k] = len(node_pos); node_pos.append(p)
    return node_id[k]
adj = {}
for ci, c in enumerate(ded):
    n1, n2 = get_node(c[0]), get_node(c[-1])
    w = max(plen2(c), 0.05)
    adj.setdefault(n1, []).append((n2, w, ci)); adj.setdefault(n2, []).append((n1, w, ci))
# T-junction edges: an endpoint feathered onto another piece's INTERIOR point
# is a junction too — connect its node to that piece's two end nodes so the
# graph walk can pass through (weights split by arc position).
for ci, c in enumerate(ded):
    for p in (c[0], c[-1]):
        n = node_id[nk(p)]
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for x, y, cj in pgrid.get((int(p[0]) + dx, int(p[1]) + dy), ()):
                    if cj == ci: continue
                    if (x - p[0]) ** 2 + (y - p[1]) ** 2 <= 0.09:
                        d = ded[cj]
                        m1, m2 = node_id[nk(d[0])], node_id[nk(d[-1])]
                        w = max(plen2(d) * 0.5, 0.05)
                        adj.setdefault(n, []).append((m1, w, cj)); adj.setdefault(m1, []).append((n, w, cj))
                        adj.setdefault(n, []).append((m2, w, cj)); adj.setdefault(m2, []).append((n, w, cj))
                        break
# anchor nodes: node within 0.95 of a settlement/port pixel-center.
# Region of an anchor = most common region colour in the SMALLEST ring around
# its pixel (3x3 first, then grow) — a wide sample at a border-hugging
# settlement picks the NEIGHBOUR region (Metapontion bug).
def anchor_region(ax, ay):
    xi, yi = int(ax), int(ay)
    for rad in (1, 2, 3):
        cnt = Counter()
        for dy in range(-rad, rad + 1):
            for dx in range(-rad, rad + 1):
                x, y = xi + dx, yi + dy
                if 0 <= x < W and 0 <= y < H and not is_sea[y, x]:
                    t = tuple(int(v) for v in reg[y, x])
                    if t not in ((0, 0, 0), (255, 255, 255)): cnt[t] += 1
        if cnt: return cnt.most_common(1)[0][0]
    return None
# anchor-centric claim: every settlement/port claims its NEAREST road node
# (up to 2.5px away — the game's own node can sit 1-2px off the black pixel).
# Node-centric detection missed those settlements entirely, wiping whole
# regions out of the link terminals.
ngrid = {}
for ni, p in enumerate(node_pos): ngrid.setdefault((int(p[0]) // 2, int(p[1]) // 2), []).append(ni)
anchor_col = {}
anchor_claim_d = {}
for (axp, ayp) in ANCH:
    ax, ay = axp + 0.5, ayp + 0.5
    col = anchor_region(ax, ay)
    if not col: continue
    best = None; bd = 2.5 * 2.5
    cx, cy = int(ax) // 2, int(ay) // 2
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for ni in ngrid.get((cx + dx, cy + dy), ()):
                p = node_pos[ni]
                d = (p[0] - ax) ** 2 + (p[1] - ay) ** 2
                if d < bd: bd = d; best = ni
    if best is not None and bd < anchor_claim_d.get(best, 1e18):
        anchor_col[best] = col; anchor_claim_d[best] = bd
print(f"link graph: {len(node_pos)} nodes, {len(anchor_col)} anchor nodes")
# --- LINK-PATH DECOMPOSITION: replicate the game's build_road_links.
# Links = settlement -> each ADJACENT region's settlement, + settlement -> own
# port. Trace each link's path through the captured graph (Dijkstra); every
# piece on the path carries that link. A piece is visible iff ANY of its links
# has a side with roads. (Nearest-anchor tagging broke at branch junctions.)
INF = 1e18
# region adjacency from map_regions pixel neighbours
SEAC = is_sea
def okcol(t): return t not in ((0, 0, 0), (255, 255, 255))
adjpairs = set()
rr = reg.astype(np.int32)
packed = (rr[..., 0] << 16) | (rr[..., 1] << 8) | rr[..., 2]
packed[SEAC] = -1
for axis, (sl1, sl2) in ((0, (np.s_[:-1, :], np.s_[1:, :])), (1, (np.s_[:, :-1], np.s_[:, 1:]))):
    a1 = packed[sl1].ravel(); a2 = packed[sl2].ravel()
    m = (a1 != a2) & (a1 >= 0) & (a2 >= 0)
    for v1, v2 in zip(a1[m].tolist(), a2[m].tolist()):
        c1 = ((v1 >> 16) & 255, (v1 >> 8) & 255, v1 & 255)
        c2 = ((v2 >> 16) & 255, (v2 >> 8) & 255, v2 & 255)
        if okcol(c1) and okcol(c2): adjpairs.add(tuple(sorted((c1, c2))))
print(f"region adjacency pairs: {len(adjpairs)}")
# settlement / port node per region colour
set_node = {}; port_nodes = {}
for ni, col in anchor_col.items():
    p = node_pos[ni]
    aa = anchors_near(p, 2.5)
    if not aa: continue
    ax, ay = aa[0]
    is_set = (int(ax), int(ay)) in ANCH and _blk[int(ay), int(ax)]
    if is_set:
        if col not in set_node or anchor_claim_d.get(ni, 9) < anchor_claim_d.get(set_node[col], 9):
            set_node[col] = ni
    else:
        port_nodes.setdefault(col, []).append(ni)
print(f"settlement nodes: {len(set_node)}, port regions: {len(port_nodes)}")
def dijkstra_path(src, dst):
    dist = {src: 0.0}; prev = {}
    pq = [(0.0, src)]
    while pq:
        d, n = heapq.heappop(pq)
        if n == dst: break
        if d > dist.get(n, INF): continue
        for m, w, ci in adj.get(n, ()):
            nd = d + w
            if nd < dist.get(m, INF):
                dist[m] = nd; prev[m] = (n, ci); heapq.heappush(pq, (nd, m))
    if dst not in dist: return None, None
    edges = []; n = dst
    while n != src:
        pn, ci = prev[n]; edges.append(ci); n = pn
    return dist[dst], edges
piece_links = [[] for _ in ded]
nlinks = 0
for (cA, cB) in adjpairs:
    nA, nB = set_node.get(cA), set_node.get(cB)
    if nA is None or nB is None or nA == nB: continue
    pA, pB = node_pos[nA], node_pos[nB]
    euclid = math.hypot(pA[0] - pB[0], pA[1] - pB[1])
    d, edges = dijkstra_path(nA, nB)
    if edges is None or d > max(euclid * 2.5, euclid + 8): continue
    nlinks += 1
    for ci in edges: piece_links[ci].append((cA, cB))
for col, pns in port_nodes.items():
    nS = set_node.get(col)
    if nS is None: continue
    for pn in pns:
        d, edges = dijkstra_path(nS, pn)
        if edges is None or d > 25: continue
        nlinks += 1
        for ci in edges: piece_links[ci].append((col, col))
untagged = sum(1 for L in piece_links if not L)
print(f"links traced: {nlinks}; untagged pieces: {untagged}")
def link_terms(ci, c):
    L = piece_links[ci]
    if L: return L[0][0], L[0][1]
    return regcol(*c[0]), regcol(*c[-1])

fp = tuple(int(v) for v in reg[313, 244])
entries = []
for ci, c in enumerate(ded):
    a, b = link_terms(ci, c)
    if a is None: a = regcol(*c[0])
    if b is None: b = regcol(*c[-1])
    cs = lambda q: (f'"{q[0]},{q[1]},{q[2]}"' if q else '""')
    # l = ALL links whose path uses this piece (beyond the primary a/b pair),
    # as "rA,gA,bA|rB,gB,bB" strings — the app shows the piece if ANY link
    # passes the visibility rule.
    extra = piece_links[ci][1:]
    rl = ",".join(f'"{q[0][0]},{q[0][1]},{q[0][2]}|{q[1][0]},{q[1][1]},{q[1][2]}"' for q in extra)
    # round for output, then re-check land — rounding 87.9996 -> 88.0 can hop
    # onto a sea pixel; re-clamp the ROUNDED value so what we WRITE is on land
    rpts = []
    for p in c:
        rx, ry = round(p[0], 2), round(p[1], 2)
        if 0 <= int(rx) < Ww and 0 <= int(ry) < Hh and is_sea[int(ry), int(rx)]:
            rx, ry = (round(v, 2) for v in to_land(rx, ry))
        rpts.append((rx, ry))
    flat = ",".join(f"{v:g}" for p in rpts for v in p)
    entries.append(f'{{a:{cs(a)},b:{cs(b)},l:[{rl}],p:[{flat}]}}')
js = ("// WHOLE-MAP road network: the game's ACTUAL drawn curve for every province,\n"
      "// read from memory (fog off, all roads built) and rebuilt as cubic Bezier\n"
      "// through the engine's own nodes. Captured-only (no reproduced fallback ->\n"
      "// no double lines). Every point clamped to land (never a sea pixel).\n"
      f"export const RIS_ROADS_FINGERPRINT = {{ x: 244, y: 313, rgb: [{fp[0]}, {fp[1]}, {fp[2]}], mapW: {W}, mapH: {H} }};\n"
      "export const RIS_ROADS = [\n" + ",\n".join(entries) + "\n];\n"
      "export const CAPTURED_MAPS = [\n  { name: \"RIS grand campaign\", fingerprint: RIS_ROADS_FINGERPRINT, roads: RIS_ROADS },\n];\n")
open(OUTJS, "w").write(js)
print("roads", len(entries), "->", round(os.path.getsize(OUTJS)/1024), "KB")
