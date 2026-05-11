// dig-unitstats9.js — Deep analysis of the per-soldier 8-byte records to find what XP/armor/weapon
// fields might look like. Look at byte 3 of each soldier record (the "3X" pattern), and also examine
// FRESH RECRUITS (units that exist in AFTER but not BEFORE).

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";
const F_BEFORE = "0184_save_Autosave   Macedon   Turn 12 End.sav";
const F_AFTER = "0192_save_Autosave   Macedon   Turn 13 Start.sav";

const bBuf = fs.readFileSync(path.join(ARCHIVE, F_BEFORE));
const aBuf = fs.readFileSync(path.join(ARCHIVE, F_AFTER));

const before = findUnitRecords(bBuf);
const after = findUnitRecords(aBuf);

function key(u) { return `${u.name}|${u.region}|${u.commanderUuid || 0}`; }
const bMap = new Map(); for (const u of before) bMap.set(key(u), u);

function regionEnd(buf, u) {
  const len = buf.readUInt16LE(u.offset);
  const ns = u.offset + 2, ne = ns + len - 1;
  for (let q = ne + 1; q < ne + 80; q++) {
    const rlen = buf[q];
    if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue;
    const rs = q + 2, re = rs + rlen * 2;
    if (re + 8 > buf.length) continue;
    let ok = true;
    for (let j = rs; j < re; j += 2) {
      if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    return re + 4;
  }
  return -1;
}

// Take FULL strength controls and decode their per-soldier byte 3 ("XX" in "?? ?? XX 00 ...").
// Pattern observed: `04 06 10 00 00 00 00 00` per soldier. Byte 3 was `10`/`20`/`30`/`40`/`50` etc.
// Could the high nibble of byte 3 be XP/morale and low nibble be armor/weapon?
//
// Actually I notice byte 3 looks like 0x10, 0x20, 0x30 etc. — multiples of 16. That's 16-byte chunks
// which doesn't look like XP. Let me try parsing per-soldier as different structures.
//
// Strategy: for a few unit types, count distinct values seen in byte 0, 1, 2, 3 of each soldier record.
// Then for the same unit in survivor saves, compare DIFFERENCES.

// First: collect per-soldier records for one specific unit (FULL strength) across many runs.
// Pick a unit name common everywhere.
function getSoldierRecords(buf, u) {
  const rE = regionEnd(buf, u);
  if (rE < 0) return null;
  // Use max from u.maxSoldiers passed in (or read from +8). The unit record's +8 is max.
  const max = buf.readUInt32LE(rE + 8);
  if (max === 0 || max > 500) return { rE, max: 0, recs: [] };
  const startAt = rE + 28;
  const recs = [];
  for (let i = 0; i < max; i++) {
    const off = startAt + 8 * i;
    if (off + 8 > buf.length) break;
    recs.push({
      b0: buf[off + 0], b1: buf[off + 1], b2: buf[off + 2], b3: buf[off + 3],
      b4: buf[off + 4], b5: buf[off + 5], b6: buf[off + 6], b7: buf[off + 7],
    });
  }
  return { rE, max, recs };
}

// Trace one fully-intact hoplites unit
const fsAfterHoplites = after.find(u => u.name === "hoplites" && u.soldiers === 160);
if (fsAfterHoplites) {
  console.log(`Full-strength hoplites in AFTER @ ${fsAfterHoplites.region} cmdr=${fsAfterHoplites.commanderUuid}`);
  const r = getSoldierRecords(aBuf, fsAfterHoplites);
  console.log(`  max=${r.max}, soldier records:`);
  const dist = { b0: new Map(), b1: new Map(), b2: new Map(), b3: new Map() };
  for (const rec of r.recs) {
    for (const f of ["b0", "b1", "b2", "b3"]) {
      dist[f].set(rec[f], (dist[f].get(rec[f]) || 0) + 1);
    }
  }
  for (const f of ["b0", "b1", "b2", "b3"]) {
    console.log(`  ${f}: ${[...dist[f].entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10).map(([k,v]) => `${k}=${v}`).join(", ")}`);
  }
  console.log(`  First 10 soldiers (raw):`);
  for (let i = 0; i < 10; i++) {
    const re = r.recs[i];
    console.log(`    ${i}: ${[re.b0, re.b1, re.b2, re.b3, re.b4, re.b5, re.b6, re.b7].map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
  }
}

// Now: count fresh new units (in after, not in before). These are turn-end recruits and would have
// XP=0, armor=0, weapon=0.
console.log(`\nNew units (recruited this turn):`);
const newUnits = [];
for (const u of after) {
  const ub = bMap.get(key(u));
  if (!ub) newUnits.push(u);
}
console.log(`  found ${newUnits.length} new units`);

// Find OLD units (in before, NOT in after) — these are killed in combat.
let killed = 0;
const beforeKeyed = new Map(); for (const u of before) beforeKeyed.set(key(u), u);
const afterKeyed = new Map(); for (const u of after) afterKeyed.set(key(u), u);
for (const [k, u] of beforeKeyed) if (!afterKeyed.has(k)) killed++;
console.log(`  killed/disappeared: ${killed}`);
for (const u of newUnits.slice(0, 15)) {
  console.log(`    ${u.name} @ ${u.region} soldiers=${u.soldiers}/${u.maxSoldiers}`);
}

// Now compare: do veteran (battle-survivor) units have any byte 3 patterns that differ from fresh?
// Find a hoplites in both BEFORE and AFTER full-strength as the "veteran" example
const refBefore = before.find(u => u.name === "hoplites" && u.soldiers === 160);
const refFreshNew = newUnits.find(u => u.name === "hoplites");

if (refBefore) {
  const r = getSoldierRecords(bBuf, refBefore);
  console.log(`\nVeteran hoplites BEFORE ${refBefore.region}, soldier records:`);
  for (let i = 0; i < 5; i++) {
    const re = r.recs[i];
    console.log(`  ${i}: ${[re.b0, re.b1, re.b2, re.b3, re.b4, re.b5, re.b6, re.b7].map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
  }
}
if (refFreshNew) {
  const r = getSoldierRecords(aBuf, refFreshNew);
  console.log(`\nFresh hoplites recruit ${refFreshNew.region} (max=${r.max}):`);
  for (let i = 0; i < 5; i++) {
    const re = r.recs[i];
    console.log(`  ${i}: ${[re.b0, re.b1, re.b2, re.b3, re.b4, re.b5, re.b6, re.b7].map(b => b.toString(16).padStart(2, "0")).join(" ")}`);
  }
}
