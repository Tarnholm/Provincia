"""MASK bake: manager-graph TOPOLOGY (master_mgr) used as a corridor mask for
the AERIAL render geometry (master_render). Whole aerial pieces keep their
native point order (that's where the game's real detail + sharp corners live);
the manager graph only decides WHICH pieces belong to which corridor and WHERE
the junctions are (chain ends pinned to shared junction nodes -> connected by
construction, no doubles, no crossings between corridors).
Zigzag can't happen inside a piece — ordering is decided per-PIECE (median
projection along the corridor), never per-point. Chains with no aerial
coverage fall back to the RE'd game wiggle synthesis (same as gen_mgr.py)."""
import json, math, os
from collections import Counter, deque, defaultdict
import numpy as np
from PIL import Image

BASE = r"C:\RIS\RIS\data\world\maps\base"
MGR = r"C:\dev\_research\master_mgr.json"
AER = r"C:\dev\_research\master_render.json"
OUTJS = r"C:\dev\Provincia\src\risRoads.js"

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]
is_sea = (reg[..., 0] == 41) & (reg[..., 1] == 140)

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

def tpix(w): return (w[0], H - 1 - w[1])

link_of = []
for r in roads:
    a = regcol(*tpix(r["w"][0])); b = regcol(*tpix(r["w"][-1]))
    link_of.append((a, b))

# ---- manager graph (identical to gen_mgr.py) --------------------------------
edges = defaultdict(set); neigh = defaultdict(set)
for ri, r in enumerate(roads):
    w = r["w"]
    for k in range(len(w)-1):
        t1 = (w[k][0], w[k][1]); t2 = (w[k+1][0], w[k+1][1])
        if t1 == t2: continue
        e = frozenset((t1, t2))
        edges[e].add(ri); neigh[t1].add(t2); neigh[t2].add(t1)
deg = {t: len(ns) for t, ns in neigh.items()}
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
for e in edges:
    if e in used: continue
    t = next(iter(e)); chains.append(walk(t, next(iter(neigh[t]))))
print("chains:", len(chains))

def chain_links(ch):
    s = set()
    for k in range(len(ch)-1):
        s |= edges.get(frozenset((ch[k], ch[k+1])), set())
    return s

# ---- wiggle fallback (RE'd game curve synthesis, same as gen_mgr.py) --------
def _dp_idx(pts, eps):
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

def smooth(ch, tiles):
    P = [(t[0]+0.5, H-1-t[1]+0.5) for t in ch]
    if len(P) < 3:
        return [to_land(*p) for p in P]
    K = []; KT = []
    keep_idx = _dp_idx(P, 0.15)
    for i in keep_idx: K.append(P[i]); KT.append(tiles[i] if i < len(tiles) else tiles[-1])
    if len(K) < 2: return [to_land(*p) for p in P]
    def jitter(t):
        h = (int(t[0])*73856093) ^ (int(t[1])*19349663)
        return (((h & 0x7fffffff) % 1000) / 1000.0 - 0.5) * (math.pi/6)
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
        seg = math.hypot(p3[0]-p0[0], p3[1]-p0[1]) * 0.18
        p1 = (p0[0]+t0[0]*seg, p0[1]+t0[1]*seg)
        p2 = (p3[0]-t1[0]*seg, p3[1]-t1[1]*seg)
        for s2 in range(1, 6):
            t = s2/5; u = 1-t
            out.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],
                        u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return [to_land(x, y) for x, y in out]

# ---- aerial pieces (the game's exact rendered spline, RE'd Bezier) ----------
_AER = json.load(open(AER))
def _bez(nodes):
    P = [(n[0], H-n[1]) for n in nodes]; T = [(n[2], -n[3]) for n in nodes]
    out = [P[0]]
    for i in range(len(P)-1):
        p0, p3 = P[i], P[i+1]; t0, t1 = T[i], T[i+1]
        p1 = (p0[0]+t0[0]*.33, p0[1]+t0[1]*.33); p2 = (p3[0]-t1[0]*.33, p3[1]-t1[1]*.33)
        for k in range(1, 6):
            t = k/5; u = 1-t
            out.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],
                        u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return out
pieces = [_bez(r) for r in _AER["roads"] if len(r) >= 2]
print("aerial pieces:", len(pieces))

