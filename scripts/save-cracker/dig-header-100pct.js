// Decode the remaining header unknowns:
//   1. Per-faction 53-byte record content (which bytes = color / diff / capital / AI flag)
//   2. Faction bitmask bit-to-faction mapping
//   3. 0x24-0x2f 12-byte hash (algorithm / inputs)
//   4. 0x43f8 4-byte counter semantics

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const saves = [
  { name: 'PRE',       path: path.join(BASE_R, 'save_arretium pre retrained..sav') },
  { name: 'QUEUE',     path: path.join(BASE_R, 'save_arretium queued retrain.sav') },
  { name: 'POST',      path: path.join(BASE_R, 'save_arretium retrained turn 2.sav') },
  { name: 'T2q',       path: path.join(BASE_R, 'save_arretium turn 2 new unit queued.sav') },
  { name: 'T3',        path: path.join(BASE_R, 'save_arretium turn 3.sav') },
  { name: 'T4',        path: path.join(BASE_R, 'save_arretium turn 4.sav') },
  { name: 'Spain-T1',  path: path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav') },
  { name: 'Spain-T1s', path: path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1 move spy.sav') },
  { name: 'Spain-T2',  path: path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav') },
  { name: 'Alex-T1',   path: path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1.sav') },
  { name: 'Alex-T11',  path: path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav') },
];

const bufs = saves.map(s => ({ name: s.name, buf: fs.readFileSync(s.path) }));

// ── PART 1: 53-byte faction record decode ──
console.log('=== PART 1: 53-byte faction records — per-byte variability ===');

const marker = Buffer.from([0x12, 0x34, 0xde, 0x0a]);

function getFactionRecords(buf) {
  // First marker position
  const first = buf.indexOf(marker);
  // Faction count (u32 after the marker, at +4)
  const count = buf.readUInt32LE(first + 4);
  const records = [];
  for (let i = 0; i < count; i++) {
    const off = first + i * 53;
    if (buf[off] !== 0x12 || buf[off+1] !== 0x34 || buf[off+2] !== 0xde || buf[off+3] !== 0x0a) {
      break; // marker mismatch, abort
    }
    records.push(off);
  }
  return { first, count, records };
}

// Show the per-byte VARIABILITY across the 21 vanilla factions in Spain-T1.
const spain = bufs.find(b => b.name === 'Spain-T1').buf;
const spainRecs = getFactionRecords(spain);
console.log('Spain-T1 has ' + spainRecs.count + ' faction records starting at 0x' + spainRecs.first.toString(16));

// For each byte position (0-52), show the value distribution across all records.
console.log('\nPer-byte values across 21 Spain faction records:');
for (let pos = 0; pos < 53; pos++) {
  const vals = spainRecs.records.map(off => spain[off + pos]);
  const unique = [...new Set(vals)].sort((a, b) => a - b);
  if (unique.length === 1) {
    // Constant — skip
    continue;
  }
  // Show the values, marking variance
  console.log('  +' + pos.toString().padStart(2) + ': [' +
    vals.map(v => '0x' + v.toString(16).padStart(2, '0')).join(',') + '] (unique=' + unique.length + ')');
}

// ── PART 2: Faction bitmask ──
console.log('\n\n=== PART 2: Faction bitmask decode ===');
function decodeFactionBitmask(buf) {
  // Find first 12-34-de-0a marker
  const first = buf.indexOf(marker);
  // Walk backwards to find the bitmask
  // Structure: [u32 byte_count][N bytes bitmask][...stuff...][u32 0x499602d2 marker?][...][12 34 de 0a]
  // Try to find the bitmask: u32 just after name_end+12
  const nameLen = buf.readUInt16LE(0x3a);
  const nameEnd = 0x3c + nameLen * 2;
  // The u32 at name_end + 16 should be the bitmask byte count
  const count = buf.readUInt32LE(nameEnd + 16);
  const bitmaskStart = nameEnd + 20;
  const bitmaskEnd = bitmaskStart + count;
  const bitmask = buf.slice(bitmaskStart, bitmaskEnd);
  return { count, start: bitmaskStart, bitmask: Array.from(bitmask), bits: Array.from(bitmask).flatMap(b => [0,1,2,3,4,5,6,7].map(i => (b >> i) & 1)) };
}

for (const b of bufs.slice(0, 6).concat([bufs.find(s => s.name === 'Spain-T1'), bufs.find(s => s.name === 'Alex-T1')])) {
  const bm = decodeFactionBitmask(b.buf);
  console.log('  ' + b.name.padEnd(12) + ' bitmask: ' + bm.count + ' bytes @ 0x' + bm.start.toString(16) +
    ' bits=[' + bm.bits.slice(0, 32).join('') + '...] (popcount=' + bm.bits.filter(b => b).length + ')');
}

// ── PART 3: 0x24-0x2f 12-byte hash ──
console.log('\n\n=== PART 3: 0x24-0x2f 12-byte hash ===');
console.log('Hash bytes per save:');
for (const b of bufs) {
  const hash = Array.from(b.buf.slice(0x24, 0x30)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log('  ' + b.name.padEnd(12) + ': ' + hash);
}

// Compare campaigns with same name across different sessions:
// Arretium saves and Spain saves are both imperial_campaign — different campaign UUID?
// Test: is the hash purely a function of campaign UUID, or also content?
console.log('\nNote: PRE/QUEUE/POST/T2q/T3/T4 are all the same campaign (same UUID @0x04).');
console.log('If hash varies among them, it must depend on save content.');
const arretiumHashes = new Set();
for (const b of bufs.slice(0, 6)) {
  const hashHex = Array.from(b.buf.slice(0x24, 0x30)).map(x => x.toString(16).padStart(2, '0')).join('');
  arretiumHashes.add(hashHex);
}
console.log('Unique hashes in 6 Arretium saves: ' + arretiumHashes.size);

// ── PART 4: 0x43f8 counter — what predicts it? ──
console.log('\n\n=== PART 4: 0x43f8 counter ===');
for (const b of bufs.slice(0, 6)) {
  const v43f8 = b.buf.readUInt32LE(0x43f8);
  // Also try a few neighboring offsets to see if value belongs there
  const v43fc = b.buf.readUInt16LE(0x43fc);
  const v43fe = Array.from(b.buf.slice(0x43fe, 0x4408)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log('  ' + b.name.padEnd(12) +
    ' size=' + b.buf.length.toString().padStart(9) +
    '  0x43f8=' + v43f8.toString().padStart(8) +
    '  0x43fc=' + v43fc + ' (path-len)' +
    '  next bytes: ' + v43fe);
}

// Test alternative interpretation: maybe 0x43f8 is two u16s — could be (something, something_else)
console.log('\n0x43f8 as two u16s:');
for (const b of bufs.slice(0, 6)) {
  const lo = b.buf.readUInt16LE(0x43f8);
  const hi = b.buf.readUInt16LE(0x43fa);
  console.log('  ' + b.name + ' lo=' + lo + '  hi=' + hi);
}

// ── PART 5: Look for player faction in faction records ──
// In RIS imperial, the player is Spain → expected to be faction index 18 per memory.
// Check if there's a "is_player" bit set somewhere in record 18.
console.log('\n\n=== PART 5: Compare faction-record content across campaigns to identify the PLAYER ===');
const spainFC = getFactionRecords(spain);
console.log('Spain-T1 (player = Spain, descr_strat order — try indices 17, 18, 19):');
for (const i of [0, 5, 10, 15, 17, 18, 19, 20]) {
  if (i >= spainFC.records.length) continue;
  const off = spainFC.records[i];
  const bytes = Array.from(spain.slice(off, off + 53)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log('  rec ' + i.toString().padStart(2) + ' @0x' + off.toString(16) + ': ' + bytes);
}

const alex = bufs.find(b => b.name === 'Alex-T1').buf;
const alexFC = getFactionRecords(alex);
console.log('\nAlex-T1 (player = Macedon, faction index = 11 in descr_strat):');
for (const i of [0, 5, 10, 11, 12, 15, 20]) {
  if (i >= alexFC.records.length) continue;
  const off = alexFC.records[i];
  const bytes = Array.from(alex.slice(off, off + 53)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log('  rec ' + i.toString().padStart(2) + ' @0x' + off.toString(16) + ': ' + bytes);
}
