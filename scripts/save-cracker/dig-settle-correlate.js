// dig-settle-correlate.js
// For ONE save, correlate every u16 and u32 field (at every dx) against pop,
// income, level, and PO across all settlements. Reveals which dx is a copy/
// proxy of which known field.
// Usage: node dig-settle-correlate.js "<save>"
"use strict";
const { loadSave, findStatsBlock } = require("./dig-settle-lib");
const { findAllSettlementMarkers } = require("../../src/buildingParser");
const buf = loadSave(process.argv[2]);
const names = [...new Set(findAllSettlementMarkers(buf).map(m => m.name))];
const S = [];
for (const n of names) {
  const sb = findStatsBlock(buf, n);
  if (!sb || sb.po < 0 || sb.po > 100) continue;
  S.push(sb);
}
console.log("settlements:", S.length);
function pearson(xs, ys) {
  const n = xs.length; let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i]*xs[i]; syy += ys[i]*ys[i]; sxy += xs[i]*ys[i]; }
  const d = Math.sqrt((n*sxx-sx*sx)*(n*syy-sy*sy)); return d===0?0:(n*sxy-sx*sy)/d;
}
const pop = S.map(s=>s.pop), inc = S.map(s=>s.income), po = S.map(s=>s.po), lvl = S.map(s=>s.level);
const targets = { pop, income: inc, PO: po, level: lvl };
for (const [tname, tvals] of Object.entries(targets)) {
  const hits = [];
  for (let dx = -584; dx <= -2; dx++) {
    const xs = S.map(s => buf.readUInt16LE(s.namePos + dx));
    if (xs.every(v => v === xs[0])) continue;
    const r = pearson(xs, tvals);
    if (Math.abs(r) > 0.7) hits.push({ dx, r, sample: S.slice(0,4).map(s=>buf.readUInt16LE(s.namePos+dx)) });
  }
  hits.sort((a,b)=>Math.abs(b.r)-Math.abs(a.r));
  console.log(`\n== u16 fields correlated with ${tname} (|r|>0.7) ==`);
  for (const h of hits.slice(0,12)) console.log(`  dx ${String(h.dx).padStart(5)} r=${h.r.toFixed(3)} e.g.[${h.sample.join(",")}]`);
}
