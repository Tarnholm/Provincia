// dig-settle-track.js
//
// Track a settlement's ENTIRE stats block across N consecutive saves. For each
// dx in [-584..-1] print the sequence of u8 values across turns, but only for
// dx where the value CHANGES at least once (dynamic fields). Also print known
// derived u32 reads (pop, income, PO) per save for context.
//
// This shows the trajectory of every dynamic field so we can correlate with
// population growth / income / PO and label fields.
//
// Usage: node dig-settle-track.js <name> "<saveA>" "<saveB>" ["<saveC>" ...]

"use strict";
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
function loadSave(arg) {
  if (fs.existsSync(arg)) return fs.readFileSync(arg);
  const p = path.join(SAVES, arg); if (fs.existsSync(p)) return fs.readFileSync(p);
  throw new Error("save not found: " + arg);
}
function findStatsBlock(buf, name) {
  const cands = [];
  for (const flag of [0x01, 0x00]) {
    const b = Buffer.alloc(3 + name.length * 2 + 2);
    b[0] = flag; b[1] = name.length; b[2] = 0;
    for (let i = 0; i < name.length; i++) { b[3 + i * 2] = name.charCodeAt(i); b[3 + i * 2 + 1] = 0; }
    let p = 0; while ((p = buf.indexOf(b, p)) !== -1) { cands.push(p + 1); p += 1; }
  }
  for (const namePos of cands.sort((a, b) => a - b)) {
    if (namePos - 583 < 0) continue;
    const rd = (dx) => buf.readUInt32LE(namePos + dx);
    const income = rd(-127), pop = rd(-35);
    // Loose gate keyed on income & pop only (PO/creator may shift under siege)
    if (income < 200000 && pop >= 100 && pop < 300000) {
      return { namePos, pop, income, po: rd(-435), creator: buf[namePos - 583], level: rd(-571) };
    }
  }
  return null;
}

const name = process.argv[2];
const saveArgs = process.argv.slice(3);
const blocks = saveArgs.map(s => { const buf = loadSave(s); return { label: s.replace(/^.*save_/, "").replace(/\.sav$/, "").slice(0, 28), b: findStatsBlock(buf, name), buf }; });

console.log(`=== ${name} across ${blocks.length} saves ===`);
for (const blk of blocks) {
  if (!blk.b) { console.log(`  ${blk.label}: NOT FOUND`); continue; }
  console.log(`  ${blk.label}: namePos=${blk.b.namePos} creator=${blk.b.creator} lvl=${blk.b.level} PO=${blk.b.po} income=${blk.b.income} pop=${blk.b.pop}`);
}

const valid = blocks.filter(b => b.b);
if (valid.length < 2) process.exit(0);

console.log("\nDynamic u8 fields (dx : values across saves):");
for (let dx = -584; dx <= -1; dx++) {
  const vals = valid.map(blk => blk.buf[blk.b.namePos + dx]);
  if (vals.some(v => v !== vals[0])) {
    console.log(`  dx ${dx}\t: ${vals.join("  ")}`);
  }
}
