// Find ALL records with the structural signature of parseFactionTreasuries
// EXCEPT relax the +8=100 constraint. Section type registry says
// FACTION_ECONOMICS has 36 records; we currently find 23 with class=100.
// What value does +8 have for the other 13?
const fs = require("fs");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

console.log(`save size: 0x${buf.length.toString(16)}`);
console.log("\nscanning for FACTION_ECONOMICS records (self-ptrs at +24/+40, +44=6, +12=1):");

const classCounts = new Map();
const records = [];
for (let i = 0; i + 96 < buf.length; i += 1) {
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  if (buf.readUInt32LE(i + 44) !== 6) continue;
  const regions = buf.readUInt32LE(i + 48);
  if (regions > 500) continue;
  if (i + 92 + 4 * regions + 4 > buf.length) continue;
  const treasury = buf.readInt32LE(i);
  const cls = buf.readUInt32LE(i + 8);
  classCounts.set(cls, (classCounts.get(cls) || 0) + 1);
  records.push({ offset: i, cls, treasury, regions });
}

console.log(`\nfound ${records.length} total records, by class tag:`);
for (const [cls, count] of Array.from(classCounts.entries()).sort((a, b) => b[1] - a[1])) {
  console.log(`  class=${cls} : ${count} records`);
}

console.log("\nfirst 5 of each class:");
const seen = new Map();
for (const r of records) {
  if ((seen.get(r.cls) || 0) >= 5) continue;
  seen.set(r.cls, (seen.get(r.cls) || 0) + 1);
  console.log(`  cls=${r.cls.toString().padStart(4)}  offset=0x${r.offset.toString(16).padStart(8, '0')}  treasury=${r.treasury.toString().padStart(6)}  regions=${r.regions}`);
}
