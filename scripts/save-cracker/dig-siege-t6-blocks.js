// dig-siege-t6-blocks.js
// save_t6.sav has MANY active sieges. Cross-check:
//   (a) How many "Settlement Under Siege" event entries + which settlement names.
//   (b) How many +73 siege-flag blocks exist; their u16@+66 values & uuids.
//   (c) Tighten the block predicate so the count matches the # of sieges.
// Also dump each block's context (the record it lives in).

const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const buf = fs.readFileSync(DIR + "save_t6.sav");

function u16le(s) { const t = Buffer.alloc(s.length * 2); for (let i = 0; i < s.length; i++) t.writeUInt16LE(s.charCodeAt(i), i * 2); return t; }
function readUtf16(b, off, max = 60) {
  if (off + 2 > b.length) return null;
  const n = b.readUInt16LE(off);
  if (n < 1 || n > max || off + 2 + n * 2 > b.length) return null;
  let s = ""; for (let i = 0; i < n; i++) { const lo = b[off+2+i*2], hi = b[off+2+i*2+1]; if (hi !== 0 || lo < 0x20 || lo > 0x7e) return null; s += String.fromCharCode(lo); } return s;
}

// (a) Settlement Under Siege event entries: the framing puts the settlement
// NAME as a pstr16 just BEFORE the "Settlement Under Siege" string (saw this
// in Corduba: name 0x161b83 "Corduba", then 0x161b93 string).
const SUS = u16le("Settlement Under Siege");
let p = 0; const besieged = [];
while ((p = buf.indexOf(SUS, p)) !== -1) {
  // walk back ~30 bytes for a pstr16 settlement name
  let nm = null;
  for (let d = 6; d < 40; d++) {
    const cand = readUtf16(buf, p - d);
    if (cand && /^[A-Z][A-Za-z' -]+$/.test(cand)) { nm = cand; break; }
  }
  besieged.push({ at: p, name: nm });
  p += 2;
}
console.log(`"Settlement Under Siege" entries: ${besieged.length}`);
for (const b of besieged) console.log(`  0x${b.at.toString(16)}  -> ${b.name}`);

// (b) +73 siege-flag blocks
function siegeBlocks(b) {
  const out = [];
  for (let off = 0; off + 73 <= b.length; off++) {
    if (b[off] !== 0x01) continue;
    let nz = 0; for (let k = 1; k <= 12; k++) if (b[off + k] !== 0) nz++;
    if (nz < 8) continue;
    let z = true; for (let k = 13; k <= 65; k++) if (b[off + k] !== 0) { z = false; break; }
    if (!z) continue;
    const v = b.readUInt16LE(off + 66);
    if (v === 0) continue;
    let tz = true; for (let k = 68; k <= 72; k++) if (b[off + k] !== 0) { tz = false; break; }
    if (!tz) continue;
    out.push({ off, u32_1: b.readUInt32LE(off + 1), u32_5: b.readUInt32LE(off + 5), u32_9: b.readUInt32LE(off + 9), u16: v });
  }
  return out;
}
const blocks = siegeBlocks(buf);
console.log(`\n+73 siege-flag blocks: ${blocks.length}`);
for (const bl of blocks) {
  console.log(`  0x${bl.off.toString(16)}  uuid=[${bl.u32_1.toString(16)} ${bl.u32_5.toString(16)} ${bl.u32_9.toString(16)}]  u16@+66=${bl.u16}`);
}

// (c) For each block, dump 32 bytes before & after to see the host record + any
// nearby region/settlement name string.
function hexAscii(b, off, n) {
  const lines = [];
  for (let r = 0; r < n; r += 16) {
    const row = []; let asc = "";
    for (let i = 0; i < 16 && r + i < n; i++) {
      const x = b[off + r + i]; row.push(x.toString(16).padStart(2, "0"));
      asc += (x >= 32 && x < 127) ? String.fromCharCode(x) : ".";
    }
    lines.push(`    0x${(off + r).toString(16)}: ${row.join(" ").padEnd(48)}  ${asc}`);
  }
  return lines.join("\n");
}
console.log("\n=== block contexts (first 6) ===");
for (const bl of blocks.slice(0, 6)) {
  console.log(`\n-- block @0x${bl.off.toString(16)} (u16=${bl.u16}) --`);
  console.log(hexAscii(buf, bl.off - 48, 48 + 73 + 48));
}
