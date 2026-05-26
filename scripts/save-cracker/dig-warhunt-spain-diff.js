// dig-warhunt-spain-diff.js
// Spain declares war on Carthage via attack. Find war state by INTERSECTION:
// bytes that are COMMON across ALL at-war saves but DIFFERENT in BOTH pre-war
// saves. Restrict to early region (0..0x40000) first to avoid battle churn,
// then whole file.
//
// Spain=18 (0x12), Carthage=7. Vanilla faction order.
// Pre-war:  T3 End, T4 Start
// At-war:   declare-war, besieged, besieged-corduba, T4
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

const PRE = [
  "save_Autosave   Spain   Turn 3 End.sav",
  "save_Autosave   Spain   Turn 4 Start.sav",
];
const WAR = [
  "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav",
  "save_Autosave   Spain   Turn 4 besiged .sav",
  "save_Autosave   Spain   Turn 4 besiged corduba.sav",
  "save_Autosave   Spain   Turn 4.sav",
];

const pre = PRE.map(f => fs.readFileSync(SAVES_DIR + f));
const war = WAR.map(f => fs.readFileSync(SAVES_DIR + f));

console.log("sizes pre:", pre.map(b => b.length), "war:", war.map(b => b.length));

// Helper: value at offset equal across a set of buffers?
function allEqual(bufs, o) {
  if (o + 4 > bufs[0].length) return false;
  const v = bufs[0].readUInt32LE(o);
  for (let i = 1; i < bufs.length; i++) {
    if (o + 4 > bufs[i].length) return false;
    if (bufs[i].readUInt32LE(o) !== v) return false;
  }
  return true;
}
function valEq(bufs, o, v) {
  for (const b of bufs) { if (o + 4 > b.length || b.readUInt32LE(o) !== v) return false; }
  return true;
}

// Find offsets where: all WAR saves agree on value W, all PRE saves agree on
// value P, and W != P. (4-byte aligned scan in early region.)
function scan(limit, step) {
  const out = [];
  const end = Math.min(limit, ...pre.map(b => b.length), ...war.map(b => b.length));
  for (let o = 0; o + 4 <= end; o += step) {
    if (!allEqual(war, o)) continue;
    if (!allEqual(pre, o)) continue;
    const w = war[0].readUInt32LE(o);
    const p = pre[0].readUInt32LE(o);
    if (w === p) continue;
    out.push({ o, p, w });
  }
  return out;
}

for (const limit of [0x40000, 0x80000]) {
  const hits = scan(limit, 1);
  console.log(`\n=== intersection scan (war-const != pre-const), region 0..0x${limit.toString(16)}, step 1 ===`);
  console.log(`hits: ${hits.length}`);
  for (const h of hits.slice(0, 60)) {
    console.log(`  @0x${h.o.toString(16).padStart(6,"0")}  pre=${h.p} (0x${h.p.toString(16)})  war=${h.w} (0x${h.w.toString(16)})`);
  }
  if (hits.length > 60) console.log(`  ... +${hits.length - 60} more`);
}
