// Probe the player's (romans_julii) live diplomacy war row on the
// "Republic of Rome Turn 1" save. Reads the matrix directly (bypassing
// isDiplomaticFaction) to show the RAW war targets, then shows what the
// production parseDiplomacyMatrix returns. Used to validate the war-list fix.
"use strict";
const fs = require("fs");
const path = require("path");
const x = require(path.join(__dirname, "..", "src", "saveCrackerExtras.js"));

const SAVE = process.argv[2] ||
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";
const MOD = "C:/RIS/RIS/data";
const SMF = path.join(MOD, "descr_sm_factions.txt");

const order = [];
for (const line of fs.readFileSync(SMF, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) order.push(m[1]);
}
console.log(`descr_sm_factions order: N=${order.length}, idx(romans_julii)=${order.indexOf("romans_julii")}`);

const buf = fs.readFileSync(SAVE);

// RAW row read — replicate cellAt but with NO isDiplomaticFaction filtering.
const N = order.length;
const reader = x.makeDiplomacyPairReader(buf, order);
if (!reader) { console.log("NO MATRIX located"); process.exit(1); }

const PLAYER = "romans_julii";
console.log(`\n=== RAW matrix war/ally row for ${PLAYER} (no placeholder filtering) ===`);
const rawWar = [], rawAllied = [];
for (const other of order) {
  if (other === PLAYER) continue;
  const c = reader(PLAYER, other);
  if (!c) continue;
  if (c.att >= 600) rawWar.push(`${other}(att=${c.att})`);
  else if (c.att === 0) rawAllied.push(other);
}
console.log(`RAW war (${rawWar.length}): ${rawWar.join(", ")}`);
console.log(`RAW allied (${rawAllied.length}): ${rawAllied.join(", ")}`);

// Production parse — what Provincia actually surfaces.
console.log(`\n=== production parseDiplomacyMatrix()[${PLAYER}] ===`);
const dip = x.parseDiplomacyMatrix(buf, order);
if (!dip) { console.log("parseDiplomacyMatrix returned null"); process.exit(1); }
const row = dip[PLAYER];
console.log(`war (${(row && row.war || []).length}): ${(row && row.war || []).join(", ")}`);
console.log(`allied (${(row && row.allied || []).length}): ${(row && row.allied || []).join(", ")}`);
console.log(`meta: stride=${dip._meta.stride} symmetry=${dip._meta.symmetry} N=${dip._meta.N}`);
