// dig-ownership1.js — Look at per-settlement records.
// Hypothesis: settlements are in zone 0xf88637..0x1f10c72. Each settlement
// starts with [u16 nameLen][UTF-16LE name]. Find the settlement record
// containing the name "Uria" or "Brundisium" (Messapian settlements).

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

function findUtf16Le(buf, name) {
  // Encode the name as UTF-16LE
  const enc = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) {
    enc.writeUInt16LE(name.charCodeAt(i), i * 2);
  }
  const out = [];
  for (let i = 0; i + enc.length < buf.length; i++) {
    if (buf.subarray(i, i + enc.length).equals(enc)) {
      out.push(i);
    }
  }
  return out;
}

function findUtf16PrefixedLen(buf, name) {
  // u16 length prefix + name in UTF-16LE
  const hits = findUtf16Le(buf, name);
  return hits.filter(h => {
    const lenBytes = buf.readUInt16LE(h - 2);
    return lenBytes === name.length;
  });
}

console.log("=== Uria in save_1 ===");
const uriaA = findUtf16PrefixedLen(bA, "Uria");
for (const h of uriaA) console.log(`  hit at 0x${h.toString(16)} prefix-len=${bA.readUInt16LE(h-2)}`);

console.log("\n=== Uria in save_3 ===");
const uriaB = findUtf16PrefixedLen(bB, "Uria");
for (const h of uriaB) console.log(`  hit at 0x${h.toString(16)} prefix-len=${bB.readUInt16LE(h-2)}`);

console.log("\n=== Brundisium in save_1 ===");
const brundA = findUtf16PrefixedLen(bA, "Brundisium");
for (const h of brundA) console.log(`  hit at 0x${h.toString(16)} prefix-len=${bA.readUInt16LE(h-2)}`);

console.log("\n=== Brundisium in save_3 ===");
const brundB = findUtf16PrefixedLen(bB, "Brundisium");
for (const h of brundB) console.log(`  hit at 0x${h.toString(16)} prefix-len=${bB.readUInt16LE(h-2)}`);
