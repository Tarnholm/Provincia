// Diff Spain Turn 4 Start (peace) vs Turn 4 declared war on Carthage.
// What CHANGES near Spain's faction record + near Carthage's faction record
// reveals how diplomatic relations are stored.
const fs = require("fs");
const { parseFactionTreasuries, parseFactionDiplomacy, identifyFactionRecordOwners } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const PRE = fs.readFileSync(`${BASE}\\save_Autosave   Spain   Turn 4 Start.sav`);
const POST = fs.readFileSync(`${BASE}\\save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav`);

console.log(`PRE: ${PRE.length} bytes, POST: ${POST.length} bytes, delta ${POST.length - PRE.length}`);

// Faction records in each
const preTreas = parseFactionTreasuries(PRE);
const postTreas = parseFactionTreasuries(POST);
console.log(`PRE faction records: ${preTreas.length}`);
console.log(`POST faction records: ${postTreas.length}`);

const preOwners = identifyFactionRecordOwners(PRE, preTreas);
const postOwners = identifyFactionRecordOwners(POST, postTreas);
console.log("PRE owners:");
for (let i = 0; i < preOwners.length; i++) {
  console.log(`  ${i}: ${preOwners[i].factionName || "(unknown)"}`);
}

// Find Spain and Carthage record indices
const findRec = (owners, name) => owners.findIndex(o => o.factionName === name);
const preSpain = findRec(preOwners, "spain");
const preCarth = findRec(preOwners, "carthage");
const postSpain = findRec(postOwners, "spain");
const postCarth = findRec(postOwners, "carthage");
console.log(`\nspain: pre=rec${preSpain} post=rec${postSpain}`);
console.log(`carthage: pre=rec${preCarth} post=rec${postCarth}`);

const preDiplo = parseFactionDiplomacy(PRE, preTreas);
const postDiplo = parseFactionDiplomacy(POST, postTreas);

if (preSpain >= 0 && postSpain >= 0) {
  console.log(`\nSpain's relations PRE: ${preDiplo[preSpain].relations.length}, POST: ${postDiplo[postSpain].relations.length}`);
  // List Spain's relations and check for class changes
  console.log("Spain PRE relations:");
  for (const r of preDiplo[preSpain].relations.slice(0, 30)) {
    console.log(`  uuid=0x${r.uuid.toString(16)} class=${r.class_} attitude=${r.attitude}`);
  }
  console.log("Spain POST relations:");
  for (const r of postDiplo[postSpain].relations.slice(0, 30)) {
    console.log(`  uuid=0x${r.uuid.toString(16)} class=${r.class_} attitude=${r.attitude}`);
  }
}

if (preCarth >= 0 && postCarth >= 0) {
  console.log(`\nCarthage's relations PRE: ${preDiplo[preCarth].relations.length}, POST: ${postDiplo[postCarth].relations.length}`);
  console.log("Carthage PRE relations:");
  for (const r of preDiplo[preCarth].relations.slice(0, 20)) {
    console.log(`  uuid=0x${r.uuid.toString(16)} class=${r.class_} attitude=${r.attitude}`);
  }
  console.log("Carthage POST relations:");
  for (const r of postDiplo[postCarth].relations.slice(0, 20)) {
    console.log(`  uuid=0x${r.uuid.toString(16)} class=${r.class_} attitude=${r.attitude}`);
  }
}

// What changed? Find UUIDs in Spain POST but not Spain PRE
function diffRelations(pre, post) {
  const preMap = new Map(pre.relations.map(r => [r.uuid, r]));
  const postMap = new Map(post.relations.map(r => [r.uuid, r]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [k, v] of postMap) {
    if (!preMap.has(k)) added.push(v);
    else {
      const p = preMap.get(k);
      if (p.class_ !== v.class_ || p.attitude !== v.attitude) changed.push({ uuid: k, pre: p, post: v });
    }
  }
  for (const [k, v] of preMap) {
    if (!postMap.has(k)) removed.push(v);
  }
  return { added, removed, changed };
}

if (preSpain >= 0 && postSpain >= 0) {
  const d = diffRelations(preDiplo[preSpain], postDiplo[postSpain]);
  console.log(`\nSpain diff: ${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed`);
  for (const a of d.added) console.log(`  +ADD uuid=0x${a.uuid.toString(16)} class=${a.class_} attitude=${a.attitude}`);
  for (const r of d.removed) console.log(`  -REM uuid=0x${r.uuid.toString(16)} class=${r.class_} attitude=${r.attitude}`);
  for (const c of d.changed) console.log(`  *CHG uuid=0x${c.uuid.toString(16)} class=${c.pre.class_}->${c.post.class_} att=${c.pre.attitude}->${c.post.attitude}`);
}

if (preCarth >= 0 && postCarth >= 0) {
  const d = diffRelations(preDiplo[preCarth], postDiplo[postCarth]);
  console.log(`\nCarthage diff: ${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed`);
  for (const a of d.added) console.log(`  +ADD uuid=0x${a.uuid.toString(16)} class=${a.class_} attitude=${a.attitude}`);
  for (const r of d.removed) console.log(`  -REM uuid=0x${r.uuid.toString(16)} class=${r.class_} attitude=${r.attitude}`);
  for (const c of d.changed) console.log(`  *CHG uuid=0x${c.uuid.toString(16)} class=${c.pre.class_}->${c.post.class_} att=${c.pre.attitude}->${c.post.attitude}`);
}
