"""Surgical parallel-merge on src/risRoads.js (run AFTER exact-dedup). Two
DIFFERENT roads that leave a SHARED junction and run parallel before diverging
draw as a double line. Trim the shared prefix off ONE so it branches off the
other at the divergence point (a Y), exactly like the game.

SAFE by construction:
 - only trim chain A's prefix that runs beside ONE SPECIFIC chain B which SHARES
   A's start endpoint (within ENDR) — not chains merely passing near a junction;
 - never trim an end on a settlement/port anchor;
 - keep >=MINKEEP unique points; the trimmed start lands on B (T-junction);
 - AFTER all trims, verify every anchor still has a road within 2.5px and every
   original junction still has a chain end nearby — UNDO any trim that fails.
"""
import re, math, os
import numpy as np
from PIL import Image
IN = r"C:\dev\Provincia\src\risRoads.js"
BASE = r"C:\RIS\RIS\data\world\maps\base"
ENDR = 1.6; PAR = 1.4; MINKEEP = 4

reg = np.array(Image.open(BASE + r"\map_regions.tga").convert("RGB"))
_an = set()
for y, x in zip(*np.nonzero(((reg[...,0]==0)&(reg[...,1]==0)&(reg[...,2]==0)) | ((reg[...,0]==255)&(reg[...,1]==255)&(reg[...,2]==255)))):
    _an.add((x, y))
def is_anchor(p):
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            if (int(p[0])+dx, int(p[1])+dy) in _an: return True
    return False

js = open(IN, encoding="utf-8").read()
head = js[:js.index("export const RIS_ROADS = [")]
tail = js[js.index("export const CAPTURED_MAPS"):]
raw = []
for m in re.finditer(r'(\{a:"[^"]*",b:"[^"]*",l:\[[^\]]*\],p:)\[([-0-9.,]+)\]', js):
    v = [float(x) for x in m.group(2).split(",")]
    raw.append({"pre": m.group(1), "pts": [(v[k], v[k+1]) for k in range(0, len(v), 2)]})
print("chains:", len(raw))
orig_pts = [r["pts"][:] for r in raw]

# endpoint index
def ek(p): return (round(p[0]/ENDR), round(p[1]/ENDR))
eidx = {}
for ci, c in enumerate(raw):
    for e in (c["pts"][0], c["pts"][-1]):
        eidx.setdefault(ek(e), set()).add(ci)
def near(p, q, r=PAR): return (p[0]-q[0])**2 + (p[1]-q[1])**2 <= r*r

def parallel_run(A, B):
    # A oriented so A[0] is the shared end; count consecutive A points (from
    # start) each within PAR of SOME B point. Return run length.
    n = 0
    for (x, y) in A:
        if any(near((x, y), b) for b in B): n += 1
        else: break
    return n

# consider only pairs that share an endpoint
trims = []  # (ci, 'head'/'tail', cut_index)
seen = set()
for ci, c in enumerate(raw):
    for ci_end, epA in ((0, c["pts"][0]), (1, c["pts"][-1])):
        for cj in eidx.get(ek(epA), ()):
            if cj == ci: continue
            d = raw[cj]
            # B must share THIS endpoint of A
            for epB in (d["pts"][0], d["pts"][-1]):
                if near(epA, epB, ENDR): break
            else:
                continue
            A = c["pts"] if ci_end == 0 else c["pts"][::-1]
            run = parallel_run(A, d["pts"])
            if run >= 4 and run <= len(A) - MINKEEP:
                # trim A's shared prefix (keep from run-1); don't trim an anchor end
                if is_anchor(A[0]): continue
                key = (ci, ci_end)
                if key in seen: continue
                seen.add(key)
                trims.append((ci, ci_end, run))

# apply trims (longest-run first so each chain trimmed once, its worst end)
best = {}
for ci, end, run in trims:
    if ci not in best or run > best[ci][1]: best[ci] = (end, run)
for ci, (end, run) in best.items():
    p = raw[ci]["pts"]
    if end == 0: raw[ci]["pts"] = p[run-1:]
    else: raw[ci]["pts"] = p[:len(p)-run+1]
print("trims applied:", len(best))

# ---- SAFETY VERIFY: anchors + junctions still served; undo failed trims
def build_pt_grid():
    g = {}
    for ci, c in enumerate(raw):
        for (x, y) in c["pts"]: g.setdefault((int(x), int(y)), []).append((x, y))
    return g
def road_near(g, p, r):
    for dx in range(-int(r)-1, int(r)+2):
        for dy in range(-int(r)-1, int(r)+2):
            for (x, y) in g.get((int(p[0])+dx, int(p[1])+dy), ()):
                if (x-p[0])**2 + (y-p[1])**2 <= r*r: return True
    return False
# every ORIGINAL endpoint (anchor or junction) must still have a road within 2.5px
orig_ends = set()
for pts in orig_pts:
    orig_ends.add((round(pts[0][0],1), round(pts[0][1],1)))
    orig_ends.add((round(pts[-1][0],1), round(pts[-1][1],1)))
undo = 0
changed = True
while changed:
    changed = False
    g = build_pt_grid()
    for e in orig_ends:
        if not road_near(g, e, 2.5):
            # find a trimmed chain whose ORIGINAL geometry covered e; undo it
            for ci in list(best):
                if best[ci] is None: continue
                if any(abs(px-e[0])<2.5 and abs(py-e[1])<2.5 for px, py in orig_pts[ci]):
                    raw[ci]["pts"] = orig_pts[ci]; best[ci] = None; undo += 1; changed = True; break
            if changed: break
print("trims undone for safety:", undo)

out = []
for c in raw:
    flat = ",".join(f"{v:g}" for p in c["pts"] for v in p)
    out.append(c["pre"] + "[" + flat + "]}")
open(IN, "w").write(head + "export const RIS_ROADS = [\n" + ",\n".join(out) + "\n];\n" + tail)
print("wrote", round(os.path.getsize(IN)/1024), "KB")
