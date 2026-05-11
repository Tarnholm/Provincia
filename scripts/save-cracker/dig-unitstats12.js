// dig-unitstats12.js — Carefully analyze the PER-UNIT HEADER between regionEnd+16 and the start of
// the per-soldier array (regionEnd+28). Also look at what comes AFTER the unit's known fields
// (commanderUuid, max, current) in case XP/armor/weapon is stored before per-soldier.
//
// Hypothesis: at regionEnd+16..+19 we might have 4 packed bytes encoding [xp][armor][weapon][?]
// or 3 u32s for each.

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";

// Compare across MULTIPLE turn boundaries. Some units gain XP every turn boundary they
// fought in but stay 0 otherwise. Let's look at hoplites in Greece across many turns.
const pairs = [
  ["0001_save_Autosave   Macedon   Turn 1 End.sav", "0212_save_Autosave   Macedon   Turn 2 Start.sav"],
  ["0184_save_Autosave   Macedon   Turn 12 End.sav", "0192_save_Autosave   Macedon   Turn 13 Start.sav"],
  ["0199_save_Autosave   Macedon   Turn 13 End.sav", "0363_save_Autosave   Macedon   Turn 14 Start.sav"],
  ["0420_save_Autosave   Macedon   Turn 18 End.sav", "0427_save_Autosave   Macedon   Turn 19 Start.sav"],
];

for (const [beforeFile, afterFile] of pairs) {
  console.log(`\n=== ${beforeFile} → ${afterFile} ===`);
  const bBuf = fs.readFileSync(path.join(ARCHIVE, beforeFile));
  const aBuf = fs.readFileSync(path.join(ARCHIVE, afterFile));

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

  // Find a few survivors (lost soldiers, still alive)
  const survivors = [];
  const fsControl = [];
  for (const u of after) {
    const ub = bMap.get(key(u));
    if (!ub) continue;
    if (u.soldiers === 0 || ub.soldiers === 0) continue;
    const bE = regionEnd(bBuf, ub);
    const aE = regionEnd(aBuf, u);
    if (bE < 0 || aE < 0) continue;
    const losses = ub.soldiers - u.soldiers;
    if (losses > 0) survivors.push({ ub, u, bE, aE, losses });
    else fsControl.push({ ub, u, bE, aE, losses });
  }

  console.log(`  survivors=${survivors.length}, controls=${fsControl.length}`);

  // For all survivors, scan offsets 0..28 from regionEnd (the per-unit header zone).
  // Look for bytes that change consistently in survivors.
  console.log(`  Survivors header (regionEnd+0..+28):`);
  for (let off = 0; off <= 28; off++) {
    let survChange = 0, fsChange = 0;
    let smallVals = [];
    for (const s of survivors) {
      const bV = bBuf[s.bE + off], aV = aBuf[s.aE + off];
      if (bV !== aV) {
        survChange++;
        if (bV <= 9 && aV <= 9) smallVals.push(`${bV}→${aV}`);
      }
    }
    for (const s of fsControl) {
      if (bBuf[s.bE + off] !== aBuf[s.aE + off]) fsChange++;
    }
    if (survChange > 0 || fsChange > 0) {
      console.log(`    +${off.toString().padStart(2)}: ${survChange}/${survivors.length} surv, ${fsChange}/${fsControl.length} ctrl${smallVals.length ? ` small: ${smallVals.slice(0,5).join(", ")}` : ''}`);
    }
  }
}
