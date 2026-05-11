// dig-unitstats2.js — Survey ALL adjacent Macedon Turn End → Turn N+1 Start pairs in the calibration archive
// to find ones where soldier counts changed (= battle happened).

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";

// Find unique (turn, type) pairs. Each save name like "0147_save_Autosave   Macedon   Turn 10 End.sav".
const allFiles = fs.readdirSync(ARCHIVE).filter(f => f.endsWith(".sav"));
const byTurn = new Map();
for (const f of allFiles) {
  const m = f.match(/Turn (\d+) (End|Start)/);
  if (!m) continue;
  const turn = parseInt(m[1], 10);
  const phase = m[2];
  // Take LARGEST (highest filesize) version of each turn-phase
  const stat = fs.statSync(path.join(ARCHIVE, f));
  const k = `${turn}|${phase}`;
  const prev = byTurn.get(k);
  if (!prev || prev.size < stat.size) byTurn.set(k, { file: f, size: stat.size, turn, phase });
}

console.log(`Found ${byTurn.size} unique (turn,phase) saves`);

// For each turn N, pair (Turn N End → Turn N+1 Start)
const pairs = [];
for (const [k, v] of byTurn) {
  if (v.phase !== "End") continue;
  const nextK = `${v.turn + 1}|Start`;
  const next = byTurn.get(nextK);
  if (next) pairs.push({ from: v, to: next });
}

console.log(`Have ${pairs.length} Turn-End → Turn-Start pairs`);

// Quick survey: for each pair check size and find any "soldier count changed" unit
const results = [];
for (const p of pairs.slice(0, 20)) {
  try {
    const bBuf = fs.readFileSync(path.join(ARCHIVE, p.from.file));
    const aBuf = fs.readFileSync(path.join(ARCHIVE, p.to.file));
    const b = findUnitRecords(bBuf);
    const a = findUnitRecords(aBuf);
    function key(u) { return `${u.name}|${u.region}|${u.commanderUuid || 0}`; }
    const bMap = new Map(); for (const u of b) bMap.set(key(u), u);
    let survivors = 0, sample = null;
    for (const u of a) {
      const ub = bMap.get(key(u));
      if (!ub) continue;
      if (ub.soldiers !== u.soldiers && u.soldiers > 0) {
        survivors++;
        if (!sample) sample = { name: u.name, before: ub.soldiers, after: u.soldiers, max: u.maxSoldiers };
      }
    }
    results.push({ turn: p.from.turn, fromSize: bBuf.length, toSize: aBuf.length, beforeUnits: b.length, afterUnits: a.length, survivors, sample });
  } catch (e) {
    console.log(`  ERR turn ${p.from.turn}: ${e.message}`);
  }
}

results.sort((a, b) => b.survivors - a.survivors);
for (const r of results) {
  console.log(`Turn ${r.turn}: ${r.fromSize}→${r.toSize} (${r.beforeUnits}→${r.afterUnits} units, ${r.survivors} survivors)${r.sample ? `, e.g. ${r.sample.name} ${r.sample.before}→${r.sample.after}/${r.sample.max}` : ''}`);
}
