// Session 27 — Target #3: Walk the tile-grid head inside body root (0xf8f9b..0x633bb3 ≈ 5.23 MB).
// Verify: does the 5.23 MB body-root tail + the 9.0 MB post-body-root continue as ONE 14.23 MB array?
// Expected: 240×238×267 = 15,253,920 bytes if full grid present.
//   * If body-root-end falls mid-row → straddle confirmed.
//   * If body-root-end aligns with a STRIDE boundary → distinct arrays glued together.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const BODY_ROOT_END = 0x633bb3;
const ARR_START = 0xf8fd2;  // From session 22
const STRIDE = 267;
const W = 240, H = 238;
const GRID_BYTES = W*H*STRIDE;
const GRID_END_EXPECTED = ARR_START + GRID_BYTES;

console.log('Body root end:', '0x' + BODY_ROOT_END.toString(16));
console.log('ARR_START:    ', '0x' + ARR_START.toString(16));
console.log('Grid bytes (240x238x267):', GRID_BYTES, '= 0x' + GRID_BYTES.toString(16));
console.log('Expected grid end:', '0x' + GRID_END_EXPECTED.toString(16));
console.log('Body root contains:', BODY_ROOT_END - ARR_START, '= 0x' + (BODY_ROOT_END - ARR_START).toString(16), 'bytes of tile grid');

// What's the offset INTO the grid at body-root-end?
const offsetIntoGrid = BODY_ROOT_END - ARR_START;
const recordIndex = Math.floor(offsetIntoGrid / STRIDE);
const offsetInRecord = offsetIntoGrid % STRIDE;
console.log('At body-root end: record idx=' + recordIndex + ' / ' + (W*H) + ' offset within record=' + offsetInRecord);
console.log('Row idx:', Math.floor(recordIndex / W), 'Col idx:', recordIndex % W);

// What total tile records fit IN the body root?
console.log('Records inside body root:', recordIndex);
console.log('Records outside body root:', W*H - recordIndex, '(expected if continuous)');

// What does the boundary byte sequence look like?
console.log('\n=== Byte sequence at body-root-end ===');
for (let off = BODY_ROOT_END - 24; off < BODY_ROOT_END + 36; off += 12) {
  const slice = buf.subarray(off, off+12);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  0x' + off.toString(16) + ': ' + hex + '  ' + ascii);
}

// Check: do records at body-root-end have the canonical structure that continues outside?
// Read records on either side of the boundary
const offRecBefore = BODY_ROOT_END - 100;  // ~ 0x633b4f, near boundary
const offRecAfter = BODY_ROOT_END + 100;   // ~ 0x633c17

// Find nearest STRIDE-aligned offset
const beforeAlignedI = Math.floor((offRecBefore - ARR_START) / STRIDE);
const afterAlignedI = Math.floor((offRecAfter - ARR_START) / STRIDE);
console.log('\nNearest aligned records:');
console.log('  Before boundary: record[' + beforeAlignedI + '] at 0x' + (ARR_START + beforeAlignedI * STRIDE).toString(16));
console.log('  After boundary:  record[' + afterAlignedI + '] at 0x' + (ARR_START + afterAlignedI * STRIDE).toString(16));

// Read 4 records around the boundary, looking for the f16=200 / f24=2 canonical pattern
console.log('\n=== Records around boundary (look for canonical fields f16=200 f24=2 etc.) ===');
for (let i = beforeAlignedI - 1; i <= beforeAlignedI + 2; i++) {
  if (i < 0 || i >= W*H) continue;
  const o = ARR_START + i * STRIDE;
  const f16 = buf.readUInt32LE(o + 16);
  const f20 = buf.readUInt32LE(o + 20);
  const f24 = buf.readUInt32LE(o + 24);
  const f28 = buf.readUInt32LE(o + 28);
  const f32 = buf.readUInt32LE(o + 32);
  console.log('  rec[' + i + '] at 0x' + o.toString(16) + ' f16=' + f16 + ' f20=' + f20 + ' f24=' + f24 + ' f28=' + f28 + ' f32=' + f32 + (i*STRIDE + ARR_START > BODY_ROOT_END ? ' [outside body root]' : ' [inside body root]'));
}

// Better: validate the WHOLE array is one continuous structure
// Count records with canonical (f16, f20, f24, f28, f32) = (200, 200, 2, 6, 200) pattern
// in BOTH the inside-body-root part AND outside-body-root part
console.log('\n=== Canonical-field count in inside/outside-body-root halves ===');
let insideCanonical = 0, insideTotal = 0;
let outsideCanonical = 0, outsideTotal = 0;
for (let i = 0; i < W*H; i++) {
  const o = ARR_START + i * STRIDE;
  if (o + STRIDE > buf.length) break;
  const f16 = buf.readUInt32LE(o + 16);
  const f20 = buf.readUInt32LE(o + 20);
  const f24 = buf.readUInt32LE(o + 24);
  const f28 = buf.readUInt32LE(o + 28);
  const f32 = buf.readUInt32LE(o + 32);
  const canon = (f16 === 200 && f20 === 200 && f24 === 2 && f28 === 6 && f32 === 200);
  if (o < BODY_ROOT_END) {
    insideTotal++;
    if (canon) insideCanonical++;
  } else {
    outsideTotal++;
    if (canon) outsideCanonical++;
  }
}
console.log('Inside body root:  ' + insideCanonical + ' / ' + insideTotal + ' = ' + (100*insideCanonical/insideTotal).toFixed(1) + '% canonical');
console.log('Outside body root: ' + outsideCanonical + ' / ' + outsideTotal + ' = ' + (100*outsideCanonical/outsideTotal).toFixed(1) + '% canonical');

// Now: do the field-value-distributions match inside vs outside?
console.log('\n=== f16 distribution: inside vs outside ===');
function distrib(start, end) {
  const h = {};
  for (let o = start; o + STRIDE <= end; o += STRIDE) {
    const v = buf.readUInt32LE(o + 16);
    h[v] = (h[v]||0)+1;
  }
  return h;
}
const hi = distrib(ARR_START, BODY_ROOT_END);
const ho = distrib(BODY_ROOT_END, ARR_START + GRID_BYTES);
const allKeys = new Set([...Object.keys(hi), ...Object.keys(ho)]);
console.log('Top values:');
[...allKeys].sort((a,b)=>(ho[b]||0) + (hi[b]||0) - (ho[a]||0) - (hi[a]||0)).slice(0,10).forEach(k=>{
  console.log('  f16=' + k.padStart(10) + ': inside=' + (hi[k]||0).toString().padStart(5) + ' outside=' + (ho[k]||0).toString().padStart(5));
});

// Final: the body-root header at 0x3ba1 should declare size that includes its end at 0x633bb3
// Let me read it.
console.log('\n=== Body root header at 0x3ba1 ===');
const bodyRootHeader = buf.subarray(0x3b99, 0x3bb1);
console.log('Bytes:', Array.from(bodyRootHeader).map(b=>b.toString(16).padStart(2,'0')).join(' '));
const selfPtr = buf.readUInt32LE(0x3b99);
const size = buf.readUInt32LE(0x3b9d);
console.log('Self-ptr at 0x3b99:', '0x' + selfPtr.toString(16), '(expected 0x3b99)');
console.log('Size at 0x3b9d:', size, '= 0x' + size.toString(16));
console.log('End from header: 0x' + (0x3ba1 + size).toString(16), '(actual end: 0x' + BODY_ROOT_END.toString(16) + ')');
