// Quick verification: new countWatchtowers() against all reference saves.

"use strict";
const fs = require("fs");
const { countWatchtowers, findWatchtowerTable } = require("../../src/mapEntityParser.js");

const SAVES = [
  ["t900-end",     "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 900 End.sav"],
  ["t960-start",   "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["t1017",        "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t1018-start",  "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

const EXPECTED = { "t960-start": 156, "t1017": 176, "t1018-start": 177 };

for (const [tag, p] of SAVES) {
  const buf = fs.readFileSync(p);
  const tbl = findWatchtowerTable(buf);
  const walked = countWatchtowers(buf);
  const exp = EXPECTED[tag];
  const matchTag = exp == null ? "(no expectation)" : (walked === exp ? "✓ matches expected" : `✗ expected ${exp}`);
  if (!tbl) { console.log(`${tag.padEnd(14)}  TABLE NOT FOUND  walked=${walked}`); continue; }
  const declVsWalk = (tbl.declaredCount === walked) ? "✓" : `✗ (declared ${tbl.declaredCount})`;
  console.log(`${tag.padEnd(14)}  anchor=0x${tbl.anchor.toString(16)}  walked=${String(walked).padStart(4)}  declared=${String(tbl.declaredCount).padStart(4)}  ${declVsWalk}  ${matchTag}`);
}
