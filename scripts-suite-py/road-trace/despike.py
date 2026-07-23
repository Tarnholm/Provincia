"""Inline hairpin despike for src/risRoads.js (windowed >135deg vertex removal).
Same metric as validate_roads.py SPIKE. Run after any bake, before validate."""
import re, math, sys
IN = sys.argv[1] if len(sys.argv) > 1 else r"C:\dev\Provincia\src\risRoads.js"
js = open(IN, encoding="utf-8").read()
head = js[:js.index("export const RIS_ROADS = [")]
tail = js[js.index("export const CAPTURED_MAPS"):]
ch = []
for m in re.finditer(r'(\{a:"[^"]*",b:"[^"]*",l:\[[^\]]*\],p:)\[([-0-9.,]+)\]', js):
    v = [float(x) for x in m.group(2).split(",")]
    ch.append({"pre": m.group(1), "pts": [(v[k], v[k+1]) for k in range(0, len(v), 2)]})
WIN = 2.0
def wd(p, k, fwd):
    x0, y0 = p[k]; acc = 0; prev = k
    for j in (range(k+1, len(p)) if fwd else range(k-1, -1, -1)):
        acc += math.hypot(p[j][0]-p[prev][0], p[j][1]-p[prev][1]); prev = j
        if acc >= WIN or j in (0, len(p)-1):
            dx, dy = (p[j][0]-x0, p[j][1]-y0) if fwd else (x0-p[j][0], y0-p[j][1])
            L = math.hypot(dx, dy)
            return (dx/L, dy/L) if L > 0.3 else None
    return None
tot = 0
for c in ch:
    p = c["pts"]; changed = True; g = 0
    while changed and len(p) > 3 and g < 300:
        changed = False; g += 1
        for k in range(1, len(p)-1):
            db, df = wd(p, k, False), wd(p, k, True)
            if db and df and db[0]*df[0]+db[1]*df[1] < -0.7:
                del p[k]; changed = True; tot += 1; break
print("hairpins removed:", tot)
out = [c["pre"]+"["+",".join(f"{round(v,2):g}" for pt in c["pts"] for v in pt)+"]}"
       for c in ch if len(c["pts"]) >= 2]
open(IN, "w", encoding="utf-8").write(head+"export const RIS_ROADS = [\n"+",\n".join(out)+"\n];\n"+tail)
