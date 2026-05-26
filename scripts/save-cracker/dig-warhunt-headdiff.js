// dig-warhunt-headdiff.js
// Anchor on head: `c8 00 00 00 <DS>` where DS in {0,100,200,400,600,850,1000}.
// Find all such heads in pre and war (aligned region), and report offsets where
// the attitude value DIFFERS between pre and war. This robustly isolates the
// records whose live attitude flipped, without depending on trailers.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const pre = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 Start.sav");
const war = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");
const DS = new Set([0,100,200,400,600,850,1000]);
const ALIGN_HI = 0x3f74a; // diplo marker same offset => aligned below this

// At every offset where base==200, check the next u32 (attitude). Compare pre/war.
const diffs = [];
for (let o = 0x8000; o + 8 <= ALIGN_HI; o++) {
  if (pre.readUInt32LE(o) !== 200) continue;
  const ap = pre.readUInt32LE(o + 4);
  if (!DS.has(ap)) continue;
  // war: same offset must also be base==200
  if (war.readUInt32LE(o) !== 200) { continue; }
  const aw = war.readUInt32LE(o + 4);
  if (!DS.has(aw)) continue;
  if (ap !== aw) diffs.push({ attOff: o + 4, pre: ap, war: aw });
}
console.log(`attitude-field diffs (base=200, DS attitude, aligned region 0x8000..0x${ALIGN_HI.toString(16)}):`);
for (const d of diffs) console.log(`  attOff=0x${d.attOff.toString(16)}  ${d.pre} -> ${d.war}`);
console.log(`total: ${diffs.length}`);

// Also: count total such records (base=200 + DS att) and att-value histogram pre/war.
function hist(buf) {
  const h = {};
  for (let o = 0x8000; o + 8 <= ALIGN_HI; o++) {
    if (buf.readUInt32LE(o) !== 200) continue;
    const a = buf.readUInt32LE(o + 4);
    if (!DS.has(a)) continue;
    h[a] = (h[a] || 0) + 1;
  }
  return h;
}
console.log("pre att histogram:", JSON.stringify(hist(pre)));
console.log("war att histogram:", JSON.stringify(hist(war)));
