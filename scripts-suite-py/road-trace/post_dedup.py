"""Post-process src/risRoads.js (v1365 aerial bake) to remove duplicated /
overlapping road chains — the aerial capture split shared corridors into
several near-parallel pieces, drawn as double lines. Collapse: if >=68% of a
chain's points lie within COVER px of the UNION of other (kept) chains, it's
redundant overlap → drop it, but union its link-tags (a/b + l) into the
covering chain so the per-link visibility filter still shows the corridor.
Geometry of surviving chains is UNTOUCHED (keeps the organic detail)."""
import re, math
import numpy as np
from PIL import Image
IN = r"C:\dev\Provincia\src\risRoads.js"
BASE = r"C:\RIS\RIS\data\world\maps\base"
COVER = 1.6
FRAC = 0.65

# settlement/port anchors — a chain ending on one must never be dropped if it is
# the LAST road reaching that anchor (else the settlement loses its road).
_reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
_blk = (_reg[..., 0]==0)&(_reg[..., 1]==0)&(_reg[..., 2]==0)
_wht = (_reg[..., 0]==255)&(_reg[..., 1]==255)&(_reg[..., 2]==255)
_anch = set()
for y, x in zip(*np.nonzero(_blk | _wht)): _anch.add((x, y))
def on_anchor(p):
    # roads end 1-2px short of the settlement/port marker (city model hides it),
    # so scan a 2px radius for the anchor this end belongs to.
    best = None; bd = 2.4*2.4
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            a = (int(p[0])+dx, int(p[1])+dy)
            if a in _anch:
                d = (a[0]+0.5-p[0])**2 + (a[1]+0.5-p[1])**2
                if d < bd: bd = d; best = (a[0]+0.5, a[1]+0.5)
    return best

js = open(IN, encoding="utf-8").read()
head = js[:js.index("export const RIS_ROADS = [")]
tail = js[js.index("export const CAPTURED_MAPS"):]

chains = []  # {a,b,l:set(pairs), pts:[(x,y)]}
for m in re.finditer(r'\{a:"([^"]*)",b:"([^"]*)",l:\[([^\]]*)\],p:\[([-0-9.,]+)\]', js):
    v = [float(x) for x in m.group(4).split(",")]
    pts = [(v[k], v[k+1]) for k in range(0, len(v), 2)]
    ls = set(re.findall(r'"([\d,]+\|[\d,]+)"', m.group(3)))
    if m.group(1) and m.group(2):
        ls.add("|".join(sorted([m.group(1), m.group(2)])))
    chains.append({"a": m.group(1), "b": m.group(2), "l": ls, "pts": pts})
print("chains in:", len(chains))

def length(c):
    p = c["pts"]; return sum(math.hypot(p[i+1][0]-p[i][0], p[i+1][1]-p[i][1]) for i in range(len(p)-1))
for c in chains: c["len"] = length(c)

# single spatial hash over ALL chain points; skip self + already-dropped
grid = {}
for ci, c in enumerate(chains):
    for (x, y) in c["pts"]:
        grid.setdefault((int(x), int(y)), []).append((x, y, ci))
dropped_set = set()
def best_single_cover(ci):
    # fraction of ci's points covered by EACH other chain individually; return
    # (best_fraction, best_other_ci). A true duplicate is covered ~entirely by
    # ONE other chain; incidental junction overlap is spread over many, so no
    # single chain covers it.
    c = chains[ci]; per = {}
    for (x, y) in c["pts"]:
        seen_here = set()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for (px, py, cj) in grid.get((int(x)+dx, int(y)+dy), ()):
                    if cj == ci or cj in dropped_set or cj in seen_here: continue
                    if (px-x)**2 + (py-y)**2 <= COVER*COVER:
                        per[cj] = per.get(cj, 0) + 1; seen_here.add(cj)
    if not per: return 0.0, None
    bcj = max(per, key=per.get)
    return per[bcj] / len(c["pts"]), bcj

# grid of chain ENDPOINTS -> chain ids (for last-road-to-anchor protection)
endgrid = {}
for ci, c in enumerate(chains):
    for p in (c["pts"][0], c["pts"][-1]):
        endgrid.setdefault((int(p[0]), int(p[1])), []).append((p[0], p[1], ci))
def other_kept_end_near(pt, skip):
    for dx in (-2,-1,0,1,2):
        for dy in (-2,-1,0,1,2):
            for (x, y, cj) in endgrid.get((int(pt[0])+dx, int(pt[1])+dy), ()):
                if cj == skip or cj in dropped_set: continue
                if (x-pt[0])**2 + (y-pt[1])**2 <= 2.25: return True
    return False

order = sorted(range(len(chains)), key=lambda i: chains[i]["len"])
for ci in order:
    frac, host = best_single_cover(ci)
    if host is None or frac < FRAC or chains[host]["len"] < chains[ci]["len"] - 1e-6:
        continue
    # PROTECT connectivity: if either end sits on a settlement/port and no other
    # surviving chain also ends there, this is the last road to that anchor —
    # keep it (dropping it lost 183 settlement connections at FRAC 0.65).
    lastroad = False
    for p in (chains[ci]["pts"][0], chains[ci]["pts"][-1]):
        if on_anchor(p) and not other_kept_end_near(p, ci): lastroad = True; break
    if lastroad: continue
    chains[host]["l"] |= chains[ci]["l"]
    dropped_set.add(ci)
kept = [i for i in range(len(chains)) if i not in dropped_set]
print("dropped duplicate chains:", len(dropped_set), "-> kept", len(kept))

out = []
for ci in kept:
    c = chains[ci]
    # keep a/b as the primary link; l = all links (minus the a/b pair)
    ab = "|".join(sorted([c["a"], c["b"]])) if c["a"] and c["b"] else None
    extra = sorted(x for x in c["l"] if x != ab)
    ls = ",".join(f'"{x}"' for x in extra)
    cs = lambda q: (f'"{q}"' if q else '""')
    flat = ",".join(f"{v:g}" for p in c["pts"] for v in p)
    out.append(f'{{a:{cs(c["a"])},b:{cs(c["b"])},l:[{ls}],p:[{flat}]}}')
open(IN, "w").write(head + "export const RIS_ROADS = [\n" + ",\n".join(out) + "\n];\n" + tail)
import os
print("wrote", round(os.path.getsize(IN)/1024), "KB,", len(out), "chains")
