"use strict";
// For each player save, search ALL 239 rows of the diplomacy matrix and
// score each by how well it matches the source descr_strat ground truth
// for that player faction. The row with the highest score IS that faction's
// real row in the matrix. The OFFSET between smOrder index and actual row
// reveals how the matrix indexes factions.
const fs = require("fs");
const path = require("path");
const xtras = require("../src/saveCrackerExtras.js");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const SAVES = [
  { name: "ANT T1", file: "save_antigonid turn1.sav", player: "antigonid" },
  { name: "ANT T2", file: "save_antigonid turn2.sav", player: "antigonid" },
  { name: "ANT T3", file: "save_antigonid turn3.sav", player: "antigonid" },
  { name: "JUL T1", file: "save_Julii turn1.sav", player: "romans_julii" },
  { name: "JUL T2", file: "save_Julii turn2.sav", player: "romans_julii" },
  { name: "CAR T1", file: "save_Carthage turn1.sav", player: "carthage" },
  { name: "CAR T2", file: "save_Carthage turn2.sav", player: "carthage" },
  { name: "BAC T1", file: "save_Bactria turn1.sav", player: "bactria" },
  { name: "BAC T2", file: "save_Bactria turn2.sav", player: "bactria" },
];

// Parse descr_strat core_attitudes into a per-faction map.
// Each entry: { faction: { targetFaction: att } }
const STRAT = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";
const stratText = fs.readFileSync(STRAT, "utf8");
const expected = {};
for (const raw of stratText.split(/\r?\n/)) {
  const m = raw.trim().match(/^core_attitudes\s+([a-z_0-9]+)\s*,\s*(-?\d+)\s+([a-z_0-9]+)/);
  if (!m) continue;
  // line: "core_attitudes  TARGET,  ATT  SOURCE"
  // means SOURCE has att=ATT toward TARGET
  const [, target, attStr, source] = m;
  const att = parseInt(attStr, 10);
  (expected[source] ||= {})[target] = att;
}
console.log(`expected sources: ${Object.keys(expected).length}`);

const SM = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const smOrder = [];
for (const line of fs.readFileSync(SM, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\t"([a-z_0-9]+)":/);
  if (m) smOrder.push(m[1]);
}
const idxOf = (n) => smOrder.indexOf(n);

// Score a row: how many cells match the expected core_attitudes for `player`?
// Expected non-default cells should appear in the row with the right att.
function scoreRow(buf, base, stride, N, C, rowIdx, expectedMap) {
  let matched = 0, mismatched = 0;
  for (const [target, expAtt] of Object.entries(expectedMap)) {
    const B = idxOf(target);
    if (B < 0) continue;
    const o = base + (rowIdx * N + B + C) * stride;
    if (o + 20 > buf.length) continue;
    const att = buf.readUInt32LE(o + 4);
    // Tolerance: source att-10 is roughly "low friendly" → matrix might encode as 0 or 200
    // source att=600 → matrix should be 600
    // source att=200 → matrix should be 200
    if (att === expAtt) matched++;
    else if (expAtt === -10 && (att === 0 || att === 200)) matched++; // ambiguous
    else mismatched++;
  }
  return { matched, mismatched };
}

for (const s of SAVES) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s.file));
  const dip = xtras.parseDiplomacyMatrix(buf, smOrder);
  if (!dip) { console.log(`${s.name} NO MATRIX`); continue; }
  const { base, stride, N, C, key } = dip._meta;
  const expectedSm = idxOf(s.player);
  const exp = expected[s.player] || {};
  console.log(`\n${s.name} player=${s.player} (smIdx=${expectedSm})  base=${base} key=${key}  expected non-default cells: ${Object.keys(exp).length}`);
  // Score top 10 rows by match
  const scores = [];
  for (let row = 0; row < N; row++) {
    const sc = scoreRow(buf, base, stride, N, C, row, exp);
    scores.push({ row, ...sc });
  }
  scores.sort((a, b) => b.matched - a.matched || a.mismatched - b.mismatched);
  console.log(`  top 8 candidate rows:`);
  for (const sc of scores.slice(0, 8)) {
    const labeled = smOrder[sc.row] || "?";
    console.log(`    row=${sc.row.toString().padStart(3)} (sm=${labeled.padEnd(20)})  matched=${sc.matched} mismatched=${sc.mismatched}`);
  }
}
