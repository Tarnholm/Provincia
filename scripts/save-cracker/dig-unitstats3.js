// dig-unitstats3.js — Detailed look at Turn 12 End → Turn 13 Start. Specifically: pick survivors with
// soldier-count drops, dump bytes after the soldier-count field looking for u8 changes 0→1+ in [0..9].
// XP/armor/weapon all live in [0..9] / [0..3] ranges so the simplest probe is byte-level.

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z";
const F_BEFORE = "0184_save_Autosave   Macedon   Turn 12 End.sav";
const F_AFTER = "0192_save_Autosave   Macedon   Turn 13 Start.sav";

const bBuf = fs.readFileSync(path.join(ARCHIVE, F_BEFORE));
const aBuf = fs.readFileSync(path.join(ARCHIVE, F_AFTER));

console.log(`before ${bBuf.length}, after ${aBuf.length}, delta ${aBuf.length - bBuf.length}`);

const before = findUnitRecords(bBuf);
const after = findUnitRecords(aBuf);

function key(u) { return `${u.name}|${u.region}|${u.commanderUuid || 0}`; }
const bMap = new Map(); for (const u of before) bMap.set(key(u), u);

// Find survivors (took losses but still alive)
const survivors = [];
for (const u of after) {
  const ub = bMap.get(key(u));
  if (!ub) continue;
  // Survived a battle: soldier count dropped between turns, still > 0
  if (ub.soldiers > u.soldiers && u.soldiers > 0 && ub.soldiers > 0) {
    survivors.push({ before: ub, after: u });
  }
}

console.log(`\nSurvivors with losses: ${survivors.length}`);

// For each survivor, dump the 80 bytes AFTER the soldier-count field in both saves
// Layout (variant A): name, region, FFFFFFFF, commanderUuid, prev/other, max u32, current u32, ...
// regionEnd points to right after the terminator. From there:
//   +0  commanderUuid  (variant A)
//   +4  ??
//   +8  max
//   +12 current
//   +16..  payload (might contain XP/armor/weapon)

// Find the offset of the "current soldiers" u32 in each save's record (or the area right after it).
function findUnitRecordEnd(buf, u) {
  // Walk back from u.offset + ... but easier: search forward from u.offset for the ffff terminator + uuid
  // Use the same finder logic, but the existing parser doesn't return regionEnd. Let's redo:
  const len = buf.readUInt16LE(u.offset);
  const ns = u.offset + 2, ne = ns + len - 1;
  // Look forward for region (similar to parser)
  for (let q = ne + 1; q < ne + 80; q++) {
    const rlen = buf[q];
    if (rlen < 3 || rlen > 50 || buf[q + 1] !== 0) continue;
    const rs = q + 2, re = rs + rlen * 2;
    if (re + 8 > buf.length) continue;
    // Quick UTF-16 validation
    let ok = true;
    for (let j = rs; j < re; j += 2) {
      if (buf[j + 1] !== 0 || buf[j] < 0x20 || buf[j] > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    return re + 4; // past terminator
  }
  return -1;
}

// Compare bytes 0..120 after the regionEnd for the FIRST 5 survivors
for (let s = 0; s < Math.min(5, survivors.length); s++) {
  const { before: ub, after: u } = survivors[s];
  console.log(`\n=== Survivor ${s}: ${u.name} @ ${u.region} cmdr=${u.commanderUuid} ===`);
  console.log(`  before: ${ub.soldiers}/${ub.maxSoldiers}  off=0x${ub.offset.toString(16)}`);
  console.log(`  after:  ${u.soldiers}/${u.maxSoldiers}   off=0x${u.offset.toString(16)}`);
  const bEnd = findUnitRecordEnd(bBuf, ub);
  const aEnd = findUnitRecordEnd(aBuf, u);
  console.log(`  bEnd=0x${bEnd.toString(16)} aEnd=0x${aEnd.toString(16)}`);
  if (bEnd < 0 || aEnd < 0) continue;

  // For variant A: at +0 commanderUuid, +8 max, +12 current.
  // Dump byte-by-byte from +0 to +120
  let hexB = "", hexA = "", diff = "";
  for (let i = 0; i < 120; i++) {
    const xb = bBuf[bEnd + i], xa = aBuf[aEnd + i];
    hexB += xb.toString(16).padStart(2, "0") + " ";
    hexA += xa.toString(16).padStart(2, "0") + " ";
    diff += (xb !== xa) ? "** " : ".. ";
    if (i % 16 === 15) {
      console.log(`+${(i - 15).toString().padStart(3)}: B ${hexB.trim()}`);
      console.log(`     A ${hexA.trim()}`);
      console.log(`     D ${diff.trim()}`);
      hexB = ""; hexA = ""; diff = "";
    }
  }
}
