// dig-victory-region-names.js
// Try to bridge settlement/region NAMES to the save's region-ID namespace.
// Strategy: descr_strat lists each settlement with its region; the save's
// settlement records carry the settlement name. We look for the region
// internal names (e.g. "Macedonia", "Attica") OR settlement names near the
// region records to recover name -> regionId.
// Research/diagnostics only.

const fs = require("fs");
const path = require("path");
const extras = require(path.join(__dirname, "..", "..", "src", "saveCrackerExtras.js"));
const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const file = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(SAVES + file);
console.log(`=== ${file} ===\n`);

// A few antigonid hold settlements to probe for as ASCII pstr/UTF8 in the save.
const probes = ["Pella", "Athens", "Sparta", "Pergamon", "Rhodes", "Alexandria", "Macedonia"];
for (const name of probes) {
  // try ASCII
  const a = Buffer.from(name, "ascii");
  let c = 0, first = -1; let p = 0;
  while ((p = buf.indexOf(a, p)) !== -1) { if (first < 0) first = p; c++; p += 1; if (c > 5) break; }
  console.log(`ASCII "${name}": ${c}${c>5?"+":""} hits, first @0x${first>=0?first.toString(16):"--"}`);
}

// Region records: show offset + regionId + the bytes right after (maybe a
// region-internal-name pstr).
const rr = extras.findRegionRecords(buf).filter(r => r.regionId > 0 && r.regionId < 2000);
console.log(`\nregion records: ${rr.length}. Sample with trailing context:`);
for (const r of rr.slice(0, 8)) {
  const ctx = buf.slice(r.offset + 16, r.offset + 16 + 40);
  const ascii = [...ctx].map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
  console.log(`  @0x${r.offset.toString(16)} regionId=${r.regionId} uuid=${r.regionUuid}  after16='${ascii}'`);
}
