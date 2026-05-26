// dig-victory-scan-regionarrays.js
// Scan the whole save for u32 arrays whose every element is a VALID live
// region ID (from the faction records' namespace), length in [hold-1, hold+2],
// optionally preceded by a u32 count == length. These are candidate
// HOLD_REGIONS / WIN_CONDITION region lists.
// Research/diagnostics only.

const fs = require("fs");
const path = require("path");
const extras = require(path.join(__dirname, "..", "..", "src", "saveCrackerExtras.js"));
const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const file = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(SAVES + file);
console.log(`=== ${file} (${buf.length} bytes) ===\n`);

// Build the live region-ID set.
const recs = extras.parseFactionTreasuries(buf);
const liveRegionIds = new Set();
for (const r of recs) for (const id of r.regionIds) liveRegionIds.add(id);
// Region records add more valid IDs.
const rr = extras.findRegionRecords(buf);
for (const r of rr) if (r.regionId > 0 && r.regionId < 2000) liveRegionIds.add(r.regionId);
console.log(`live region-ID set size: ${liveRegionIds.size}, range [${Math.min(...liveRegionIds)},${Math.max(...liveRegionIds)}]`);

// We expect player hold list length ~ 30 (antigonid) but the win condition
// could be for any faction. Look for runs of length 6..40 of all-valid region IDs.
const MINLEN = 6, MAXLEN = 40;
const candidates = [];
for (let p = 0x4000; p + 4 <= buf.length; p += 4) {
  let len = 0;
  let q = p;
  while (q + 4 <= buf.length) {
    const v = buf.readUInt32LE(q);
    if (liveRegionIds.has(v)) { len++; q += 4; } else break;
  }
  if (len >= MINLEN && len <= MAXLEN) {
    // check for count prefix
    const prefix = p >= 4 ? buf.readUInt32LE(p - 4) : -1;
    candidates.push({ off: p, len, prefixCount: prefix, prefixMatches: prefix === len });
    p = q; // skip past this run to avoid sub-run spam
  }
}
console.log(`\ncandidate region-ID runs (len ${MINLEN}..${MAXLEN}): ${candidates.length}`);
// Sort by prefix-match first, then by length
candidates.sort((a, b) => (b.prefixMatches - a.prefixMatches) || (b.len - a.len));
for (const c of candidates.slice(0, 40)) {
  const ids = [];
  for (let k = 0; k < c.len; k++) ids.push(buf.readUInt32LE(c.off + k * 4));
  console.log(`  @0x${c.off.toString(16)} len=${c.len} prefixCount=${c.prefixCount}${c.prefixMatches ? " <==COUNT" : ""} ids=[${ids.slice(0, 12).join(",")}${ids.length > 12 ? ",..." : ""}]`);
}
