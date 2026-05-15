// Session 58 pass 2: confirm mercenary pool table structure.
// Count region headers, count merc unit strings, see how the tail (~120 B repeating 16-byte rows) fits.
const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const START = 0x14e5ac6;
const END   = 0x1501615;
const LEN = END - START;

const buf = fs.readFileSync(SAVE);
const slice = buf.subarray(START, END);

// Extract ASCII runs (>=4) with their offset; classify region-name vs merc-name.
const runs = [];
let cur = '', curStart = -1;
for (let i = 0; i < slice.length; i++) {
  const b = slice[i];
  if (b >= 0x20 && b < 0x7f) {
    if (!cur) curStart = i;
    cur += String.fromCharCode(b);
  } else {
    if (cur.length >= 4) runs.push({ off: curStart, len: cur.length, s: cur });
    cur = '';
  }
}
if (cur.length >= 4) runs.push({ off: curStart, len: cur.length, s: cur });

// Region names from descr_mercenaries.txt look like single tokens (no spaces),
// often _ separated, e.g. achaea, alps_rhaetia_noricum, alexandria.
// Merc unit names always start with "merc ".
const mercNames = runs.filter(r => r.s.startsWith('merc '));
const regionCandidates = runs.filter(r => !r.s.includes(' ') && /^[a-z][a-z0-9_]*$/.test(r.s));
console.log(`merc-* names: ${mercNames.length}`);
console.log(`single-token lowercase strings (region candidates): ${regionCandidates.length}`);

console.log('\n--- region-token strings (first 80) ---');
regionCandidates.slice(0, 80).forEach(r => console.log(`  0x${(r.off+START).toString(16)}  ${r.s}`));

// Locate end of the merc-pool text region: last merc-* string offset
const lastMerc = mercNames[mercNames.length - 1];
console.log(`\nfirst merc string: 0x${(mercNames[0].off+START).toString(16)} "${mercNames[0].s}"`);
console.log(`last  merc string: 0x${(lastMerc.off+START).toString(16)} "${lastMerc.s}"`);
console.log(`text-zone span    : 0x${(mercNames[0].off+START).toString(16)} .. 0x${(lastMerc.off+lastMerc.len+START).toString(16)}`);

// First region header is at 0x14f20a0 "achaea". What's between START=0x14e5ac6 and 0x14f20a0?
const preTextBytes = (0x14f20a0 - START);
console.log(`\npre-text bytes (0x${START.toString(16)} .. 0x14f20a0): ${preTextBytes} (0x${preTextBytes.toString(16)})`);

// What occupies the pre-text zone? Show a histogram and zero-run distribution
const pre = slice.subarray(0, preTextBytes);
const preHist = new Uint32Array(256);
for (const b of pre) preHist[b]++;
const preTop = [...preHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
console.log('pre-text top bytes:');
preTop.forEach(([b,c]) => console.log(`  0x${b.toString(16).padStart(2,'0')}: ${c} (${(100*c/pre.length).toFixed(1)}%)`));

// The pre-text zone shows ac fe 45 12 repeating, plus characters. Look for that signature.
let sig = Buffer.from([0xac, 0xfe, 0x45, 0x12]);
let sigHits = 0, sigPos = [];
for (let i = 0; i <= pre.length - 4; i++) {
  if (pre[i]===sig[0]&&pre[i+1]===sig[1]&&pre[i+2]===sig[2]&&pre[i+3]===sig[3]) {
    sigHits++;
    if (sigPos.length<5) sigPos.push(i+START);
  }
}
console.log(`pre-text "ac fe 45 12" signature hits: ${sigHits} (first 5 offsets: ${sigPos.map(p=>'0x'+p.toString(16)).join(', ')})`);

// Tail (last ~512 B) shows repeating 16-byte rows ending at END.
// Compute spacing between rows: each row looks like "XX XX 00 00  YY 00 00 00  ZZ 00 00 00  WW WW WW WW"
// In the tail dump rows step by 16 B starting around 0x015013f0.
// Detect: scan back from END to find the run start.
function looks16Row(off) {
  // u16 first val + zeros + small u32s
  const b = buf;
  return b[off+2]===0 && b[off+3]===0 &&
         b[off+5]===0 && b[off+6]===0 && b[off+7]===0 &&
         b[off+9]===0 && b[off+10]===0 && b[off+11]===0;
}
let rowEnd = END;
// step back in 16-byte chunks
let rowStart = END;
while (rowStart >= START + 16 && looks16Row(rowStart - 16)) rowStart -= 16;
console.log(`\ntail 16B-row span: 0x${rowStart.toString(16)} .. 0x${rowEnd.toString(16)}  (${rowEnd-rowStart} bytes, ${(rowEnd-rowStart)/16} rows)`);

// Print last 5 rows
console.log('sample tail rows:');
for (let off = rowEnd - 16*5; off < rowEnd; off += 16) {
  const r = buf.subarray(off, off+16);
  console.log(`  0x${off.toString(16)}  ${[...r].map(b=>b.toString(16).padStart(2,'0')).join(' ')}`);
}

// Show small u32 trios per row: (a, b, c) where a is small varying, b is ~2-5, c is 5.
// That's plausibly (unit-record-or-pool ptr, available count, max count)
// Print first 8 row decodes
console.log('\nrow decode (first 8): u16_a u16_pad u32_b u32_c u32_d');
for (let off = rowStart; off < rowStart + 16*8 && off < rowEnd; off += 16) {
  const a = buf.readUInt16LE(off);
  const pad = buf.readUInt16LE(off+2);
  const b32 = buf.readUInt32LE(off+4);
  const c32 = buf.readUInt32LE(off+8);
  const d32 = buf.readUInt32LE(off+12);
  console.log(`  0x${off.toString(16)}  a=${a} pad=${pad} b=${b32} c=${c32} d=0x${d32.toString(16)}`);
}

// Cross-check: how many entries in expected merc regions? Print just region-style tokens
// adjacent to a 'merc ' string (within 1 KB before the first merc of a cluster)
console.log('\n--- region-name detection (token immediately followed by "merc " strings) ---');
let detectedRegions = [];
for (let i = 0; i < regionCandidates.length; i++) {
  const r = regionCandidates[i];
  // is there a 'merc ' string within next 80 bytes?
  const hit = mercNames.find(m => m.off > r.off && m.off - r.off < 80);
  if (hit) detectedRegions.push(r);
}
console.log(`detected regions: ${detectedRegions.length}`);
detectedRegions.forEach(r => console.log(`  0x${(r.off+START).toString(16)}  ${r.s}`));
