// Check LAYOUT_A detection — should find many Roman characters.
const fs = require("fs");
const path = require("path");
const savePath = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const dsPath = path.join(modPath, "data/world/maps/campaign/imperial_campaign/descr_strat.txt");
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitsTxt = fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8");
const traitsList = [];
for (const m of traitsTxt.matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traitsList.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(savePath);
const v1Records = findCharacterRecords(buf, names, traitsList, null);

// Count descr_strat chars per faction
const dsText = fs.readFileSync(dsPath, "utf8");
const factionCounts = new Map();
const factionLayoutA = new Map(); // chars with space in name = surname → likely LAYOUT_A
let cur = null;
for (const line of dsText.split(/\r?\n/)) {
  const f = line.match(/^faction\s+([a-z_]+)/); if (f) { cur = f[1]; continue; }
  const m = line.match(/^character,\s+(.+?)\s*$/); if (!m) continue;
  const parts = m[1].split(",").map(s => s.trim());
  if (/^sub[_ ]faction/i.test(parts[0])) continue;
  factionCounts.set(cur, (factionCounts.get(cur) || 0) + 1);
  if (parts[0].includes(" ")) factionLayoutA.set(cur, (factionLayoutA.get(cur) || 0) + 1);
}
console.log("descr_strat per faction (and how many have lastName i.e. LAYOUT_A):");
for (const [f, c] of [...factionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${f}: ${c} chars (${factionLayoutA.get(f) || 0} with surname)`);
}

// Compare to v1: which factions have LAYOUT_A chars in v1?
const v1LayoutACount = v1Records.filter(c => c.lastName !== null).length;
console.log(`\nv1 LAYOUT_A records: ${v1LayoutACount}`);

// What firstNames does v1 LAYOUT_A have?
const layoutAFirstNames = new Map();
for (const c of v1Records) {
  if (c.lastName === null) continue;
  layoutAFirstNames.set(c.firstName, (layoutAFirstNames.get(c.firstName) || 0) + 1);
}
console.log("v1 LAYOUT_A firstNames:");
for (const [n, c] of [...layoutAFirstNames.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n}: ${c}`);
}

// Find a known Roman char (Quintus Ogulnius_Gallus) and check v1
const quintus = v1Records.find(c => c.firstName === "Quintus" && c.lastName === "Ogulnius_Gallus");
console.log(`\nQuintus Ogulnius_Gallus in v1: ${quintus ? "YES" : "NO"} (offset=${quintus?.offset?.toString(16)})`);

// How many descr_strat Roman chars (julii) have surnames?
const julii = factionLayoutA.get("romans_julii") || 0;
console.log(`Romans_julii in descr_strat with surname: ${julii}`);
