"""Bake the game's ACTUAL sea routes (AERIAL_MAP_SEA_ROUTES, dumped to
master_sea.json as integer TILE paths) into a CANDIDATE module
src/risSea.candidate.js — does NOT touch risSea.js or the build.

Pipeline (mirrors the winning ROAD approach, adapted for sea):
  tile -> pixel        (x + 0.5, H - 1 - y + 0.5)   [verified vs map_regions]
  clamp                every point to NAVIGABLE water (sea r==41,g==140 exact,
                       OR white 255,255,255 port pixel) — never a range test
  DP simplify          eps DP_EPS: drops the 1px tile-staircase quantization,
                       KEEPS genuine route bends (the anti-v1366 lesson:
                       don't Chaikin everything into mush)
  Bezier               tangents synthesized = normalize(next - prev) at each
                       keypoint (sea routes store none), arm = 0.33 * seglen —
                       the game's own aerial-road arm constant — 5 subdivisions
  re-clamp             every emitted point, AND again after rounding to 2
                       decimals (int() pixel tests, never round())
  dedup                same unordered endpoint pair + near-identical path

Validation pass (printed, exit 1 on land points):
  points on land, endpoints not within 2px of a white port pixel, duplicate
  routes, windowed-heading hairpins (2px window each side, dot < -0.7).
Also renders 3 comparison boxes (raw tiles vs baked curve) to the scratchpad.
"""
import json, math, os, sys
from collections import Counter, deque
import numpy as np
from PIL import Image, ImageDraw

BASE   = r"C:\RIS\RIS\data\world\maps\base"
MASTER = r"C:\dev\_research\master_sea.json"
OUTJS  = r"C:\dev\Provincia\src\risSea.candidate.js"
SCRATCH = r"C:\Users\vtarn\AppData\Local\Temp\claude\C--Users-vtarn-OneDrive-Skrivbord\6fd4885d-f016-48c8-bf38-a20b78536fc3\scratchpad"

DP_EPS = 0.7    # px; staircase amplitude ~0.5, genuine bends kept above this
ARM    = 0.33   # game's aerial Bezier arm constant
SUBDIV = 5

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]
is_sea  = (reg[..., 0] == 41) & (reg[..., 1] == 140)      # exact signature; b varies with depth
is_port = (reg[..., 0] == 255) & (reg[..., 1] == 255) & (reg[..., 2] == 255)
navigable = is_sea | is_port

def on_nav(x, y):
    xi, yi = int(x), int(y)                                # int(), never round()
    return 0 <= xi < Ww and 0 <= yi < Hh and navigable[yi, xi]

def to_sea(x, y):
    """Clamp a point to the nearest navigable pixel (BFS ring)."""
    if on_nav(x, y): return (x, y)
    xi, yi = int(x), int(y)
    seen = {(xi, yi)}; q = deque([(xi, yi)])
    while q:
        cx, cy = q.popleft()
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
            nx, ny = cx+dx, cy+dy
            if 0 <= nx < Ww and 0 <= ny < Hh and (nx, ny) not in seen:
                if navigable[ny, nx]: return (nx + 0.5, ny + 0.5)
                seen.add((nx, ny)); q.append((nx, ny))
    return (x, y)

def dp_idx(pts, eps):
    """Douglas-Peucker, returns KEPT indices."""
    keep = [False]*len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts)-1)]
    while stack:
        a, b = stack.pop()
        if b <= a+1: continue
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx-ax, by-ay; L2 = dx*dx+dy*dy or 1.0
        dmax = 0.0; idx = a
        for i in range(a+1, b):
            px, py = pts[i]
            t = max(0.0, min(1.0, ((px-ax)*dx+(py-ay)*dy)/L2))
            d = (px-ax-t*dx)**2 + (py-ay-t*dy)**2
            if d > dmax: dmax = d; idx = i
        if dmax > eps*eps:
            keep[idx] = True; stack.append((a, idx)); stack.append((idx, b))
    return [i for i in range(len(pts)) if keep[i]]

def smooth(P):
    """DP keypoints -> cubic Bezier with synthesized tangents, clamped."""
    if len(P) < 3:
        return [to_sea(*p) for p in P]
    K = [P[i] for i in dp_idx(P, DP_EPS)]
    if len(K) < 2:
        return [to_sea(*p) for p in P]
    T = []
    for i in range(len(K)):
        a = K[max(0, i-1)]; b = K[min(len(K)-1, i+1)]
        dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1.0
        T.append((dx/L, dy/L))
    out = [K[0]]
    for i in range(len(K)-1):
        p0, p3 = K[i], K[i+1]; t0, t1 = T[i], T[i+1]
        seg = math.hypot(p3[0]-p0[0], p3[1]-p0[1]) * ARM
        p1 = (p0[0]+t0[0]*seg, p0[1]+t0[1]*seg)
        p2 = (p3[0]-t1[0]*seg, p3[1]-t1[1]*seg)
        for s in range(1, SUBDIV+1):
            t = s/SUBDIV; u = 1-t
            out.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],
                        u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return [to_sea(x, y) for x, y in out]

