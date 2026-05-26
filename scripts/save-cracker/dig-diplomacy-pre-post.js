// Compare diplomacy state between PRE and POST saves.
// The user edited descr_strat to put romans_julii at war with carthage,
// reloaded PRE, game showed peace, saved POST. If diplomacy bytes are
// identical → descr_strat was ignored at load (save state is authoritative).
const fs = require("fs");
const {
  parseFactionTreasuries,
  parseFactionDiplomacy,
  identifyFactionRecordOwners,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const PRE = fs.readFileSync("C:/Users/vtarn/Downloads/save_diplo_before.sav..sav");
const POST = fs.readFileSync("C:/Users/vtarn/Downloads/save_diplo_after.sav..sav");

const preTreas = parseFactionTreasuries(PRE);
const postTreas = parseFactionTreasuries(POST);
console.log(`PRE factions: ${preTreas.length}, POST factions: ${postTreas.length}`);

const preOwners = identifyFactionRecordOwners(PRE, preTreas);
const postOwners = identifyFactionRecordOwners(POST, postTreas);

const preDiplo = parseFactionDiplomacy(PRE, preTreas);
const postDiplo = parseFactionDiplomacy(POST, postTreas);

// Total relations
const preCount = preDiplo.reduce((s, x) => s + (x.relations?.length || 0), 0);
const postCount = postDiplo.reduce((s, x) => s + (x.relations?.length || 0), 0);
console.log(`PRE total relations: ${preCount}, POST total: ${postCount}`);

// For each pair of records (same index), check if relations match
console.log("\nPer-record relation comparison:");
let totalSame = 0, totalDiff = 0;
const diffs = [];
for (let i = 0; i < Math.min(preTreas.length, postTreas.length); i++) {
  const pre = preDiplo[i]?.relations || [];
  const post = postDiplo[i]?.relations || [];
  const owner = preOwners[i]?.factionName || `rec${i}`;
  // Compare by uuid → class+attitude
  const preMap = new Map(pre.map(r => [r.uuid, { c: r.class_, a: r.attitude }]));
  const postMap = new Map(post.map(r => [r.uuid, { c: r.class_, a: r.attitude }]));
  const changed = [];
  for (const [k, v] of preMap) {
    const p = postMap.get(k);
    if (!p) { changed.push(`-uuid 0x${k.toString(16)} (c=${v.c}, a=${v.a})`); continue; }
    if (p.c !== v.c || p.a !== v.a) changed.push(`*uuid 0x${k.toString(16)}: c ${v.c}→${p.c}, a ${v.a}→${p.a}`);
  }
  for (const [k, v] of postMap) {
    if (!preMap.has(k)) changed.push(`+uuid 0x${k.toString(16)} (c=${v.c}, a=${v.a})`);
  }
  if (changed.length === 0) totalSame += pre.length;
  else { totalDiff += changed.length; diffs.push({ owner, changed, preCount: pre.length, postCount: post.length }); }
}
console.log(`Unchanged relations: ${totalSame}, changed: ${totalDiff}`);
if (diffs.length > 0) {
  console.log("\nFactions with diplomacy diffs:");
  for (const d of diffs) {
    console.log(`  ${d.owner} (${d.preCount}→${d.postCount}):`);
    for (const c of d.changed.slice(0, 10)) console.log(`    ${c}`);
    if (d.changed.length > 10) console.log(`    ... +${d.changed.length - 10} more`);
  }
}

// Find romans_julii and carthage specifically
const rj = preOwners.findIndex(o => o.factionName === "romans_julii");
const car = preOwners.findIndex(o => o.factionName === "carthage");
console.log(`\nromans_julii rec: ${rj}, carthage rec: ${car}`);
if (rj >= 0) {
  console.log(`romans_julii PRE relations: ${preDiplo[rj]?.relations?.length || 0}`);
  console.log(`romans_julii POST relations: ${postDiplo[rj]?.relations?.length || 0}`);
}
if (car >= 0) {
  console.log(`carthage PRE relations: ${preDiplo[car]?.relations?.length || 0}`);
  console.log(`carthage POST relations: ${postDiplo[car]?.relations?.length || 0}`);
}
