// dig-diplopair2-registry.js
//
// LEAD: in ror_t2s, relation uuid 1124 (seleucid's new ally) appears at
// 0xb38a9/0xb5de8/0xbcd25 inside records that contain SMALL INTEGER fields
// resembling faction ids (07=seleucid, 06=ptolemaic). This region (~0xb0000)
// may be a relationship registry mapping uuid -> (factionA, factionB, ...).
//
// Plan:
//  1. Characterize the records in 0xb0000-0xc0000: stride, fields.
//  2. For EVERY relation uuid (Seleucids T0 save), check if it appears in this
//     region with two small faction-id fields, and TEST the pair vs GT.

const fs = require('fs');
const L = require('./dig-diplopair2-lib.js');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav';
const buf = fs.readFileSync(SAVE);
const fo = L.parseFactionOrder();
const zones = L.dedupZones(L.parseZones(buf, fo));
const gt = L.parseGT();

// uuid -> owner info
const uuidInfo = new Map();
for (const z of zones) for (const r of z.relations) uuidInfo.set(r.uuid, { fid: z.fid, name: z.name, cls: r.class_, att: r.attitude });
const relUuids = [...uuidInfo.keys()];

function hex(off, len) { const o = []; for (let i = 0; i < len; i++) { const p = off + i; o.push(p >= 0 && p < buf.length ? buf[p].toString(16).padStart(2, '0') : '..'); } return o.join(' '); }

// First, find where these registry-like records are in THIS save. They had the
// shape: [ptr/uuid][u32 ~1100][RELUUID][u32 small][u32 small][u32 small].
// The reluuid was the THIRD u32. Search for each reluuid where it is preceded
// 4 bytes earlier by another plausible reluuid (i.e. two reluuids adjacent).
// Then read the trailing small fields.
//
// Generic detector: scan the whole buffer for positions p where
//   buf[p..p+4) = reluuid R (R in our set)
// and the 3 u32s AFTER it are all < 240 (faction-id sized) -> candidate.
console.log('=== Candidate registry records (reluuid followed by 3 small u32 < 240) ===');
const cand = new Map(); // reluuid -> [{off, f:[a,b,c]}]
for (let i = 0; i + 16 <= buf.length; i++) {
  const R = buf.readUInt32LE(i);
  if (!uuidInfo.has(R)) continue;
  const a = buf.readUInt32LE(i + 4), b = buf.readUInt32LE(i + 8), c = buf.readUInt32LE(i + 12);
  if (a < 240 && b < 240 && c < 240) {
    if (!cand.has(R)) cand.set(R, []);
    cand.get(R).push({ off: i, f: [a, b, c] });
  }
}
let withCand = 0; for (const [, v] of cand) withCand++;
console.log('reluuids with >=1 such candidate:', withCand, 'of', relUuids.length);

// The seleucid-1124 record was [prev?][1097][1124][7][14][6]. Let me instead
// look at the EXACT structure around the known good offsets translated... but
// offsets differ per save. So: locate records where TWO reluuids are adjacent
// (R at p, R2 at p-4) since the t2s dump showed `61 04 .. 64 04 ..` (1121,1124).
console.log('\n=== Records with TWO adjacent reluuids (R2@p-4, R@p) + trailing smalls ===');
const pairRecs = [];
for (let i = 8; i + 16 <= buf.length; i++) {
  const R = buf.readUInt32LE(i);
  if (!uuidInfo.has(R)) continue;
  const R2 = buf.readUInt32LE(i - 4);
  if (!uuidInfo.has(R2)) continue;
  // trailing small fields
  const a = buf.readUInt32LE(i + 4), b = buf.readUInt32LE(i + 8), c = buf.readUInt32LE(i + 12);
  if (a < 240 && b < 240) pairRecs.push({ off: i, R2, R, a, b, c });
}
console.log('such records:', pairRecs.length);
for (const pr of pairRecs.slice(0, 40)) {
  const oi = uuidInfo.get(pr.R), oi2 = uuidInfo.get(pr.R2);
  console.log(`  @0x${pr.off.toString(16)} R2=${pr.R2}(${oi2.name}) R=${pr.R}(${oi.name}) -> f[${pr.a},${pr.b},${pr.c}] = [${fo[pr.a]||'?'},${fo[pr.b]||'?'},${fo[pr.c]||'?'}]`);
}

// Validate: for a record [R2,R,a,b], does {fo[a],fo[b]} == {owner(R2),owner(R)}?
// or does it equal a GT pair? Score it.
console.log('\n=== Validation of trailing-field faction pairs vs GT ===');
let tested = 0, gtHit = 0, ownerHit = 0;
for (const pr of pairRecs) {
  const fa = fo[pr.a], fb = fo[pr.b];
  if (!fa || !fb) continue;
  tested++;
  const key = [fa, fb].sort().join('|');
  if (gt.has(key)) gtHit++;
  const own = [uuidInfo.get(pr.R).name, uuidInfo.get(pr.R2).name].sort().join('|');
  if (key === own) ownerHit++;
}
console.log(`tested=${tested} pairsMatchingGT=${gtHit} pairsMatchingOwners=${ownerHit}`);
