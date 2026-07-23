"""Render regions from risRoads.js exactly as the APP shows them at campaign
start under PER-REGION CLIPPING (mirrors App.js v49clip): a road run draws
only if its region has roads in descr_strat (or a port); roads are CUT at the
border of roadless regions."""
import re, sys
import numpy as np
from PIL import Image, ImageDraw

BASE = r"C:\RIS\RIS\data\world\maps\base"
STRAT = r"C:\RIS\RIS\data\world\maps\campaign\imperial_campaign\descr_strat.txt"
OUTJS = r"C:\dev\Provincia\src\risRoads.js"
SP = r"C:\Users\vtarn\AppData\Local\Temp\claude\C--Users-vtarn-OneDrive-Skrivbord\6fd4885d-f016-48c8-bf38-a20b78536fc3\scratchpad"

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
Hh, Ww = reg.shape[:2]

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
print(f"start road regions: {len(roadcols)}, port regions: {len(portcols)}")

js = open(OUTJS, encoding="utf-8").read()
segs = []          # visible polylines after clipping (app-identical)
n_cut = 0
for m in re.finditer(r'\{a:"([^"]*)",b:"([^"]*)",l:\[[^\]]*\],p:\[([-0-9.,]+)\],s:\[([^\]]*(?:\][^\]]*)*?)\](,t:1)?\}', js):
    is_port = m.group(5) is not None
    v = [float(x) for x in m.group(3).split(",")]
    pts = [(v[k], v[k+1]) for k in range(0, len(v), 2)]
    runs = [(int(rm.group(1)), tuple(int(x) for x in rm.group(2).split(",")))
            for rm in re.finditer(r'\[(\d+),"([\d,]+)"\]', m.group(4))]
    if not runs: runs = [(0, None)]
    cur = []
    cut = False
    for r, (lo, c) in enumerate(runs):
        hi = runs[r+1][0] if r+1 < len(runs) else len(pts)
        vis = c is None or c in roadcols or (is_port and c in portcols)
        if vis:
            cur.extend(pts[lo:hi])
        else:
            cut = True
            if len(cur) >= 2: segs.append(cur)
            cur = []
    if len(cur) >= 2: segs.append(cur)
    if cut: n_cut += 1
print(f"visible segments: {len(segs)} (roads cut at a border: {n_cut})")

for (x0, y0, x1, y1, name) in [(232, 300, 262, 345, "clip_sardinia"),
                               (280, 270, 320, 300, "clip_etruria")]:
    sc = 22
    S = [c for c in segs if any(x0 <= x <= x1 and y0 <= y <= y1 for x, y in c)]
    img = Image.fromarray(reg[y0:y1, x0:x1]).resize(((x1-x0)*sc, (y1-y0)*sc), Image.NEAREST).convert("RGB")
    d = ImageDraw.Draw(img)
    for c in S: d.line([((x-x0)*sc, (y-y0)*sc) for x, y in c], fill=(40, 28, 16), width=3, joint="curve")
    for c in S: d.line([((x-x0)*sc, (y-y0)*sc) for x, y in c], fill=(230, 185, 120), width=1, joint="curve")
    img.save(SP + "\\" + name + ".png")
print("rendered")
