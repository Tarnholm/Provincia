// Verify the header faction-discovered bitmask: is bits[i] indexed by
// descr_sm_factions declaration order? Cross-reference against the live
// diplomacy zones (which factions actually have relations) as a sanity check.
const fs = require("fs");
const {
  parseHeader,
  parseFactionDiscoveredBitmask,
  parseFactionTreasuries,
  identifyFactionRecordOwners,
  parseAllFactionDiplomacy,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = [
  "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
  "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
];
const SM_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8");
  const order = [];
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) {
      const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
      if (cm) { order.push(cur); cur = null; }
    }
  }
  return order;
}

const order = loadFactionOrder(SM_FACTIONS);
console.log(`descr_sm_factions order: ${order.length} factions`);
console.log(order.map((f, i) => `${i}:${f}`).join("  "));

for (const path of SAVES) {
  let buf;
  try { buf = fs.readFileSync(path); } catch { console.log(`\n(skip ${path} — not found)`); continue; }
  console.log(`\n\n===== ${path.split("\\").pop()} =====`);
  const hdr = parseHeader(buf);
  const bm = parseFactionDiscoveredBitmask(buf, hdr);
  if (!bm) { console.log("bitmask: NULL"); continue; }
  console.log(`bitmask: byteCount=${bm.byteCount} totalBits=${bm.totalFactions} discoveredCount=${bm.discoveredCount}`);

  // Map bits[i] -> order[i]
  console.log("\nDISCOVERED (bit=1) mapped to descr_sm_factions order:");
  const discovered = [];
  const discoveredBeyondOrder = [];
  for (let i = 0; i < bm.bits.length; i++) {
    if (!bm.bits[i]) continue;
    if (i < order.length) discovered.push(`${i}:${order[i]}`);
    else discoveredBeyondOrder.push(i);
  }
  console.log("  " + discovered.join("  "));
  if (discoveredBeyondOrder.length) console.log(`  (bits set beyond order length: ${discoveredBeyondOrder.join(",")})`);

  // Cross-check: which factions have live diplomacy zones (= active in game)?
  const recs = parseFactionTreasuries(buf);
  const owners = identifyFactionRecordOwners(buf, recs, order);
  const player = owners.length ? null : null;
  const allDiplo = parseAllFactionDiplomacy(buf, order);
  const diploFactions = new Set(Object.keys(allDiplo));
  console.log(`\nLive diplomacy zones present for ${diploFactions.size} factions.`);

  // Of discovered factions, how many have a live zone? (sanity: discovered
  // should be a subset/superset relationship we can reason about)
  const discNames = discovered.map(s => s.split(":")[1]);
  const discWithZone = discNames.filter(n => diploFactions.has(n.toLowerCase()));
  console.log(`Discovered factions that also have a live diplo zone: ${discWithZone.length}/${discNames.length}`);
  const discNoZone = discNames.filter(n => !diploFactions.has(n.toLowerCase()));
  if (discNoZone.length) console.log(`  discovered but NO live zone: ${discNoZone.join(", ")}`);
}
