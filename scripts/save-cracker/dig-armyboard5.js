// dig-armyboard5.js — analyze the 138B explanation.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_7.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_8.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

console.log('A @ 0x02110e30 (256B):');
console.log(A.subarray(0x02110e30, 0x02110f30).toString('hex'));
console.log('\nB @ 0x02110e30 (256B):');
console.log(B.subarray(0x02110e30, 0x02110f30).toString('hex'));

// Did the previous events leave us mid-stream? The reported events were:
//   ins 32B @ 0x01504e96
//   del 5B @ 0x01535779
//   ins 5B @ 0x0153586c
//   ins 4B @ 0x015358ba
//   ins 12B @ 0x01f46677
//   ins 90B @ 0x01f48519
//   del 138B @ 0x02110e42
// Sum ins = 32 + 5 + 4 + 12 + 90 = 143
// Sum del = 5 + 138 = 143  → net=0
// But file delta is +138. So something is off in our diff.

// Let me check the actual file sizes and verify a single trailing offset
console.log(`A.length=${A.length}  B.length=${B.length}  Δ=${B.length - A.length}`);

// Check whether the file tail matches at offset shift = +138 (B is +138)
let shift138_end = 0;
for (let i = 1; i <= 50000; i++) {
  if (A[A.length - i] === B[B.length - i]) shift138_end++;
  else break;
}
console.log(`Tail bytes that match WITHOUT shift: ${shift138_end}`);

let shift_zero = 0;
for (let i = 1; i <= 50000; i++) {
  const aIdx = A.length - i;
  const bIdx = B.length - i;
  if (A[aIdx] === B[bIdx]) shift_zero++;
  else break;
}
console.log(`Last byte: A[end]=${A[A.length-1]} B[end]=${B[B.length-1]}`);

// Check beginning
let headMatch = 0;
for (let i = 0; i < 50000; i++) {
  if (A[i] === B[i]) headMatch++;
  else break;
}
console.log(`Head bytes matching: ${headMatch}`);

// So if tail matches a lot of bytes WITHOUT shift, then the +138 inserts are
// fully consumed by an EARLIER offset (most likely structural inserts within ≤ 0x02110e42 range)
// In that case the file lengths match shifted by 0 — but they differ by 138B...
// CONCLUSION: the +138B insert happens at the very end of the file (after 0x02110e42).
// Let me look at the last 500B of each
console.log('\nA last 256B:');
console.log(A.subarray(A.length - 256).toString('hex'));
console.log('\nB last 256B:');
console.log(B.subarray(B.length - 256).toString('hex'));

// Actually let me find where they DIVERGE from the end.
let lastA = A.length, lastB = B.length;
while (lastA > 0 && lastB > 0 && A[lastA - 1] === B[lastB - 1]) {
  lastA--; lastB--;
}
console.log(`From end: divergence at A=${hex(lastA)} B=${hex(lastB)}  diff=${lastB - lastA}`);

// And from start
let firstA = 0, firstB = 0;
while (firstA < A.length && firstB < B.length && A[firstA] === B[firstB]) {
  firstA++; firstB++;
}
console.log(`From start: first divergence A=B=${hex(firstA)}`);

// Differing window
console.log(`Diff window: A[${hex(firstA)}..${hex(lastA)}] (${lastA - firstA}B) vs B[${hex(firstB)}..${hex(lastB)}] (${lastB - firstB}B)`);