def portcol(px, py):
    """Nearest land region colour around an endpoint (the port's owner)."""
    for rad in range(2, 9):
        cnt = Counter()
        for dy in range(-rad, rad+1):
            for dx in range(-rad, rad+1):
                x, y = int(px)+dx, int(py)+dy
                if 0 <= x < Ww and 0 <= y < Hh and not navigable[y, x]:
                    c = tuple(int(v) for v in reg[y, x])
                    if c not in ((0, 0, 0), (255, 255, 255)): cnt[c] += 1
        if cnt: return cnt.most_common(1)[0][0]
    return None

# ---------------- bake ----------------
j = json.load(open(MASTER)); H = j["H"]
assert j["W"] == Ww and j["H"] == Hh, "map size mismatch"
routes = [r for r in j["routes"] if len(r) >= 2]
print("raw sea routes:", len(routes))

curves = []
for tiles in routes:
    P = [to_sea(x + 0.5, H - 1 - y + 0.5) for x, y in tiles]   # verified convention
    curves.append(smooth(P))

# round to 2 decimals, re-clamp the ROUNDED value
def round_clamp(c):
    out = []
    for x, y in c:
        rx, ry = round(x, 2), round(y, 2)
        if not on_nav(rx, ry):
            rx, ry = (round(v, 2) for v in to_sea(rx, ry))
        out.append((rx, ry))
    return out
curves = [round_clamp(c) for c in curves]

# ---------------- dedup ----------------
def resample(c, n=24):
    d = [0.0]
    for i in range(1, len(c)): d.append(d[-1] + math.hypot(c[i][0]-c[i-1][0], c[i][1]-c[i-1][1]))
    L = d[-1] or 1.0
    out = []; k = 0
    for s in range(n):
        t = L * s/(n-1)
        while k < len(d)-2 and d[k+1] < t: k += 1
        seg = d[k+1]-d[k] or 1.0; f = (t-d[k])/seg
        out.append((c[k][0]+(c[k+1][0]-c[k][0])*f, c[k][1]+(c[k+1][1]-c[k][1])*f))
    return out

by_pair = {}
kept = []; dupes = []
for ci, c in enumerate(curves):
    e0 = (int(c[0][0]), int(c[0][1])); e1 = (int(c[-1][0]), int(c[-1][1]))
    key = tuple(sorted((e0, e1)))
    dup = False
    for kj in by_pair.get(key, []):
        a = resample(kept[kj]); b = resample(c); br = list(reversed(b))
        for cand in (b, br):
            avg = sum(math.hypot(p[0]-q[0], p[1]-q[1]) for p, q in zip(a, cand)) / len(a)
            if avg < 1.5: dup = True; break
        if dup: break
    if dup: dupes.append(ci); continue
    by_pair.setdefault(key, []).append(len(kept)); kept.append(c)
print(f"dedup: {len(dupes)} duplicates dropped -> {len(kept)} routes")

# ---------------- validate ----------------
land = [(ci, x, y) for ci, c in enumerate(kept) for x, y in c if not on_nav(x, y)]
noport = []
for ci, c in enumerate(kept):
    for x, y in (c[0], c[-1]):
        if not any(0 <= int(x)+dx < Ww and 0 <= int(y)+dy < Hh and is_port[int(y)+dy, int(x)+dx]
                   for dx in range(-2, 3) for dy in range(-2, 3)):
            noport.append((ci, round(x, 1), round(y, 1)))

SPIKE_DOT, WIN = -0.7, 2.0
def dir_win(p, k, step):
    x0, y0 = p[k]; acc = 0.0; j2 = k
    while True:
        nj = j2 + step
        if nj < 0 or nj >= len(p): break
        acc += math.hypot(p[nj][0]-p[j2][0], p[nj][1]-p[j2][1]); j2 = nj
        if acc >= WIN: break
    dx, dy = p[j2][0]-x0, p[j2][1]-y0; L = math.hypot(dx, dy)
    return (dx/L, dy/L) if L > 0.3 else None
