// Session 32 step 2: find the shift point (10 bytes deleted) and properly diff before/after.
// File B is 10 bytes shorter than A. There must be a region where A has 10 extra bytes;
// after that point, B's data is shifted left 10. Find that shift point.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

// Strategy: find pairs of long runs of bytes near the end that match between A and B.
// Walk from end backward: find the first divergence.
let aTail = a.length - 1;
let bTail = b.length - 1;
let lastEqual = aTail;
while (aTail >= 0 && bTail >= 0 && a[aTail] === b[bTail]) {
  aTail--; bTail--;
}
console.log(`Tail-aligned last diff offsets: A=0x${aTail.toString(16)} (${aTail}), B=0x${bTail.toString(16)} (${bTail})`);
console.log(`Matching tail length: ${a.length - 1 - aTail} bytes`);
// Note: a.length-1 - aTail bytes match at the tail at shift -10 (a-b = 10).
// So the shift point is somewhere; everything after aTail+1 in A === everything after bTail+1 in B.

// Now walk forward from start: find where leading diff begins.
let aHead = 0, bHead = 0;
while (aHead < a.length && bHead < b.length && a[aHead] === b[bHead]) {
  aHead++; bHead++;
}
console.log(`Head-aligned first diff offsets: A=0x${aHead.toString(16)} (${aHead}), B=0x${bHead.toString(16)} (${bHead})`);

// The "changed region" is: A[aHead..aTail] vs B[bHead..bTail].
const aChangedLen = aTail - aHead + 1;
const bChangedLen = bTail - bHead + 1;
console.log(`Changed region: A=${aChangedLen} bytes (${aHead.toString(16)}..${aTail.toString(16)}), B=${bChangedLen} bytes (${bHead.toString(16)}..${bTail.toString(16)})`);
console.log(`Size delta inside changed region: ${bChangedLen - aChangedLen}`);

// Within the changed region, look for INTERIOR-aligned anchors.
// Try a simple approach: divide region into rolling windows, find longest exact match.
// But our changed region is bounded — print hex dumps and key snippets.

function hex(buf, start, len) {
  const lines = [];
  for (let i = 0; i < len; i += 16) {
    const off = start + i;
    const slice = buf.slice(off, Math.min(off + 16, start + len));
    const hexs = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const asciis = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    lines.push(`  ${off.toString(16).padStart(8, '0')}: ${hexs.padEnd(48)} ${asciis}`);
  }
  return lines.join('\n');
}

console.log(`\n=== A around aHead-32..aHead+128 ===`);
console.log(hex(a, Math.max(0, aHead - 32), 32 + Math.min(128, aChangedLen)));
console.log(`\n=== B around bHead-32..bHead+128 ===`);
console.log(hex(b, Math.max(0, bHead - 32), 32 + Math.min(128, bChangedLen)));

console.log(`\n=== A around aTail-128..aTail+32 ===`);
console.log(hex(a, Math.max(0, aTail - 128), Math.min(128, aChangedLen) + 32));
console.log(`\n=== B around bTail-128..bTail+32 ===`);
console.log(hex(b, Math.max(0, bTail - 128), Math.min(128, bChangedLen) + 32));
