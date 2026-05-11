// dig-trade5.js — examine Brundisium's record structure in rome6 vs rome7.
// In rome6 Brundisium is owned by Messapians (a minor faction). In rome7
// Brundisium is owned by... who? (the AI capture happened mid-turn).
//
// Compare bytes around the tax_byte anchor in both saves.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findSettlementByName(buf, name) {
  const nameU16 = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) nameU16.writeUInt16LE(name.charCodeAt(i), i * 2);
  const positions = [];
  let p = 0;
  while ((p = buf.indexOf(nameU16, p)) !== -1) {
    if (p >= 3) {
      const marker = buf.readUInt8(p - 3);
      const len = buf.readUInt16LE(p - 2);
      if (marker === 0x01 && len === name.length) {
        positions.push(p - 2272);
      }
    }
    p += 1;
  }
  return positions;
}

const a = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const b = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));

for (const cityName of ["Brundisium", "Uria"]) {
  const tA = findSettlementByName(a, cityName)[0];
  const tB = findSettlementByName(b, cityName)[0];
  console.log(`\n## ${cityName}: rome6 tax=0x${tA.toString(16)}, rome7 tax=0x${tB.toString(16)}`);
  // Show bytes -30..+100 around tax_byte in both saves
  for (const [label, buf, tax] of [["rome6", a, tA], ["rome7", b, tB]]) {
    console.log(`  ${label} bytes -30..+100:`);
    const slice = buf.slice(tax - 30, tax + 100);
    const hex = slice.toString("hex").match(/.{1,2}/g);
    const lines = [];
    for (let i = 0; i < hex.length; i += 16) {
      const rel = i - 30;
      lines.push(`    +${rel.toString().padStart(4)}: ${hex.slice(i, i + 16).join(" ")}`);
    }
    console.log(lines.join("\n"));
  }
}

// Also check: scan for the "cb 00 00 00 ff ff ff ff" or similar settlement-record
// prefix between rome6 and rome7 for Brundisium — find the actual record start.

function findSettlementSignatureNear(buf, anchor, range) {
  // Look for "cb 00 00 00" pattern within [anchor-range, anchor+range]
  const target = Buffer.from([0xcb, 0x00, 0x00, 0x00]);
  const start = Math.max(0, anchor - range);
  const end = Math.min(buf.length, anchor + range);
  const out = [];
  for (let i = start; i < end - 4; i++) {
    if (buf[i] === 0xcb && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 0) {
      out.push(i);
    }
  }
  return out;
}

console.log("\n# Scan for cb 00 00 00 settlement-tag bytes near Brundisium's tax_byte (rome6)");
const tA = findSettlementByName(a, "Brundisium")[0];
const sigs = findSettlementSignatureNear(a, tA, 4096);
console.log(`  found ${sigs.length} sigs in ±4KB around 0x${tA.toString(16)}`);
console.log(`  closest before tax_byte=0x${tA.toString(16)}:`);
const before = sigs.filter(s => s < tA).sort((a, b) => b - a).slice(0, 3);
for (const s of before) console.log(`    0x${s.toString(16)} (delta=${tA - s})`);

// Same in rome7
console.log("\n# Same in rome7");
const tB = findSettlementByName(b, "Brundisium")[0];
const sigsB = findSettlementSignatureNear(b, tB, 4096);
console.log(`  found ${sigsB.length} sigs in ±4KB around 0x${tB.toString(16)}`);
const beforeB = sigsB.filter(s => s < tB).sort((a, b) => b - a).slice(0, 3);
for (const s of beforeB) console.log(`    0x${s.toString(16)} (delta=${tB - s})`);
