// dig-diplopair2-verify-t2s.js
// Final verification: dump the t2s region around 0xb38a9 (where reluuid 1124
// appeared with apparent faction-id smalls) to see if it's a real registry or
// noise. Also confirm single-sidedness: in t2s->t5 diff, do new relations ever
// come as reciprocal pairs (same turn, two factions, linked uuids)?

const fs = require('fs');
const L = require('./dig-diplopair2-lib.js');
const DIR = 'C:/dev/Provincia/scripts/save-cracker/fixtures/feral/';
const fo = L.parseFactionOrder();

const bufB = fs.readFileSync(DIR + 'ror_t2s.sav');
function hex(buf, off, len) { const o = []; for (let i = 0; i < len; i++) { const p = off + i; o.push(p >= 0 && p < buf.length ? buf[p].toString(16).padStart(2, '0') : '..'); } return o.join(' '); }

console.log('=== t2s @0xb38a9 region (claimed registry) — wide context ===');
for (let r = -32; r <= 48; r += 16) console.log(`  ${(r>=0?'+':'')}${r}: ${hex(bufB, 0xb38a9 + r, 16)}`);
// What ASCII is nearby? This region (0xb0000) is likely a strings/registry zone.
let asc = '';
for (let i = 0xb3880; i < 0xb3900; i++) { const b = bufB[i]; asc += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.'; }
console.log('  ascii 0xb3880..0xb3900:', asc);

// Confirm: is 0xb0000 region a TEXT/registry area (lots of ascii)?
let asciiBytes = 0; for (let i = 0xb0000; i < 0xc0000; i++) { const b = bufB[i]; if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)) asciiBytes++; }
console.log(`  region 0xb0000-0xc0000 letter-byte density: ${(asciiBytes / 0x10000 * 100).toFixed(1)}%`);

// Single-sidedness across t2s->t5 (lots of changes): for each faction, the
// NEW uuids it gained. Then: do any two factions share a "linked" new uuid?
const bufT5 = fs.readFileSync(DIR + 'ror_t5.sav');
const zB = L.dedupZones(L.parseZones(bufB, fo));
const zT5 = L.dedupZones(L.parseZones(bufT5, fo));
const mB = new Map(zB.map(z => [z.fid, z])), mT5 = new Map(zT5.map(z => [z.fid, z]));
const gained = []; // {fid, uuid, cls}
for (const [fid, z] of mT5) {
  const old = new Set((mB.get(fid) ? mB.get(fid).relations : []).map(r => r.uuid));
  for (const r of z.relations) if (!old.has(r.uuid)) gained.push({ fid, name: fo[fid], uuid: r.uuid, cls: r.class_ });
}
console.log(`\n=== t2s->t5: ${gained.length} relations gained across all factions ===`);
// If single-sided, gained.length ~= number of NEW relationships.
// If bidirectional, each new relationship => 2 entries, and the two entries
// would have CLOSE uuids (created in same engine op). Test: sort gained uuids,
// count adjacent (delta<=1) pairs that belong to DIFFERENT factions of SAME class.
const g = gained.slice().sort((a, b) => a.uuid - b.uuid);
let recip = 0, recipEx = [];
for (let i = 1; i < g.length; i++) {
  if (g[i].uuid - g[i-1].uuid <= 1 && g[i].fid !== g[i-1].fid && g[i].cls === g[i-1].cls) {
    recip++; if (recipEx.length < 15) recipEx.push(`${g[i-1].name}#${g[i-1].uuid} <> ${g[i].name}#${g[i].uuid} cls${g[i].cls}`);
  }
}
console.log(`adjacent (delta<=1) diff-faction same-class gained-uuid pairs (reciprocal candidates): ${recip}`);
for (const e of recipEx) console.log('  ' + e);
// And how many gained uuids are perfectly lone (no neighbor within 1)?
let lone = 0;
for (let i = 0; i < g.length; i++) {
  const prevClose = i > 0 && g[i].uuid - g[i-1].uuid <= 1;
  const nextClose = i < g.length - 1 && g[i+1].uuid - g[i].uuid <= 1;
  if (!prevClose && !nextClose) lone++;
}
console.log(`gained uuids that are LONE (no neighbor within delta1): ${lone}/${g.length}`);
