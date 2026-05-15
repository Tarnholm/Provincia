// Find full extent of T2 tile-grid. Start at 0xf913d, stride 267, count
// records by checking +96=166 invariant (which holds across both T1/T2).
const fs = require('fs');

const T1_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const T2_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 2 Start.sav';
const T1 = fs.readFileSync(T1_PATH);
const T2 = fs.readFileSync(T2_PATH);

const STRIDE = 267;

function countConsecutive(buf, start, label) {
  let n = 0;
  while (start + n * STRIDE + 100 < buf.length) {
    const v96 = buf.readUInt32LE(start + n * STRIDE + 96);
    if (v96 !== 166) break;
    n++;
  }
  console.log(`${label} from 0x${start.toString(16)}: ${n} records at +96=166`);
  return n;
}

// T1 sanity
countConsecutive(T1, 0xf8fd2, 'T1');
// T2
countConsecutive(T2, 0xf913d, 'T2');

// Also check the start: T2 starts at 0xf913d, T1 at 0xf8fd2 — delta = 363 bytes.
console.log(`\nT2_START - T1_START = ${0xf913d - 0xf8fd2} bytes = 0x${(0xf913d - 0xf8fd2).toString(16)}`);

// Now verify record 0 of T1 vs T2 has same structure at +0..+99 except for the
// version constants
console.log('\nField-by-field T1[0] vs T2[0] (offset 0..99):');
for (let off = 0; off < 100; off += 4) {
  const v1 = T1.readUInt32LE(0xf8fd2 + off);
  const v2 = T2.readUInt32LE(0xf913d + off);
  const match = v1 === v2 ? '==' : '!=';
  console.log(`  +${off}: T1=${v1}, T2=${v2} ${match}`);
}

// And record 1
console.log('\nField-by-field T1[1] vs T2[1]:');
for (let off = 0; off < 100; off += 4) {
  const v1 = T1.readUInt32LE(0xf8fd2 + STRIDE + off);
  const v2 = T2.readUInt32LE(0xf913d + STRIDE + off);
  const match = v1 === v2 ? '==' : '!=';
  if (v1 !== 0 || v2 !== 0) console.log(`  +${off}: T1=${v1}, T2=${v2} ${match}`);
}
