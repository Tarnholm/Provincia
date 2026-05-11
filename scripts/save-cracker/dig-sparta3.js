// Look at the bytes IMMEDIATELY before and after each "sparta" cstring
// occurrence. RTW faction records typically have the faction-name string
// preceded or followed by small structural fields (faction-id u16, color u32,
// flags u8). These are exactly the bytes that should change when sparta
// declares war.
//
// For each sparta occurrence in baseline, dump bytes Δ=-32..+64 from the
// start of the string in BOTH baseline and variant, side-by-side, and
// highlight differences.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const a = fs.readFileSync(path.join(SAVE_DIR, "save_savestartsparta.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_1.1.sav"));

function findAll(buf, needle, max = 100) {
  const hits = []; let from = 0;
  while (hits.length < max) {
    const i = buf.indexOf(needle, from);
    if (i < 0) break;
    hits.push(i); from = i + 1;
  }
  return hits;
}

const sparta = Buffer.from("sparta", "utf-8");
const aHits = findAll(a, sparta);
const bHits = findAll(b, sparta);
console.log(`sparta hits — baseline:${aHits.length} variant:${bHits.length}\n`);

// Show neighborhood for each occurrence; mark diffs
const PRE = 64, POST = 96;
for (let i = 0; i < Math.min(aHits.length, bHits.length); i++) {
  const ao = aHits[i], bo = bHits[i];
  console.log(`=== sparta #${i}: baseline @0x${ao.toString(16)}, variant @0x${bo.toString(16)} (shift ${bo - ao}) ===`);
  let diffs = 0;
  for (let row = -PRE; row < POST; row += 16) {
    let line = `Δ${String(row).padStart(4)}  `;
    let lineHasDiff = false;
    for (let c = 0; c < 16; c++) {
      const aOff = ao + row + c, bOff = bo + row + c;
      if (aOff < 0 || aOff >= a.length || bOff < 0 || bOff >= b.length) { line += "   "; continue; }
      const av = a[aOff], bv = b[bOff];
      if (av !== bv) {
        line += `\x1b[33m${av.toString(16).padStart(2,"0")}\x1b[0m `;
        lineHasDiff = true;
        diffs++;
      } else {
        line += `${av.toString(16).padStart(2,"0")} `;
      }
    }
    line += "  ";
    for (let c = 0; c < 16; c++) {
      const aOff = ao + row + c;
      if (aOff < 0 || aOff >= a.length) continue;
      const v = a[aOff];
      line += (v >= 0x20 && v <= 0x7e) ? String.fromCharCode(v) : ".";
    }
    if (lineHasDiff || (row === 0)) console.log(line);
  }
  console.log(`(total diffs in window: ${diffs})\n`);
  if (i >= 3) break; // Just first 4 occurrences
}

// Now extract the differing bytes specifically — what enum-like values changed?
console.log(`\n[byte-level diffs in ±64B around each sparta occurrence (paired)]`);
for (let i = 0; i < Math.min(aHits.length, bHits.length); i++) {
  const ao = aHits[i], bo = bHits[i];
  for (let row = -64; row < 96; row++) {
    const aOff = ao + row, bOff = bo + row;
    if (aOff < 0 || aOff >= a.length || bOff < 0 || bOff >= b.length) continue;
    const av = a[aOff], bv = b[bOff];
    if (av !== bv) {
      console.log(`  sparta#${i} Δ=${String(row).padStart(4)}  baseline=0x${av.toString(16).padStart(2,"0")}(${av}) → variant=0x${bv.toString(16).padStart(2,"0")}(${bv})  abs: 0x${aOff.toString(16)} / 0x${bOff.toString(16)}`);
    }
  }
}
