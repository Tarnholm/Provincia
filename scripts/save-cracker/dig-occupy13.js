// dig-occupy13.js
// Check the SAME offsets (relative to settlement marker -1590..-1582)
// for Brundisium in save_11.1 (which was just captured with OCCUPY).
// Also check Brundisium in save_9.1 (pre-capture, Messapian-owned).

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function read(name) { return fs.readFileSync(path.join(SAVE_DIR, name)); }

const offsets = [-1610, -1606, -1602, -1598, -1594, -1590, -1586, -1582, -1578, -34, -28];

const saves = [
  ["save_9.1.sav",  { Brundisium: null, Tarentum: null, Uria: 0x1264861 }],
  ["save_10.1.sav", { Brundisium: null, Tarentum: null, Uria: 0x1264861 }],
  ["save_11.1.sav", { Brundisium: 0x126852e, Tarentum: 0x12ded9e, Uria: 0x12693c6 }],
  ["save_12.1.sav", { Brundisium: null, Tarentum: null, Uria: 0x1264861 }],
];

function findMarker(buf, name) {
  // Find settlement marker for given name. Returns abs offset of marker byte (the 0x01).
  for (let i = 0; i < buf.length - 30; i++) {
    const flag = buf[i];
    if (flag !== 0x01 && flag !== 0x00) continue;
    const nc = buf[i + 1];
    if (nc !== name.length || buf[i + 2] !== 0) continue;
    const se = i + 3 + nc * 2;
    if (se + 2 > buf.length || buf[se] !== 0 || buf[se + 1] !== 0) continue;
    let ok = true, found = "";
    for (let j = i + 3; j < se; j += 2) {
      const lo = buf[j], hi = buf[j + 1];
      if (hi !== 0 || lo < 0x20 || lo > 0x7e) { ok = false; break; }
      found += String.fromCharCode(lo);
    }
    if (ok && found === name) return i;
  }
  return -1;
}

for (const [fname, markers] of saves) {
  const buf = read(fname);
  console.log(`\n=== ${fname} ===`);
  for (const city of ["Brundisium", "Tarentum", "Uria"]) {
    const m = findMarker(buf, city);
    if (m < 0) { console.log(`  ${city}: NOT FOUND`); continue; }
    console.log(`  ${city} @ 0x${m.toString(16)}:`);
    for (const off of offsets) {
      const v32 = buf.readUInt32LE(m + off);
      const v16 = buf.readUInt16LE(m + off);
      const v8 = buf.readUInt8(m + off);
      const u32s = v32 > 1e7 ? `0x${v32.toString(16)}` : `${v32}`;
      console.log(`    ${city}${off}: u32=${u32s.padEnd(12)} u16=${v16.toString().padEnd(6)} u8=${v8.toString().padEnd(4)}  hex=${buf.slice(m+off, m+off+4).toString("hex")}`);
    }
  }
}
