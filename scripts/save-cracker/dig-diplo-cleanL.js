// Session 32 step L: find the 8 "other" events that account for net -10 in regions.
const fs = require('fs');
const events = JSON.parse(fs.readFileSync('C:/dev/Provincia/scripts/save-cracker/diplo-clean-events.json', 'utf8'));

const regionEvents = events.filter(e => e.ai >= 0xf80000);
const oddSize = regionEvents.filter(e => e.type === 'replace' && e.bLen !== e.aLen && (e.bLen - e.aLen !== 1) && (e.bLen - e.aLen !== -1));
console.log(`'Other' size events: ${oddSize.length}`);
let net = 0;
for (const e of oddSize) {
  net += e.bLen - e.aLen;
  console.log(`  A=0x${e.ai.toString(16)} B=0x${e.bi.toString(16)} aLen=${e.aLen} bLen=${e.bLen} d=${e.bLen-e.aLen} aHex=${e.aHex} bHex=${e.bHex}`);
}
console.log(`Net delta from odd events: ${net}`);

// Also there might be ZERO-delta replace events (substitutions) we should ignore.
// Print the +1/-1 events that DON'T pair locally (lone events).
console.log(`\n=== All region events in order (truncated to ones with non-zero delta) ===`);
const nzr = regionEvents.filter(e => e.type === 'replace' && e.bLen !== e.aLen);
console.log(`Total: ${nzr.length}`);
// Take groups of 100 and sum delta
for (let i = 0; i < nzr.length; i += 50) {
  let sum = 0;
  for (let j = i; j < Math.min(i + 50, nzr.length); j++) sum += nzr[j].bLen - nzr[j].aLen;
  if (sum !== 0) console.log(`  events ${i}..${i+50}: net=${sum}`);
}

// Just look at the last 20 events.
console.log(`\nLast 20 non-zero-delta region events:`);
for (const e of nzr.slice(-20)) {
  console.log(`  A=0x${e.ai.toString(16)} B=0x${e.bi.toString(16)} aLen=${e.aLen} bLen=${e.bLen} d=${e.bLen-e.aLen} aHex=${e.aHex} bHex=${e.bHex}`);
}
