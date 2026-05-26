// dig-diplo-pairing-allfactions.js
//
// CRITICAL re-test: there are 239 class-100 faction records (23 with +44=6,
// 216 with +44=8). parseFactionDiplomacy only looked at the 23. If the 216
// other records ALSO carry diplomacy blocks, a relationUuid in faction A's
// list may have its RECIPROCAL (same relationship) in faction B's list ->
// enabling pairing across the FULL 239-faction set.
//
// Build the full 239-record set, read each record's diplomacy block (the
// marker math: +44=6 records use +244+4N; +44=8 records may differ), then:
//   - re-test uuid uniqueness across ALL 239 lists
//   - test reciprocal: does relationUuid U in A's list appear in exactly one
//     OTHER faction B's list? -> that B is the target.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav';
const DSTRAT = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt';
const buf = fs.readFileSync(SAVE);

const DIPLO_MARKER = 0x39240005;

// Find ALL 239 records (broad signature) and capture +44.
function findAllFactionRecords() {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    const v44 = buf.readUInt32LE(i + 44);
    if (v44 !== 6 && v44 !== 8) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 300) continue;
    out.push({ offset: i, v44, regionCount: regions });
  }
  return out;
}

const recs = findAllFactionRecords();
console.log('total faction records:', recs.length, '(+44=6:', recs.filter(r=>r.v44===6).length, '+44=8:', recs.filter(r=>r.v44===8).length, ')');

// Try to read a diplomacy block for EACH record. For +44=6 records the marker
// is at +244+4N. For +44=8 records, scan a window after the region list for
// the DIPLO_MARKER.
function readDiplo(rec) {
  // Primary guess
  const guesses = [];
  if (rec.v44 === 6) guesses.push(rec.offset + 244 + 4 * rec.regionCount);
  // Generic scan: search a window from after region list for the marker
  const scanStart = rec.offset + 52 + 4 * rec.regionCount;
  const scanEnd = Math.min(scanStart + 400, buf.length - 8);
  for (let p = scanStart; p < scanEnd; p += 1) {
    if (buf.readUInt32LE(p) === DIPLO_MARKER) { guesses.push(p); break; }
  }
  for (const g of guesses) {
    if (g + 8 > buf.length) continue;
    if (buf.readUInt32LE(g) !== DIPLO_MARKER) continue;
    const count = buf.readUInt32LE(g + 4);
    if (count > 300) continue;
    const relations = [];
    let ok = true;
    for (let k = 0; k < count; k++) {
      const o = g + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      relations.push({ uuid: buf.readUInt32LE(o), class_: buf.readUInt32LE(o + 4), attitude: buf.readUInt32LE(o + 8), tag: buf.readUInt32LE(o + 12) });
    }
    if (ok) return { markerOffset: g, count, relations };
  }
  return { markerOffset: null, count: 0, relations: [] };
}

let withDiplo = 0, totalRels = 0;
const recDiplo = recs.map(r => {
  const d = readDiplo(r);
  if (d.markerOffset != null) withDiplo++;
  totalRels += d.relations.length;
  return { rec: r, ...d };
});
console.log('records WITH a diplo block:', withDiplo, ' total relations:', totalRels);

// uuid -> list of record indices that contain it
const uuidToRecs = new Map();
for (let i = 0; i < recDiplo.length; i++) {
  for (const r of recDiplo[i].relations) {
    if (!uuidToRecs.has(r.uuid)) uuidToRecs.set(r.uuid, []);
    uuidToRecs.get(r.uuid).push({ recIdx: i, class_: r.class_, attitude: r.attitude });
  }
}
// Histogram: how many records share each uuid?
const shareHist = new Map();
for (const [u, list] of uuidToRecs) shareHist.set(list.length, (shareHist.get(list.length) || 0) + 1);
console.log('\n=== uuid sharing across ALL', recs.length, 'records ===');
console.log('distinct uuids:', uuidToRecs.size);
for (const [n, c] of [...shareHist.entries()].sort((a,b)=>a[0]-b[0])) {
  console.log(`  uuids appearing in ${n} record(s): ${c}`);
}

// If sharing==2 dominates, reciprocal pairing WORKS. Sample some pairs and
// check class consistency.
console.log('\n=== Sample uuids shared by exactly 2 records (reciprocal pairs) ===');
let shown = 0, classAgree = 0, classDisagree = 0, pairCount = 0;
for (const [u, list] of uuidToRecs) {
  if (list.length !== 2) continue;
  pairCount++;
  if (list[0].class_ === list[1].class_) classAgree++; else classDisagree++;
  if (shown < 20) {
    console.log(`  uuid=${u}: rec[${list[0].recIdx}](off=0x${recs[list[0].recIdx].offset.toString(16)},cls=${list[0].class_}) <-> rec[${list[1].recIdx}](off=0x${recs[list[1].recIdx].offset.toString(16)},cls=${list[1].class_})`);
    shown++;
  }
}
console.log(`reciprocal-pair uuids (share==2): ${pairCount}  classAgree=${classAgree} classDisagree=${classDisagree}`);
