// dig-upkeep2.js — session 9
//
// First-pass results from dig-upkeep1:
//   - Player faction (Romans Julii) treasury 7610 → -3137 (Δ=-10747) at turn 5→6 boundary
//   - +232 (treasury snapshot, after 35-region list): 10000 → -3395
//   - +1000=459 → 974, +1016=1537 → 967, +1032=1792 → 229 — looks like income components
//   - +1152..1188 has -1 → 459/1537/1792 — these match +1000/+1016/+1032's PRIOR-turn values
//
// HYPOTHESIS: +1000/+1016/+1032 is income breakdown (tax/trade/farming) for previous turn
// and +1152/+1168/+1184 are this-turn's accumulator (was -1 = unset, now filled).
//
// But session brief says "income" — total income/expenses ledger appears in rome7 only
// since at rome5 (within turn) the player has not yet ended turn.
//
// Now let's:
//   1. Cross-validate by looking at Carthage's record (AI, idx 1) at the same offsets
//   2. Find the actual "current turn upkeep" — should be a constant across rome5/rome6
//      (within turn, no recruit/disband) and change between rome6→rome7 if AI bought/lost units
//   3. Look at byte ranges +1700..2300 — the repeating "3488/13/0/3520..." pattern looks
//      like a fixed-size record array. Identify stride.
//
// Strategy: print Carthage's record for the SAME offsets that Romans had movement on.

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

function load(name) {
  const fn = path.join(SAVES, `save_${name}.sav`);
  const buf = fs.readFileSync(fn);
  return { buf, recs: findMajorRecords(buf) };
}

function dumpInteresting(label, rec, buf, offsets) {
  console.log(`\n=== ${label} (record at 0x${rec.pos.toString(16)}) ===`);
  for (const off of offsets) {
    const v = buf.readInt32LE(rec.pos + off);
    const vu = buf.readUInt32LE(rec.pos + off);
    console.log(`  +${off.toString().padStart(5)} i32=${String(v).padStart(10)} u32=0x${vu.toString(16).padStart(8, '0')} u16lo=${buf.readUInt16LE(rec.pos + off)} u16hi=${buf.readUInt16LE(rec.pos + off + 2)}`);
  }
}

const interesting = [
  232,  // treasury snapshot
  612, 616, 688, 692, 736, 784, 820, 860,
  1000, 1016, 1032,  // hypothesized income breakdown (prior turn)
  1152, 1168, 1184,  // hypothesized income breakdown (this turn) — was -1
  1196, 1200, 1204, 1212, 1216, 1220, 1224, 1240, 1248,
  1352, 1356, 1380, 1384, 1388, 1392, 1404, 1408, 1412, 1424,
  1528, 1572, 1580, 1588,
  1704, 1712, 1720, 1732, 1756, 1784, 1792, 1820, 1828,
];

const saves = ["rome1", "rome2", "rome3", "rome4", "rome5.", "rome6", "rome7", "rome8", "rome9", "rome10"]
  .map(n => ({ name: n, ...load(n) }));

// Show player record values across all 10 saves at the interesting offsets:
console.log("=== Player record (Romans Julii idx 0) trail across all 10 saves ===");
console.log("Save                     | treasury  | +232      | +1000   | +1016   | +1032   | +1152   | +1168   | +1184   | +860 (cnt?)");
for (const s of saves) {
  const r = s.recs[0];
  const t = r.treasury;
  const v232 = s.buf.readInt32LE(r.pos + 232);
  const v1000 = s.buf.readInt32LE(r.pos + 1000);
  const v1016 = s.buf.readInt32LE(r.pos + 1016);
  const v1032 = s.buf.readInt32LE(r.pos + 1032);
  const v1152 = s.buf.readInt32LE(r.pos + 1152);
  const v1168 = s.buf.readInt32LE(r.pos + 1168);
  const v1184 = s.buf.readInt32LE(r.pos + 1184);
  const v860 = s.buf.readInt32LE(r.pos + 860);
  console.log(`${s.name.padEnd(24)} | ${String(t).padStart(8)}  | ${String(v232).padStart(8)}  | ${String(v1000).padStart(7)} | ${String(v1016).padStart(7)} | ${String(v1032).padStart(7)} | ${String(v1152).padStart(7)} | ${String(v1168).padStart(7)} | ${String(v1184).padStart(7)} | ${String(v860).padStart(5)}`);
}

// Now Carthage idx 1 (AI faction):
console.log("\n=== Carthage record (AI idx 1) trail across all 10 saves ===");
console.log("Save                     | treasury  | +232      | +1000   | +1016   | +1032   | +1152   | +1168   | +1184   | +860");
for (const s of saves) {
  const r = s.recs[1];
  const t = r.treasury;
  const v232 = s.buf.readInt32LE(r.pos + 232);
  const v1000 = s.buf.readInt32LE(r.pos + 1000);
  const v1016 = s.buf.readInt32LE(r.pos + 1016);
  const v1032 = s.buf.readInt32LE(r.pos + 1032);
  const v1152 = s.buf.readInt32LE(r.pos + 1152);
  const v1168 = s.buf.readInt32LE(r.pos + 1168);
  const v1184 = s.buf.readInt32LE(r.pos + 1184);
  const v860 = s.buf.readInt32LE(r.pos + 860);
  console.log(`${s.name.padEnd(24)} | ${String(t).padStart(8)}  | ${String(v232).padStart(8)}  | ${String(v1000).padStart(7)} | ${String(v1016).padStart(7)} | ${String(v1032).padStart(7)} | ${String(v1152).padStart(7)} | ${String(v1168).padStart(7)} | ${String(v1184).padStart(7)} | ${String(v860).padStart(5)}`);
}

// And Antigonid idx 2, Ptolemaic idx 3 for triangulation:
for (const idx of [2, 3, 6, 7]) {
  console.log(`\n=== Idx ${idx} ===`);
  console.log("Save                     | treasury  | +1000   | +1016   | +1032   | +1152   | +1168   | +1184   | +860");
  for (const s of saves) {
    const r = s.recs[idx];
    const t = r.treasury;
    const v1000 = s.buf.readInt32LE(r.pos + 1000);
    const v1016 = s.buf.readInt32LE(r.pos + 1016);
    const v1032 = s.buf.readInt32LE(r.pos + 1032);
    const v1152 = s.buf.readInt32LE(r.pos + 1152);
    const v1168 = s.buf.readInt32LE(r.pos + 1168);
    const v1184 = s.buf.readInt32LE(r.pos + 1184);
    const v860 = s.buf.readInt32LE(r.pos + 860);
    console.log(`${s.name.padEnd(24)} | ${String(t).padStart(8)}  | ${String(v1000).padStart(7)} | ${String(v1016).padStart(7)} | ${String(v1032).padStart(7)} | ${String(v1152).padStart(7)} | ${String(v1168).padStart(7)} | ${String(v1184).padStart(7)} | ${String(v860).padStart(5)}`);
  }
}
