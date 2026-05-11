// dig-lua-state3.js — Use existing findLuaCounters to locate the counter
// table, then probe adjacent regions for richer mission/quest state.

const fs = require("fs");
const path = require("path");
const { findLuaCounters } = require(path.join("..", "..", "src", "luaCounterParser.js"));

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);
console.log(`# File: ${path.basename(SAVE)} (${buf.length} bytes)\n`);

// Run findLuaCounters
const recs = findLuaCounters(buf);
console.log(`Counter records found: ${recs.length}`);
if (recs.length === 0) {
  console.log("No counters found. Exiting.");
  process.exit(0);
}

console.log(`First counter @0x${recs[0].offset.toString(16)}: name=${JSON.stringify(recs[0].name)} value=${recs[0].value}`);
console.log(`Last counter @0x${recs[recs.length - 1].offset.toString(16)}: name=${JSON.stringify(recs[recs.length - 1].name)} value=${recs[recs.length - 1].value}`);
console.log(`Table spans 0x${recs[0].offset.toString(16)} .. 0x${recs[recs.length - 1].end.toString(16)} = ${recs[recs.length - 1].end - recs[0].offset} bytes\n`);

// Sample records
console.log("First 15 counter records:");
for (let i = 0; i < Math.min(15, recs.length); i++) {
  const r = recs[i];
  console.log(`  [${i}] ${JSON.stringify(r.name)} = ${r.value} (off=0x${r.offset.toString(16)})`);
}
console.log("\nLast 15 counter records:");
for (let i = Math.max(0, recs.length - 15); i < recs.length; i++) {
  const r = recs[i];
  console.log(`  [${i}] ${JSON.stringify(r.name)} = ${r.value} (off=0x${r.offset.toString(16)})`);
}

// All identifiers — categorize by token prefix
const cats = {};
for (const r of recs) {
  const m = r.name.match(/^([a-zA-Z]+_?)/);
  const cat = m ? m[1] : "?";
  if (!cats[cat]) cats[cat] = [];
  cats[cat].push(r);
}
console.log("\nCategorization by name prefix:");
for (const [cat, list] of Object.entries(cats).sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
  console.log(`  "${cat}*": ${list.length} (sample: ${list.slice(0, 3).map(r => r.name).join(", ")})`);
}

// Now: what's BEFORE the table (mission data?)
console.log("\n=== 256 bytes BEFORE the counter table ===");
const before = recs[0].offset;
for (let i = 0; i < 16; i++) {
  const off = before - 256 + i * 16;
  if (off < 0) continue;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// 256 bytes AFTER
console.log("\n=== 256 bytes AFTER the counter table ===");
const after = recs[recs.length - 1].end;
console.log(`Counter table ends at 0x${after.toString(16)}, file ends at 0x${buf.length.toString(16)} (${buf.length - after} bytes after)`);
for (let i = 0; i < 16; i++) {
  const off = after + i * 16;
  if (off + 16 > buf.length) break;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}
