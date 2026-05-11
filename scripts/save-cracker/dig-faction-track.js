// dig-faction-track.js — session 5
//
// Find faction records via a structural signature:
//   +0  u32 treasury (or some value)
//   +4  u32 (runtime/income — varies)
//   +8  u32 == 100
//   +12 u32 == 1
//   +16..+23 = 8 zeros
//   +24 self-pointer (u32 == position+24)
//   +28 u32 (hash/runtime)
//   +32..+39 = 8 zeros
//   +40 self-pointer (u32 == position+40)
//   +44 u32 == 6 (size of small sub-section)
//   +48 u32 = number of regions owned by faction
//   +52..  array of region-ids (u32 each)
//
// This pattern is faction-record half-1 (treasury+regions). Half-2 follows
// ~216 bytes later with [treasury][faction-id][lots of zeros][0xef markers].
//
// We then verify treasury at +0 by examining changes across saves.
const fs = require("fs");
const path = require("path");

function findFactionRecords(buf) {
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    // 8 zeros at +16..+23
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    // Region count = u32 at +48; should be 0..100 (sanity)
    const regionCount = buf.readUInt32LE(i + 48);
    if (regionCount > 200) continue;
    const treasury = buf.readUInt32LE(i);
    const runtime = buf.readUInt32LE(i + 4);
    hits.push({ pos: i, treasury, runtime, regionCount });
  }
  return hits;
}

function main() {
  const dir = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
  const files = [
    "save_rome1.sav",
    "save_rome2.sav",
    "save_rome3.sav",
    "save_rome4.sav",
    "save_rome5..sav",
    "save_rome6.sav",
    "save_rome7.sav",
    "save_rome8.sav",
    "save_rome9.sav",
    "save_rome10.sav",
  ];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const hits = findFactionRecords(buf);
    console.log(`\n# ${f} → ${hits.length} faction-record hits`);
    if (hits.length === 0) continue;
    for (const h of hits.slice(0, 8)) {
      console.log(`  pos=0x${h.pos.toString(16)} treasury=${h.treasury} runtime=0x${h.runtime.toString(16)} regionCount=${h.regionCount}`);
    }
    // Total faction count
    if (hits.length > 8) console.log(`  ... ${hits.length} total`);
  }
}

main();
