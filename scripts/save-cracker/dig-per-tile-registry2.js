// Session 27 — Verify scripted-events region boundaries by scanning for delimiter pattern.
// Pattern from session 26: 26-byte records ending in [ff ff ff ff (0|1) 01]

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

// Find ALL [ff ff ff ff XX 01] patterns in 0x846d1..0xa8c00 region
const SCAN_START = 0x846d1, SCAN_END = 0xa8c00;
const matches = [];
for (let o = SCAN_START; o < SCAN_END - 6; o++) {
  if (buf[o]===0xff && buf[o+1]===0xff && buf[o+2]===0xff && buf[o+3]===0xff
      && (buf[o+4]===0x00 || buf[o+4]===0x01) && buf[o+5]===0x01) {
    matches.push(o);
  }
}
console.log('Delimiter matches found:', matches.length);
console.log('First 10 offsets:', matches.slice(0,10).map(o=>'0x'+o.toString(16)).join(','));
console.log('Last 10 offsets:', matches.slice(-10).map(o=>'0x'+o.toString(16)).join(','));

// Stride between consecutive matches
const strides = [];
for (let i = 1; i < matches.length; i++) strides.push(matches[i] - matches[i-1]);
const strideH = {};
for (const s of strides) strideH[s] = (strideH[s]||0)+1;
console.log('\nStride distribution (top 10):');
Object.entries(strideH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([s,c])=>console.log('  Δ=' + s + ': ' + c));

// Region with strict 26-byte stride
// Start at the first run of 26-byte strides
let startIdx = -1, endIdx = -1;
for (let i = 0; i < matches.length - 5; i++) {
  let isRun = true;
  for (let j = i; j < i + 5; j++) {
    if (matches[j+1] - matches[j] !== 26) { isRun = false; break; }
  }
  if (isRun) { startIdx = i; break; }
}
for (let i = matches.length - 1; i >= 5; i--) {
  let isRun = true;
  for (let j = i - 5; j < i; j++) {
    if (matches[j+1] - matches[j] !== 26) { isRun = false; break; }
  }
  if (isRun) { endIdx = i; break; }
}
console.log('\n26B-stride run: idx ' + startIdx + '..' + endIdx + ' = ' + (endIdx - startIdx + 1) + ' records');
console.log('  start offset: 0x' + matches[startIdx].toString(16));
console.log('  end offset:   0x' + matches[endIdx].toString(16));

// Each record = 20B payload + 6B delim. Payload starts at delim-20
// Show first 3 records' bytes
console.log('\n=== First 3 records (20B payload + 6B delim) ===');
for (let i = startIdx; i < Math.min(startIdx + 3, matches.length); i++) {
  const dEnd = matches[i] + 6;
  const pStart = matches[i] - 20;
  const payload = buf.subarray(pStart, dEnd);
  const hex = Array.from(payload).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  rec[' + i + '] payload at 0x' + pStart.toString(16) + ': ' + hex);
  // Interpret as 5×u32 + delimiter
  const u32a = buf.readUInt32LE(pStart);
  const u32b = buf.readUInt32LE(pStart + 4);
  const u32X = buf.readUInt32LE(pStart + 8);
  const u32Y = buf.readUInt32LE(pStart + 12);
  const u32h = buf.readUInt32LE(pStart + 16);
  console.log('         a=' + u32a + ' b=' + u32b + ' X=' + u32X + ' Y=' + u32Y + ' hash=0x' + u32h.toString(16).padStart(8,'0'));
}

// Wait — the bytes inside the 20B payload might be SMALLER ints
// session 26 has: (u32a 0..43, u32b 1..5, u32X, u32Y, u32hash)
// X and Y should fit in 0..1024 / 0..768
// Let me try u16-based decoding instead
console.log('\n=== Try u16-based decoding of payload ===');
for (let i = startIdx; i < Math.min(startIdx + 5, matches.length); i++) {
  const pStart = matches[i] - 20;
  // Maybe: [u16 a][u16 b][u16 X][u16 Y][u16 ?][u16 ?][u16 ?][u16 ?][u16 ?][u16 ?]
  const vals = [];
  for (let j = 0; j < 10; j++) vals.push(buf.readUInt16LE(pStart + j*2));
  console.log('  rec[' + i + '] u16x10: ' + vals.join(','));
}

// Or maybe: [u32 a][u16 b][u16 X][u16 Y][...]
console.log('\n=== Try mixed u32+u16 decoding ===');
for (let i = startIdx; i < Math.min(startIdx + 5, matches.length); i++) {
  const pStart = matches[i] - 20;
  const u32a = buf.readUInt32LE(pStart);
  const u32b = buf.readUInt32LE(pStart + 4);
  const u16X = buf.readUInt16LE(pStart + 8);
  const u16Y = buf.readUInt16LE(pStart + 10);
  const u32rest = buf.readUInt32LE(pStart + 12);
  const u32rest2 = buf.readUInt32LE(pStart + 16);
  console.log('  rec[' + i + '] a=' + u32a + ' b=' + u32b + ' X16=' + u16X + ' Y16=' + u16Y + ' rest=0x' + u32rest.toString(16) + ' 0x' + u32rest2.toString(16));
}
