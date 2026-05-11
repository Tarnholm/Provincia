// dig-faction-deeper.js — session 5
//
// We have 23 faction records pinned with treasury at +0 and region list at +52.
// Now: figure out the rest of the record interior.
//   1. Compare rome5 (within turn) vs rome7 (turn boundary).
//   2. For one record at known position, dump u32s from +0 to +500 and compare.
//   3. Find the faction-id (half-2) location.
//   4. Look for income/upkeep fields.
const fs = require("fs");
const path = require("path");

function findFactionRecords(buf) {
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
    const treasury = buf.readUInt32LE(i);
    hits.push({ pos: i, treasury, regionCount });
  }
  return hits;
}

function main() {
  const dir = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
  const rome5 = fs.readFileSync(path.join(dir, "save_rome5..sav"));
  const rome6 = fs.readFileSync(path.join(dir, "save_rome6.sav"));
  const rome7 = fs.readFileSync(path.join(dir, "save_rome7.sav"));

  const r5 = findFactionRecords(rome5);
  const r6 = findFactionRecords(rome6);
  const r7 = findFactionRecords(rome7);

  // Take Carthage (record index 1)
  const idx = 1;  // Carthage
  console.log(`Faction #${idx} (Carthage)`);
  console.log(`  rome5: pos=0x${r5[idx].pos.toString(16)} treasury=${r5[idx].treasury}`);
  console.log(`  rome6: pos=0x${r6[idx].pos.toString(16)} treasury=${r6[idx].treasury}`);
  console.log(`  rome7: pos=0x${r7[idx].pos.toString(16)} treasury=${r7[idx].treasury}`);

  // Dump u32s from +0 to +500 for Carthage in rome5 & rome7
  console.log("\n--- u32s in Carthage record (first 250 dwords) ---");
  console.log("offset | rome5(within turn 5) | rome6(within turn 5) | rome7(turn 6 start) | r5-r7 differ?");
  for (let dw = 0; dw < 250; dw += 1) {
    const v5 = rome5.readUInt32LE(r5[idx].pos + dw * 4);
    const v6 = rome6.readUInt32LE(r6[idx].pos + dw * 4);
    const v7 = rome7.readUInt32LE(r7[idx].pos + dw * 4);
    if (v5 === v7) continue;
    const v5s = v5 > 2 ** 31 ? v5 - 2 ** 32 : v5;
    const v7s = v7 > 2 ** 31 ? v7 - 2 ** 32 : v7;
    const v6s = v6 > 2 ** 31 ? v6 - 2 ** 32 : v6;
    console.log(`  +${(dw * 4).toString().padStart(4)} | ${v5s.toString().padStart(12)} | ${v6s.toString().padStart(12)} | ${v7s.toString().padStart(12)} ${v5 !== v6 ? "(also r5-r6!)" : ""}`);
  }
}

main();
