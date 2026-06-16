// Cross-check every town: farms + taxes + trade + admin - |corruption| should = net_income.
// Mismatches reveal transcription errors in the truth file (like Hadrumetum 534->334).
const TRUTH = require("./docs/carthage-screenshots-truth.json");
let bad = 0;
for (const s of TRUTH.settlements) {
  if (s.net_income == null) continue;
  const farms = s.farms || 0, tax = s.taxes || 0, trade = s.trade || 0, admin = s.admin || 0, corr = s.corruption || 0;
  const sum = farms + tax + trade + admin + corr; // corruption is already negative
  const d = sum - s.net_income;
  if (Math.abs(d) > 1) {
    bad++;
    console.log(`${s.name.padEnd(22)} f${farms}+t${tax}+tr${trade}+a${admin}${corr ? corr : ""} = ${sum}  vs net ${s.net_income}  DELTA ${d}`);
  }
}
console.log(bad ? `\n${bad} mismatches (likely transcription errors)` : "\nall towns reconcile to net");
