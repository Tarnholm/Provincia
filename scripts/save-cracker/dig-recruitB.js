// Zoom into the −18 byte structural delta. shift was 0 at 0xf84500 and −18 at 0xf84700.
// So the delta happens in [0xf84500..0xf84700]. Look at exact bytes.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));

// Find common prefix from a starting offset (within window)
function commonPrefix(a, b, aOff, bOff, limit) {
  let i = 0;
  while (i < limit && a[aOff+i] === b[bOff+i]) i++;
  return i;
}

// Walk byte-by-byte; we expect a clean run from 0xf84500 onwards, then divergence
// at the queue location, then re-alignment at +(-18) shift.

let ai = 0xf84500, bi = 0xf84500;
const pre = commonPrefix(A, B, ai, bi, 0x800);
console.log(`From 0x${ai.toString(16)}: common prefix length = ${pre}`);
console.log(`Divergence at A=0x${(ai+pre).toString(16)} B=0x${(bi+pre).toString(16)}`);

// Now at the divergence point, we expect a deleted region in A.
// Show 64 bytes from each
const dvA = ai + pre, dvB = bi + pre;
console.log(`\nA at 0x${dvA.toString(16)}:`);
console.log('  ' + A.slice(dvA, dvA + 64).toString('hex').match(/.{2}/g).join(' '));
console.log(`B at 0x${dvB.toString(16)}:`);
console.log('  ' + B.slice(dvB, dvB + 64).toString('hex').match(/.{2}/g).join(' '));

// Try various deletion sizes for A: A[dvA + N] should re-align with B[dvB]
console.log('\nTrying deletion sizes (A is longer by N):');
for (let n = 1; n < 100; n++) {
  const matchAfter = commonPrefix(A, B, dvA + n, dvB, 0x100);
  if (matchAfter >= 64) {
    console.log(`  N=${n}: matches for ${matchAfter} bytes after the deletion`);
    // Show the deleted region in A
    console.log(`    Deleted region in A [0x${dvA.toString(16)} .. 0x${(dvA+n).toString(16)}):`);
    console.log(`    ${A.slice(dvA, dvA+n).toString('hex')}`);
    console.log(`    As ASCII: "${A.slice(dvA, dvA+n).toString('latin1').replace(/[^\x20-\x7e]/g, '.')}"`);
    break;
  }
}

// Maybe both have inserts (replace, not delete). Try various sizes for both.
console.log('\nTrying both-side replace:');
for (let na = 0; na <= 100; na++) {
  for (let nb = 0; nb <= 100; nb++) {
    if (na - nb !== 18) continue;
    const m = commonPrefix(A, B, dvA + na, dvB + nb, 0x100);
    if (m >= 64) {
      console.log(`  remove ${na} from A, ${nb} from B: matches for ${m} bytes after`);
      console.log(`    A removed: ${A.slice(dvA, dvA+na).toString('hex')}`);
      console.log(`    B removed: ${B.slice(dvB, dvB+nb).toString('hex')}`);
      break;
    }
  }
}
