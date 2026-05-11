// dig-upkeep7.js — trace stride-354 detection bug
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findMajorRecords(buf) {
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regionCount = buf.readUInt32LE(i + 48);
    if (regionCount > 200) continue;
    const treasury = buf.readInt32LE(i);
    hits.push({ pos: i, treasury, regionCount });
  }
  return hits;
}

const r5 = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const recs = findMajorRecords(r5);
const p = recs[0];
console.log("Player rec at 0x" + p.pos.toString(16));

// Walk byte-by-byte and find self-pointers
const sp = [];
for (let i = p.pos; i + 4 < recs[1].pos; i++) {
  if (r5.readUInt32LE(i) === i) sp.push(i);
}
console.log("Total self-pointers:", sp.length);

// Find at the specific offsets I expected from dig-upkeep4:
const expectedRel = [40719, 41073, 41427, 41781, 42135, 42489, 42843, 43197, 43551, 43905, 44259, 44613];
console.log("\n=== Check expected gap-16 pairs ===");
for (const rel of expectedRel) {
  const absA = p.pos + rel;
  const absB = absA + 16;
  const isA = r5.readUInt32LE(absA) === absA;
  const isB = r5.readUInt32LE(absB) === absB;
  console.log(`  rel +${rel}: abs A=0x${absA.toString(16)} self-ptr=${isA}, abs B=0x${absB.toString(16)} self-ptr=${isB}`);
}

// Now let's check sp's list — see which expected entries are present
console.log("\n=== Self-ptrs near rel +40000-+45000 ===");
for (const s of sp) {
  const rel = s - p.pos;
  if (rel >= 40000 && rel <= 46000) {
    console.log(`  rel +${rel} (abs 0x${s.toString(16)})`);
  }
}
