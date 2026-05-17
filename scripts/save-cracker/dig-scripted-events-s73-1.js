// Session 73 — Explore ZoneB scripted-events at 0x846af..0xa8beb in save_1.2.sav.
// Goal: find record framing so we can write a real decode/encode pair.
// Session 54 said:
//   - Header at 0x846af is a 34-byte taw section {selfPtr, size=0x22}
//     containing category list ("historic", "olympics")
//   - Each event record starts with length-prefixed asciiz pair
//     (category_len, category, name_len, name) followed by ~50B payload
// Validate this concretely.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAV);

const START = 0x846af, END = 0xa8beb;
console.log('ZoneB:', '0x' + START.toString(16), '..', '0x' + END.toString(16), '=', (END-START), 'bytes');

// First 256 bytes
console.log('\n=== First 256 bytes ===');
for (let o = START; o < START + 256; o += 16) {
  const slice = buf.subarray(o, o + 16);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b=>(b>=0x20&&b<0x7f)?String.fromCharCode(b):'.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex + '  ' + ascii);
}

// Look at header — taw section: {u32 selfPtr == offset, u32 size}
const h0 = buf.readUInt32LE(START);
const h4 = buf.readUInt32LE(START + 4);
console.log('\nHeader at 0x' + START.toString(16) + ': u32@+0=' + h0 + ' (0x' + h0.toString(16) + '), u32@+4=' + h4);
console.log('selfPtr check: 0x' + h0.toString(16) + ' vs 0x' + START.toString(16) + ' match=' + (h0 === START));

// Enumerate length-prefixed ASCII strings (u16 lenPlus1) like dig-scripted-events1.js
function tryPstr(o) {
  if (o + 2 > END) return null;
  const lenP1 = buf.readUInt16LE(o);
  if (lenP1 < 2 || lenP1 > 128) return null;
  if (o + 2 + lenP1 > END) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[o + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[o + 2 + lenP1 - 1] !== 0) return null;
  return { off: o, str: buf.slice(o + 2, o + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

// Some saves use u32 lenPlus1
function tryPstr32(o) {
  if (o + 4 > END) return null;
  const lenP1 = buf.readUInt32LE(o);
  if (lenP1 < 2 || lenP1 > 128) return null;
  if (o + 4 + lenP1 > END) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[o + 4 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[o + 4 + lenP1 - 1] !== 0) return null;
  return { off: o, str: buf.slice(o + 4, o + 4 + lenP1 - 1).toString('latin1'), totalLen: 4 + lenP1 };
}

// Scan u16 strings exhaustively
const strs16 = [];
for (let o = START; o < END - 4; o++) {
  const r = tryPstr(o);
  if (r) strs16.push(r);
}
console.log('\nu16-prefixed ASCIIZ strings: ' + strs16.length);
console.log('First 30:');
strs16.slice(0,30).forEach(s=>console.log('  0x' + s.off.toString(16) + ' "' + s.str + '"'));

// Now look at the taw header more carefully — if size=0x22 then next section starts at 0x846af+0x22 = 0x846d1
console.log('\nIf size=0x22 at +4, next section at 0x' + (START + 0x22).toString(16));
console.log('  (size includes header? Let me check both)');
const after22 = START + 0x22;
console.log('Bytes at 0x' + after22.toString(16) + ':');
for (let o = after22; o < after22 + 64; o += 16) {
  const slice = buf.subarray(o, o + 16);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b=>(b>=0x20&&b<0x7f)?String.fromCharCode(b):'.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex + '  ' + ascii);
}

// Walk record-by-record assuming each record starts with [u16 catLen][catBytes][u16 nameLen][nameBytes][50B payload]
// Try at 0x846d1 (after a 0x22 header)
console.log('\n=== Walking records from 0x846d1 with [u16 catLen][cat][u16 nameLen][name][payload] ===');
let p = 0x846d1;
let count = 0;
const samples = [];
while (p < END && count < 100) {
  const r1 = tryPstr(p);
  if (!r1) { console.log('  STOP at 0x' + p.toString(16) + ': no string here'); break; }
  const r2 = tryPstr(p + r1.totalLen);
  if (!r2) { console.log('  STOP at 0x' + p.toString(16) + ': cat="' + r1.str + '" but no name follows'); break; }
  samples.push({off:p, cat:r1.str, name:r2.str});
  // Need to find payload size — for now skip past with heuristic
  // Try to detect next string-pair
  let payloadStart = p + r1.totalLen + r2.totalLen;
  let nextStart = -1;
  for (let q = payloadStart; q < Math.min(payloadStart + 200, END - 4); q++) {
    const t1 = tryPstr(q);
    if (!t1) continue;
    const t2 = tryPstr(q + t1.totalLen);
    if (!t2) continue;
    // Validate: cat should be reasonable known set
    nextStart = q;
    break;
  }
  if (nextStart < 0) {
    console.log('  Last record at 0x' + p.toString(16) + ' (' + r1.str + ', ' + r2.str + '), no more after');
    break;
  }
  const recSize = nextStart - p;
  if (count < 10) console.log('  0x' + p.toString(16) + ' rec[' + count + '] cat="' + r1.str + '" name="' + r2.str + '" recSize=' + recSize);
  count++;
  p = nextStart;
}
console.log('Total walked records: ' + count);
console.log('Final p: 0x' + p.toString(16) + ' (END=0x' + END.toString(16) + ')');
console.log('Tail bytes remaining: ' + (END - p));

// Categories observed
const catH = {};
samples.forEach(s=>catH[s.cat]=(catH[s.cat]||0)+1);
console.log('\nCategories observed (first 100 records):');
Object.entries(catH).forEach(([k,v])=>console.log('  ' + k + ': ' + v));
