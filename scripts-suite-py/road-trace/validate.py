"""Validate baked risRoads.js against the RAW game capture (master_render.json).
Checks, map-wide:
  1. anchor connectivity — every settlement/port pixel touched by raw road ends
     must still be touched in the bake (catches Olbia/Velzna-class bugs)
  2. dangling ends — baked endpoint connected in raw but connected to nothing
     in the bake (catches cut-offs)
  3. degenerate / tiny pieces
  4. sea points
Prints a numbered issue list with coordinates + nearest settlement name."""
import json, math, re
import numpy as np
from PIL import Image

BASE = r"C:\RIS\RIS\data\world\maps\base"
MASTER = r"C:\dev\_research\master_render.json"
OUTJS = r"C:\dev\Provincia\src\risRoads.js"

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]
H = Hh
is_sea = (reg[..., 0] == 41) & (reg[..., 1] == 140)  # exact sea signature
blk = (reg[..., 0] == 0) & (reg[..., 1] == 0) & (reg[..., 2] == 0)
wht = (reg[..., 0] == 255) & (reg[..., 1] == 255) & (reg[..., 2] == 255)

# region name lookup for reporting
name_by_rgb = {}
txt = open(BASE + r"\descr_regions.txt", encoding="latin-1").read()
for b in txt.split("\n\n"):
    lines = [l.strip() for l in b.splitlines() if l.strip() and not l.strip().startswith(";")]
    if len(lines) < 5: continue
    nm, st = lines[0], lines[1]
    for l in lines:
        m = re.match(r"^(\d+)\s+(\d+)\s+(\d+)$", l)
        if m:
            name_by_rgb[tuple(int(x) for x in m.groups())] = (nm, st)
            break
def regname(x, y):
    for r in range(0, 4):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                xx, yy = int(x) + dx, int(y) + dy
                if 0 <= xx < Ww and 0 <= yy < Hh:
                    t = tuple(int(v) for v in reg[yy, xx])
                    if t in name_by_rgb: return name_by_rgb[t]
    return ("?", "?")

# anchors
anchors = []  # (x+0.5, y+0.5, 'settlement'|'port')
ys, xs = np.nonzero(blk)
for y, x in zip(ys.tolist(), xs.tolist()): anchors.append((x + 0.5, y + 0.5, "settlement"))
ys, xs = np.nonzero(wht)
for y, x in zip(ys.tolist(), xs.tolist()): anchors.append((x + 0.5, y + 0.5, "port"))

# raw curves (bez, exactly like gen_final)
j = json.load(open(MASTER))
def bez(nodes):
    P = [(n[0], H - n[1]) for n in nodes]; T = [(n[2], -n[3]) for n in nodes]
    out = [P[0]]
    for i in range(len(P) - 1):
        p0, p3 = P[i], P[i + 1]; t0, t1 = T[i], T[i + 1]
        p1 = (p0[0] + t0[0] * .33, p0[1] + t0[1] * .33); p2 = (p3[0] - t1[0] * .33, p3[1] - t1[1] * .33)
        for k in range(1, 6):
            t = k / 5; u = 1 - t
            out.append((u**3*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t**3*p3[0],
                        u**3*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t**3*p3[1]))
    return out
rawc = [bez(nd) for nd in j["roads"] if len(nd) >= 2]

# baked pieces
js = open(OUTJS, encoding="utf-8").read()
baked = []
for m in re.finditer(r"p:\[([-0-9.,]+)\]", js):
    v = [float(x) for x in m.group(1).split(",")]
    baked.append([(v[k], v[k + 1]) for k in range(0, len(v), 2)])
print(f"raw curves: {len(rawc)}   baked pieces: {len(baked)}")

def endgrid(curves):
    g = {}
    for ci, c in enumerate(curves):
        for p in (c[0], c[-1]): g.setdefault((int(p[0]), int(p[1])), []).append((p, ci))
    return g
def near_end(g, p, rad, skip_ci=None):
    out = []
    for dx in range(-1 - int(rad), 2 + int(rad)):
        for dy in range(-1 - int(rad), 2 + int(rad)):
            for q, ci in g.get((int(p[0]) + dx, int(p[1]) + dy), ()):
                if skip_ci is not None and ci == skip_ci: continue
                if (q[0]-p[0])**2 + (q[1]-p[1])**2 <= rad*rad: out.append((q, ci))
    return out
graw = endgrid(rawc); gbak = endgrid(baked)

