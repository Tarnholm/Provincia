// Quick CLI: pointer-registry budget for a save, using the two helpers
// the Budget pill uses in-app. `node scripts/save-budget.js <save.sav>`
const fs = require("fs");
const path = require("path");
const { countEngineCharacters } = require("../src/saveCrackerExtras.js");
const { countDeadPoolRecords } = require("../src/characterParser.js");

const p = process.argv[2];
if (!p || !fs.existsSync(p)) { console.error("usage: node save-budget.js <save.sav>"); process.exit(1); }

const buf = fs.readFileSync(p);
const live = countEngineCharacters(buf);
const dead = countDeadPoolRecords(buf);
const total = live + dead;
const cap = 65536;
const pad = (s, w) => String(s).padStart(w);
const pct = (n) => ((n / cap) * 100).toFixed(1) + "%";

console.log(`save: ${path.basename(p)}`);
console.log(`size: ${(buf.length / (1024 * 1024)).toFixed(1)} MB`);
console.log("");
console.log(`  live (engine CHARACTER):    ${pad(live.toLocaleString(), 8)}   ${pad(pct(live), 6)} of cap`);
console.log(`  dead (dynasty pool):        ${pad(dead.toLocaleString(), 8)}   ${pad(pct(dead), 6)} of cap`);
console.log(`  total characters/records:   ${pad(total.toLocaleString(), 8)}   ${pad(pct(total), 6)} of cap`);
console.log("");
console.log(`  pointer-registry cap:       ${pad(cap.toLocaleString(), 8)}`);
console.log(`  remaining headroom:         ${pad((cap - total).toLocaleString(), 8)}`);
const tier = dead / cap >= 0.40 ? "RED (near corruption risk)"
           : dead / cap >= 0.30 ? "YELLOW (watch closely)"
           : "GREEN (healthy)";
console.log(`  tier:                       ${tier}`);