# spatial grid over corridor tiles: chain idx -> set of dilated cells
MATCH_R = 1.6
chain_cells = []          # per chain: {cell: nearest centerline idx}
cell_owner = defaultdict(list)   # cell -> [(chain idx)]
centers = []
for qi, ch in enumerate(chains):
    center = [(t[0]+0.5, H-1-t[1]+0.5) for t in ch]
    centers.append(center)
    cm = {}
    for ci, (x, y) in enumerate(center):
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                cell = (int(x)+dx, int(y)+dy)
                if cell not in cm: cm[cell] = ci
    chain_cells.append(cm)
    for cell in cm: cell_owner[cell].append(qi)

# assign each piece to its best chain by coverage fraction
def proj(qi, x, y):
    """nearest centerline index of chain qi to point, within MATCH_R; else None"""
    center = centers[qi]; cm = chain_cells[qi]
    best = None; bd = MATCH_R*MATCH_R
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            ci = cm.get((int(x)+dx, int(y)+dy))
            if ci is None: continue
            # scan a small neighbourhood of indices for true nearest
            for cj in range(max(0, ci-2), min(len(center), ci+3)):
                cx, cy = center[cj]; d = (cx-x)**2+(cy-y)**2
                if d < bd: bd = d; best = cj
    return best

assign = defaultdict(list)   # chain idx -> [(piece idx, [proj indices])]
unused_pieces = 0
for pi, pc in enumerate(pieces):
    # candidate chains = owners of cells touched by this piece
    cand = Counter()
    for (x, y) in pc:
        for qi in cell_owner.get((int(x), int(y)), ()): cand[qi] += 1
    best_q = None; best_frac = 0.0; best_pr = None
    for qi in cand:
        pr = [proj(qi, x, y) for (x, y) in pc]
        frac = sum(1 for v in pr if v is not None) / len(pc)
        if frac > best_frac: best_frac = frac; best_q = qi; best_pr = pr
    if best_q is not None and best_frac >= 0.7:
        assign[best_q].append((pi, best_pr))
    else:
        unused_pieces += 1
print("pieces assigned:", sum(len(v) for v in assign.values()), "unassigned:", unused_pieces)

def plen(pc): return sum(math.hypot(pc[i+1][0]-pc[i][0], pc[i+1][1]-pc[i][1]) for i in range(len(pc)-1))

