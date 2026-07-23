"""Convergence driver for the MASK bake: any issue the aerial geometry adds
BEYOND the all-wiggle baseline forces those chains back to wiggle, iterating
until the mask bake has no new fatal issues (baseline junction-spikes are the
graph's own acute Y-branches — present in the shipped wiggle build too)."""
import json, os, subprocess, sys

RT = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
RIS = r"C:\dev\Provincia\src\risRoads.js"
def run(*a):
    r = subprocess.run([PY]+list(a), capture_output=True, text=True, cwd=r"C:\dev\_research")
    print(r.stdout.strip()[-400:])
    if r.returncode not in (0, 1): print(r.stderr[-800:]); sys.exit(2)
    return r

# ---- baseline: all-wiggle bake -> despike -> validate --json
print("== baseline (all-wiggle)")
run(os.path.join(RT, "gen_mgr.py"))
run(os.path.join(RT, "despike.py"))
run(os.path.join(RT, "validate_roads.py"), RIS, "--json", os.path.join(RT, "baseline.json"))
base = json.load(open(os.path.join(RT, "baseline.json")))
base_j = [(x, y) for _, _, x, y in base["jspikes"]]
print(f"baseline jspikes: {len(base_j)}")

def is_base(x, y):
    return any((x-bx)**2 + (y-by)**2 <= 2.25 for bx, by in base_j)

force = set()
json.dump(sorted(force), open(os.path.join(RT, "force_wiggle.json"), "w"))
for it in range(8):
    print(f"== mask iter {it}")
    run(os.path.join(RT, "gen_mask.py"))
    run(os.path.join(RT, "despike.py"))
    run(os.path.join(RT, "validate_roads.py"), RIS, "--json", os.path.join(RT, "cur.json"))
    cur = json.load(open(os.path.join(RT, "cur.json")))
    aer = set(json.load(open(os.path.join(RT, "mask_aerial_idx.json"))))
    new = set()
    for ri, x, y in cur["spikes"]:
        if ri in aer: new.add(ri)
    for ci, cj in cur["crossovers"]:
        for c in (ci, cj):
            if c in aer: new.add(c)
    for ci, x, y in cur["sea"]:
        if ci in aer: new.add(ci)
    n_newj = 0
    for ci, cj, x, y in cur["jspikes"]:
        if is_base(x, y): continue
        n_newj += 1
        for c in (ci, cj):
            if c in aer: new.add(c)
    new -= force
    print(f"  new offenders: {len(new)} (new jspikes {n_newj}, "
          f"spikes {len(cur['spikes'])}, cross {len(cur['crossovers'])}, sea {len(cur['sea'])})")
    if not new:
        print("CONVERGED: no issues beyond the all-wiggle baseline")
        break
    force |= new
    json.dump(sorted(force), open(os.path.join(RT, "force_wiggle.json"), "w"))
print(f"final force-wiggle set: {len(force)} chains")
