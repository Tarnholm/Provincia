// dig-diplopair2-newentry.js
//
// Decisive test on the cleanest fixture diff (ror_t1e -> ror_t2s, 7 new
// relations). For EACH newly-added relation entry:
//   (1) Is it lone (no reciprocal new entry in another faction)? -> single-sided.
//   (2) Search the WHOLE t2s buffer for the new uuid as a u32. Every occurrence
//       outside its own zone entry: dump context. If a join table exists, the
//       new uuid would appear in a fresh record holding TWO faction ids.
//   (3) Dump the full 16-byte entry + 32 bytes of surrounding zone context to
//       confirm there is genuinely no partner field.

const fs = require('fs');
const L = require('./dig-diplopair2-lib.js');
const DIR = 'C:/dev/Provincia/scripts/save-cracker/fixtures/feral/';
const fo = L.parseFactionOrder();

const bufA = fs.readFileSync(DIR + 'ror_t1e.sav');
const bufB = fs.readFileSync(DIR + 'ror_t2s.sav');
const zA = L.dedupZones(L.parseZones(bufA, fo));
const zB = L.dedupZones(L.parseZones(bufB, fo));

const uuidsA = new Set(); for (const z of zA) for (const r of z.relations) uuidsA.add(r.uuid);
const newEntries = [];
for (const z of zB) for (const r of z.relations) if (!uuidsA.has(r.uuid)) newEntries.push({ z, r });
console.log('new entries in t2s:', newEntries.length);

function hex(buf, off, len) { const o = []; for (let i = 0; i < len; i++) { const p = off + i; o.push(p >= 0 && p < buf.length ? buf[p].toString(16).padStart(2, '0') : '..'); } return o.join(' '); }

// All uuids that exist in t2s (to detect non-zone occurrences of a new uuid)
const allZoneEntryOffsets = new Set();
for (const z of zB) for (const r of z.relations) allZoneEntryOffsets.add(r.entryOff);

for (const ne of newEntries) {
  const { z, r } = ne;
  console.log(`\n=== NEW: ${fo[z.fid]}(fid${z.fid}) uuid=${r.uuid} cls=${r.class_} att=${r.attitude} @0x${r.entryOff.toString(16)} ===`);
  console.log('  entry 16B + 16 after:', hex(bufB, r.entryOff, 32));
  // Search whole buffer for the uuid u32
  const tgt = Buffer.alloc(4); tgt.writeUInt32LE(r.uuid);
  const occ = [];
  let p = 0; while ((p = bufB.indexOf(tgt, p)) !== -1) { occ.push(p); p += 1; }
  const nonEntry = occ.filter(o => !allZoneEntryOffsets.has(o));
  console.log(`  total u32 occurrences in t2s: ${occ.length}  (non-zone-entry: ${nonEntry.length})`);
  // Show non-zone occurrences near the body (skip header/string regions < 0x100000 noise where small uuids alias)
  let shown = 0;
  for (const o of nonEntry) {
    if (shown >= 6) break;
    // Only show occurrences whose surrounding bytes look like a record (not ascii)
    console.log(`    @0x${o.toString(16)}: ${hex(bufB, o - 8, 24)}`);
    shown++;
  }
}

// Reciprocity: are any two new entries plausibly the two sides of one relation?
// They'd need to be different factions with the SAME class. Print the matrix.
console.log('\n=== Reciprocity of the new entries ===');
console.log('new entries:', newEntries.map(n => `${fo[n.z.fid]}#${n.r.uuid}(cls${n.r.class_})`).join('  '));
console.log('If single-sided: each new relation = one lone entry, NO partner');
console.log('entry with a same-class sibling (potential reciprocal):');
for (let i = 0; i < newEntries.length; i++) {
  for (let j = i + 1; j < newEntries.length; j++) {
    if (newEntries[i].r.class_ === newEntries[j].r.class_ && newEntries[i].z.fid !== newEntries[j].z.fid) {
      console.log(`  ${fo[newEntries[i].z.fid]}#${newEntries[i].r.uuid} <?> ${fo[newEntries[j].z.fid]}#${newEntries[j].r.uuid} (both cls${newEntries[i].r.class_}, uuid delta ${Math.abs(newEntries[i].r.uuid - newEntries[j].r.uuid)})`);
    }
  }
}
