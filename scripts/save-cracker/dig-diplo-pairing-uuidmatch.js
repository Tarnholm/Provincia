// dig-diplo-pairing-uuidmatch.js
//
// Hypothesis (a): a relation's uuid (or a nearby field) equals the TARGET
// faction's record-level UUID. Collect candidate faction-level UUIDs from
// each record's header/self-pointer area and test whether any relationUuid
// matches one of them.

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

// Candidate faction-level identity fields: scan each record's first 0x40
// bytes for u32 values that are NOT pointers/constants and could be a UUID.
// We specifically capture +28 (the value after the +24 self-pointer) and
// +0..+0x40 in general.
console.log('=== Candidate faction-identity u32s per record ===');
const recHeaderFields = []; // recHeaderFields[i] = { name, fields: Map(offset->value) }
for (let i = 0; i < recs.length; i++) {
  const off = recs[i].offset;
  const fields = {};
  for (let r = 0; r < 0x40; r += 4) fields[r] = buf.readUInt32LE(off + r);
  recHeaderFields.push({ name: owners[i].factionName, off, fields });
}
// Print the per-offset values that VARY across records (constant fields are noise)
const offsets = [];
for (let r = 0; r < 0x40; r += 4) {
  const vals = recHeaderFields.map(h => h.fields[r]);
  const distinct = new Set(vals).size;
  offsets.push({ r, distinct, sample: vals.slice(0, 4) });
}
console.log('offset distinct-values across 23 records:');
for (const o of offsets) {
  console.log(`  +${String(o.r).padStart(2)} distinct=${o.distinct}` + (o.distinct === 23 ? '  <-- unique per record (UUID candidate)' : ''));
}

// Gather all relationUuids
const allRelUuids = new Set();
for (const d of diplo) for (const r of (d.relations || [])) allRelUuids.add(r.uuid);

// For each header offset that's unique-ish, test whether relationUuids match
console.log('\n=== relationUuid vs header-field cross match ===');
for (let r = 0; r < 0x40; r += 4) {
  const headerVals = new Map(); // value -> faction name
  for (const h of recHeaderFields) headerVals.set(h.fields[r], h.name);
  let matches = 0;
  for (const u of allRelUuids) if (headerVals.has(u)) matches++;
  if (matches > 0) console.log(`  header +${r}: ${matches} relationUuids match a record's +${r} value`);
}
console.log('(no output above = no header field matches any relationUuid)');

// Also: do relationUuids ever match a region UUID / region id? (sanity)
const regionIdSet = new Set();
for (const rec of recs) for (const id of rec.regionIds) regionIdSet.add(id);
let regionMatch = 0;
for (const u of allRelUuids) if (regionIdSet.has(u)) regionMatch++;
console.log(`relationUuids matching a regionId: ${regionMatch}`);

// Broaden: search ENTIRE buffer for each record's +28 value to see what it is.
console.log('\n=== What is the +28 field? (count occurrences in whole file) ===');
for (let i = 0; i < Math.min(recs.length, 8); i++) {
  const v = buf.readUInt32LE(recs[i].offset + 28);
  const t = Buffer.alloc(4); t.writeUInt32LE(v);
  let cnt = 0, p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) { cnt++; p++; if (cnt > 50) break; }
  console.log(`  rec[${i}] ${owners[i].factionName}: +28 = 0x${v.toString(16)} (${v}) occurs ${cnt}${cnt>50?'+':''} times`);
}
