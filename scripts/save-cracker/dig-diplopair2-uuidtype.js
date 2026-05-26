// dig-diplopair2-uuidtype.js
//
// The 806 "relations" vastly exceed plausible faction-pair counts (seleucid 29
// wars, carthage 33, ptolemaic 66). So the uuid+class+attitude entry may NOT be
// a faction-pair relation. Hypotheses for what uuid points to:
//   (H1) the relationship's OWN uuid (creation counter) — partner elsewhere. (already ~ruled out)
//   (H2) the PARTNER faction's record uuid (region_uuid / faction self-ptr).
//   (H3) a CHARACTER uuid (diplomat target / agent).
//   (H4) a REGION uuid.
//
// We have other parsers: faction records have self-ptrs and a uuid at +4;
// region records have regionUuid at +4. Cross-reference the relation uuids
// against (a) faction-record uuids, (b) region uuids, (c) character own_uuids.

const fs = require('fs');
const L = require('./dig-diplopair2-lib.js');
const X = require('../../src/saveCrackerExtras.js');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav';
const buf = fs.readFileSync(SAVE);
const fo = L.parseFactionOrder();
const zones = L.dedupZones(L.parseZones(buf, fo));

const relUuids = new Set();
for (const z of zones) for (const r of z.relations) relUuids.add(r.uuid);
console.log('distinct relation uuids:', relUuids.size, 'range', Math.min(...relUuids), '..', Math.max(...relUuids));

// (b) region uuids
const regions = X.findRegionRecords(buf);
const regionUuids = new Set(regions.map(r => r.regionUuid));
const regionIds = new Set(regions.map(r => r.regionId));
console.log('\nregion records:', regions.length, 'distinct regionUuids:', regionUuids.size, 'regionIds:', regionIds.size);
let relInRegionUuid = 0, relInRegionId = 0;
for (const u of relUuids) { if (regionUuids.has(u)) relInRegionUuid++; if (regionIds.has(u)) relInRegionId++; }
console.log('relation uuids that are a regionUuid:', relInRegionUuid, '/', relUuids.size);
console.log('relation uuids that are a regionId:', relInRegionId, '/', relUuids.size);
console.log('region uuid sample:', [...regionUuids].slice(0, 10).join(','));
console.log('region id sample:', [...regionIds].slice(0, 20).join(','));

// (a) faction-record uuids (the +4 field and self-ptr area)
const facRecs = X.parseFactionTreasuries(buf);
console.log('\nfaction (class-100) records:', facRecs.length);
// read uuid-ish field at +4 of each
const facUuids = new Set();
for (const r of facRecs) facUuids.add(buf.readUInt32LE(r.offset + 4));
let relInFac = 0;
for (const u of relUuids) if (facUuids.has(u)) relInFac++;
console.log('faction-record +4 values:', [...facUuids].slice(0, 10).join(','));
console.log('relation uuids matching a faction +4 value:', relInFac);

// (c) character own_uuids
const chars = X.parseCharacterExtras(buf);
const charUuids = new Set(chars.map(c => c.ownUuid));
console.log('\ncharacters parsed:', chars.length, 'distinct ownUuids:', charUuids.size);
let relInChar = 0;
for (const u of relUuids) if (charUuids.has(u)) relInChar++;
console.log('relation uuids matching a character ownUuid:', relInChar);
console.log('char ownUuid range:', charUuids.size ? Math.min(...charUuids) + '..' + Math.max(...charUuids) : 'n/a');

// Distribution: relation uuids are 12..1322, sequential global counter.
// Region uuids and char uuids are typically in totally different ranges (big).
// Print the ranges side by side to see overlap potential.
console.log('\n=== Range comparison ===');
const arr = a => a.size ? `${Math.min(...a)} .. ${Math.max(...a)}` : 'n/a';
console.log('relation uuids :', arr(relUuids));
console.log('region uuids   :', arr(regionUuids));
console.log('region ids     :', arr(regionIds));
console.log('char ownUuids  :', arr(charUuids));
console.log('faction +4     :', arr(facUuids));
