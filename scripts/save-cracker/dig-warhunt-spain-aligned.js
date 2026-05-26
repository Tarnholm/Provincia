// dig-warhunt-spain-aligned.js
// The Spain diplo marker is at the SAME absolute offset (0x3f74a) in T4Start
// (pre-war), declareWAR, and besieged. So 0..0x3f74a is alignment-stable
// between those saves. Within that stable region, find bytes that differ
// between T4Start (pre) and BOTH war saves, where the two war saves AGREE.
// That isolates the war write from battle/RNG noise.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

const T4Start = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 Start.sav");
const declare = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");
const besieged = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 besiged .sav");
const t4 = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4.sav");

// First, verify alignment: find the longest matching prefix between T4Start and declare.
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}
console.log(`firstDiff T4Start vs declare:  0x${firstDiff(T4Start, declare).toString(16)}`);
console.log(`firstDiff T4Start vs besieged: 0x${firstDiff(T4Start, besieged).toString(16)}`);
console.log(`firstDiff declare vs besieged: 0x${firstDiff(declare, besieged).toString(16)}`);

// Byte-level diff in region 0..LIMIT where (declare==besieged) != T4Start.
const LIMIT = 0x3f74a;
const war = [declare, besieged];
function warAgree(o) { return declare[o] === besieged[o]; }
const diffs = [];
for (let o = 0; o < LIMIT; o++) {
  if (!warAgree(o)) continue;
  if (declare[o] === T4Start[o]) continue;
  diffs.push(o);
}
// group into runs
const runs = [];
for (const o of diffs) {
  if (runs.length && o === runs[runs.length - 1].end + 1) runs[runs.length - 1].end = o;
  else runs.push({ start: o, end: o });
}
console.log(`\nByte diffs in 0..0x${LIMIT.toString(16)} where war saves agree & differ from pre: ${diffs.length} bytes, ${runs.length} runs`);
for (const r of runs) {
  const len = r.end - r.start + 1;
  const pre = Array.from(T4Start.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const w = Array.from(declare.slice(r.start, r.end + 1)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`  0x${r.start.toString(16)}..0x${r.end.toString(16)} (${len}B)  pre[${pre}]  war[${w}]`);
}
