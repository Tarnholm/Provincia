// dig-diplo6.js — relax signature and find all faction records.
//
// Session 5/7 documented 23 major + 216 minor faction records. We're seeing
// far fewer with the strict +24==pos+24, +40==pos+40 signature. Try a looser
// signature.

const fs = require("fs");
const SAVE_R10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";

const buf = fs.readFileSync(SAVE_R10);

// Loose signature: +8=100, +12=1 only
let count = 0;
const samples = [];
for (let i = 0x3000; i + 56 < buf.length; i += 4) {
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  count++;
  if (samples.length < 30) samples.push(i);
}
console.log(`+8=100,+12=1 only: ${count} records`);

// Check each sample for the rest of the signature
console.log("\nFirst 30 samples — dump key fields:");
for (const i of samples) {
  const p24 = buf.readUInt32LE(i + 24);
  const p40 = buf.readUInt32LE(i + 40);
  const v44 = buf.readUInt32LE(i + 44);
  const v48 = buf.readUInt32LE(i + 48);
  const v0 = buf.readInt32LE(i);
  console.log(`  0x${i.toString(16)} +0=${v0} +24=${p24===i+24?'self':'0x'+p24.toString(16)} +40=${p40===i+40?'self':'0x'+p40.toString(16)} +44=${v44} +48=${v48}`);
}
