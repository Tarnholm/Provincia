// Ground truth oracle: compute expected starting diplomacy for the player
// faction in each save (Seleucid, Antigonid) from descr_strat + campaign script.
const fs = require("fs");
const {
  parseDescrStratFactionRelationships,
  parseCampaignScriptDiplomacy,
  mergeFactionRelationships,
} = require("C:/dev/Provincia/src/parsers.js");
const {
  parseFactionTreasuries,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = [
  "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
  "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
];
const SM_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const DESCR_STRAT = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const SCRIPT = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\RIS_Campaign_Script.txt";

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8");
  const order = [];
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) {
      const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
      if (cm) { order.push(cur); cur = null; }
    }
  }
  return order;
}

const order = loadFactionOrder(SM_FACTIONS);
const stratText = fs.readFileSync(DESCR_STRAT, "utf8");
const scriptText = fs.readFileSync(SCRIPT, "utf8");

const stratRel = parseDescrStratFactionRelationships(stratText);
const scriptRel = parseCampaignScriptDiplomacy(scriptText);
const merged = mergeFactionRelationships(stratRel, scriptRel);

console.log("=== descr_sm_factions order (index -> name) ===");
console.log(order.map((f, i) => `${i}:${f}`).join("  "));

for (const path of SAVES) {
  let buf;
  try { buf = fs.readFileSync(path); } catch { console.log(`\n(skip ${path})`); continue; }
  const recs = parseFactionTreasuries(buf);
  const player = identifyPlayerFactionFromSave(buf, recs);
  console.log(`\n\n===== ${path.split("\\").pop()} =====`);
  console.log(`player faction (from save) = ${player}`);
  const rel = merged[player] || [];
  const allies = rel.filter(r => r.kind === "ally").map(r => r.to);
  const wars = rel.filter(r => r.kind === "war").map(r => r.to);
  const protects = rel.filter(r => r.kind === "protects").map(r => r.to);
  const protectedBy = rel.filter(r => r.kind === "protected_by").map(r => r.to);
  console.log(`  WARS         (${wars.length}): ${wars.sort().join(", ")}`);
  console.log(`  ALLIES       (${allies.length}): ${allies.sort().join(", ")}`);
  console.log(`  PROTECTS     (${protects.length}): ${protects.sort().join(", ")}`);
  console.log(`  PROTECTED_BY (${protectedBy.length}): ${protectedBy.sort().join(", ")}`);
  // also list as faction indices
  const idx = (n) => order.indexOf(n);
  console.log(`  WAR indices:   ${wars.map(n => `${idx(n)}:${n}`).sort().join(", ")}`);
  console.log(`  ALLY indices:  ${allies.map(n => `${idx(n)}:${n}`).sort().join(", ")}`);
}
