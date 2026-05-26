// Continue header decode — bitmask, 0x24 hash analysis, 0x43f8 counter, player marker

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const saves = [
  { name: 'PRE',       path: path.join(BASE_R, 'save_arretium pre retrained..sav') },
  { name: 'QUEUE',     path: path.join(BASE_R, 'save_arretium queued retrain.sav') },
  { name: 'POST',      path: path.join(BASE_R, 'save_arretium retrained turn 2.sav') },
  { name: 'T4',        path: path.join(BASE_R, 'save_arretium turn 4.sav') },
  { name: 'Spain-T1',  path: path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav') },
  { name: 'Alex-T1',   path: path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1.sav') },
];

const bufs = saves.map(s => ({ name: s.name, buf: fs.readFileSync(s.path) }));

// ── Bitmask decode (fixed) ──
function decodeFactionBitmask(buf) {
  const nameLen = buf.readUInt16LE(0x3a);
  const nameEnd = 0x3c + nameLen * 2;
  const count = buf.readUInt32LE(nameEnd + 16);
  const bitmaskStart = nameEnd + 20;
  if (count > 100 || bitmaskStart + count > buf.length) return null;
  const bitmask = buf.slice(bitmaskStart, bitmaskStart + count);
  const bits = [];
  for (let i = 0; i < count; i++) {
    for (let bit = 0; bit < 8; bit++) {
      bits.push((bitmask[i] >> bit) & 1);
    }
  }
  return { count, start: bitmaskStart, hex: Array.from(bitmask).map(b => b.toString(16).padStart(2, '0')).join(''), bits };
}

console.log('=== Faction bitmask per save ===');
for (const b of bufs) {
  const bm = decodeFactionBitmask(b.buf);
  if (!bm) { console.log('  ' + b.name + ': bitmask decode failed'); continue; }
  console.log('  ' + b.name.padEnd(12) + ' bytes=' + bm.count + '  popcount=' + bm.bits.filter(b => b).length + '/' + bm.bits.length);
  console.log('              hex: ' + bm.hex);
  console.log('              bits: ' + bm.bits.slice(0, 32).join('') + (bm.bits.length > 32 ? '...' : ''));
  // Note which bit indices are SET
  const setIndices = [];
  for (let i = 0; i < bm.bits.length; i++) if (bm.bits[i]) setIndices.push(i);
  if (setIndices.length < 30) console.log('              set bits at indices: [' + setIndices.join(',') + ']');
}

// ── Decode Spain's 21 faction records — show ALL bytes for each, focusing on +29 (faction idx) ──
console.log('\n=== Spain T1: all 21 faction records (53 bytes each), highlighting varying bytes ===');
const spain = bufs.find(b => b.name === 'Spain-T1').buf;
const marker = Buffer.from([0x12, 0x34, 0xde, 0x0a]);
const firstMark = spain.indexOf(marker);
const factionCount = spain.readUInt32LE(firstMark + 4);

// Faction order (vanilla imperial_campaign, descr_strat order)
const FACTION_NAMES = [
  'romans_julii', 'romans_brutii', 'romans_scipii', 'romans_senate', 'egypt',
  'seleucid', 'carthage', 'parthia', 'gauls', 'germania',
  'britons', 'greek_cities', 'macedon', 'pontus', 'armenia',
  'dacia', 'thrace', 'numidia', 'spain', 'scythia', 'slave'
];

console.log('Format: rec_index faction_name | bytes (only showing positions 8..52)');
for (let i = 0; i < factionCount; i++) {
  const off = firstMark + i * 53;
  const bytes = Array.from(spain.slice(off + 8, off + 53)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log('  ' + i.toString().padStart(2) + ' ' + (FACTION_NAMES[i] || '?').padEnd(15) + ' ' + bytes);
}

// Highlight: byte +29 in 21 records — match faction_index?
console.log('\nByte +29 of each record (faction index hypothesis):');
for (let i = 0; i < factionCount; i++) {
  const off = firstMark + i * 53;
  const v = spain[off + 29];
  const matchesIdx = v === i ? 'matches idx' : (v === 21 ? 'is SLAVE/merged' : 'mismatch (=' + v + ')');
  console.log('  rec ' + i.toString().padStart(2) + ' (' + (FACTION_NAMES[i] || '?').padEnd(15) + '): +29=' + v.toString().padStart(2) + ' ' + matchesIdx);
}

// ── 0x24-0x2f 12-byte hash analysis ──
console.log('\n\n=== 0x24-0x2f 12-byte hash — does it equal SHA1[0..12] / MD5[0..12] / CRC32x3 of something? ===');
// Compare PRE/QUEUE: only 200 bytes differ between them. Does the 12-byte hash change?
const pre = bufs.find(b => b.name === 'PRE').buf;
const queue = bufs.find(b => b.name === 'QUEUE').buf;
const preHash = pre.slice(0x24, 0x30);
const queueHash = queue.slice(0x24, 0x30);
console.log('PRE hash:   ' + Array.from(preHash).map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log('QUEUE hash: ' + Array.from(queueHash).map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log('Same? ' + preHash.equals(queueHash));

// Compare T4 vs Spain-T1 (different campaigns):
const t4 = bufs.find(b => b.name === 'T4').buf;
console.log('T4 hash:    ' + Array.from(t4.slice(0x24, 0x30)).map(b => b.toString(16).padStart(2, '0')).join(' '));
console.log('Spain hash: ' + Array.from(spain.slice(0x24, 0x30)).map(b => b.toString(16).padStart(2, '0')).join(' '));

// Look for the FIRST 4 bytes of the hash separately — could be 3 distinct CRC32s
console.log('\nHash split as 3 x u32 LE:');
for (const b of bufs) {
  const a = b.buf.readUInt32LE(0x24).toString(16).padStart(8, '0');
  const cc = b.buf.readUInt32LE(0x28).toString(16).padStart(8, '0');
  const d = b.buf.readUInt32LE(0x2c).toString(16).padStart(8, '0');
  console.log('  ' + b.name.padEnd(12) + ' ' + a + ' ' + cc + ' ' + d);
}

// ── 0x43f8 counter ──
console.log('\n\n=== 0x43f8 counter — what does it actually count? ===');
console.log('All saves with action descriptions:');
const fileActions = {
  'PRE':  'baseline (post-T1, retrain not queued)',
  'QUEUE': 'retrain queued (1 player action)',
  'POST': 'retrain completed, T2 started (end-turn + many AI actions)',
  'T2q':  'new unit recruit queued (1 player action)',
  'T3':   'T3 started (full end-turn)',
  'T4':   'T4 started (full end-turn)',
};
for (const b of bufs) {
  const v = b.buf.readUInt32LE(0x43f8);
  console.log('  ' + b.name.padEnd(12) + ' value=' + v.toString().padStart(8) + '  action: ' + (fileActions[b.name] || 'other'));
}
