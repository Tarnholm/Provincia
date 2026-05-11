// Session 26 — Decode the 146KB scripted-event firing log at 0x84f1c..0xa8b3d
// Pattern (from bytes): each record is ~24 bytes ending in "ff ff ff ff 01 01"

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

// Scan for the "ff ff ff ff 01 01" delimiter pattern
const PAT = Buffer.from([0xff,0xff,0xff,0xff,0x01,0x01]);
const PAT2 = Buffer.from([0xff,0xff,0xff,0xff,0x00,0x01]);

const REGION_START = 0x84efb;
const REGION_END = 0xa8b3d;

const matches = [];
for (let o = REGION_START; o < REGION_END - PAT.length; o++) {
  let m = true;
  for (let j = 0; j < PAT.length; j++) if (buf[o+j] !== PAT[j]) { m = false; break; }
  if (!m) {
    m = true;
    for (let j = 0; j < PAT2.length; j++) if (buf[o+j] !== PAT2[j]) { m = false; break; }
  }
  if (m) matches.push(o);
}
console.log('Delimiter matches (ff ff ff ff 0/1 1) in region:', matches.length);
if (matches.length > 1) {
  const strides = [];
  for (let i = 1; i < matches.length; i++) strides.push(matches[i] - matches[i-1]);
  const sH = {};
  strides.forEach(s=>sH[s]=(sH[s]||0)+1);
  console.log('Stride distribution (top 10):');
  Object.entries(sH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([s,c])=>console.log('  Δ=' + s.padStart(4) + ': ' + c));
}

// Most common stride should be the per-record size
// Assume stride 22 from the visual pattern; verify
const TOP_STRIDE = parseInt(Object.entries((function(){
  const sH = {};
  for (let i = 1; i < matches.length; i++) sH[matches[i]-matches[i-1]] = (sH[matches[i]-matches[i-1]]||0)+1;
  return sH;
})()).sort((a,b)=>b[1]-a[1])[0][0]);
console.log('Top stride:', TOP_STRIDE);

// Try parsing the first 30 records using the alignment from matches
// Each match is the END marker. The record BEFORE the match starts at matches[i-1]+6.
// Record body: u16 sub, u32 type1, u32 tileX, u32 tileY, u32 hash
console.log('\n=== First 20 records (treating "ff ff ff ff XX 01" as record terminator) ===');
for (let i = 0; i < Math.min(20, matches.length); i++) {
  const startRec = (i===0) ? REGION_START : (matches[i-1] + 6);
  const endRec = matches[i];
  const len = endRec - startRec;
  const slice = buf.subarray(startRec, endRec);
  // Try a simple parse:
  // [u16 a][u32 b][u32 c][u32 d][u32 e][u32 hash]
  let parsed = '';
  if (len === 18 || len === 22 || len === 24) {
    const a = buf.readUInt16LE(startRec);
    const b = buf.readUInt32LE(startRec + 2);
    const c = buf.readUInt32LE(startRec + 6);
    const d = buf.readUInt32LE(startRec + 10);
    const e = len >= 18 ? buf.readUInt32LE(startRec + 14) : null;
    parsed = ` parsed: a=${a} b=${b} c=${c} d=${d} e=${e}`;
  }
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  rec[' + i + '] 0x' + startRec.toString(16) + ' len=' + len + ': ' + hex + parsed);
}

// Hmm — variable record length. Let me parse using the most common stride
// Match-to-match stride = full record size including its terminator
// Let me look at the patterns within a single stride-N record
const COMMON_STRIDE = TOP_STRIDE;
console.log('\n=== Parsing with stride=' + COMMON_STRIDE + ' from first match ===');
let p = matches[0];  // first delimiter
// Records preceding each delimiter have the data
// Try treating delimiter as marker; record starts COMMON_STRIDE bytes before the next delimiter
// Or: each delimiter ends a record, record body = bytes from (matches[i-1]+6) to matches[i]
// Look at length-distribution between matches
const lengths = [];
for (let i = 1; i < matches.length; i++) lengths.push(matches[i] - (matches[i-1] + 6));
const lenH = {};
lengths.forEach(l=>lenH[l]=(lenH[l]||0)+1);
console.log('Length-between-delimiters distribution:');
Object.entries(lenH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([l,c])=>console.log('  len=' + l.padStart(4) + ': ' + c));

// Let me try a different decode: maybe each record is fixed 22B, and the "ff ff ff ff" appears INSIDE
// not as a delimiter. Re-examine
console.log('\n=== Stride 22 from start: fixed 22B records ===');
const STRIDE22 = 22;
const N22 = Math.floor((REGION_END - 0x84f1c) / STRIDE22);
console.log('Estimated', N22, 'records of 22B');
// Test: every 22B record should END with "ff ff ff ff 01 01" (6 bytes match)
let endHits = 0;
for (let i = 0; i < N22; i++) {
  const o = 0x84f1c + i*STRIDE22 + 16;  // last 6 bytes of record
  if (buf[o] === 0xff && buf[o+1] === 0xff && buf[o+2] === 0xff && buf[o+3] === 0xff) endHits++;
}
console.log('Endings with ff ff ff ff:', endHits, '/', N22);

// Maybe alignment is different. Try various offsets
console.log('\n=== Alignment scan: find STRIDE+offset that aligns "ff ff ff ff" at consistent position ===');
for (let off = 0; off < 24; off++) {
  for (const stride of [18, 20, 22, 24, 26, 28]) {
    let hits = 0;
    let n = 0;
    for (let p2 = 0x84f1c + off; p2 + 4 < REGION_END; p2 += stride) {
      n++;
      if (buf[p2] === 0xff && buf[p2+1] === 0xff && buf[p2+2] === 0xff && buf[p2+3] === 0xff) hits++;
    }
    if (hits > n * 0.5) console.log('  offset=+' + off + ' stride=' + stride + ': ' + hits + '/' + n + ' hits');
  }
}

// Let me look at first ~120 bytes after 0x84efb in finer detail
console.log('\n=== First 200 bytes after named-event strings ===');
for (let o = 0x84efc; o < 0x84efc + 200; o += 16) {
  const slice = buf.subarray(o, o+16);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b=>(b>=0x20&&b<0x7f)?String.fromCharCode(b):'.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex + '  ' + ascii);
}
