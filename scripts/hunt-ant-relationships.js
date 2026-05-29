"use strict";
// Antigonid is smIdx=5. Search for triples where one of the fields is 5
// (antigonid) AND another is 199 (alliance) or 201 (war).
// Expected: 6 alliances + 2 wars = 8 entries involving antigonid (or 16 if bidirectional)
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const buf = fs.readFileSync(path.join(SAVE_DIR, "save_antigonid turn1.sav"));

const ANT = 5;

// Try every u32 alignment for triples (a, b, type) — antigonid involved
console.log("=== triples (a, b, 199|201) where a===5 or b===5 ===");
const hits = [];
for (let o = 8; o + 4 <= buf.length; o += 4) {
  const v = buf.readUInt32LE(o);
  if (v !== 199 && v !== 201) continue;
  const a = buf.readUInt32LE(o - 8);
  const b = buf.readUInt32LE(o - 4);
  if (a > 238 || b > 238) continue;
  if (a !== ANT && b !== ANT) continue;
  hits.push({ o, a, b, v });
}
console.log(`hits where antigonid involved: ${hits.length}`);
// Expected ally partners for antigonid: seleucid=7, knossos=133, messene=157, cabyle=55, illyrian_kingdom=125, paeonia=172
// Expected war partners: epirus=98, galatians=102
const allyExp = [7, 133, 157, 55, 125, 172];
const warExp  = [98, 102];
for (const h of hits.slice(0, 30)) {
  const other = h.a === ANT ? h.b : h.a;
  const expected = (h.v === 199 && allyExp.includes(other)) ? "✓ALLY" :
                   (h.v === 201 && warExp.includes(other))  ? "✓WAR" :
                   "?";
  console.log(`  off=${h.o}  ${h.a},${h.b},${h.v}  other=${other} ${expected}`);
}

// Alternative layouts: (type, a, b) or (a, type, b)
console.log("\n=== triples (a, type, b) ===");
for (let o = 4; o + 8 <= buf.length; o += 4) {
  const v = buf.readUInt32LE(o);
  if (v !== 199 && v !== 201) continue;
  const a = buf.readUInt32LE(o - 4);
  const b = buf.readUInt32LE(o + 4);
  if (a > 238 || b > 238) continue;
  if (a !== ANT && b !== ANT) continue;
  const other = a === ANT ? b : a;
  const expected = (v === 199 && allyExp.includes(other)) ? "✓ALLY" :
                   (v === 201 && warExp.includes(other))  ? "✓WAR" :
                   "?";
  console.log(`  off=${o}  ${a},${v},${b}  other=${other} ${expected}`);
}
