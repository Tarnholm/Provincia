// Find which block index corresponds to Spain by looking for the
// "current player faction" identifier in the save header.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

// First, look for a u32 in the header (first 0x10000 bytes) that's BETWEEN
// 0 and 20 (a faction-index range), is NOT a turn counter or year value,
// and is the SAME in both peace and war saves.
console.log('=== u32 values 0..20 in header zone, same in both saves ===');
const candidates = [];
for (let i = 0; i < 0x10000; i += 4) {
  const p = peace.readUInt32LE(i);
  const w = war.readUInt32LE(i);
  if (p === w && p >= 0 && p <= 20) {
    candidates.push({ off: i, val: p });
  }
}
// Filter: print only positions where value > 0 (most-likely candidates;
// 0 is too generic)
const realCandidates = candidates.filter(c => c.val > 0 && c.val !== 1 && c.val !== 2 && c.val !== 3);
console.log('Candidates (value 4-20, same in both saves):', realCandidates.length);
for (const c of realCandidates.slice(0, 50)) {
  console.log('  u32@0x' + c.off.toString(16) + ' = ' + c.val);
}

// Also check known faction-counts for player-faction-index hypothesis
// If Spain is at descr_strat index 18 (in standard vanilla order), look for u32=18
const want18 = candidates.filter(c => c.val === 18);
console.log('\nu32=18 candidates: ' + want18.length);
for (const c of want18.slice(0, 20)) console.log('  0x' + c.off.toString(16));

// Look for u32=4 (Spain at index 4 in some orderings)
const want4 = candidates.filter(c => c.val === 4);
console.log('\nu32=4 candidates: ' + want4.length);

// Maybe player faction is a UUID (full u32, not a small int). The first
// u32 in the file that's > 0x1000000 and < 0xffffffff might be it.
// Or the campaign-name pstr16 (at 0x3a in Remastered) is followed by
// faction-related fields.

// Read 32 bytes after campaign-name pstr16
const campLen = peace.readUInt16LE(0x3a);
const afterCamp = 0x3c + campLen * 2;
console.log('\nCampaign name "' + (function() {
  const chars = [];
  for (let i = 0; i < campLen; i++) chars.push(String.fromCharCode(peace.readUInt16LE(0x3c + i * 2)));
  return chars.join('');
})() + '" ends at 0x' + afterCamp.toString(16));
console.log('Bytes after campaign name (32 bytes):');
const after = peace.subarray(afterCamp, afterCamp + 64);
for (let o = 0; o < 64; o += 16) {
  const slice = after.subarray(o, Math.min(o + 16, 64));
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  0x' + (afterCamp + o).toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
}

// Also: try reading the next u32 after the campaign name (looking for player-faction-index)
console.log('\nu32 values after campaign name (16 candidates):');
for (let i = 0; i < 16; i++) {
  const off = afterCamp + i * 4;
  if (off + 4 > peace.length) break;
  const v = peace.readUInt32LE(off);
  console.log('  u32@0x' + off.toString(16) + ' = ' + v + ' (0x' + v.toString(16) + ')');
}
