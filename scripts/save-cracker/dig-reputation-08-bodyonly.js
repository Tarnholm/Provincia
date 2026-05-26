// dig-reputation-08-bodyonly.js
// Constrain the betrayal diff to the record's OWN body: from +44 up to the
// diplomacy marker (0x39240005) that follows it. Beyond the marker lies the
// per-faction relation list + character roster (huge churn). We find the
// marker per record, then report EVERY diff in [+44, markerOffset), tagging
// each record by whether it changed at all.
//
// Then we cross-tabulate the +100/+104/+108 columns across all records.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const A = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const B = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav'));
const MARKER = 0x39240005;

function findRecs(buf) {
  const out = [];
  for (let i = 0; i + 96 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    // find diplo marker within next 4096 bytes
    let mk = -1;
    for (let o = i + 48; o < Math.min(buf.length - 4, i + 4096); o += 4) {
      if (buf.readUInt32LE(o) === MARKER) { mk = o; break; }
    }
    out.push({ off: i, treasury: buf.readInt32LE(i), marker: mk });
  }
  return out;
}

const ra = findRecs(A), rb = findRecs(B);

const usedB = new Set();
for (let ai = 0; ai < ra.length; ai++) {
  const a = ra[ai];
  let bi = rb.findIndex((b, k) => !usedB.has(k) && b.treasury === a.treasury);
  if (bi < 0) continue;
  usedB.add(bi);
  const b = rb[bi];
  const endA = a.marker > 0 ? a.marker - a.off : 256;
  const endB = b.marker > 0 ? b.marker - b.off : 256;
  const end = Math.min(endA, endB);
  const diffs = [];
  for (let o = 44; o < end; o++) {
    if (A[a.off + o] !== B[b.off + o]) diffs.push(o);
  }
  // skip pure handle churn region: none expected in the small body except UUIDs
  const markerRel = a.marker > 0 ? a.marker - a.off : -1;
  console.log(`rec[${ai}] treas=${String(a.treasury).padStart(6)} marker@+${markerRel} bodyEnd=${end} diffs=${diffs.length}` +
    (diffs.length ? '  -> ' + diffs.map(o => `+${o}:${A[a.off+o]}>${B[b.off+o]}`).join(' ') : ''));
}

// Cross-tab the +100/+104/+108 u8 columns across all records (A vs B)
console.log('\n=== +100 / +104 / +108 columns (A -> B) per record ===');
usedB.clear();
for (let ai = 0; ai < ra.length; ai++) {
  const a = ra[ai];
  let bi = rb.findIndex((b, k) => !usedB.has(k) && b.treasury === a.treasury);
  if (bi < 0) continue;
  usedB.add(bi);
  const b = rb[bi];
  const c = (o) => `${A[a.off+o]}>${B[b.off+o]}`;
  console.log(`  rec[${String(ai).padStart(2)}] treas=${String(a.treasury).padStart(6)}  +100:${c(100)}  +104:${c(104)}  +108:${c(108)}`);
}
