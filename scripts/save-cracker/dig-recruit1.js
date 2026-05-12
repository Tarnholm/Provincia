// Session 36, probe #1: top-level size/byte diff of the four save_*.2 files.
// Goal: orient with the magnitude of changes across the corpus.
const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const files = ['save_1.2.sav', 'save_2.2.sav', 'save_3.2.sav', 'save_4.2.sav'];
const bufs = files.map(f => fs.readFileSync(path.join(SAVE_DIR, f)));

for (const [i, b] of bufs.entries()) {
  console.log(`${files[i]}: ${b.length} bytes (0x${b.length.toString(16)})`);
}
console.log();
for (let i = 1; i < bufs.length; i++) {
  const a = bufs[i-1], b = bufs[i];
  console.log(`Δ ${files[i-1]} -> ${files[i]}: ${b.length - a.length} bytes`);
  let pre = 0;
  const lim = Math.min(a.length, b.length);
  while (pre < lim && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < lim - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  console.log(`   common prefix: ${pre} (0x${pre.toString(16)}); common suffix: ${suf} (0x${suf.toString(16)})`);
  console.log(`   middle window A: 0x${pre.toString(16)} .. 0x${(a.length - suf).toString(16)} = ${a.length - suf - pre} B`);
  console.log(`   middle window B: 0x${pre.toString(16)} .. 0x${(b.length - suf).toString(16)} = ${b.length - suf - pre} B`);
}