def build_masked(qi):
    """stitch assigned aerial pieces along chain qi; None if coverage too low"""
    center = centers[qi]; n = len(center)
    items = []
    for pi, pr in assign[qi]:
        idxs = [v for v in pr if v is not None]
        if len(idxs) < 2: continue
        pc = pieces[pi]
        # orient piece along the corridor
        first = next(v for v in pr if v is not None)
        last = next(v for v in reversed(pr) if v is not None)
        if last < first: pc = pc[::-1]; pr = pr[::-1]
        med = sorted(idxs)[len(idxs)//2]
        items.append({"pc": pc, "pr": pr, "lo": min(idxs), "hi": max(idxs),
                      "med": med, "len": plen(pc)})
    if not items: return None
    # coverage check: union of intervals vs centerline length
    ivs = sorted((it["lo"], it["hi"]) for it in items)
    cov = 0; ce = -1
    for lo, hi in ivs:
        if lo > ce: cov += hi-lo; ce = hi
        elif hi > ce: cov += hi-ce; ce = hi
    if n > 3 and cov / (n-1) < 0.55: return None
    # prune pieces mostly covered by longer ones (parallel duplicates)
    items.sort(key=lambda it: -it["len"])
    kept = []
    for it in items:
        span = max(1, it["hi"]-it["lo"])
        ov = 0
        for k in kept:
            o = min(it["hi"], k["hi"]) - max(it["lo"], k["lo"])
            if o > 0: ov = max(ov, o)
        if ov / span < 0.6: kept.append(it)
    kept.sort(key=lambda it: it["med"])
    # stitch: clip each piece to the UNCOVERED projection interval — no lateral
    # overlap between consecutive pieces means no doubling-back at seams
    out = []; cov_end = -1
    for it in kept:
        pc, pr = it["pc"], it["pr"]
        k0 = 0
        if out:
            k0 = len(pc)
            for k in range(len(pc)):
                if pr[k] is not None and pr[k] > cov_end: k0 = k; break
        seg = pc[k0:]
        if len(seg) < 2: continue
        out.extend(seg)
        cov_end = max(cov_end, it["hi"])
    if len(out) < 2: return None
    # pin ends to the manager junction nodes (shared -> connected junctions):
    # CUT to the point nearest the node within the head/tail, then prepend the
    # node itself — never bends the curve back (no hairpin, no feather).
    A = to_land(*center[0]); B = to_land(*center[-1])
    def pin(seq, target):
        look = min(10, len(seq)-2)
        best_k = 0; bd = 1e18
        for k in range(look+1):
            d = (seq[k][0]-target[0])**2 + (seq[k][1]-target[1])**2
            if d < bd: bd = d; best_k = k
        seq = seq[best_k:]
        if bd > 0.1: seq = [target] + seq
        else: seq[0] = target
        return seq
    out = pin(out, A)
    out = pin(out[::-1], B)[::-1]
    return [to_land(x, y) for x, y in out]

fp = tuple(int(v) for v in reg[313, 244])
# chains listed here bake with wiggle even if aerial coverage exists — filled
# by the convergence loop with chains whose aerial geometry created NEW issues
# (spike/crossover/junction-spike not present in the all-wiggle baseline)
FORCE = set()
_ff = os.path.join(os.path.dirname(os.path.abspath(__file__)), "force_wiggle.json")
if os.path.exists(_ff): FORCE = set(json.load(open(_ff)))
print("force-wiggle chains:", len(FORCE))
entries = []; n_aer = 0; n_wig = 0; aer_idx = []
for qi, ch in enumerate(chains):
    if len(ch) < 2: continue
    links = chain_links(ch)
    pairs = sorted({tuple(sorted([link_of[ri][0], link_of[ri][1]], key=lambda c:(c or (0,0,0)))) for ri in links if link_of[ri][0] or link_of[ri][1]})
    curve = None if len(entries) in FORCE else build_masked(qi)
    if curve is not None: n_aer += 1; aer_idx.append(len(entries))
    else: curve = smooth(ch, ch); n_wig += 1
    a = regcol(*curve[0]); b = regcol(*curve[-1])
    cs = lambda q: (f'"{q[0]},{q[1]},{q[2]}"' if q else '""')
    ls = ",".join(f'"{p[0][0]},{p[0][1]},{p[0][2]}|{p[1][0]},{p[1][1]},{p[1][2]}"' for p in pairs if p[0] and p[1])
    rpts = []
    for x, y in curve:
        rx, ry = round(x, 2), round(y, 2)
        if 0 <= int(rx) < Ww and 0 <= int(ry) < Hh and is_sea[int(ry), int(rx)]:
            rx, ry = (round(v, 2) for v in to_land(rx, ry))
        rpts.append((rx, ry))
    flat = ",".join(f"{v:g}" for p in rpts for v in p)
    entries.append(f'{{a:{cs(a)},b:{cs(b)},l:[{ls}],p:[{flat}]}}')

js = ("// Road geometry: manager-graph topology (junctions/corridors) masked with the\n"
      "// game's actual AERIAL render curves — whole pieces in native order (real\n"
      "// detail), corridors merge, junction ends pinned to shared nodes. Chains\n"
      "// without aerial coverage use the RE'd wiggle synthesis. l = settlement-links.\n"
      f"export const RIS_ROADS_FINGERPRINT = {{ x: 244, y: 313, rgb: [{fp[0]}, {fp[1]}, {fp[2]}], mapW: {Ww}, mapH: {Hh} }};\n"
      "export const RIS_ROADS = [\n" + ",\n".join(entries) + "\n];\n"
      "export const CAPTURED_MAPS = [\n  { name: \"RIS grand campaign\", fingerprint: RIS_ROADS_FINGERPRINT, roads: RIS_ROADS },\n];\n")
open(OUTJS, "w", encoding="utf-8").write(js)
json.dump(aer_idx, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mask_aerial_idx.json"), "w"))
print("chains baked:", len(entries), "aerial-masked:", n_aer, "wiggle:", n_wig, "->", round(os.path.getsize(OUTJS)/1024), "KB")
