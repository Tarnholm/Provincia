// dig-model-strings2.js — Decode settlement records around each model name.
//
// Layout (per settlement):
//   [u16 strLen+1 (including NUL terminator)] [strLen-1 bytes ASCII model name] [u8 0x00 NUL]
//   [u32 0x1b? = field tag][u32 X][u32 Y][u32 1?][u32 0xffffffff][u32 ?][u32 2][u32 2][u32 ?]
//   ... more fields ...
//   then next settlement record begins with [u16 strLen+1][model name...]

const fs = require("fs");

const SAVE_ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const SAVE_ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function isModelChar(b) { return (b>=0x41&&b<=0x5a)||(b>=0x61&&b<=0x7a)||(b>=0x30&&b<=0x39)||b===0x5f; }

function findAllModels(buf, start, end) {
  const refs = [];
  let p = start;
  while (p + 2 < end) {
    const lenPlus1 = buf.readUInt16LE(p);
    if (lenPlus1 < 9 || lenPlus1 > 40 || p + 2 + lenPlus1 > end) { p++; continue; }
    const strLen = lenPlus1 - 1;
    // Check that strLen bytes are ASCII model chars and the next byte is NUL
    let ok = true;
    for (let i = 0; i < strLen; i++) {
      if (!isModelChar(buf[p + 2 + i])) { ok = false; break; }
    }
    if (!ok) { p++; continue; }
    if (buf[p + 2 + strLen] !== 0) { p++; continue; }
    const name = buf.slice(p + 2, p + 2 + strLen).toString("ascii");
    // Reject if not capitalized-with-underscore
    if (!/^[A-Z][A-Za-z_]+(_[A-Za-z]+)+$/.test(name)) { p++; continue; }
    refs.push({ off: p, lenPlus1, name, postName: p + 2 + lenPlus1 });
    p = p + 2 + lenPlus1;
  }
  return refs;
}

// Scan a broader region to ensure we find all model strings — block starts before 0x1f47abd
for (const [name, savePath, scanStart, scanEnd] of [
  ["rome10",  SAVE_ROME10, 0x1f40000, 0x1f90000],
  ["RoR-T1",  SAVE_ROR_T1, 0x1f00000, 0x1f80000],
]) {
  console.log(`\n=========== ${name} ===========`);
  const buf = fs.readFileSync(savePath);
  const refs = findAllModels(buf, scanStart, scanEnd);
  console.log(`Total settlement refs: ${refs.length}`);

  if (refs.length === 0) continue;

  console.log(`First ref @0x${refs[0].off.toString(16)}, last ref @0x${refs[refs.length - 1].off.toString(16)}`);

  // Deltas between consecutive refs
  const deltas = [];
  for (let i = 1; i < refs.length; i++) {
    deltas.push(refs[i].off - refs[i - 1].off);
  }
  // Histogram
  const hist = {};
  for (const d of deltas) hist[d] = (hist[d] || 0) + 1;
  const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log("Top 15 deltas:");
  for (const [d, c] of top) console.log(`  delta=${d}: ${c}`);

  // Show the trailing data layout for first 5 settlements
  console.log("\nFirst 5 settlement records (full record up to next):");
  for (let i = 0; i < 5 && i + 1 < refs.length; i++) {
    const r = refs[i];
    const next = refs[i + 1];
    const recLen = next.off - r.off;
    console.log(`\n  [${i}] ${r.name} (recLen=${recLen})`);
    // Dump payload after the model name
    const payloadStart = r.postName;
    const payloadEnd = next.off;
    const u32s = [];
    for (let j = payloadStart; j + 4 <= payloadEnd; j += 4) {
      u32s.push(buf.readUInt32LE(j));
    }
    console.log(`    payload u32s: ${u32s.map((v, idx) => `[${idx}]=${v >= 0x80000000 ? "-" + (0x100000000 - v) : v}`).join(", ")}`);
  }

  // Now: extract X,Y from each settlement (assume X,Y at payload[1] and payload[2])
  console.log("\n=== Settlement X,Y coords (assumed payload u32[1,2]) ===");
  const settlements = [];
  for (let i = 0; i < refs.length - 1; i++) {
    const r = refs[i];
    const next = refs[i + 1];
    const u32_0 = buf.readUInt32LE(r.postName);
    const u32_1 = buf.readUInt32LE(r.postName + 4);
    const u32_2 = buf.readUInt32LE(r.postName + 8);
    settlements.push({ ...r, recLen: next.off - r.off, tag: u32_0, x: u32_1, y: u32_2 });
  }
  // Range of X,Y
  const xs = settlements.map(s => s.x).filter(x => x < 2000);
  const ys = settlements.map(s => s.y).filter(y => y < 2000);
  console.log(`  X range: [${Math.min(...xs)}..${Math.max(...xs)}]  Y range: [${Math.min(...ys)}..${Math.max(...ys)}]`);
  console.log(`  Tag value (u32_0): unique=${[...new Set(settlements.map(s => s.tag))].length}`);
  console.log(`  Sample first 10 settlements: name, recLen, tag, x, y:`);
  for (let i = 0; i < Math.min(10, settlements.length); i++) {
    const s = settlements[i];
    console.log(`    [${i}] ${s.name.padEnd(28)} recLen=${s.recLen.toString().padStart(4)} tag=${s.tag} x=${s.x} y=${s.y}`);
  }
}
