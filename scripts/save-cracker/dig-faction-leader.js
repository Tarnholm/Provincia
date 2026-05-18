// Find the LEADER character per faction from the save. The faction record
// (treasury parser hits) has a fixed header; somewhere in the body there
// should be a leader UUID pointing into the character records.
//
// Strategy: for each faction record, scan bytes for u32 values matching
// any of our characterExtras ownUuids. The most prominent match in a
// consistent position is the leader.

const fs = require("fs");
const path = require("path");
const { parseCharacterExtras, parseFactionTreasuries } = require("../../src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

const chars = parseCharacterExtras(buf);
console.log(`character records: ${chars.length}`);
const ownUuids = new Set(chars.map(c => c.ownUuid));
const treas = parseFactionTreasuries(buf);
console.log(`faction records: ${treas.length}`);

// For each faction record, scan +0..+500 for character UUID matches.
// Record positions where matches cluster.
const offsetVotes = {}; // relative offset -> count of faction records that match
for (const r of treas.slice(0, 10)) {
  for (let off = 0; off < 2000; off += 1) {
    if (r.offset + off + 4 > buf.length) continue;
    const v = u32(r.offset + off);
    if (ownUuids.has(v)) {
      offsetVotes[off] = (offsetVotes[off] || 0) + 1;
    }
  }
}
console.log("\nrelative offsets where char UUID was found in first 10 faction records:");
const sorted = Object.entries(offsetVotes).sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [off, n] of sorted) {
  console.log(`  +${off.padStart(4)}: ${n}/10 records`);
}

// If there's a position where ALL records hit, that's the leader_uuid offset
const universal = sorted.filter(([, n]) => n >= 8);
if (universal.length > 0) {
  console.log(`\nTOP candidates (>=8/10):`);
  for (const [off, n] of universal) {
    console.log(`  +${off}: ${n}/10`);
    // Verify: for each record, what character does this position point to?
    for (const r of treas.slice(0, 3)) {
      const uuid = u32(r.offset + parseInt(off));
      const c = chars.find(x => x.ownUuid === uuid);
      console.log(`    rec @0x${r.offset.toString(16)}: uuid=${uuid.toString(16)} → ${c ? `${c.region} age ${c.age}` : "no char match"}`);
    }
  }
}
