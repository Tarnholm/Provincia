// Session 27 — Debug: inside vs outside body-root tile-grid records.
// The previous run says ALL inside have f16=200, ALL outside have f16=0. Investigate.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const BODY_ROOT_END = 0x633bb3;
const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;
const GRID_BYTES = W*H*STRIDE;

// Show actual canonical-field distributions
console.log('=== Field-value histograms inside vs outside body root ===');
const fields = [16, 20, 24, 28, 32, 36, 40];

for (const f of fields) {
  const hi = {}, ho = {};
  for (let i = 0; i < W*H; i++) {
    const o = ARR_START + i * STRIDE;
    if (o + f + 4 > buf.length) break;
    const v = buf.readUInt32LE(o + f);
    if (o < BODY_ROOT_END) hi[v] = (hi[v]||0)+1;
    else ho[v] = (ho[v]||0)+1;
  }
  console.log('  f' + f + ':');
  console.log('    Inside  top: ' + Object.entries(hi).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([v,c])=>v+':'+c).join(' '));
  console.log('    Outside top: ' + Object.entries(ho).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([v,c])=>v+':'+c).join(' '));
}

// So the canonical field rule from session 22 is "f16=200, f20=200, f24=2, f28=6, f32=200"
// Verify on inside half
console.log('\n=== Strict canonical-pattern match inside vs outside ===');
let insMatch = 0, outsMatch = 0;
let insTotal = 0, outsTotal = 0;
for (let i = 0; i < W*H; i++) {
  const o = ARR_START + i * STRIDE;
  if (o + 36 > buf.length) break;
  const f16 = buf.readUInt32LE(o + 16);
  const f20 = buf.readUInt32LE(o + 20);
  const f24 = buf.readUInt32LE(o + 24);
  const f28 = buf.readUInt32LE(o + 28);
  const f32 = buf.readUInt32LE(o + 32);
  const canon = (f16===200 && f20===200 && f24===2 && f28===6 && f32===200);
  if (o < BODY_ROOT_END) { insTotal++; if (canon) insMatch++; }
  else { outsTotal++; if (canon) outsMatch++; }
}
console.log('Inside  (200,200,2,6,200): ' + insMatch + ' / ' + insTotal);
console.log('Outside (200,200,2,6,200): ' + outsMatch + ' / ' + outsTotal);

// Hmm — that can't be right if outside has all f16=0. Let me dump first 80 bytes of records around boundary
console.log('\n=== First 80 bytes of records [20536..20539] (around body-root boundary) ===');
for (let i = 20536; i <= 20539; i++) {
  const o = ARR_START + i * STRIDE;
  if (o + 80 > buf.length) break;
  const slice = buf.subarray(o, o + 80);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  rec[' + i + '] at 0x' + o.toString(16) + (o < BODY_ROOT_END ? ' [in]' : ' [out]') + ':');
  // Print 4 lines of 20 bytes
  for (let j = 0; j < 80; j += 20) {
    console.log('    +' + j.toString().padStart(3) + ': ' + Array.from(slice.subarray(j, j+20)).map(b=>b.toString(16).padStart(2,'0')).join(' '));
  }
}

// I think 20537 record at 0x633b45 ENDS at 0x633b45 + 267 = 0x633c50, so it straddles body-root-end
// Field offsets 0..STRIDE may have the canonical fields at f16..f32 = bytes 16..36 of the 267-byte record
// And rec[20537]'s body actually CONTINUES outside body root
// Look at rec[20538] (fully outside): does it have canonical pattern at +16?

const o20538 = ARR_START + 20538 * STRIDE;
console.log('\nrec[20538] field values:');
for (let off = 0; off <= 40; off += 4) {
  const v = buf.readUInt32LE(o20538 + off);
  console.log('  +' + off.toString().padStart(2) + ': ' + v + ' (0x' + v.toString(16) + ')');
}

// Compare to rec[20536]
const o20536 = ARR_START + 20536 * STRIDE;
console.log('\nrec[20536] field values:');
for (let off = 0; off <= 40; off += 4) {
  const v = buf.readUInt32LE(o20536 + off);
  console.log('  +' + off.toString().padStart(2) + ': ' + v + ' (0x' + v.toString(16) + ')');
}
