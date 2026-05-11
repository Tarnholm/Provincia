// dig-gap3.js — verify zero-fill claim at byte level + characterize the non-zero tail.
const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const START = 0x633bb3;
const END   = 0xf88637;

// 1) Find exact run of zeros at the start
let zStart = START;
let zEnd = START;
while (zEnd < END && buf[zEnd] === 0) zEnd++;
console.log(`Initial zero run: 0x${zStart.toString(16)}..0x${zEnd.toString(16)} length=${zEnd - zStart} (${((zEnd-zStart)/1024/1024).toFixed(3)} MB)`);

// 2) Are there ANY non-zero bytes before zEnd? No (we just confirmed).
// 3) Map every non-zero byte position in the gap after zEnd
const nonZero = [];
for (let p = zEnd; p < END; p++) {
  if (buf[p] !== 0) nonZero.push(p);
}
console.log(`Non-zero bytes after initial run: ${nonZero.length}`);

// 4) Are there interior zero runs >= 256 bytes after zEnd? (gap-within-gap)
let interiorRuns = [];
let zrun = 0, zrunStart = 0;
for (let p = zEnd; p < END; p++) {
  if (buf[p] === 0) {
    if (zrun === 0) zrunStart = p;
    zrun++;
  } else {
    if (zrun >= 64) interiorRuns.push({ from: zrunStart, to: p, len: zrun });
    zrun = 0;
  }
}
if (zrun >= 64) interiorRuns.push({ from: zrunStart, to: END, len: zrun });
console.log(`Interior zero runs >= 64 bytes after non-zero starts:`);
for (const r of interiorRuns) {
  console.log(`  0x${r.from.toString(16)}..0x${r.to.toString(16)}  len=${r.len}`);
}

// 5) Hex dump first 512 bytes of the non-zero tail
console.log(`\n=== first 512 bytes of non-zero tail at 0x${zEnd.toString(16)} ===`);
for (let i = 0; i < Math.min(512, END - zEnd); i += 16) {
  const p = zEnd + i;
  const slice = buf.slice(p, p + 16);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
  console.log(`0x${p.toString(16).padStart(8,'0')}  ${hex}  ${asc}`);
}

// 6) Also dump last 256 bytes of the entire gap (right before 0xf88637 boundary)
console.log(`\n=== last 256 bytes of gap (before 0x${END.toString(16)}) ===`);
const tailStart = Math.max(zEnd, END - 256);
for (let i = 0; i < END - tailStart; i += 16) {
  const p = tailStart + i;
  const slice = buf.slice(p, p + 16);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
  console.log(`0x${p.toString(16).padStart(8,'0')}  ${hex}  ${asc}`);
}

// 7) Also: where exactly do non-zero clusters fall? bucket by 1KB
const buckets = {};
for (const p of nonZero) {
  const b = (p >>> 10) << 10;
  buckets[b] = (buckets[b] || 0) + 1;
}
console.log(`\n=== non-zero density by 1KB bucket ===`);
Object.keys(buckets).sort((a,b)=>+a-+b).forEach(k => {
  const p = +k;
  console.log(`  0x${p.toString(16).padStart(8,'0')}  ${buckets[k]} non-zero bytes / 1024 (${(buckets[k]/1024*100).toFixed(1)}%)`);
});