spikes = []
for ci, p in enumerate(kept):
    for k in range(1, len(p)-1):
        db, df = dir_win(p, k, -1), dir_win(p, k, +1)
        if db and df and (-db[0])*df[0] + (-db[1])*df[1] < SPIKE_DOT:
            spikes.append((ci, round(p[k][0], 1), round(p[k][1], 1)))

print(f"VALIDATE: routes={len(kept)}  land-points={len(land)}  "
      f"endpoints-not-on-port={len(noport)}  spikes={len(spikes)}  dupes-removed={len(dupes)}")
for it in noport[:6]: print("  no-port endpoint:", it)
for it in spikes[:6]: print("  spike:", it)
if land:
    for it in land[:6]: print("  LAND:", it)

# ---------------- emit candidate module ----------------
fp = tuple(int(v) for v in reg[313, 244])
entries = []
for c in kept:
    a = portcol(*c[0]); b = portcol(*c[-1])
    cs = lambda q: (f'"{q[0]},{q[1]},{q[2]}"' if q else '""')
    flat = ",".join(f"{v:g}" for p in c for v in p)
    entries.append(f'{{a:{cs(a)},b:{cs(b)},p:[{flat}]}}')
js = ("// CANDIDATE - the game's ACTUAL sea routes (AERIAL_MAP_SEA_ROUTES) read from\n"
      "// memory as integer tile paths. DP-simplified (staircase removed, real bends\n"
      "// kept) + Bezier (synthesized tangents, arm 0.33). Every point on navigable\n"
      "// water (sea or port pixel). a/b = nearest PORT region colour.\n"
      f"export const RIS_SEA_FINGERPRINT = {{ x: 244, y: 313, rgb: [{fp[0]}, {fp[1]}, {fp[2]}], mapW: {Ww}, mapH: {Hh} }};\n"
      "export const RIS_SEA = [\n" + ",\n".join(entries) + "\n];\n"
      "export const CAPTURED_SEA = [\n  { name: \"RIS grand campaign\", fingerprint: RIS_SEA_FINGERPRINT, routes: RIS_SEA },\n];\n")
open(OUTJS, "w", encoding="utf-8").write(js)
print("candidate:", OUTJS, round(os.path.getsize(OUTJS)/1024), "KB")

# ---------------- comparison renders ----------------
SCALE = 20
BOXES = {"sea2_aegean":    (470, 330, 580, 420),
         "sea2_sardinia":  (220, 290, 330, 380),
         "sea2_carthage":  (230, 330, 340, 430)}   # Carthage/Sicily strait (orig 300-400/380-450 was open sea)
raw_px = [[(x + 0.5, H - 1 - y + 0.5) for x, y in tiles] for tiles in routes]

def draw_dashed(dr, pts, color, width, dash=0.6*SCALE, gap=0.4*SCALE):
    acc = 0.0; on = True
    for i in range(len(pts)-1):
        x0, y0 = pts[i]; x1, y1 = pts[i+1]
        seg = math.hypot(x1-x0, y1-y0)
        t = 0.0
        while t < seg:
            step = min((dash if on else gap) - acc, seg - t)
            if on:
                fx0 = x0+(x1-x0)*(t/seg); fy0 = y0+(y1-y0)*(t/seg)
                fx1 = x0+(x1-x0)*((t+step)/seg); fy1 = y0+(y1-y0)*((t+step)/seg)
                dr.line([fx0, fy0, fx1, fy1], fill=color, width=width)
            t += step; acc += step
            if acc >= (dash if on else gap) - 1e-9: on = not on; acc = 0.0

for name, (x0, y0, x1, y1) in BOXES.items():
    bg = reg[y0:y1, x0:x1]
    img = Image.fromarray(bg).resize(((x1-x0)*SCALE, (y1-y0)*SCALE), Image.NEAREST).convert("RGB")
    dr = ImageDraw.Draw(img)
    def inbox(c): return any(x0-5 <= p[0] <= x1+5 and y0-5 <= p[1] <= y1+5 for p in c)
    def scr(c): return [((px-x0)*SCALE, (py-y0)*SCALE) for px, py in c]
    n = 0
    for rp in raw_px:                                  # raw tiles: thin orange solid
        if inbox(rp): dr.line([v for p in scr(rp) for v in p], fill=(255, 140, 0), width=2)
    for c in kept:                                     # baked: dashed white/cyan
        if inbox(c): draw_dashed(dr, scr(c), (240, 255, 255), 4); n += 1
    img.save(os.path.join(SCRATCH, name + ".png"))
    print(f"render {name}: {n} baked routes in box")

sys.exit(1 if land else 0)
