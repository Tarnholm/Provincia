// dig-diplopair2-positional.js
//
// New angle (positional partner): maybe each zone lists relations toward a set
// of partner factions, and partner identity comes from the ENTRY ORDER aligning
// with a known faction iteration (e.g. ascending uuid == ascending creation =
// ascending fid?), OR there is a hidden per-entry field beyond +12 we missed.
//
// (P1) Is the relation uuid correlated with the OWNER fid or some partner fid?
//      Sort all (uuid, ownerFid). If uuid increases with creation, early uuids
//      = early-created relations (script order). Does the script create
//      relations in a fid order we can align?
// (P2) Re-dump entries WIDER: read +12..+16 bytes PAST each 16-byte entry to
//      confirm stride is exactly 16 (no hidden partner field). Check the byte
//      right after tag.
// (P3) region-id overlap significance: relation uuids 12..1322 vs region ids
//      13..1307. Compute expected random overlap vs observed 307.

const fs = require('fs');
const L = require('./dig-diplopair2-lib.js');
const X = require('../../src/saveCrackerExtras.js');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav';
const buf = fs.readFileSync(SAVE);
const fo = L.parseFactionOrder();
const zones = L.dedupZones(L.parseZones(buf, fo));

// (P2) confirm 16-byte stride: every entry's tag is 0x00010101 and the byte
// after the 16-byte block belongs to the next entry (uuid) or trailer.
let tagOk = 0, tagBad = 0;
for (const z of zones) for (const r of z.relations) { if (r.tag === 0x00010101) tagOk++; else { tagBad++; } }
console.log('=== (P2) stride check ===');
console.log('entries with tag 0x00010101:', tagOk, ' other:', tagBad);
// dump the distinct tag values
const tagVals = new Map();
for (const z of zones) for (const r of z.relations) tagVals.set(r.tag, (tagVals.get(r.tag) || 0) + 1);
console.log('distinct tag values:', [...tagVals.entries()].map(([k, v]) => `0x${k.toString(16)}:${v}`).join('  '));

// distinct class & attitude values
const clsVals = new Map(), attVals = new Map();
for (const z of zones) for (const r of z.relations) { clsVals.set(r.class_, (clsVals.get(r.class_) || 0) + 1); attVals.set(r.attitude, (attVals.get(r.attitude) || 0) + 1); }
console.log('distinct class values:', [...clsVals.entries()].sort((a,b)=>a[0]-b[0]).map(([k,v])=>`${k}:${v}`).join('  '));
console.log('distinct attitude values:', [...attVals.entries()].sort((a,b)=>a[0]-b[0]).map(([k,v])=>`${k}:${v}`).join('  '));

// (P1) uuid vs owner fid — is there ANY structure? Plot count of distinct
// owners per uuid-bucket of 100.
console.log('\n=== (P1) uuid distribution by owner (fid) ===');
const all = [];
for (const z of zones) for (const r of z.relations) all.push({ uuid: r.uuid, fid: z.fid, name: z.name, cls: r.class_ });
all.sort((a, b) => a.uuid - b.uuid);
// Are consecutive uuids owned by the same faction? (would imply blocks created together)
let consecSame = 0, consecDiff = 0;
for (let i = 1; i < all.length; i++) { if (all[i].uuid === all[i-1].uuid + 1) { if (all[i].fid === all[i-1].fid) consecSame++; else consecDiff++; } }
console.log('consecutive-uuid pairs same owner:', consecSame, ' diff owner:', consecDiff);

// (P3) overlap significance
const regions = X.findRegionRecords(buf);
const regionIds = new Set(regions.map(r => r.regionId));
const relUuids = new Set(all.map(a => a.uuid));
const lo = 12, hi = 1322, span = hi - lo + 1;
const overlap = [...relUuids].filter(u => regionIds.has(u)).length;
// expected overlap if both uniformly random in [lo,hi]: |A|*|B|/span
const exp = (relUuids.size * regionIds.size) / span;
console.log('\n=== (P3) relation-uuid vs region-id overlap ===');
console.log(`relUuids=${relUuids.size} regionIds=${regionIds.size} span=${span}`);
console.log(`observed overlap=${overlap}  expected-if-random=${exp.toFixed(1)}`);
console.log(overlap > exp * 1.3 ? '=> overlap notably ABOVE chance — investigate' : '=> overlap ~ chance (coincidental dense ranges)');

// Also check: does relation uuid ever equal the OWNER's own region id? (self)
const facRecs = X.parseFactionTreasuries(buf);
const owners = X.identifyFactionRecordOwners(buf, facRecs, fo);
const fidRegionIds = new Map(); // fid -> Set(regionIds) from class-100 records
for (let i = 0; i < facRecs.length; i++) {
  const o = owners[i]; if (!o || o.factionId == null) continue;
  fidRegionIds.set(o.factionId, new Set(facRecs[i].regionIds));
}
// For each relation, is uuid in OWNER's regionIds (self) or in some OTHER fid's regionIds (=> partner!)?
let selfHit = 0, otherHit = 0, both2 = 0, none = 0;
const partnerVotes = []; // {relName, uuid, partnerFids:[...]}
for (const a of all) {
  const ownSet = fidRegionIds.get(a.fid);
  const inSelf = ownSet && ownSet.has(a.uuid);
  const partners = [];
  for (const [pf, rs] of fidRegionIds) { if (pf === a.fid) continue; if (rs.has(a.uuid)) partners.push(pf); }
  if (inSelf && partners.length) both2++;
  else if (inSelf) selfHit++;
  else if (partners.length) { otherHit++; if (partnerVotes.length < 30) partnerVotes.push({ name: a.name, uuid: a.uuid, cls: a.cls, partners: partners.map(p => fo[p]) }); }
  else none++;
}
console.log('\n=== relation uuid vs faction-record regionIds (does uuid name a partner via its territory?) ===');
console.log('only owner-self regionId:', selfHit, ' only other-faction regionId:', otherHit, ' both:', both2, ' none:', none);
console.log('(only-other would be the crack IF uuids were region ids of the partner; sample:)');
for (const v of partnerVotes.slice(0, 20)) console.log(`  ${v.name} uuid=${v.uuid} cls=${v.cls} -> regionOwnedBy: ${v.partners.join(',')}`);
