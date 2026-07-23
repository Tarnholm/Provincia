"""Remove duplicate/overlapping road chains from the (endpoint-snapped) aerial
src/risRoads.js. Drop a chain if a SINGLE longer chain covers >=FRAC of it
(true overlap, not incidental junction crossing). Then VERIFY every original
endpoint still has a road within 2.5px and UNDO any drop that disconnects
something. Geometry of survivors is untouched (organic curves preserved)."""
import re, math, os
import numpy as np
from PIL import Image
IN = r"C:\dev\Provincia\src\risRoads.js"
BASE = r"C:\RIS\RIS\data\world\maps\base"
COVER = 1.6; FRAC = 0.8

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
js = open(IN, encoding="utf-8").read()
head = js[:js.index("export const RIS_ROADS = [")]
tail = js[js.index("export const CAPTURED_MAPS"):]
chains = []
for m in re.finditer(r'\{a:"([^"]*)",b:"([^"]*)",l:\[([^\]]*)\],p:\[([-0-9.,]+)\]', js):
    v = [float(x) for x in m.group(4).split(",")]
    pts = [(v[k], v[k+1]) for k in range(0, len(v), 2)]
    ls = set(re.findall(r'"([\d,]+\|[\d,]+)"', m.group(3)))
    if m.group(1) and m.group(2): ls.add("|".join(sorted([m.group(1), m.group(2)])))
    chains.append({"a": m.group(1), "b": m.group(2), "l": ls, "pts": pts,
                   "len": sum(math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]) for i in range(len(pts)-1))})
print("chains:", len(chains))
orig_pts = [c["pts"][:] for c in chains]
orig_ends = set()
for p in orig_pts:
    orig_ends.add((round(p[0][0],1), round(p[0][1],1))); orig_ends.add((round(p[-1][0],1), round(p[-1][1],1)))

grid = {}
for ci, c in enumerate(chains):
    for (x, y) in c["pts"]: grid.setdefault((int(x), int(y)), []).append((x, y, ci))
def single_cover(ci, dropped):
    c = chains[ci]; per = {}
    for (x, y) in c["pts"]:
        seen = set()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for (px, py, cj) in grid.get((int(x)+dx, int(y)+dy), ()):
                    if cj == ci or cj in dropped or cj in seen: continue
                    if (px-x)**2 + (py-y)**2 <= COVER*COVER: per[cj] = per.get(cj, 0)+1; seen.add(cj)
    if not per: return 0.0, None
    b = max(per, key=per.get); return per[b]/len(c["pts"]), b

dropped = set()
order = sorted(range(len(chains)), key=lambda i: chains[i]["len"])
for ci in order:
    frac, host = single_cover(ci, dropped)
    if host is not None and frac >= FRAC and chains[host]["len"] >= chains[ci]["len"] - 1e-6:
        chains[host]["l"] |= chains[ci]["l"]; dropped.add(ci)
print("provisionally dropped:", len(dropped))

# UNDO any drop that leaves an original endpoint with no road within 2.5px
def kept_pt_grid():
    g = {}
    for ci, c in enumerate(chains):
        if ci in dropped: continue
        for (x, y) in c["pts"]: g.setdefault((int(x), int(y)), []).append((x, y))
    return g
def road_near(g, e, r=2.5):
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            for (x, y) in g.get((int(e[0])+dx, int(e[1])+dy), ()):
                if (x-e[0])**2 + (y-e[1])**2 <= r*r: return True
    return False
undo = 0; changed = True
while changed:
    changed = False
    g = kept_pt_grid()
    for e in orig_ends:
        if not road_near(g, e):
            for ci in list(dropped):
                if any(abs(px-e[0])<2.5 and abs(py-e[1])<2.5 for px, py in orig_pts[ci]):
                    dropped.discard(ci); undo += 1; changed = True; break
            if changed: break
print("undone for connectivity:", undo, "-> final dropped:", len(dropped))

kept = [i for i in range(len(chains)) if i not in dropped]
out = []
for ci in kept:
    c = chains[ci]
    ab = "|".join(sorted([c["a"], c["b"]])) if c["a"] and c["b"] else None
    extra = sorted(x for x in c["l"] if x != ab)
    ls = ",".join(f'"{x}"' for x in extra)
    cs = lambda q: (f'"{q}"' if q else '""')
    flat = ",".join(f"{round(v,2):g}" for p in c["pts"] for v in p)
    out.append(f'{{a:{cs(c["a"])},b:{cs(c["b"])},l:[{ls}],p:[{flat}]}}')
open(IN, "w").write(head + "export const RIS_ROADS = [\n" + ",\n".join(out) + "\n];\n" + tail)
print("kept", len(out), "->", round(os.path.getsize(IN)/1024), "KB")
