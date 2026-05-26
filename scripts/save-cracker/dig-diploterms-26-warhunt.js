// dig-diploterms-26-warhunt.js
// Definitive war-location hunt. War (spain vs carthage) must be SOMEWHERE.
// Strategy: find byte positions that are IDENTICAL across T4start/T4war is huge,
// but the war is committed. Approach: intersect the diff of (T4start->T4war) with
// the diff of (T3end->T4start) — war-specific changes should be in the former but
// the churn is in both. Then among war-only changes, look for faction-pair stance.
//
// Better: use 3 same-state pairs to find the STABLE-then-CHANGED signal.
// We compare T4start vs T4war and T1 vs T1move (both same-turn). Bytes that
// change in BOTH at the SAME relative structure = churn. We want war-unique.
//
// Simplest robust approach: count, for each 4-byte aligned position, whether it
// changed T4start->T4war. Then check the SAME position T3end->T4start. If it
// changed war-transition but NOT the prior same-turn pair AND the new value is a
// small stance-like int, flag it.
"use strict";
const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const t4s = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Spain   Turn 4 Start.sav"));
const t4w = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"));

// They are nearly same size. Find runs.
const n = Math.min(t4s.length, t4w.length);
console.log(`T4start=${t4s.length} T4war=${t4w.length}`);

// Look for any NEW occurrence of the byte pattern that would indicate a war
// declaration: a record pairing faction 7 (carthage) and 18 (spain) with a
// stance > 200. Search T4war for `<07 00 00 00> ... <stance>` structures that
// are absent in T4start at the same area. Instead, search for the appearance of
// a NEW 'war' marker. RTW uses 'at_war' as part of campaign state — search both
// for any ASCII 'war'/'diplo' strings near changes.
function findAscii(buf, s) {
  const tgt = Buffer.from(s, "ascii");
  const out = []; let p=0; while((p=buf.indexOf(tgt,p))!==-1){out.push(p);p+=1;} return out;
}
for (const kw of ["war", "ceasefire", "alliance", "tribute", "trade_rights", "diplomatic"]) {
  const a = findAscii(t4s, kw).length, b = findAscii(t4w, kw).length;
  console.log(`  ascii "${kw}": T4start=${a} T4war=${b}`);
}

// Now: the cleanest war-stance candidate. In RTW campaign state, each faction has
// a diplomacy struct. Search for a 21-int array where index 7 (carthage) flips
// from a low value to a high (war) value in T4war but not T4start. Slide a window
// and look for arrays of 21 small ints (0..5) where exactly index 7 differs.
let found = 0;
for (let off = 0x3000; off + 21*4 < n; off += 4) {
  // read 21 u32, all must be < 8 (stance enum range)
  let ok = true;
  for (let k = 0; k < 21; k++) { if (t4s.readUInt32LE(off+k*4) > 7) { ok=false; break; } }
  if (!ok) continue;
  // compare to t4w: exactly index 7 (carthage) changed?
  let diffIdx = [];
  for (let k = 0; k < 21; k++) { if (t4s.readUInt32LE(off+k*4) !== t4w.readUInt32LE(off+k*4)) diffIdx.push(k); }
  if (diffIdx.length === 1 && diffIdx[0] === 7) {
    found++;
    console.log(`  CANDIDATE 21-int stance array @0x${off.toString(16)}: idx7 ${t4s.readUInt32LE(off+28)}->${t4w.readUInt32LE(off+28)}`);
    if (found > 20) break;
  }
}
console.log(`21-int idx7-only candidates: ${found}`);
