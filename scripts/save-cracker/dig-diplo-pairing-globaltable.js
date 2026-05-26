// dig-diplo-pairing-globaltable.js
//
// Hypothesis (b): a global diplomacy table elsewhere maps each relationUuid
// to the pair of factions. The relationUuid is a global sequential counter,
// so the engine probably stores relation objects in one central array.
//
// Strategy: pick a handful of relationUuids and find EVERY occurrence in the
// file (excluding the known diplo-block offsets). Cluster the out-of-block
// occurrences to find a separate table. Dump bytes around them.

const fs = require('fs');
const X = require('../../src/saveCrackerExtras.js');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav';
const buf = fs.readFileSync(SAVE);

function parseFactionOrder() {
  const txt = fs.readFileSync('C:/RIS/RIS/data/descr_sm_factions.txt', 'utf8');
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur && /^\s*"culture":/.test(line)) { order.push(cur); cur = null; }
  }
  return order;
}
const factionOrder = parseFactionOrder();
const recs = X.parseFactionTreasuries(buf);
const owners = X.identifyFactionRecordOwners(buf, recs, factionOrder);
const diplo = X.parseFactionDiplomacy(buf, recs);

// Map every relationUuid -> which faction record owns it + its diplo-block offset
const uuidInfo = new Map(); // uuid -> { owner, blockOff, entryOff, class_, attitude }
for (let i = 0; i < recs.length; i++) {
  const d = diplo[i];
  if (!d.markerOffset) continue;
  const base = d.markerOffset + 8;
  (d.relations || []).forEach((r, k) => {
    uuidInfo.set(r.uuid, { owner: owners[i].factionName, blockOff: d.markerOffset, entryOff: base + k * 16, class_: r.class_, attitude: r.attitude });
  });
}

const knownBlockRanges = [];
for (const d of diplo) {
  if (!d.markerOffset) continue;
  const count = buf.readUInt32LE(d.markerOffset + 4);
  knownBlockRanges.push([d.markerOffset, d.markerOffset + 8 + count * 16]);
}
function inKnownBlock(off) {
  for (const [a, b] of knownBlockRanges) if (off >= a && off < b) return true;
  return false;
}

// Pick relationUuids that are war between two MAJOR factions if possible, else
// just sample a spread.
const sampleUuids = [...uuidInfo.keys()].sort((a,b)=>a-b);
// Take 12 spread across the range
const picks = [];
for (let i = 0; i < 12; i++) picks.push(sampleUuids[Math.floor(i * (sampleUuids.length - 1) / 11)]);

console.log('=== Out-of-diplo-block occurrences of sample relationUuids ===');
for (const u of picks) {
  const info = uuidInfo.get(u);
  const t = Buffer.alloc(4); t.writeUInt32LE(u);
  const occ = [];
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) { occ.push(p); p++; if (occ.length > 200) break; }
  const outBlock = occ.filter(o => !inKnownBlock(o));
  console.log(`uuid=${u} owner=${info.owner} class=${info.class_}: total=${occ.length} outOfBlock=${outBlock.length}`);
  // Show the out-of-block offsets clustered
  for (const o of outBlock.slice(0, 8)) {
    console.log(`    @0x${o.toString(16)}  region=0x${(o & ~0xfffff).toString(16)}`);
  }
}

// Now: are there occurrences that cluster TOGETHER in one region (a table)?
// Aggregate ALL out-of-block occurrences for ALL uuids and histogram by 64KB region.
console.log('\n=== Histogram of out-of-block uuid occurrences by 1MB region ===');
const regionHist = new Map();
let scanned = 0;
for (const u of sampleUuids) {
  if (scanned++ > 60) break; // limit for speed
  const t = Buffer.alloc(4); t.writeUInt32LE(u);
  let p = 0, cnt = 0;
  while ((p = buf.indexOf(t, p)) !== -1 && cnt < 100) {
    cnt++;
    if (!inKnownBlock(p)) {
      const region = p >>> 20; // 1MB buckets
      regionHist.set(region, (regionHist.get(region) || 0) + 1);
    }
    p++;
  }
}
const sortedHist = [...regionHist.entries()].sort((a,b)=>b[1]-a[1]);
for (const [region, cnt] of sortedHist.slice(0, 20)) {
  console.log(`  region 0x${(region<<20).toString(16)} - 0x${((region+1)<<20).toString(16)}: ${cnt} occurrences`);
}
console.log('(scanned', Math.min(60, sampleUuids.length), 'uuids)');
