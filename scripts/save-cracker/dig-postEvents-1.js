// Dig into the unzoned 0x000a9000..0x000f3000 zone (post-scripted-events).
// ~280 KB of DATA with sparse ASCII strings. Identify structure.

const fs = require('fs');

const A = fs.readFileSync('C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav');

const START = 0x000a9000;
const END   = 0x000f9000;
console.log('Zone:', '0x' + START.toString(16) + '..0x' + END.toString(16), '(' + ((END-START)/1024).toFixed(0) + ' KB)\n');

// 1. Find length-prefixed ASCII strings in this zone
function tryAsciizPstr16(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 4 || lenP1 > 80) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { off, str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

const strings = [];
for (let p = START; p < END - 4; p++) {
  const r = tryAsciizPstr16(A, p);
  if (r && /^[A-Za-z][A-Za-z _0-9.()]*$/.test(r.str)) strings.push(r);
}
console.log('Found ' + strings.length + ' ASCIIZ pstr16 strings in zone.\n');
console.log('First 50:');
for (const s of strings.slice(0, 50)) {
  console.log('  0x' + s.off.toString(16) + ' (' + s.totalLen + 'B) "' + s.str + '"');
}

// 2. Hex sample at start of zone
console.log('\n=== Hex sample (first 512 bytes of zone) ===');
function hexLine(buf, off, len) {
  const slice = buf.subarray(off, off + len);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  return hex + '  ' + asc;
}
for (let o = START; o < START + 512; o += 16) {
  console.log('  0x' + o.toString(16) + ': ' + hexLine(A, o, 16));
}

// 3. Are there section grammar headers in this zone? (u32 selfPtr == pos)
let sectionHits = 0;
const sectionExamples = [];
for (let p = START; p + 8 <= END; p++) {
  if (A.readUInt32LE(p) === p) {
    sectionHits++;
    if (sectionExamples.length < 20) sectionExamples.push(p);
  }
}
console.log('\nSection-grammar self-pointers in zone: ' + sectionHits);
console.log('First 20 positions:');
for (const p of sectionExamples) {
  const sizeOrSelf2 = A.readUInt32LE(p + 4);
  console.log('  0x' + p.toString(16) + '  u32@+4 = 0x' + sizeOrSelf2.toString(16) + (sizeOrSelf2 === p + 4 ? ' (selfPtr+4!)' : ''));
}

// 4. Distribution of string KEYWORDS — what does the content look like?
const wordHist = new Map();
for (const s of strings) {
  for (const word of s.str.toLowerCase().match(/[a-z_][a-z_0-9]+/g) || []) {
    wordHist.set(word, (wordHist.get(word) || 0) + 1);
  }
}
console.log('\nTop 30 word stems in zone strings:');
const sorted = Array.from(wordHist.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [w, c] of sorted) console.log('  ' + c + '× ' + w);
