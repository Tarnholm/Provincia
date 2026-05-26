// dig-settle-lib.js — shared settlement stats-block locator.
//
// The settlement name appears in multiple sections of the save (name pool,
// region records, the stats-block record). We pick the occurrence whose
// negative-dx fields best match the known stats-block invariants:
//   creator(-583) small, level(-571)<10, tax(-562)<5, PO(-435) 0..100,
//   income(-127) plausible, pop(-35) 100..300000, pop_copy(-223)==pop.
//
// Returns the best-scoring namePos (= marker+1) or null.

"use strict";
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";

function loadSave(arg) {
  if (fs.existsSync(arg)) return fs.readFileSync(arg);
  const p = path.join(SAVES, arg); if (fs.existsSync(p)) return fs.readFileSync(p);
  throw new Error("save not found: " + arg);
}

function nameOccurrences(buf, name) {
  const out = [];
  for (const flag of [0x01, 0x00]) {
    const b = Buffer.alloc(3 + name.length * 2 + 2);
    b[0] = flag; b[1] = name.length; b[2] = 0;
    for (let i = 0; i < name.length; i++) { b[3 + i * 2] = name.charCodeAt(i); b[3 + i * 2 + 1] = 0; }
    let p = 0; while ((p = buf.indexOf(b, p)) !== -1) { out.push(p + 1); p += 1; }
  }
  return out.sort((a, b) => a - b);
}

// Score a candidate namePos against stats-block invariants. Higher = better.
function scoreCandidate(buf, namePos) {
  if (namePos - 583 < 0 || namePos + 4 > buf.length) return -1;
  const u32 = (dx) => buf.readUInt32LE(namePos + dx);
  let s = 0;
  const creator = buf[namePos - 583];
  const level = u32(-571);
  const tax = buf[namePos - 562];
  const po = u32(-435);
  const income = u32(-127);
  const pop = u32(-35);
  const popCopy = u32(-223);
  if (pop >= 100 && pop < 300000) s += 2; else return -1;
  if (popCopy === pop || Math.abs(popCopy - pop) < pop * 0.2) s += 2; // copy/snapshot near pop
  if (income >= 0 && income < 100000) s += 1;
  if (po >= 0 && po <= 100) s += 2;
  if (level >= 0 && level <= 8) s += 1;
  if (creator < 60) s += 1;
  if (tax <= 4) s += 1;
  return s;
}

function findStatsBlock(buf, name) {
  let best = null, bestScore = 3; // require a minimum score
  for (const np of nameOccurrences(buf, name)) {
    const sc = scoreCandidate(buf, np);
    if (sc > bestScore) { bestScore = sc; best = np; }
  }
  if (best == null) return null;
  const u32 = (dx) => buf.readUInt32LE(best + dx);
  return {
    namePos: best, score: bestScore,
    creator: buf[best - 583], level: u32(-571), tax: buf[best - 562],
    po: u32(-435), income: u32(-127), pop: u32(-35), popCopy: u32(-223),
  };
}

module.exports = { loadSave, nameOccurrences, scoreCandidate, findStatsBlock, SAVES };
