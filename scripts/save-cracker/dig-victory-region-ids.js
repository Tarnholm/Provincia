// dig-victory-region-ids.js
// Build settlement-name -> region-index map from descr_regions.txt, then
// resolve the antigonid/seleucid hold_regions lists to their region indices.
// This gives us the integer sequence we expect to find in the save's
// WIN_CONDITION / HOLD_REGIONS section.
// Research/diagnostics only.

const fs = require("fs");
const REGIONS = "C:\\RIS\\RIS\\data\\world\\maps\\base\\descr_regions.txt";
const txt = fs.readFileSync(REGIONS, "latin1").split(/\r?\n/);

// Parse region blocks. A block starts at a non-indented, non-comment,
// non-empty line (region name). The NEXT non-empty line is the settlement.
const regions = []; // { regionName, settlement, idx }
let i = 0;
while (i < txt.length) {
  let line = txt[i];
  if (line == null) break;
  const trimmed = line.trim();
  // region name = line with no leading whitespace, not comment, not empty
  if (line.length > 0 && !/^[\s;]/.test(line) && trimmed.length > 0) {
    const regionName = trimmed;
    // settlement = next non-empty line (indented)
    let j = i + 1;
    while (j < txt.length && txt[j].trim().length === 0) j++;
    const settlement = txt[j] ? txt[j].trim() : null;
    regions.push({ regionName, settlement });
    // skip to next blank-line gap then continue
    i = j + 1;
    // skip remaining lines of this block until a blank line
    while (i < txt.length && txt[i].trim().length > 0) i++;
  } else {
    i++;
  }
}

// Assign region index. In RTW the region id is declaration order. The
// engine typically reserves index 0 for "no region"/sea, so the first
// declared region = id 1. We print BOTH 0-based and 1-based so we can
// match against the save's actual region IDs.
const bySettlement = new Map();
regions.forEach((r, k) => {
  r.idx0 = k;
  r.idx1 = k + 1;
  if (r.settlement) bySettlement.set(r.settlement.toLowerCase(), r);
});

console.log(`parsed ${regions.length} regions`);
console.log(`first 5:`, regions.slice(0, 5).map(r => `${r.idx1}:${r.settlement}(${r.regionName})`).join(", "));
console.log(`last 3:`, regions.slice(-3).map(r => `${r.idx1}:${r.settlement}`).join(", "));

function resolve(holdList) {
  return holdList.map(s => {
    const r = bySettlement.get(s.toLowerCase().replace(/_/g, "_"));
    return r ? { s, idx0: r.idx0, idx1: r.idx1 } : { s, idx0: null, idx1: null };
  });
}

const antigonidHold = "Pella, Athens, Aigion, Sparta, Orchomenos, Ambrakia, Thermon, Rhizon, Ouskoudama, Singidounon, Dourostoron, Pergamon, Rhodes, Nikaia, Ankyra, Amaseia, Mazaka, Armavir, Gazaka, Seleucia, Nisa, Baktra-Zariaspa, Patala, Alexandria, Petra, Kyrene, Syracuse, Rome, Bononia, Mediolanum".split(",").map(s => s.trim());

const seleucidHold = "Seleucia, Alexandria, Petra, Kyrene, Meroe, Marib, Baktra-Zariaspa, Patala, Nisa, Sakon_Taphai, Gazaka, Armavir, Seraka, Pantikapaion, Mazaka, Amaseia, Ankyra, Nikaia, Pergamon, Rhodes, Sparta, Athens, Aigion, Orchomenos, Thermon, Pella, Ambrakia, Syracuse, Rome, Carthage, Rhizon, Ouskoudama, Dourostoron".split(",").map(s => s.trim());

console.log("\n=== antigonid hold_regions (30) ===");
const ar = resolve(antigonidHold);
console.log("idx1:", ar.map(x => x.idx1).join(", "));
console.log("idx0:", ar.map(x => x.idx0).join(", "));
console.log("unresolved:", ar.filter(x => x.idx1 == null).map(x => x.s).join(", ") || "(none)");

console.log("\n=== seleucid hold_regions (33) ===");
const sr = resolve(seleucidHold);
console.log("idx1:", sr.map(x => x.idx1).join(", "));
console.log("idx0:", sr.map(x => x.idx0).join(", "));
console.log("unresolved:", sr.filter(x => x.idx1 == null).map(x => x.s).join(", ") || "(none)");

// Save the maps for reuse
fs.writeFileSync(__dirname + "/_victory_region_map.json", JSON.stringify({
  regions: regions.map(r => ({ idx0: r.idx0, idx1: r.idx1, region: r.regionName, settlement: r.settlement })),
  antigonid: ar, seleucid: sr,
}, null, 0));
console.log("\nwrote _victory_region_map.json");
