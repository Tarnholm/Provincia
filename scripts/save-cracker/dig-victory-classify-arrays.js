// dig-victory-classify-arrays.js
// Enumerate every count-prefixed region-ID array in the save and classify:
//   - matches a known faction OWNED region list (from parseFactionTreasuries)
//   - "extra" (candidate player-owned list or WIN_CONDITION hold list)
// Research/diagnostics only.

const fs = require("fs");
const path = require("path");
const extras = require(path.join(__dirname, "..", "..", "src", "saveCrackerExtras.js"));
const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const file = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(SAVES + file);
console.log(`=== ${file} ===\n`);

const recs = extras.parseFactionTreasuries(buf);
const liveRegionIds = new Set();
for (const r of recs) for (const id of r.regionIds) liveRegionIds.add(id);
const rr = extras.findRegionRecords(buf);
for (const r of rr) if (r.regionId > 0 && r.regionId < 2000) liveRegionIds.add(r.regionId);

// Signatures of known owned lists: sorted-join of first 6 IDs.
const ownedSig = new Map(); // sig -> recIndex
recs.forEach((r, i) => {
  const sig = r.regionIds.slice(0, 6).join(",");
  ownedSig.set(sig, i);
});
// also full-set membership signature
const ownedFullSig = new Set(recs.map(r => [...r.regionIds].sort((a, b) => a - b).join(",")));

// Find count-prefixed arrays: u32 count C in [3,40], followed by C valid region IDs.
const found = [];
for (let p = 0x4000; p + 4 <= buf.length; p += 4) {
  const c = buf.readUInt32LE(p);
  if (c < 3 || c > 40) continue;
  let ok = true;
  const ids = [];
  for (let k = 0; k < c; k++) {
    const o = p + 4 + k * 4;
    if (o + 4 > buf.length) { ok = false; break; }
    const v = buf.readUInt32LE(o);
    if (!liveRegionIds.has(v)) { ok = false; break; }
    ids.push(v);
  }
  if (!ok) continue;
  const sig6 = ids.slice(0, 6).join(",");
  const fullSig = [...ids].sort((a, b) => a - b).join(",");
  const matchOwned = ownedSig.has(sig6) ? ownedSig.get(sig6) : (ownedFullSig.has(fullSig) ? "set" : null);
  found.push({ off: p, count: c, ids, matchOwned, dataOff: p + 4 });
  p = p + 4 + c * 4 - 4; // skip past
}

console.log(`count-prefixed region arrays: ${found.length}`);
const extra = found.filter(f => f.matchOwned === null);
const matched = found.filter(f => f.matchOwned !== null);
console.log(`  matched a faction OWNED list: ${matched.length}`);
console.log(`  EXTRA (player-owned or win-condition candidates): ${extra.length}\n`);

console.log("=== EXTRA arrays ===");
for (const f of extra) {
  console.log(`  @0x${f.off.toString(16)} count=${f.count} ids=[${f.ids.slice(0, 14).join(",")}${f.ids.length > 14 ? ",..." : ""}]`);
}

console.log("\n=== MATCHED arrays (off + which rec) ===");
for (const f of matched) {
  console.log(`  @0x${f.off.toString(16)} count=${f.count} -> rec ${f.matchOwned}`);
}
