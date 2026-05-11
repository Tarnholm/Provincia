// dig-trade4.js — find settlement records for Brundisium and Uria in rome6
// and rome7. Compare their interior bytes.
//
// Settlement records have signature `cb 00 00 00` at offset -21 from tax_byte.
// Settlement name as UTF-16LE is at tax_byte + 2272.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findSettlementByName(buf, name) {
  // Encode name as UTF-16LE
  const nameU16 = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) nameU16.writeUInt16LE(name.charCodeAt(i), i * 2);

  const positions = [];
  let p = 0;
  while ((p = buf.indexOf(nameU16, p)) !== -1) {
    // Check that prev u8 is the name marker (0x01) at p-1 -- no wait, layout is:
    // +2269 marker u8 = 0x01
    // +2270 u16 name length (in chars)
    // +2272.. UTF-16LE name
    // So at name position p: marker is at p-3, len is at p-2
    if (p >= 3) {
      const marker = buf.readUInt8(p - 3);
      const len = buf.readUInt16LE(p - 2);
      if (marker === 0x01 && len === name.length) {
        positions.push({ namePos: p, tax_byte: p - 2272, settlementStart: p - 2272 - 21 });
      }
    }
    p += 1;
  }
  return positions;
}

const a = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const b = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));

for (const cityName of ["Brundisium", "Uria", "Rome", "Sparta", "Tarentum"]) {
  console.log(`\n## ${cityName}`);
  const inA = findSettlementByName(a, cityName);
  const inB = findSettlementByName(b, cityName);
  console.log(`  rome6: ${inA.length} hits  ${inA.slice(0, 3).map(p => "tax=0x" + p.tax_byte.toString(16)).join(", ")}`);
  console.log(`  rome7: ${inB.length} hits  ${inB.slice(0, 3).map(p => "tax=0x" + p.tax_byte.toString(16)).join(", ")}`);
}

// For Brundisium & Uria, dump key settlement fields in both saves
for (const cityName of ["Brundisium", "Uria"]) {
  console.log(`\n## ${cityName} settlement record state`);
  for (const [label, buf] of [["rome6", a], ["rome7", b]]) {
    const hits = findSettlementByName(buf, cityName);
    if (hits.length === 0) {
      console.log(`  ${label}: NOT FOUND`);
      continue;
    }
    const h = hits[0];
    const tax = h.tax_byte;
    const taxByte = buf.readUInt8(tax);
    const size = buf.readUInt8(tax + 62);
    const x = buf.readUInt32LE(tax + 341);
    const y = buf.readUInt32LE(tax + 345);
    const turnTag = buf.readUInt8(tax + 28);
    const incomePerTurn = buf.readUInt32LE(tax + 683);
    const pop = buf.readUInt32LE(tax + 775);
    const happiness = buf.readFloatLE(tax + 2239);
    console.log(`  ${label}: tax=0x${tax.toString(16)}  taxLevel=${taxByte}  size=${size}  XY=(${x},${y})  +28=${turnTag}  income=${incomePerTurn}  pop=${pop}  happiness=${happiness.toFixed(2)}`);
  }
}
