// dig-tail-strings1.js — pull all ASCII (>=5 chars) and UTF-16 strings in a
// given offset range, with offsets. Lets us name each tail sub-region.
"use strict";
const fs = require("fs");
const SAVE = process.argv[2] ||
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const START = parseInt(process.argv[3] || "0xf80000", 16);
const END = parseInt(process.argv[4] || "0x1500000", 16);
const MINLEN = parseInt(process.argv[5] || "6", 10);

const buf = fs.readFileSync(SAVE);
console.log(`range 0x${START.toString(16)} .. 0x${END.toString(16)}  (${((END-START)/1024).toFixed(0)} KB)  minlen=${MINLEN}`);

// ASCII runs
const asc = [];
let cur = -1;
for (let i = START; i <= END; i++) {
  const v = i < END ? buf[i] : 0;
  const p = v >= 0x20 && v < 0x7f;
  if (p && cur < 0) cur = i;
  else if (!p && cur >= 0) {
    if (i - cur >= MINLEN) asc.push({ off: cur, s: buf.slice(cur, i).toString("ascii") });
    cur = -1;
  }
}
// UTF-16 runs (lo byte printable, hi byte 0)
const u16 = [];
cur = -1;
for (let i = START; i + 1 <= END; i += 2) {
  const lo = buf[i], hi = buf[i + 1];
  const p = hi === 0 && lo >= 0x20 && lo < 0x7f;
  if (p && cur < 0) cur = i;
  else if (!p && cur >= 0) {
    const n = (i - cur) / 2;
    if (n >= MINLEN) {
      let s = ""; for (let k = cur; k < i; k += 2) s += String.fromCharCode(buf[k]);
      u16.push({ off: cur, s });
    }
    cur = -1;
  }
}

// Frequency table of ASCII strings (to spot repeated record tokens)
const freq = new Map();
for (const a of asc) freq.set(a.s, (freq.get(a.s) || 0) + 1);

console.log(`\n=== ASCII strings (first 60 distinct) ===`);
let shown = 0;
const seen = new Set();
for (const a of asc) {
  if (seen.has(a.s)) continue;
  seen.add(a.s);
  console.log(`  0x${a.off.toString(16)}  (x${freq.get(a.s)})  "${a.s}"`);
  if (++shown >= 60) break;
}

console.log(`\n=== Top repeated ASCII tokens ===`);
[...freq.entries()].filter(e => e[1] > 2).sort((a,b)=>b[1]-a[1]).slice(0,40)
  .forEach(([s,c]) => console.log(`  x${c}  "${s}"`));

console.log(`\n=== UTF-16 strings (first 40 distinct) ===`);
shown = 0; seen.clear();
for (const u of u16) {
  if (seen.has(u.s)) continue; seen.add(u.s);
  console.log(`  0x${u.off.toString(16)}  "${u.s}"`);
  if (++shown >= 40) break;
}
console.log(`\ntotals: ascii_runs=${asc.length} utf16_runs=${u16.length}`);
