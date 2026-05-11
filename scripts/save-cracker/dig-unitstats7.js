// dig-unitstats7.js — Wider survey: scan offsets -40..+200 from regionEnd for bytes that change
// ONLY in survivors, with values in [0..9] (potential XP/armor/weapon range).
// Also: look for bytes that change in a CONSISTENT direction (always increase, or 0→K).

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

// Get unit start offset: useful for "before name" probe (pre-record bytes)
function unitStart(u) { return u.offset; }

// Survivor and full-strength control sets
const allMatched = [];
for (const u of after) {
  const ub = bMap.get(key(u));
  if (!ub) continue;
  if (u.soldiers === 0 || ub.soldiers === 0) continue;
  const bE = regionEnd(bBuf, ub);
  const aE = regionEnd(aBuf, u);
  if (bE < 0 || aE < 0) continue;
  const losses = ub.soldiers - u.soldiers;
  allMatched.push({ ub, u, bE, aE, losses });
}

const survivors = allMatched.filter(s => s.losses > 0);
const fsControl = allMatched.filter(s => s.losses === 0);

console.log(`Survivors: ${survivors.length}, Full-strength control: ${fsControl.length}`);

// For each relative offset -40..+500, see how many survivors change. Bias toward offsets
// where ALL of: (a) at least 5 survivors change, (b) the values are <= 9, (c) full-strength is stable.
console.log(`\nLooking for offsets where SURVIVORS change with value <= 9 AND control units are stable:`);
const candidates = [];
for (let off = -60; off <= 500; off++) {
  let survChange = 0, fsChange = 0;
  let smallValTransitions = [];
  for (const s of survivors) {
    if (s.bE + off < 0 || s.aE + off < 0 || s.bE + off >= bBuf.length || s.aE + off >= aBuf.length) continue;
    const bV = bBuf[s.bE + off], aV = aBuf[s.aE + off];
    if (bV !== aV) {
      survChange++;
      if (bV <= 9 && aV <= 9 && aV !== bV) smallValTransitions.push(`${bV}→${aV}`);
    }
  }
  for (const s of fsControl) {
    if (s.bE + off < 0 || s.aE + off < 0 || s.bE + off >= bBuf.length || s.aE + off >= aBuf.length) continue;
    if (bBuf[s.bE + off] !== aBuf[s.aE + off]) fsChange++;
  }
  // Strong candidate: many survivors change, no/very-few control changes, small values
  if (survChange >= 5 && fsChange < 5) {
    candidates.push({ off, survChange, fsChange, smallVals: smallValTransitions.slice(0, 10) });
  }
}
candidates.sort((a, b) => b.survChange - a.survChange);
for (const c of candidates.slice(0, 30)) {
  console.log(`  +${c.off}: ${c.survChange}/${survivors.length} surv, ${c.fsChange}/${fsControl.length} ctrl${c.smallVals.length ? `  small: ${c.smallVals.join(", ")}` : ''}`);
}

// Specifically look at PRE-record bytes (before name): in case unit-XP lives BEFORE the unit name
console.log(`\nPre-name probe: offsets -60..-1 from unit.offset (the nameLen u16):`);
const candidates2 = [];
for (let off = -60; off <= -1; off++) {
  let survChange = 0, fsChange = 0;
  let smallValTransitions = [];
  for (const s of survivors) {
    if (s.ub.offset + off < 0 || s.u.offset + off < 0) continue;
    const bV = bBuf[s.ub.offset + off], aV = aBuf[s.u.offset + off];
    if (bV !== aV) {
      survChange++;
      if (bV <= 9 && aV <= 9) smallValTransitions.push(`${bV}→${aV}`);
    }
  }
  for (const s of fsControl) {
    if (s.ub.offset + off < 0 || s.u.offset + off < 0) continue;
    if (bBuf[s.ub.offset + off] !== aBuf[s.u.offset + off]) fsChange++;
  }
  if (survChange >= 5 && fsChange < 10) {
    candidates2.push({ off, survChange, fsChange, smallVals: smallValTransitions });
  }
}
candidates2.sort((a, b) => b.survChange - a.survChange);
for (const c of candidates2.slice(0, 15)) {
  console.log(`  preName ${c.off}: ${c.survChange}/${survivors.length} surv, ${c.fsChange}/${fsControl.length} ctrl${c.smallVals.length ? `  small: ${c.smallVals.slice(0, 8).join(", ")}` : ''}`);
}