issues = []
# 1. anchor connectivity
for ax, ay, kind in anchors:
    rawn = len(near_end(graw, (ax, ay), 0.95))
    bakn = len(near_end(gbak, (ax, ay), 0.95))
    if rawn > 0 and bakn == 0:
        nm, st = regname(ax, ay)
        issues.append(f"ANCHOR-LOST {kind} at ({ax},{ay}) {nm}/{st}: raw had {rawn} road ends, baked has 0")

pgrid = {}
for ci, c in enumerate(baked):
    for p in c: pgrid.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1], ci))
def on_other_polyline(p, ci, rad=0.9):
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for x, y, cj in pgrid.get((int(p[0]) + dx, int(p[1]) + dy), ()):
                if cj != ci and (x - p[0]) ** 2 + (y - p[1]) ** 2 <= rad * rad: return True
    return False

# 2. dangling ends: baked endpoint with no baked partner/polyline nearby but raw partner existed
#    (skip anchor-touching ends: legit dead-ends)
def poly_near(curves_grid_pts, p, rad, skip_ci):
    return False  # endpoint check is enough at this scale
def anchored(p):
    return any((p[0]-ax)**2 + (p[1]-ay)**2 <= 0.9 for ax, ay, _ in anchors)
dang = 0
for ci, c in enumerate(baked):
    for p in (c[0], c[-1]):
        if anchored(p): continue
        if near_end(gbak, p, 0.7, skip_ci=ci): continue
        if on_other_polyline(p, ci): continue  # T-junction = connected
        # find this endpoint's RAW origin (nearest raw endpoint within 1.2) and
        # check whether THAT point was shared with another raw curve (a joint).
        origins = near_end(graw, p, 1.2)
        if not origins: continue
        oq, oci = min(origins, key=lambda t: (t[0][0]-p[0])**2 + (t[0][1]-p[1])**2)
        raw_partners = [1 for q2, ci2 in near_end(graw, oq, 0.6) if ci2 != oci]
        if raw_partners:
            nm, st = regname(*p)
            issues.append(f"DANGLING end at ({p[0]:.1f},{p[1]:.1f}) {nm}/{st} (raw had {len(raw_partners)} partners)")
            dang += 1

# 2b. END INVARIANT (user spec): every road end must terminate at a
#     settlement/port anchor OR at a junction with another road (shared
#     endpoint or a point on another road's polyline).
for ci, c in enumerate(baked):
    for p in (c[0], c[-1]):
        if anchored(p): continue
        if near_end(gbak, p, 0.7, skip_ci=ci): continue
        if on_other_polyline(p, ci): continue
        nm, st = regname(*p)
        issues.append(f"END-INVARIANT broken at ({p[0]:.1f},{p[1]:.1f}) {nm}/{st}: end reaches no settlement, port or junction")

# 3. degenerate / tiny
for c in baked:
    L = sum(math.hypot(c[i+1][0]-c[i][0], c[i+1][1]-c[i][1]) for i in range(len(c)-1))
    if L < 0.4:
        nm, st = regname(*c[0])
        issues.append(f"TINY piece L={L:.2f} at ({c[0][0]:.1f},{c[0][1]:.1f}) {nm}/{st}")

# 4. sea
seac = sum(1 for c in baked for x, y in c
           if 0 <= int(x) < Ww and 0 <= int(y) < Hh and is_sea[int(y), int(x)])
if seac: issues.append(f"SEA points: {seac}")

# 5. FILTERED-VIEW check: simulate the app's campaign-start filter and verify
#    the visible subset ALSO satisfies the end invariant (a visible piece must
#    not dangle because its continuation is hidden), and that every region
#    with start roads shows roads at its settlement.
STRAT = r"C:\RIS\RIS\data\world\maps\campaign\imperial_campaign\descr_strat.txt"
strat = open(STRAT, encoding="latin-1").read()
start_roads = set(); start_ports = set()
for bmatch in re.finditer(r"settlement\s*\{(.*?)\n\}", strat, re.S):
    body = bmatch.group(1)
    rm = re.search(r"region\s+(\S+)", body)
    if not rm: continue
    if "hinterland_roads" in body: start_roads.add(rm.group(1))
    if "port_buildings" in body or "river_port" in body: start_ports.add(rm.group(1))
col_by_name = {}
for rgb, (nm, st) in name_by_rgb.items(): col_by_name[nm] = rgb
roadcols = {col_by_name[n] for n in start_roads if n in col_by_name}
portcols = {col_by_name[n] for n in start_ports if n in col_by_name}
ab = []
for m in re.finditer(r'\{a:"([^"]*)",b:"([^"]*)",l:\[([^\]]*)\]', js):
    pa = tuple(int(v) for v in m.group(1).split(",")) if m.group(1) else None
    pb = tuple(int(v) for v in m.group(2).split(",")) if m.group(2) else None
    pairs = [(pa, pb)]
    for lm in re.finditer(r'"([\d,]+)\|([\d,]+)"', m.group(3)):
        pairs.append((tuple(int(v) for v in lm.group(1).split(",")),
                      tuple(int(v) for v in lm.group(2).split(","))))
    ab.append(pairs)
