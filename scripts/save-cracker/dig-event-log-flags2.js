// Session 26 — Question the 12-byte stride hypothesis.
// Many flag values are huge (242 distinct), suggesting the stride or alignment is wrong.
// Let me look for self-pointers and headers within the event log.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const START = 0x87e9, END = 0x846af;

// Look for self-pointers in the event log range
console.log('=== Self-pointers in event log range ===');
let selfPtrs = [];
for (let o = START; o < END - 4; o += 1) {
  const v = buf.readUInt32LE(o);
  if (v === o) selfPtrs.push(o);
}
console.log('Self-pointers found:', selfPtrs.length);
if (selfPtrs.length > 0) {
  console.log('First 20:', selfPtrs.slice(0,20).map(o => '0x' + o.toString(16)).join(', '));
  console.log('Last 5:', selfPtrs.slice(-5).map(o => '0x' + o.toString(16)).join(', '));
}

// Spacing between self-pointers
if (selfPtrs.length > 1) {
  const gaps = [];
  for (let i = 1; i < selfPtrs.length; i++) gaps.push(selfPtrs[i] - selfPtrs[i-1]);
  const gapH = {};
  for (const g of gaps) gapH[g] = (gapH[g]||0)+1;
  console.log('\nGap distribution (top 10):');
  Object.entries(gapH).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([g,c])=>console.log('  gap=' + g + ': ' + c));
}

// Look at first few records: maybe there's a header before the 12-byte stride starts
console.log('\n=== Raw bytes at 0x87e9..0x8830 ===');
for (let o = 0x87e9; o < 0x8830; o += 16) {
  const slice = buf.subarray(o, Math.min(o+16, 0x8830));
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b => (b>=0x20 && b<0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + ascii);
}

// Look at end too
console.log('\n=== Raw bytes at 0x846a0..0x846b0 (end of region) ===');
for (let o = 0x846a0; o < Math.min(0x846b0, buf.length); o += 16) {
  const slice = buf.subarray(o, Math.min(o+16, 0x846b0));
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b => (b>=0x20 && b<0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + ascii);
}

// Try assuming the FIRST record starts at 0x87e9 -- but maybe alignment differs
// Let's verify by checking if records align well by looking for repeating patterns
// Specifically: every offset where flag<10 AND sub in {0,0x20} AND idA<2000 AND year<1000 AND z==0
let alignHits = [];
for (let o = START; o < END - 12; o += 1) {
  const flag = buf[o], sub = buf[o+1];
  const idA = buf.readUInt16LE(o+2);
  const idB = buf.readUInt16LE(o+4);
  const z = buf.readUInt16LE(o+6);
  // strict pattern
  if (flag < 5 && (sub===0||sub===0x20) && idA < 5000 && idB > 0 && idB < 800 && z === 0) {
    alignHits.push(o);
  }
}
console.log('\nStrictly-matching candidate records (flag<5, sub∈{0,0x20}, idA<5K, idB 1..799, z=0):', alignHits.length);
if (alignHits.length > 1) {
  const offsetMod12 = {};
  for (const o of alignHits) {
    const m = (o - START) % 12;
    offsetMod12[m] = (offsetMod12[m]||0) + 1;
  }
  console.log('Distribution by (offset-START) mod 12:');
  Object.entries(offsetMod12).sort((a,b)=>b[1]-a[1]).forEach(([m,c])=>console.log('  mod ' + m + ': ' + c));
}

// Also try mod 8, 16, 20 strides
console.log('\nAlternative strides:');
for (const stride of [8, 12, 16, 20, 24]) {
  const mod = {};
  for (const o of alignHits) {
    const m = (o - START) % stride;
    mod[m] = (mod[m]||0)+1;
  }
  const top = Object.entries(mod).sort((a,b)=>b[1]-a[1]).slice(0,3);
  console.log('  stride=' + stride + ': top mods → ' + top.map(([m,c])=>'mod'+m+'='+c).join(', '));
}

// Now: if mod-12 is dominant, what fraction of slots have flag>=10? Those non-conforming
// rows might be the source of the 242 distinct flag values
const recs = [];
const N = Math.floor((END - START)/12);
for (let i = 0; i < N; i++) {
  const o = START + i*12;
  recs.push({
    o, flag: buf[o], sub: buf[o+1],
    idA: buf.readUInt16LE(o+2), idB: buf.readUInt16LE(o+4),
    z: buf.readUInt16LE(o+6), h: buf.readUInt32LE(o+8) >>> 0
  });
}
console.log('\n=== Records grouped by validity rules ===');
const cat = { allZero:0, validFlag:0, flagHighWeird:0 };
for (const r of recs) {
  if (r.flag===0 && r.sub===0 && r.idA===0 && r.idB===0 && r.z===0 && r.h===0) cat.allZero++;
  else if (r.flag < 10 && r.idB < 1000) cat.validFlag++;
  else cat.flagHighWeird++;
}
console.log(cat);

// Look at "flagHighWeird" — maybe those slots are mis-aligned (carry-over from a variable-stride blob earlier)
console.log('\n=== First 30 "weird" records ===');
let weirdCount = 0;
for (const r of recs) {
  if (!(r.flag < 10 && r.idB < 1000) && !(r.flag===0 && r.sub===0 && r.idA===0 && r.idB===0 && r.z===0 && r.h===0)) {
    if (weirdCount < 30) {
      // hex dump 12 bytes
      const hex = Array.from(buf.subarray(r.o, r.o+12)).map(b=>b.toString(16).padStart(2,'0')).join(' ');
      console.log('  0x' + r.o.toString(16) + ': ' + hex);
      weirdCount++;
    }
  }
}

// Last test: do the "weird" records cluster at specific addresses, e.g. blocks of contiguous weirdness?
console.log('\n=== Runs of valid/weird ===');
let runStart = START;
let runKind = null;
const runs = [];
function kindOf(r){
  if (r.flag===0 && r.sub===0 && r.idA===0 && r.idB===0 && r.z===0 && r.h===0) return 'zero';
  if (r.flag < 10 && r.idB < 1000) return 'valid';
  return 'weird';
}
for (const r of recs) {
  const k = kindOf(r);
  if (runKind === null) { runKind = k; runStart = r.o; }
  else if (k !== runKind) {
    runs.push({kind: runKind, start: runStart, end: r.o, len: (r.o - runStart)/12});
    runStart = r.o; runKind = k;
  }
}
runs.push({kind: runKind, start: runStart, end: END, len: (END - runStart)/12});
const sumByKind = {};
for (const r of runs) sumByKind[r.kind] = (sumByKind[r.kind]||0)+r.len;
console.log('Runs:', runs.length, '— total slots by kind:', sumByKind);
console.log('First 20 runs:');
runs.slice(0,20).forEach(r=>console.log('  ' + r.kind.padEnd(6) + ' 0x' + r.start.toString(16) + '..0x' + r.end.toString(16) + ' (' + r.len + ' slots)'));
console.log('Longest 10 weird runs:');
runs.filter(r=>r.kind==='weird').sort((a,b)=>b.len-a.len).slice(0,10).forEach(r=>console.log('  weird 0x' + r.start.toString(16) + '..0x' + r.end.toString(16) + ' (' + r.len + ' slots)'));
