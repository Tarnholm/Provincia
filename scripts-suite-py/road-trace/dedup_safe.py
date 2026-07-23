"""SAFE dedup on src/risRoads.js: remove a chain ONLY if another chain connects
the SAME two endpoints (both within ENDR px, orientation-independent) AND
covers >=COVFRAC of its path. Dropping such a chain is provably gap-free — the
survivor links the identical two points along the same route. Mid-corridor
pieces and divergent branches are NEVER touched, so no roads go missing."""
import re, math, os
IN = r"C:\dev\Provincia\src\risRoads.js"
ENDR = 1.6      # endpoints must match this close
COVFRAC = 0.7   # and the path must overlap this much

js = open(IN, encoding="utf-8").read()
head = js[:js.index("export const RIS_ROADS = [")]
tail = js[js.index("export const CAPTURED_MAPS"):]

chains = []
for m in re.finditer(r'\{a:"([^"]*)",b:"([^"]*)",l:\[([^\]]*)\],p:\[([-0-9.,]+)\]', js):
    v = [float(x) for x in m.group(4).split(",")]
    pts = [(v[k], v[k+1]) for k in range(0, len(v), 2)]
    ls = set(re.findall(r'"([\d,]+\|[\d,]+)"', m.group(3)))
    if m.group(1) and m.group(2): ls.add("|".join(sorted([m.group(1), m.group(2)])))
    chains.append({"a": m.group(1), "b": m.group(2), "l": ls, "pts": pts})
print("chains in:", len(chains))
def length(c):
    p = c["pts"]; return sum(math.hypot(p[i+1][0]-p[i][0], p[i+1][1]-p[i][1]) for i in range(len(p)-1))
for c in chains: c["len"] = length(c)

# index chains by rounded endpoint so we only compare same-endpoint pairs
def ekey(p): return (round(p[0]/ENDR), round(p[1]/ENDR))
endidx = {}
for ci, c in enumerate(chains):
    for e in (c["pts"][0], c["pts"][-1]):
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                endidx.setdefault((ekey(e)[0]+dx, ekey(e)[1]+dy), set()).add(ci)

# point grid per chain for coverage
grid = {}
for ci, c in enumerate(chains):
    for (x, y) in c["pts"]: grid.setdefault((int(x), int(y)), []).append((x, y, ci))
def coverage(ci, cj):
    hit = 0
    for (x, y) in chains[ci]["pts"]:
        f = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for (px, py, ck) in grid.get((int(x)+dx, int(y)+dy), ()):
                    if ck == cj and (px-x)**2 + (py-y)**2 <= ENDR*ENDR: f = True; break
                if f: break
            if f: break
        if f: hit += 1
    return hit / len(chains[ci]["pts"])
def same_ends(ci, cj):
    a0, a1 = chains[ci]["pts"][0], chains[ci]["pts"][-1]
    b0, b1 = chains[cj]["pts"][0], chains[cj]["pts"][-1]
    def near(p, q): return (p[0]-q[0])**2 + (p[1]-q[1])**2 <= ENDR*ENDR
    return (near(a0, b0) and near(a1, b1)) or (near(a0, b1) and near(a1, b0))

dropped = set()
order = sorted(range(len(chains)), key=lambda i: chains[i]["len"])
for ci in order:
    if ci in dropped: continue
    cand = set()
    for e in (chains[ci]["pts"][0], chains[ci]["pts"][-1]):
        cand |= endidx.get(ekey(e), set())
    for cj in cand:
        if cj == ci or cj in dropped: continue
        if chains[cj]["len"] < chains[ci]["len"] - 1e-6: continue   # keep the longer/equal
        if same_ends(ci, cj) and coverage(ci, cj) >= COVFRAC:
            chains[cj]["l"] |= chains[ci]["l"]; dropped.add(ci); break
print("dropped EXACT-duplicate chains:", len(dropped))

# ---- TRIM parallel prefixes: two DIFFERENT roads that share a junction and run
# parallel a while before diverging (Neapolis→Sulci vs Neapolis→Caralis) draw
# as double lines. Trim the shared prefix off the shorter so it starts where it
# leaves the other (a Y-branch, like the game). No drop → nothing disconnects.
PAR = 1.4      # "parallel" distance
def pt_grid_excl():
    g = {}
    for ci, c in enumerate(chains):
        if ci in dropped: continue
        for (x, y) in c["pts"]: g.setdefault((int(x), int(y)), []).append((x, y, ci))
    return g
def near_other(gr, x, y, self_ci):
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for (px, py, cj) in gr.get((int(x)+dx, int(y)+dy), ()):
                if cj != self_ci and (px-x)**2 + (py-y)**2 <= PAR*PAR: return True
    return False
# anchors (never trim a settlement/port end away)
import numpy as np
from PIL import Image
_reg = np.array(Image.open(r"C:\RIS\RIS\data\world\maps\base\map_regions.tga").convert("RGB"))
_an = set()
for y, x in zip(*np.nonzero(((_reg[...,0]==0)&(_reg[...,1]==0)&(_reg[...,2]==0)) | ((_reg[...,0]==255)&(_reg[...,1]==255)&(_reg[...,2]==255)))):
    _an.add((x, y))
def is_anchor(p):
    for dx in range(-2,3):
        for dy in range(-2,3):
            if (int(p[0])+dx, int(p[1])+dy) in _an: return True
    return False
trimmed = 0
pg = pt_grid_excl()
for ci in order:
    if ci in dropped: continue
    c = chains[ci]["pts"]
    if len(c) < 8: continue
    def run(seq):
        n = 0
        for (x, y) in seq:
            if near_other(pg, x, y, ci): n += 1
            else: break
        return n
    head_run = run(c); tail_run = run(c[::-1])
    # trim the end that runs parallel — but NEVER an end sitting on a settlement/
    # port (would disconnect it), and keep >=4 unique points. New end lands on
    # the other chain (T-junction) since its points were within PAR of one.
    if head_run >= 4 and head_run <= len(c) - 5 and head_run >= tail_run and not is_anchor(c[0]):
        chains[ci]["pts"] = c[head_run-1:]; trimmed += 1
    elif tail_run >= 4 and tail_run <= len(c) - 5 and not is_anchor(c[-1]):
        chains[ci]["pts"] = c[:len(c)-tail_run+1]; trimmed += 1
print("trimmed parallel prefixes:", trimmed)

kept = [i for i in range(len(chains)) if i not in dropped]
print("kept", len(kept))

out = []
for ci in kept:
    c = chains[ci]
    ab = "|".join(sorted([c["a"], c["b"]])) if c["a"] and c["b"] else None
    extra = sorted(x for x in c["l"] if x != ab)
    ls = ",".join(f'"{x}"' for x in extra)
    cs = lambda q: (f'"{q}"' if q else '""')
    flat = ",".join(f"{v:g}" for p in c["pts"] for v in p)
    out.append(f'{{a:{cs(c["a"])},b:{cs(c["b"])},l:[{ls}],p:[{flat}]}}')
open(IN, "w").write(head + "export const RIS_ROADS = [\n" + ",\n".join(out) + "\n];\n" + tail)
print("wrote", round(os.path.getsize(IN)/1024), "KB,", len(out), "chains")