assert len(ab) == len(baked), f"a/b parse mismatch {len(ab)} vs {len(baked)}"
def pair_vis(pa, pb):
    if pa is None and pb is None: return True
    return (pa in roadcols) or (pb in roadcols) or (pa == pb and pa in portcols)
keepf = [any(pair_vis(pa, pb) for pa, pb in pairs) for pairs in ab]
# visibility closure — mirrors the app: a kept end touching only hidden pieces
# un-hides them (the game never draws a dead end)
gall = {}
for ci, c in enumerate(baked):
    for k, p in enumerate(c):
        gall.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1], ci))
def touch_all(x, y, self_ci, r2=0.81):
    res = set()
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for qx, qy, cj in gall.get((int(x) + dx, int(y) + dy), ()):
                if cj != self_ci and (qx - x) ** 2 + (qy - y) ** 2 <= r2: res.add(cj)
    return res
for _ in range(12):
    changed = False
    for ci, c in enumerate(baked):
        if not keepf[ci]: continue
        for p in (c[0], c[-1]):
            near = touch_all(p[0], p[1], ci)
            if not near: continue
            if any(keepf[j] for j in near): continue
            for j in near:
                keepf[j] = True; changed = True
    if not changed: break
vis = [i for i, k in enumerate(keepf) if k]
visset = set(vis)
gvis = {}
for ci in vis:
    c = baked[ci]
    for p in (c[0], c[-1]): gvis.setdefault((int(p[0]), int(p[1])), []).append((p, ci))
pgv = {}
for ci in vis:
    for p in baked[ci]: pgv.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1], ci))
def vis_near_end(p, rad, skip_ci):
    out = []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for q, ci in gvis.get((int(p[0]) + dx, int(p[1]) + dy), ()):
                if ci != skip_ci and (q[0]-p[0])**2 + (q[1]-p[1])**2 <= rad*rad: out.append(q)
    return out
def vis_on_poly(p, ci):
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for x, y, cj in pgv.get((int(p[0]) + dx, int(p[1]) + dy), ()):
                if cj != ci and (x-p[0])**2 + (y-p[1])**2 <= 0.81: return True
    return False
nvi = 0
for ci in vis:
    c = baked[ci]
    for p in (c[0], c[-1]):
        if anchored(p): continue
        if vis_near_end(p, 0.7, ci): continue
        if vis_on_poly(p, ci): continue
        nm, st = regname(*p)
        issues.append(f"FILTERED-DANGLE at ({p[0]:.1f},{p[1]:.1f}) {nm}/{st}: visible piece ends where its continuation is hidden")
        nvi += 1
# every start-roads region shows roads at its settlement
for nm in start_roads:
    rgb = col_by_name.get(nm)
    if rgb is None: continue
    mask = (reg[..., 0] == rgb[0]) & (reg[..., 1] == rgb[1]) & (reg[..., 2] == rgb[2])
    if not mask.any(): continue
    ys2, xs2 = np.nonzero(mask)
    # settlement anchor = the black px with MAX count of this region colour in
    # its 3x3 (first-hit matching grabbed a neighbour's settlement)
    sx = sy = None; bc = 0
    for ax, ay, kind in anchors:
        if kind != "settlement": continue
        xi, yi = int(ax), int(ay)
        y0b, y1b = max(0, yi-1), min(Hh, yi+2); x0b, x1b = max(0, xi-1), min(Ww, xi+2)
        cnt = int(((reg[y0b:y1b, x0b:x1b] == rgb).all(axis=-1)).sum())
        if cnt > bc: bc = cnt; sx, sy = ax, ay
    hit = sx is not None and (vis_near_end((sx, sy), 1.8, -1) or vis_on_poly((sx, sy), -1))
    # exempt regions the GAME draws no roads for (no raw capture ends near the
    # settlement — isolated/impassable, e.g. deep desert and steppe edges)
    if sx is not None and not hit:
        if not near_end(graw, (sx, sy), 2.5): continue
        issues.append(f"START-ROADS region {nm} shows NO visible road at its settlement ({sx},{sy})")
print(f"filtered view: {len(vis)}/{len(baked)} pieces visible at campaign start")

print(f"\n=== {len(issues)} issues ===")
for i, s in enumerate(issues): print(f"{i+1:3d}. {s}")
if not issues: print("ALL CLEAN")
