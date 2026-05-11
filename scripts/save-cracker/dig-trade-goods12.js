// Retry mid-file 240x238 grid resource correlation with Y-flip applied.
// Session 18 RETRACTED resource correlation but maybe with flipped Y the answer is different.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const res = JSON.parse(fs.readFileSync('C:/dev/Provincia/public/resources_large.json'));

const MAP_H = 700;

// Build all resources (flat list)
const allRes = [];
for (const region of Object.keys(res)) {
  for (const r of res[region]) {
    allRes.push({ region, x: r.x, y: r.y, type: r.type, amount: r.amount });
  }
}
console.log('total resources:', allRes.length);

// Mid-file array per session 18: 57120 records × 267 bytes at 0xf8fd2
// Wait - session 18 actually wrote "57,120 records starting at 0xf8fd2"
// But my earlier check showed 0xf8fd2 is INSIDE the settlement zone wrapper
// Let me find the actual start by walking from session 15's hint 0x633c50
const ARR_START_GUESS = 0x633c50;
const ARR_STRIDE = 267;
// 57120 × 267 = 15,250,040 bytes = 14.5 MB
// 36582 × 267 = 9,767,394 bytes = 9.3 MB (session 15)
// Session 18 corrected: actual is 57,120 records starting at 0xf8fd2
// Wait, that doesn't make sense in rome10 layout. Let me recheck

// Re-walk to find the array
console.log('\\nFind canonical-pattern records:');
const cano = Buffer.from([0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0xc8]);
let p = 0;
let firstHit = -1, lastHit = -1, count = 0;
while ((p = buf.indexOf(cano, p)) !== -1) {
  if (firstHit < 0) firstHit = p;
  lastHit = p;
  count++;
  p++;
}
console.log('canonical pattern count:', count, 'first:', '0x'+firstHit.toString(16), 'last:', '0x'+lastHit.toString(16));
const interStride = (lastHit - firstHit) / (count - 1);
console.log('avg inter-stride:', interStride.toFixed(2));

// Use firstHit as record-0 start, ARR_STRIDE as expected stride
// Try mapping resource (X, Y) → record index assuming W=240 grid
function tryMapping(W) {
  // Per session 18: W=240, H=238
  // Each cell covers ~1020/240=4.25 region-pixels × 700/238=2.94 region-pixels
  let canonicalAtResource = 0, nonCanonAtResource = 0;
  // For each resource location, compute its expected cell index
  for (const r of allRes) {
    const col = Math.floor((r.x - 1) * W / 1020);
    const row = Math.floor((MAP_H - r.y) * 238 / MAP_H); // y-flip for save coords
    const idx = row * W + col;
    if (idx >= 57120) continue;
    const recOff = firstHit + idx * ARR_STRIDE;
    // Compare 33 bytes to canonical
    let isCanon = true;
    for (let k = 0; k < 33; k++) {
      if (buf[recOff + k] !== cano[k]) { isCanon = false; break; }
    }
    if (isCanon) canonicalAtResource++;
    else nonCanonAtResource++;
  }
  return { canonicalAtResource, nonCanonAtResource };
}

// Also try non-flipped Y
function tryMappingRaw(W) {
  let canonicalAtResource = 0, nonCanonAtResource = 0;
  for (const r of allRes) {
    const col = Math.floor((r.x - 1) * W / 1020);
    const row = Math.floor((r.y - 1) * 238 / MAP_H);
    const idx = row * W + col;
    if (idx >= 57120) continue;
    const recOff = firstHit + idx * ARR_STRIDE;
    let isCanon = true;
    for (let k = 0; k < 33; k++) {
      if (buf[recOff + k] !== cano[k]) { isCanon = false; break; }
    }
    if (isCanon) canonicalAtResource++;
    else nonCanonAtResource++;
  }
  return { canonicalAtResource, nonCanonAtResource };
}

console.log('flipped Y mapping:', tryMapping(240));
console.log('raw Y mapping:', tryMappingRaw(240));

// Also check overall: how many non-canonical records are there?
let nonCanonCount = 0;
for (let i = 0; i < 57120; i++) {
  const recOff = firstHit + i * ARR_STRIDE;
  if (recOff + 33 > buf.length) break;
  let isCanon = true;
  for (let k = 0; k < 33; k++) {
    if (buf[recOff + k] !== cano[k]) { isCanon = false; break; }
  }
  if (!isCanon) nonCanonCount++;
}
console.log('total non-canonical records in 57120:', nonCanonCount);
