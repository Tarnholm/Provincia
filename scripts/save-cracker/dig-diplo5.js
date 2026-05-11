// dig-diplo5.js — session 12 diplomacy probe (start fresh).
//
// Strategy: locate ALL major (and minor) faction records via the +8=100,+12=1,
// +24==pos+24, +40==pos+40, +44 in {6,8} signature; for each, dump a window
// of the trailing data (+52+4N onward) and look for a known-shape
// diplomacy table:
//   - per major-faction record should contain its diplomatic state vs all
//     other factions.
//   - Expected structure: a small-int array (state enum) of size ~N_factions
//     or a 9-byte-stride table.
//
// Cross-reference against descr_strat ground truth: for Romans Julii in
// imperial_campaign, only `allied_to massalia` and `at_war_with taras`
// (everything else defaults to 200 neutral, per RTW convention).

const fs = require("fs");
const path = require("path");
const SAVE_ROR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";
const SAVE_ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";

function findFactionRecords(buf, fortyFour /* 6 or 8 */) {
  const out = [];
  // u32 at +8 = 100; u32 at +12 = 1; u32 at +24 = pos+24; u32 at +40 = pos+40; u32 at +44 = 6/8
  // Search at u32 alignment for +12=1 cheap probe, then verify all.
  for (let i = 0x3000; i + 56 < buf.length; i += 4) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== fortyFour) continue;
    const regionCount = buf.readUInt32LE(i + 48);
    if (regionCount > 200) continue; // sanity
    out.push({ offset: i, regionCount, treasury: buf.readInt32LE(i) });
  }
  return out;
}

function dump(file) {
  const buf = fs.readFileSync(file);
  const major = findFactionRecords(buf, 6);
  const minor = findFactionRecords(buf, 8);
  console.log(`${path.basename(file)}: ${buf.length} bytes`);
  console.log(`  majors: ${major.length}, minors: ${minor.length}`);
  return { buf, major, minor };
}

const ror = dump(SAVE_ROR);
const r10 = dump(SAVE_ROME10);

// Sort by file offset so positional order is stable
ror.major.sort((a, b) => a.offset - b.offset);
ror.minor.sort((a, b) => a.offset - b.offset);
r10.major.sort((a, b) => a.offset - b.offset);
r10.minor.sort((a, b) => a.offset - b.offset);

console.log("\nROR Turn 1 majors (offset, regionCount, treasury):");
for (const m of ror.major) console.log(`  0x${m.offset.toString(16)} r=${m.regionCount} $=${m.treasury}`);
console.log("\nrome10 majors (offset, regionCount, treasury):");
for (const m of r10.major) console.log(`  0x${m.offset.toString(16)} r=${m.regionCount} $=${m.treasury}`);
