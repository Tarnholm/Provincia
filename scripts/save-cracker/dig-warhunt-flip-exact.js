// dig-warhunt-flip-exact.js
// Robust per-record diff: anchor on trailer (579,0,-1,14). For each trailer in
// pre AND war that exists at the same offset (aligned saves), read attitude at
// trailer-0x40 and trailer-0x3c (handle the two layouts) and report records
// whose attitude flips pre->war. This tells us EXACTLY which records changed.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const pre = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 Start.sav");
const war = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");
const TRAILER = Buffer.from([0x43,0x02,0x00,0x00, 0x00,0x00,0x00,0x00, 0xff,0xff,0xff,0xff, 0x0e,0x00,0x00,0x00]);

function trailers(buf, lo, hi) { const o = []; let p = lo; while ((p = buf.indexOf(TRAILER, p)) !== -1 && p < hi) { o.push(p); p += 1; } return o; }

// Aligned region only (both share marker at 0x3f74a, so 0..0x3f74a is aligned).
const lo = 0x10000, hi = 0x3f000;
const tPre = new Set(trailers(pre, lo, hi));
const tWar = trailers(war, lo, hi);

// We compare records present at SAME trailer offset in both.
// For a record, find the attitude: scan backward from trailer for the FIRST
// `200` (base) u32 such that the NEXT u32 is a DS value, then attitude = base+4.
function readAtt(buf, t) {
  for (let o = t - 0x38; o >= t - 0x50; o -= 4) {
    if (buf.readUInt32LE(o) === 200) {
      const att = buf.readUInt32LE(o + 4);
      if ([0,100,200,400,600,850,1000].includes(att)) return { baseOff: o, att };
    }
  }
  return null;
}

let flips = [];
for (const t of tWar) {
  if (!tPre.has(t)) continue; // only aligned-matching trailers
  const rp = readAtt(pre, t), rw = readAtt(war, t);
  if (!rp || !rw) continue;
  if (rp.att !== rw.att) flips.push({ t, baseOff: rp.baseOff, pre: rp.att, war: rw.att });
}
console.log(`aligned trailers compared. attitude FLIPS pre->war:`);
for (const f of flips) {
  console.log(`  baseOff=0x${f.baseOff.toString(16)} attField=0x${(f.baseOff+4).toString(16)}  ${f.pre} -> ${f.war}`);
}
console.log(`total flips: ${flips.length}`);
