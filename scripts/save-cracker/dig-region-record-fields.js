// Examine the per-region data starting at +16 of each region record.
// Region record layout:
//   +0   u32 self_ptr_A == pos
//   +4   u32 region_uuid
//   +8   u32 self_ptr_B == pos + 8
//   +12  u32 region_id
//   +16..(next) per-region data
//
// Dump bytes of a few records to identify field positions.

const fs = require("fs");
const { findRegionRecords, parseFactionTreasuries } = require("../../src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;
const f32 = (o) => buf.readFloatLE(o);

const regions = findRegionRecords(buf);
console.log(`region records: ${regions.length}`);

// Get player's region IDs to identify which records are player's
const treas = parseFactionTreasuries(buf);
const playerRegionIds = new Set(treas[0].regionIds);
console.log(`player has ${playerRegionIds.size} regions, IDs: ${[...playerRegionIds].slice(0, 5).join(", ")}...`);

// For player's first 5 region records, dump u32 fields +16..+80
const playerRecords = regions.filter(r => playerRegionIds.has(r.regionId)).slice(0, 5);
console.log(`\nFirst 5 PLAYER region records:`);
for (const r of playerRecords) {
  console.log(`\n  region_id=${r.regionId} at 0x${r.offset.toString(16)}`);
  // Find span: next region record's offset
  const nextR = regions.find(o => o.offset > r.offset);
  const span = nextR ? nextR.offset - r.offset : 200;
  console.log(`  span until next region: ${span} bytes`);
  for (let off = 16; off <= Math.min(span, 80); off += 4) {
    const v = u32(r.offset + off);
    const fv = f32(r.offset + off);
    let note = "";
    if (v === 0xffffffff) note = " ← sentinel";
    else if (v < 100) note = ` (small ${v})`;
    else if (v < 10000) note = ` (${v})`;
    else if (Math.abs(fv) > 0.01 && Math.abs(fv) < 10000 && Math.abs(fv - Math.round(fv)) > 0.001) note = ` (float ${fv.toFixed(2)})`;
    console.log(`    +${off.toString().padStart(3)}: ${v.toString().padStart(10)} = 0x${v.toString(16).padStart(8, "0")}${note}`);
  }
}
