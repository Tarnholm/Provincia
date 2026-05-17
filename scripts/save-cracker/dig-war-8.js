// Full decode of the eliminated Numidian character record at peace 0xfc861.
// This is the diplomatic-relation-tied record that disappears when Spain
// declared war on Carthage (Numidia's ally).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
const war = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 besiged corduba.sav'));

function dump(buf, off, len, label) {
  const lines = [];
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    lines.push('  ' + label + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
  return lines.join('\n');
}

// The card path is at 0xfc861. The card strlen prefix (u16=49) is at 0xfc85f.
// Walk backward to find the record START. The record format from earlier
// findings: leading zeros for padding, then maybe a self-pointer or section
// header. Let me look for the previous "captain banners/captain_card_" string
// boundaries.

// Look at the equivalent in the war save — the bytes that should map here
// shifted by +0x4000 would be at 0xfc861 + 0x4000 = 0x100861. The next
// numidia card in war is at 0x100a18 which is 0x1b7 LATER. So war 0x100861
// has the REPLACEMENT content where peace 0xfc861 was a numidia captain.

console.log('=== Peace 0xfc740..0xfcc00 (wide context around eliminated record) ===');
console.log(dump(peace, 0xfc740, 0xfcc00 - 0xfc740, 'peace'));

console.log('\n=== Equivalent war 0x100740..0x100c00 (shifted +0x4000) ===');
console.log(dump(war, 0x100740, 0x100c00 - 0x100740, 'war'));

// Walk forward through peace, finding section boundaries. A typical
// character record has:
//   - faction tag + culture
//   - portrait paths
//   - position (X, Y)
//   - movement points
//   - traits
//   - ancillaries
// Look for the START of THIS record. Most likely: previous record's end
// is a `ff ff ff ff` terminator.

// Scan backward from 0xfc861 looking for `ff ff ff ff` boundaries
console.log('\n=== Backward scan for record boundary markers ===');
for (let p = 0xfc861; p > 0xfc500; p--) {
  if (peace[p] === 0xff && peace[p+1] === 0xff && peace[p+2] === 0xff && peace[p+3] === 0xff) {
    console.log('  0xffffffff at 0x' + p.toString(16) + ' (' + (0xfc861 - p) + ' bytes before card path)');
    if (0xfc861 - p < 400) break;  // stop at the first reasonable boundary
  }
}

// Walk forward from 0xfc8c9 (end of portrait path) looking for record end
console.log('\n=== Forward scan for record end markers ===');
for (let p = 0xfc8c9; p < 0xfca18; p++) {
  if (peace[p] === 0xff && peace[p+1] === 0xff && peace[p+2] === 0xff && peace[p+3] === 0xff) {
    console.log('  0xffffffff at 0x' + p.toString(16) + ' (' + (p - 0xfc8c9) + ' bytes after portrait path)');
    if (p - 0xfc8c9 < 400) break;
  }
}

// Try to find where this character's record meets the NEXT character record.
// The next numidia card in peace is at 0xfca18. So the missing record's
// "ROW" extends from somewhere before 0xfc861 to somewhere before 0xfca18.

// Let me also count "carthage" within this range — if Carthage shows up
// inside the eliminated record's neighborhood, that's the smoking gun.
console.log('\n=== Search the missing region for diplomatic-state indicator UUIDs ===');
// First find all "carthage" instances in peace and check if any are in
// the missing region (between 0xfc861 and the matching next record).

// More direct: find the start of THIS character's record by looking for
// the section header. Records often start with a u32 self-pointer or
// a length prefix.
// In peace, going backward from 0xfc861, the previous non-zero byte
// sequence should hint at the prev record's terminator.

// Scan backward from 0xfc861 for the LAST non-zero byte
let lastNonZero = -1;
for (let p = 0xfc861 - 1; p > 0xfc861 - 0x200; p--) {
  if (peace[p] !== 0) {
    lastNonZero = p;
    break;
  }
}
console.log('Last non-zero before card path: 0x' + lastNonZero.toString(16) + ' (' + (0xfc861 - lastNonZero) + ' bytes back)');

// Look at structure between (last non-zero + 1) and the strlen prefix
console.log('\n=== Bytes between last non-zero and strlen prefix ===');
console.log(dump(peace, lastNonZero, 0xfc861 + 8 - lastNonZero, 'peace'));

// Try to find where the eliminated character's record START is by looking
// at the war save: what content comes BEFORE the next numidia card at
// war 0x100a18 (and is NOT present in peace before 0xfca18)?
// That content is the REPLACEMENT for the missing record.

// Specifically: peace 0xfc861's record was REMOVED, and in war's position
// 0x100861-onwards (which would have been the record), war has different
// content because the elimination shifted things.

// Strategy: align peace at 0xfca18 vs war at 0x100a18 (both NEXT numidia
// captain records). Walk backward identically — they should match until
// we hit the start of the eliminated record in peace.
console.log('\n=== Walk backward from peace 0xfca18 / war 0x100a18 (both same content) ===');
let pi = 0xfca18, wi = 0x100a18;
let backMatch = 0;
while (pi > 0 && wi > 0 && peace[pi - 1] === war[wi - 1]) {
  pi--; wi--;
  backMatch++;
  if (backMatch > 0x2000) break;
}
console.log('Backward match: ' + backMatch + ' bytes. Diverges at peace 0x' + (pi - 1).toString(16) + ' / war 0x' + (wi - 1).toString(16));

// The eliminated record ends at peace position pi (where backward walk stops)
// Walk forward from peace 0xfc861 + record + something
// Walk forward from peace just past the card path
console.log('\n=== Walk forward from peace 0xfc861 / war 0x100861 ===');
let pf = 0xfc861, wf = 0x100861;
let fwdMatch = 0;
while (pf < peace.length && wf < war.length && peace[pf] === war[wf]) {
  pf++; wf++;
  fwdMatch++;
  if (fwdMatch > 0x2000) break;
}
console.log('Forward match from 0xfc861: ' + fwdMatch + ' bytes. Diverges at peace 0x' + pf.toString(16) + ' / war 0x' + wf.toString(16));

// Walk backward from peace 0xfc861 / war 0x100861
let pb = 0xfc861, wb = 0x100861;
let bMatch = 0;
while (pb > 0 && wb > 0 && peace[pb - 1] === war[wb - 1]) {
  pb--; wb--;
  bMatch++;
  if (bMatch > 0x2000) break;
}
console.log('Backward match from 0xfc861: ' + bMatch + ' bytes. Diverges at peace 0x' + (pb - 1).toString(16) + ' / war 0x' + (wb - 1).toString(16));

// So the eliminated record is roughly peace [pb .. pi]. Let me extract it.
console.log('\n=== ELIMINATED RECORD: peace 0x' + pb.toString(16) + ' .. 0x' + pi.toString(16) + ' (' + (pi - pb) + ' bytes) ===');
console.log(dump(peace, pb, pi - pb, 'peace'));

// Also dump what war has in the same offset range
console.log('\n=== Corresponding war range: 0x' + wb.toString(16) + ' .. 0x' + wi.toString(16) + ' (' + (wi - wb) + ' bytes) ===');
console.log(dump(war, wb, wi - wb, 'war'));
