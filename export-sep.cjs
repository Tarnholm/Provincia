// Separate EXPORT rows from IMPORT-shadow rows using the import = export/5 law.
// For each Carthaginian pair (A,B) where both panels list each other, the larger of
// {A's row to B, B's row to A} is the export; the smaller should be ~1/5 of the matching
// export. This both VALIDATES the /5 law on real data and yields a clean export-only set.
const TRUTH = require("./docs/carthage-screenshots-truth.json");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const own = new Set(TRUTH.settlements.map(s => norm(s.name)));

// rowsByPair[A|B] = list of values A lists for partner B (can be 1-2: export + import)
const rows = {};
for (const tw of TRUTH.settlements) for (const rt of tw.routes) {
  const k = norm(tw.name) + "|" + norm(rt.partner);
  (rows[k] = rows[k] || []).push(rt.value);
}

// For each directed pair A->B, A's rows to B vs B's rows to A.
const seen = new Set();
let okFifth = 0, total = 0;
const expRows = [];
console.log("A <-> B            A_rows        B_rows        | inferred export(dir,val)  /5 check");
for (const tw of TRUTH.settlements) {
  const A = norm(tw.name);
  for (const rt of tw.routes) {
    const Bp = norm(rt.partner);
    if (!own.has(Bp)) continue;                 // need both panels
    const key = [A, Bp].sort().join("~");
    if (seen.has(key)) continue; seen.add(key);
    const aRows = rows[A + "|" + Bp] || [];
    const bRows = rows[Bp + "|" + A] || [];
    // candidate export = max value across both directions
    const allv = [...aRows.map(v => ({ v, dir: A + "->" + Bp })), ...bRows.map(v => ({ v, dir: Bp + "->" + A }))].sort((x, y) => y.v - x.v);
    if (!allv.length) continue;
    const exp = allv[0];
    // the matching import shadow should be ~exp/5 on the OTHER panel
    const otherPanel = exp.dir.startsWith(A) ? bRows : aRows;
    const wantImp = exp.v / 5;
    const impHit = otherPanel.find(v => Math.abs(v - wantImp) <= 1.5);
    total++;
    if (impHit != null) okFifth++;
    expRows.push({ from: exp.dir.split("->")[0], to: exp.dir.split("->")[1], val: exp.v });
    console.log(`${(A + " <-> " + Bp).padEnd(34)} [${aRows.join(",")}]`.padEnd(50) + `[${bRows.join(",")}]`.padEnd(16) + `| EXP ${exp.dir}=${exp.v}  want imp≈${wantImp.toFixed(0)} ${impHit != null ? "✓" + impHit : "✗"}`);
  }
}
console.log(`\n/5 law holds on ${okFifth}/${total} bidirectional Carthaginian pairs`);
