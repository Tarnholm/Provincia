// Session 23: hash blob inspection #2 — the first 2KB at 0x1f43000 looks like 9-byte soldier records.
// Verify: is the "hash blob" actually more per-soldier records (continuation of field-army block)?
// Also: locate where the actual high-entropy region starts and ends, and where the structure breaks.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

// (a) Check 9-byte stride from 0x1f43000
console.log(`=== 9-byte stride check at 0x1f43000..0x1f43090 ===`);
for (let i = 0; i < 16; i++) {
  const p = 0x1f43000 + i * 9;
  const s = buf.subarray(p, p + 9);
  console.log(`  rec[${i}] @ 0x${p.toString(16)}: ${s.toString('hex')}`);
}

// (b) Look at "gap" between 0x1f42cb6 (field army end) and 0x1f43000 (hash blob start per s14)
console.log(`\n=== Bytes 0x1f42cb6..0x1f43000 (842B gap) ===`);
for (let p = 0x1f42cb0; p < 0x1f43010; p += 16) {
  const slice = buf.subarray(p, p + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  console.log(`  0x${p.toString(16)}: ${hex}`);
}

// (c) Cross-reference: take the 122 unit-record settlement hashes (8B hash + 8B uuid) and see
// if any appear in the high-entropy 0x1f43800..0x1f44400 region.
console.log(`\n=== Cross-reference: collect field-army (8B hash + 8B uuid) pairs ===`);
const tailStart = 0x1f10c72;
const tailEnd   = 0x1f42cb6;

const records = [];
for (let p = tailStart; p + 2 < tailEnd; p++) {
  const len = buf.readUInt16LE(p);
  if (len < 4 || len > 50) continue;
  if (p + 2 + len > tailEnd) continue;
  const s = buf.slice(p + 2, p + 2 + len).toString('ascii');
  if (!/^[a-z][a-z ]+[a-z]\0?$/.test(s)) continue;
  records.push({ off: p, len, name: s.replace(/\0$/, '') });
}

console.log(`  ${records.length} unit records detected.`);

// Each record: after [u16 nameLen][ASCII name][0xee 1B], we expect 8B hash + 8B uuid
const hashes = [];
const uuids = [];
for (const r of records) {
  const after = r.off + 2 + r.len;
  // sanity check the 0xee marker
  if (buf[after] !== 0xee) continue;
  const hash = buf.subarray(after + 1, after + 9);
  const uuid = buf.subarray(after + 9, after + 17);
  hashes.push({ name: r.name, off: after + 1, bytes: hash });
  uuids.push({ name: r.name, off: after + 9, bytes: uuid });
}
console.log(`  ${hashes.length} (hash, uuid) pairs extracted.`);
console.log(`  Sample hash[0] '${hashes[0]?.name}': ${hashes[0]?.bytes.toString('hex')}`);
console.log(`  Sample uuid[0] '${uuids[0]?.name}': ${uuids[0]?.bytes.toString('hex')}`);

// Search the hash blob 0x1f43000..0x1f47abd for any of these 8-byte hashes
const blobStart = 0x1f43000, blobEnd = 0x1f47abd;
let hashMatches = 0, uuidMatches = 0;
const matchedNames = new Set();
const matchedOffsets = [];

for (const h of hashes) {
  for (let p = blobStart; p < blobEnd - 8; p++) {
    let match = true;
    for (let j = 0; j < 8; j++) if (buf[p + j] !== h.bytes[j]) { match = false; break; }
    if (match) {
      hashMatches++;
      matchedNames.add(h.name);
      matchedOffsets.push({ kind: 'hash', name: h.name, blobOff: p, recordOff: h.off });
      break;
    }
  }
}

for (const u of uuids) {
  for (let p = blobStart; p < blobEnd - 8; p++) {
    let match = true;
    for (let j = 0; j < 8; j++) if (buf[p + j] !== u.bytes[j]) { match = false; break; }
    if (match) {
      uuidMatches++;
      matchedOffsets.push({ kind: 'uuid', name: u.name, blobOff: p, recordOff: u.off });
      break;
    }
  }
}

console.log(`\n  Hash matches in hash blob: ${hashMatches}/${hashes.length}`);
console.log(`  UUID matches in hash blob: ${uuidMatches}/${uuids.length}`);
console.log(`  Distinct unit names with hash match: ${matchedNames.size}`);
if (matchedOffsets.length > 0) {
  console.log(`  First 10 matches:`);
  for (const m of matchedOffsets.slice(0, 10)) {
    console.log(`    ${m.kind} '${m.name}' at blob 0x${m.blobOff.toString(16)} (record was at 0x${m.recordOff.toString(16)})`);
  }
}
