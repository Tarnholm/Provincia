// dig-victory-search-holdlist.js
// Search the save body for the player's hold_regions region-ID sequence,
// stored as u32 array. Also search for the take_regions integer and the
// outlive_factions faction-ID sequence. Tolerates 0-based vs 1-based and
// partial/permuted matches.
// Research/diagnostics only.

const fs = require("fs");
const path = require("path");
const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const file = process.argv[2] || "save_macedon t0.sav";
const which = process.argv[3] || "antigonid"; // which faction's win condition
const buf = fs.readFileSync(SAVES + file);
console.log(`=== ${file} (${buf.length} bytes) — win cond: ${which} ===\n`);

const map = JSON.parse(fs.readFileSync(path.join(__dirname, "_victory_region_map.json"), "latin1"));
const holdResolved = map[which]; // [{s, idx0, idx1}]
if (!holdResolved) { console.log("no resolved hold for", which); process.exit(0); }
const idx0 = holdResolved.map(x => x.idx0);
const idx1 = holdResolved.map(x => x.idx1);

// Build a set of all region IDs present in the save (any u32 that appears as
// part of the faction regionIds), to know the actual namespace.
const extras = require(path.join(__dirname, "..", "..", "src", "saveCrackerExtras.js"));
const recs = extras.parseFactionTreasuries(buf);
const saveRegionIds = new Set();
for (const r of recs) for (const id of r.regionIds) saveRegionIds.add(id);

// How many of the hold IDs (each namespace) actually exist as region IDs in the save?
const hit0 = idx0.filter(x => saveRegionIds.has(x)).length;
const hit1 = idx1.filter(x => saveRegionIds.has(x)).length;
console.log(`hold IDs that match a live save region ID: idx0=${hit0}/${idx0.length}  idx1=${hit1}/${idx1.length}`);

// Try to find the hold list as a contiguous u32 sequence (in declared order).
function findSeqU32(ids, label) {
  // Search for the first 4 IDs as consecutive u32 LE, then verify the rest.
  if (ids.length < 4) return;
  const head = Buffer.alloc(16);
  for (let k = 0; k < 4; k++) head.writeUInt32LE(ids[k] >>> 0, k * 4);
  let p = 0, found = 0;
  while ((p = buf.indexOf(head, p)) !== -1) {
    // verify full sequence
    let ok = true;
    for (let k = 0; k < ids.length; k++) {
      if (p + k * 4 + 4 > buf.length || buf.readUInt32LE(p + k * 4) !== (ids[k] >>> 0)) { ok = false; break; }
    }
    console.log(`  [${label}] head-match @0x${p.toString(16)} fullSeq=${ok}`);
    found++;
    p += 1;
    if (found > 20) break;
  }
  if (found === 0) console.log(`  [${label}] no contiguous match`);
}
console.log("\nsearch hold list as contiguous u32 (declared order):");
findSeqU32(idx0, "idx0");
findSeqU32(idx1, "idx1");

// Sorted-order variants (engine may store sorted)
const idx0s = [...idx0].sort((a, b) => a - b);
const idx1s = [...idx1].sort((a, b) => a - b);
console.log("\nsearch hold list as contiguous u32 (sorted order):");
findSeqU32(idx0s, "idx0-sorted");
findSeqU32(idx1s, "idx1-sorted");

// Also try u16 packing
function findSeqU16(ids, label) {
  if (ids.length < 6) return;
  const head = Buffer.alloc(12);
  for (let k = 0; k < 6; k++) head.writeUInt16LE(ids[k] & 0xffff, k * 2);
  let p = 0, found = 0;
  while ((p = buf.indexOf(head, p)) !== -1) {
    let ok = true;
    for (let k = 0; k < ids.length; k++) {
      if (buf.readUInt16LE(p + k * 2) !== (ids[k] & 0xffff)) { ok = false; break; }
    }
    console.log(`  [${label}] u16 head-match @0x${p.toString(16)} fullSeq=${ok}`);
    found++; p += 1; if (found > 20) break;
  }
  if (found === 0) console.log(`  [${label}] no u16 contiguous match`);
}
console.log("\nsearch hold list as contiguous u16:");
findSeqU16(idx0, "idx0");
findSeqU16(idx1, "idx1");
findSeqU16(idx0s, "idx0-sorted");
findSeqU16(idx1s, "idx1-sorted");
