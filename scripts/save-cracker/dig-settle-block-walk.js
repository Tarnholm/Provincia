// dig-settle-block-walk.js
//
// Walk the 583-byte settlement stats block field by field for a single save,
// dumping EVERY u32 (and u8 at known offsets) relative to the settlement name
// position. Goal: label every field and find the live-owner / PO-breakdown.
//
// Usage: node dig-settle-block-walk.js "<save path>" [settlementNameFilter]

"use strict";
const fs = require("fs");
const path = require("path");

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";

function loadSave(arg) {
  if (fs.existsSync(arg)) return fs.readFileSync(arg);
  const p = path.join(SAVES, arg);
  if (fs.existsSync(p)) return fs.readFileSync(p);
  throw new Error("save not found: " + arg);
}

// Find settlement name markers: [flag(0/1), nchars, 0x00, UTF-16 name, 0x00 0x00]
function findSettlementMarkers(buf) {
  const out = [];
  for (let i = 0; i < buf.length - 30; i++) {
    const flag = buf[i];
    if (flag !== 0x01 && flag !== 0x00) continue;
    const nc = buf[i + 1];
    if (nc < 3 || nc > 32 || buf[i + 2] !== 0) continue;
    const se = i + 3 + nc * 2;
    if (se + 2 > buf.length || buf[se] !== 0 || buf[se + 1] !== 0) continue;
    let ok = true, name = "";
    for (let j = i + 3; j < se; j += 2) {
      const lo = buf[j], hi = buf[j + 1];
      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
      name += String.fromCharCode(lo);
    }
    if (ok && name[0] >= "A" && name[0] <= "Z") {
      // namePos = MEMORY convention: the length-prefix byte (marker + 1).
      // (The memory's stats-block dx offsets like -583/-35 are relative here.)
      out.push({ markerOffset: i, namePos: i + 1, name, blockEnd: se + 2 });
    }
  }
  return out;
}

const arg = process.argv[2];
const filter = process.argv[3];
const buf = loadSave(arg);
console.log("save:", arg, "size:", buf.length);

const markers = findSettlementMarkers(buf);
console.log("settlement markers found:", markers.length);

// Deduplicate by name (markers can false-positive); keep ones where -583 .. -35
// reads sane. We'll print the block for filtered names.
const targets = filter
  ? markers.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()))
  : markers;

for (const m of targets) {
  const namePos = m.namePos;
  if (namePos - 583 < 0) continue;
  // Read known offsets per memory
  const rd = (dx) => (namePos + dx + 4 <= buf.length && namePos + dx >= 0) ? buf.readUInt32LE(namePos + dx) : null;
  const rdu8 = (dx) => (namePos + dx >= 0 && namePos + dx < buf.length) ? buf[namePos + dx] : null;
  console.log("\n=== " + m.name + " @ marker " + m.markerOffset + " namePos " + namePos + " ===");
  console.log("  creator(-583)u32 =", rd(-583));
  console.log("  +0(-583..) u8    =", rdu8(-583));
  console.log("  level(-571) u32  =", rd(-571));
  console.log("  taxrate(-562)u8  =", rdu8(-562));
  console.log("  PO(-435) u32     =", rd(-435));
  console.log("  income(-127) u32 =", rd(-127));
  console.log("  pop(-35) u32     =", rd(-35));
  console.log("  pop_copy(-223)   =", rd(-223));
}

// For the first valid target, dump the WHOLE 583-byte block as labeled u32s.
const first = targets.find(m => m.namePos - 583 >= 0);
if (first) {
  const namePos = first.namePos;
  console.log("\n##### FULL BLOCK DUMP for " + first.name + " (u32 at every -dx, step 4) #####");
  console.log("dx\tu32(LE)\t\ti32(LE)\t\tbytes");
  for (let dx = -584; dx <= -4; dx += 4) {
    const off = namePos + dx;
    if (off < 0 || off + 4 > buf.length) continue;
    const u = buf.readUInt32LE(off);
    const s = buf.readInt32LE(off);
    const bytes = Array.from(buf.slice(off, off + 4)).map(b => b.toString(16).padStart(2, "0")).join(" ");
    console.log(`${dx}\t${u}\t\t${s}\t\t${bytes}`);
  }
}
