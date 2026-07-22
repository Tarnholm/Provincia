"""Render regions from risRoads.js exactly as the APP will show them at
campaign start: link-pair filter + visibility closure (mirrors App.js)."""
import re, sys
import numpy as np
from PIL import Image, ImageDraw

BASE = r"C:\RIS\RIS\data\world\maps\base"
STRAT = r"C:\RIS\RIS\data\world\maps\campaign\imperial_campaign\descr_strat.txt"
OUTJS = r"C:\dev\Provincia\src\risRoads.js"
SP = r"C:\Users\vtarn\AppData\Local\Temp\claude\C--Users-vtarn-OneDrive-Skrivbord\6fd4885d-f016-48c8-bf38-a20b78536fc3\scratchpad"

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]

# start road/port colour sets
txt = open(BASE + r"\descr_regions.txt", encoding="latin-1").read()
col_by_name = {}
for b in txt.split("\n\n"):
    lines = [l.strip() for l in b.splitlines() if l.strip() and not l.strip().startswith(";")]
    if len(lines) < 5: continue
    for l in lines:
        m = re.match(r"^(\d+)\s+(\d+)\s+(\d+)$", l)
        if m: col_by_name[lines[0]] = tuple(int(x) for x in m.groups()); break
strat = open(STRAT, encoding="latin-1").read()
roadcols = set(); portcols = set()
for bm in re.finditer(r"settlement\s*\{(.*?)\n\}", strat, re.S):
    body = bm.group(1); rm = re.search(r"region\s+(\S+)", body)
    if not rm or rm.group(1) not in col_by_name: continue
    if "hinterland_roads" in body: roadcols.add(col_by_name[rm.group(1)])
    if "port_buildings" in body or "river_port" in body: portcols.add(col_by_name[rm.group(1)])

# parse pieces
js = open(OUTJS, encoding="utf-8").read()
pieces = []; pairs_all = []
for m in re.finditer(r'\{a:"([^"]*)",b:"([^"]*)",l:\[([^\]]*)\],p:\[([-0-9.,]+)\]', js):
    pa = tuple(int(v) for v in m.group(1).split(",")) if m.group(1) else None
    pb = tuple(int(v) for v in m.group(2).split(",")) if m.group(2) else None
    prs = [(pa, pb)]
    for lm in re.finditer(r'"([\d,]+)\|([\d,]+)"', m.group(3)):
        prs.append((tuple(int(v) for v in lm.group(1).split(",")),
                    tuple(int(v) for v in lm.group(2).split(","))))
    v = [float(x) for x in m.group(4).split(",")]
    pieces.append([(v[k], v[k+1]) for k in range(0, len(v), 2)])
    pairs_all.append(prs)
print(f"pieces: {len(pieces)}")

def pv(pa, pb):
    if pa is None and pb is None: return True
    return pa in roadcols or pb in roadcols or (pa == pb and pa in portcols)
keep = [any(pv(a, b) for a, b in prs) for prs in pairs_all]
gall = {}
for ci, c in enumerate(pieces):
    for p in c: gall.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1], ci))
def touch(x, y, s):
    r = set()
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for qx, qy, cj in gall.get((int(x)+dx, int(y)+dy), ()):
                if cj != s and (qx-x)**2 + (qy-y)**2 <= 0.81: r.add(cj)
    return r
for _ in range(12):
    ch = False
    for ci, c in enumerate(pieces):
        if not keep[ci]: continue
        for p in (c[0], c[-1]):
            nr = touch(p[0], p[1], ci)
            if nr and not any(keep[j] for j in nr):
                for j in nr: keep[j] = True
                ch = True
    if not ch: break
print(f"visible at start: {sum(keep)}")

def render(x0, y0, x1, y1, sc, out):
    img = Image.fromarray(reg[y0:y1, x0:x1]).resize(((x1-x0)*sc, (y1-y0)*sc), Image.NEAREST)
    d = ImageDraw.Draw(img); n = 0
    sel = [c for ci, c in enumerate(pieces) if keep[ci]
           and any(x0 <= p[0] <= x1 and y0 <= p[1] <= y1 for p in (c[0], c[len(c)//2], c[-1]))]
    for c in sel:
        pts = [((p[0]-x0)*sc, (p[1]-y0)*sc) for p in c]
        d.line(pts, fill=(84, 58, 34), width=5, joint="curve")
    for c in sel:
        pts = [((p[0]-x0)*sc, (p[1]-y0)*sc) for p in c]
        d.line(pts, fill=(202, 170, 120), width=3, joint="curve")
    img.save(out); print(out.split("\\")[-1], len(sel), "pieces")

for name, (cx, cy) in [
    ("f_friniatia", (263, 262)), ("f_vocontia", (211, 252)),
    ("f_vennonia", (None, None)), ("f_turonia", (None, None)), ("f_anagnutia", (None, None)),
]:
    pass
# resolve settlement centres for the named regions
def spx(rgb):
    blk = (reg[..., 0] == 0) & (reg[..., 1] == 0) & (reg[..., 2] == 0)
    mask = (reg[..., 0] == rgb[0]) & (reg[..., 1] == rgb[1]) & (reg[..., 2] == rgb[2])
    ys, xs = np.nonzero(mask); best = None; bc = 0
    for y in range(ys.min(), ys.max()+1):
        for x in range(xs.min(), xs.max()+1):
            if blk[y, x]:
                nb = reg[max(0, y-2):y+3, max(0, x-2):x+3].reshape(-1, 3)
                c = sum(1 for q in nb if tuple(q) == rgb)
                if c > bc: bc = c; best = (x, y)
    return best
for name, rn in [("f_friniatia", "Friniatia"), ("f_vocontia", "Vocontia"),
                 ("f_vennonia", "Vennonia-Caluconia"), ("f_turonia", "Turonia"),
                 ("f_anagnutia", "Anagnutia")]:
    p = spx(col_by_name[rn])
    render(p[0]-12, p[1]-11, p[0]+12, p[1]+11, 34, SP + "\\" + name + ".png")
