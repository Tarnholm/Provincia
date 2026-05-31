// probe-order-slots-v3b.js — focused follow-ups on s10 (true capital), s7, s14.
"use strict";
const fs = require("fs");
const all = JSON.parse(fs.readFileSync(require("path").join(__dirname, "..", "tmp-order-slots-v3.json"), "utf8"));

const bySave = {};
for (const a of all) (bySave[a.label] ||= []).push(a);

// --- s10: is exactly ONE city per faction the "capital" with high s10? ---
console.log("--- s10 distribution per save: the single max-s10 city vs the rest ---");
for (const [label, rows] of Object.entries(bySave)) {
  const sorted = [...rows].sort((x, y) => y.slots[10] - x.slots[10]);
  const top = sorted[0], second = sorted[1];
  const s10vals = rows.map((r) => r.slots[10]);
  const hi = s10vals.filter((v) => v >= 4).length;
  console.log(`  ${label.padEnd(14)} top=${top.city.padEnd(14)} s10=${top.slots[10]}  2nd=${(second?second.slots[10]:0)}  #(s10>=4)=${hi}  s11ofTop=${top.slots[11]}`);
}

// --- which city is geographically capital? cross-check: same city is top across that faction's saves? ---
console.log("\n--- s10>=4 cities (candidate capitals), grouped ---");
const capCities = {};
for (const [label, rows] of Object.entries(bySave)) {
  for (const r of rows) if (r.slots[10] >= 4) (capCities[r.city] ||= []).push(`${label}:${r.slots[10]}`);
}
for (const [city, hits] of Object.entries(capCities)) console.log(`  ${city.padEnd(16)} ${hits.join("  ")}`);

// --- s14: which cities lose s14 at T34? compare T8End active set vs T34 ---
console.log("\n--- s14 by save: list active cities (value) ---");
for (const lbl of ["crash-T5Start", "crash-T8End", "crash-T34Start"]) {
  const rows = bySave[lbl] || [];
  const act = rows.filter((r) => r.slots[14] > 0).map((r) => `${r.city}=${r.slots[14]}`);
  console.log(`  ${lbl}: ${act.length} active → ${act.slice(0, 40).join(", ")}`);
}

// --- s14 vs s2(tax): are they complementary? when one is on is the other off? ---
console.log("\n--- s14 vs s2 (tax) co-activation across turn-5/8 cities ---");
for (const lbl of ["crash-T5Start", "crash-T8End"]) {
  const rows = bySave[lbl] || [];
  let both = 0, only14 = 0, only2 = 0, neither = 0;
  for (const r of rows) {
    const a = r.slots[14] !== 0, b = r.slots[2] !== 0;
    if (a && b) both++; else if (a) only14++; else if (b) only2++; else neither++;
  }
  console.log(`  ${lbl}: both=${both} only-s14=${only14} only-s2=${only2} neither=${neither}`);
  // show a few rows
  for (const r of rows.slice(0, 6)) console.log(`     ${r.city.padEnd(14)} s2(tax)=${r.slots[2]} s14=${r.slots[14]}`);
}

// --- s7 turn-34 stray ---
console.log("\n--- s7 at T34 (the one stray) ---");
for (const r of (bySave["crash-T34Start"]||[])) if (r.slots[7] > 0) console.log(`  ${r.city} s7=${r.slots[7]}`);
