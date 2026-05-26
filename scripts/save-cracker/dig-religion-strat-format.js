// Inspect how descr_strat declares religion per settlement, and capture
// region -> official religion ground truth for cross-validation.
const fs = require("fs");
const STRAT = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const txt = fs.readFileSync(STRAT, "latin1");
const lines = txt.split(/\r?\n/);

// Find the first 3 settlement blocks and print them verbatim.
let printed = 0;
for (let i = 0; i < lines.length && printed < 3; i++) {
  if (/^\s*settlement\s*$/.test(lines[i]) || /^settlement$/.test(lines[i].trim())) {
    console.log("--- settlement block @ line " + i + " ---");
    for (let j = i; j < Math.min(i + 30, lines.length); j++) {
      console.log(j + ": " + lines[j]);
      if (lines[j].trim() === "}") break;
    }
    printed++;
  }
}

// Show every distinct line that contains 'religion' (trimmed), with counts.
const relLines = {};
for (const l of lines) {
  if (/religion/i.test(l)) {
    const key = l.trim().split(/\s+/).slice(0, 1).join(" ");
    relLines[key] = (relLines[key] || 0) + 1;
  }
}
console.log("\n=== distinct first-token of lines containing 'religion' ===");
Object.entries(relLines).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([k,v])=>console.log("  "+v+"  '"+k+"'"));

// Print a few full sample religion lines
console.log("\n=== sample full religion lines ===");
let n=0;
for (const l of lines) { if (/religion/i.test(l)) { console.log("  '"+l.trim()+"'"); if(++n>=12) break; } }
