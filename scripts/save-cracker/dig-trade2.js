// dig-trade2.js — find biggest data structures that changed between rome6
// (Messapians alive, owned Uria) and rome7 (Messapians wiped, Rome owns Uria).
// The trade-route table SHOULD be among them, along with character/army/region
// state.
//
// Strategy: use file-size delta (564k bytes BIGGER in rome7 - because Rome gained
// Uria's settlement record adding ~3700 bytes etc). Look for sections that
// appear/disappear.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const a = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const b = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));
console.log(`a=${a.length}, b=${b.length}, delta=${b.length - a.length}`);

// Look for messapians faction-id references. First check faction-name strings.
const factionTokens = ["romans_julii", "romans_brutii", "romans_scipii", "romans_senate",
  "carthage", "messapians", "samnites", "etruscans", "sicilians", "sabines",
  "lusitani", "ardiaei", "thracians", "macedon", "egypt", "seleucid", "iberians"];
for (const t of factionTokens) {
  const cA = a.toString("latin1").split(t).length - 1;
  const cB = b.toString("latin1").split(t).length - 1;
  if (cA !== cB) console.log(`${t}: rome6=${cA}, rome7=${cB}, delta=${cB-cA}`);
}

// Look for the player faction record using the structural signature (session 5)
function findFactionRecords(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions, treasury: buf.readInt32LE(i) });
  }
  return out;
}

const facA = findFactionRecords(a);
const facB = findFactionRecords(b);
console.log(`\nfaction records: rome6=${facA.length}  rome7=${facB.length}`);

// Index 0 is player. Show player faction record overview
console.log(`\nrome6 player: pos=0x${facA[0].pos.toString(16)}  regions=${facA[0].regions}  treasury=${facA[0].treasury}`);
console.log(`rome7 player: pos=0x${facB[0].pos.toString(16)}  regions=${facB[0].regions}  treasury=${facB[0].treasury}`);

// Show all faction-pos pairs
console.log(`\nAll faction records (rome6 / rome7):`);
for (let i = 0; i < Math.min(facA.length, facB.length); i++) {
  console.log(`  [${i}] rome6: pos=0x${facA[i].pos.toString(16).padStart(8, "0")}  reg=${String(facA[i].regions).padStart(3)}  $${facA[i].treasury}  ||  rome7: pos=0x${facB[i].pos.toString(16).padStart(8, "0")}  reg=${String(facB[i].regions).padStart(3)}  $${facB[i].treasury}`);
}

// Find the player faction record's region-list and compare across
console.log(`\nrome6 player region list (first 40):`);
const pA = facA[0];
const aRegions = [];
for (let i = 0; i < pA.regions; i++) aRegions.push(a.readUInt32LE(pA.pos + 52 + i * 4));
console.log("  rome6:", aRegions.join(","));
const pB = facB[0];
const bRegions = [];
for (let i = 0; i < pB.regions; i++) bRegions.push(b.readUInt32LE(pB.pos + 52 + i * 4));
console.log("  rome7:", bRegions.join(","));

const aSet = new Set(aRegions);
const bSet = new Set(bRegions);
console.log(`\nregions in rome7 but not rome6 (Rome's NEW regions):`);
for (const r of bRegions) if (!aSet.has(r)) console.log(`  ${r}`);
console.log(`regions in rome6 but not rome7 (Rome's LOST regions):`);
for (const r of aRegions) if (!bSet.has(r)) console.log(`  ${r}`);
