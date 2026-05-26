// dig-final-validation.js — run counts across all 4 saves and check that
// the budget totals approach 65,536 (the corruption cap) for Turn 1018.
"use strict";
const fs = require("fs");
const { execSync } = require("child_process");

const SAVES = [
  ["t900-end",      "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 900 End.sav"],
  ["t960-start",    "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["item-limit",    "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t1018-start",   "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

const { countMapEntities } = require("../../src/mapEntityParser.js");

console.log("save".padEnd(14) + "  roads  ports  watch  setts");
for (const [tag, p] of SAVES) {
  const buf = fs.readFileSync(p);
  const m = countMapEntities(buf);
  console.log(
    tag.padEnd(14) + "  " +
    String(m.roads).padStart(5) + "  " +
    String(m.ports).padStart(5) + "  " +
    String(m.watchtowers ?? "n/a").padStart(5) + "  " +
    String(m.settlementCount).padStart(5)
  );
}
