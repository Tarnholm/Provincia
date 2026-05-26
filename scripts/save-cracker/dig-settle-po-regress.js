// dig-settle-po-regress.js
//
// For ONE save, extract every settlement's stats block as a vector of u32/u16/u8
// reads at every dx, then find which fields correlate with the known PO value
// (-435). Goal: identify PO-component fields (happiness, unrest, garrison, etc.)
// that may sum to PO, and the live-owner field (a small int that differs from
// creator for captured cities).
//
// Usage: node dig-settle-po-regress.js "<save>"
"use strict";
const { loadSave, findStatsBlock } = require("./dig-settle-lib");
const { findAllSettlementMarkers } = require("../../src/buildingParser");
const buf = loadSave(process.argv[2]);
const names = [...new Set(findAllSettlementMarkers(buf).map(m => m.name))];

// Collect settlements with a valid PO in [0,100]
const settles = [];
for (const n of names) {
  const sb = findStatsBlock(buf, n);
  if (!sb) continue;
  if (sb.po < 0 || sb.po > 100) continue;
  settles.push({ n, np: sb.namePos, po: sb.po, pop: sb.pop, income: sb.income, level: sb.level, creator: sb.creator });
}
console.log(`settlements with valid PO: ${settles.length}`);

// For each dx, gather the u8 value across settlements and compute Pearson
// correlation with PO. Strong |r| => candidate PO component / proxy.
function pearson(xs, ys) {
  const n = xs.length;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; syy += ys[i] * ys[i]; sxy += xs[i] * ys[i]; }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den === 0 ? 0 : num / den;
}

const po = settles.map(s => s.po);
const results = [];
for (let dx = -584; dx <= -1; dx++) {
  // u8 read
  const xs = settles.map(s => buf[s.np + dx]);
  if (xs.every(v => v === xs[0])) continue; // constant, skip
  const r = pearson(xs, po);
  // also u32 read (aligned at this dx)
  results.push({ dx, r, sample: xs.slice(0, 6) });
}
results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
console.log("\nTop u8-fields correlated with PO (dx, r, sample values):");
for (const x of results.slice(0, 25)) {
  console.log(`  dx ${String(x.dx).padStart(5)}  r=${x.r.toFixed(3)}  e.g. [${x.sample.join(",")}]`);
}

// Also: does PO == buf[-435]? Check if any field EQUALS PO for all settlements
console.log("\nFields that EQUAL PO for ALL settlements (PO mirrors):");
for (let dx = -584; dx <= -1; dx++) {
  if (settles.every(s => buf[s.np + dx] === s.po)) console.log(`  u8 dx ${dx} == PO`);
}
