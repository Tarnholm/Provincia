// Decode the missing diplomatic records at peace 0xfc886 and 0xfc8bd.
// These bytes hold the Spain↔Carthage diplomatic relation since they
// vanish when war is declared.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

console.log('=== Wide context dump: peace 0xfc880..0xfca80 (the diplomatic record zone) ===');
function dump(buf, off, len, label) {
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  ' + label + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}
dump(peace, 0xfc880 - 32, 512, 'peace');

// Step back to find the record START. Walk backwards from 0xfc886 looking
// for either:
//   - a section self-pointer (u32 == offset)
//   - a 0xffffffff terminator (suggesting end of prev record)
console.log('\n=== Backward walk from 0xfc880 to find record start ===');
for (let scan = 0xfc880; scan > 0xfc800; scan--) {
  // Check for self-pointer
  if (scan + 4 <= peace.length && peace.readUInt32LE(scan) === scan) {
    console.log('  Self-pointer at 0x' + scan.toString(16));
  }
}

// Walk forward from peace 0xfc7e0 (~160 bytes before) and look at structure
console.log('\n=== Forward dump from peace 0xfc7e0 (before record) ===');
dump(peace, 0xfc7e0, 320, 'peace');

// And compare what's at the EQUIVALENT region in war (shifted by ~+0x4000)
console.log('\n=== Equivalent region in WAR save (shifted +0x4000 = 0x1007e0..) ===');
dump(war, 0x1007e0, 320, 'war');

// The records around peace 0xfc886/0xfc8bd should be MISSING in war.
// Let me try to align peace[0xfc750..0xfca50] (a wider window) and find
// the EXACT byte sequence in peace that has no counterpart in war.

// Approach: walk forward from a known synced position. The previous
// card_captain in peace was at 0xfca3d (mapped to war 0x100a3d, shift
// +0x4000). The peace card at 0xfb758 maps to war 0xff511 (shift +0x3db9).
// Between them: shift changed by +0x247 = 583 bytes inserted.
// AND peace 0xfc886 is MISSING in war.
// So the structure is:
//   peace [0xfb758..0xfc886-?]  matches war [0xff511..0xff511+(0xfc886-0xfb758)]
//   peace [0xfc886..end_of_missing_record]  GONE in war
//   peace [end_of_missing_record..0xfca3d]  matches war [some_position..0x100a3d]

// Need to find WHERE in peace [0xfb758..0xfc886+N] the divergence from war starts
// and where (if anywhere) it resyncs at the next card.

const PEACE_START = 0xfb758;  // previous card_captain
const WAR_START = 0xff511;    // corresponding war position
const PEACE_END = 0xfca3d;    // next card_captain after the missing one
const WAR_END = 0x100a3d;     // corresponding war position

console.log('\n=== Pre-divergence: align peace 0xfb758 vs war 0xff511 (first 32 bytes) ===');
console.log('peace:');
dump(peace, PEACE_START, 64, '  p');
console.log('war:');
dump(war, WAR_START, 64, '  w');

// Walk forward and find where they diverge
let div = -1;
for (let i = 0; i < (PEACE_END - PEACE_START); i++) {
  if (peace[PEACE_START + i] !== war[WAR_START + i]) {
    div = i;
    break;
  }
}
console.log('\nDivergence offset from PEACE_START: ' + div + ' (0x' + div.toString(16) + ')');
console.log('Divergence absolute position in peace: 0x' + (PEACE_START + div).toString(16));

// Walk backward from peace 0xfca3d to find where they re-sync
let reConverge = -1;
for (let i = 0; i < (PEACE_END - PEACE_START); i++) {
  // Compare peace[PEACE_END - i] to war[WAR_END - i]
  if (peace[PEACE_END - i] !== war[WAR_END - i]) {
    reConverge = i;
    break;
  }
}
console.log('Last byte that DIFFERS in peace (counting back from PEACE_END): 0x' + (PEACE_END - reConverge).toString(16));

// So the missing region in peace is [PEACE_START+div .. PEACE_END-reConverge]
const missingStart = PEACE_START + div;
const missingEnd = PEACE_END - reConverge;
console.log('\n*** Missing region in peace: 0x' + missingStart.toString(16) + ' .. 0x' + missingEnd.toString(16) + '  (' + (missingEnd - missingStart) + ' bytes) ***');

console.log('\n=== FULL dump of the missing region (this is the Spain↔Carthage diplomatic record) ===');
dump(peace, missingStart, missingEnd - missingStart, 'peace');

// Also dump what's at the equivalent war position (should match before/after the missing region)
const warEquivStart = WAR_START + div;
console.log('\n=== Bytes in war at the corresponding offset (' + (missingEnd - missingStart) + ' bytes after first divergence) — what flowed in instead ===');
dump(war, warEquivStart, missingEnd - missingStart, 'war');
