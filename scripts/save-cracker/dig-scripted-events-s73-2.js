// Session 73 — Detailed walk of scripted-events records in save_1.2.sav.
// Find exact record boundaries and per-record payload size.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAV);

const START = 0x846af, END = 0xa8beb;

function readPstr16(o) {
  if (o + 2 > END) return null;
  const lenP1 = buf.readUInt16LE(o);
  if (lenP1 < 2 || lenP1 > 128) return null;
  if (o + 2 + lenP1 > END) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[o + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[o + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(o + 2, o + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

// Find all string-pair starts: a position where pstr16 followed by another pstr16
const pairs = [];
for (let o = START; o < END - 4; o++) {
  const r1 = readPstr16(o);
  if (!r1) continue;
  const r2 = readPstr16(o + r1.totalLen);
  if (!r2) continue;
  pairs.push({off: o, cat: r1.str, name: r2.str, catLen: r1.totalLen, nameLen: r2.totalLen});
  o += r1.totalLen + r2.totalLen - 1;
}
console.log('Found ' + pairs.length + ' pstr16+pstr16 pairs');
console.log('First 5:');
pairs.slice(0,5).forEach(p=>console.log('  0x' + p.off.toString(16) + ' cat="' + p.cat + '" name="' + p.name + '"'));
console.log('Last 5:');
pairs.slice(-5).forEach(p=>console.log('  0x' + p.off.toString(16) + ' cat="' + p.cat + '" name="' + p.name + '"'));

// Stride distribution between consecutive pairs
const strides = [];
for (let i = 1; i < pairs.length; i++) {
  strides.push(pairs[i].off - pairs[i-1].off);
}
const strideH = {};
strides.forEach(s=>strideH[s]=(strideH[s]||0)+1);
console.log('\nStride distribution (top 20):');
Object.entries(strideH).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([s,c])=>console.log('  Δ=' + s.padStart(5) + ' bytes: ' + c));

// For pair[0] "historic"/"olympics": what's between it and pair[1] ("volcano"/"eruption_at_etna_140")?
console.log('\nPair[0] header:');
console.log('  off: 0x' + pairs[0].off.toString(16));
console.log('  catLen + nameLen = ' + (pairs[0].catLen + pairs[0].nameLen));
console.log('  endOfStrings: 0x' + (pairs[0].off + pairs[0].catLen + pairs[0].nameLen).toString(16));
console.log('  Pair[1] off: 0x' + pairs[1].off.toString(16));
console.log('  Bytes between: ' + (pairs[1].off - (pairs[0].off + pairs[0].catLen + pairs[0].nameLen)));

// Wait — pairs[0].off=0x846b7 (after section header 8B). The section header at 0x846af spans 8B and size=0x22=34
// Means the FIRST "section" includes header + 34 body bytes:
//   [0x846af..0x846b7) = section header
//   [0x846b7..0x846d9) = 34-byte body (the "categories" enumeration)
//
// 34 = 2+9 (historic) + 2+9 (olympics) + 14? No: 2+9 + 2+9 = 22. So 34-22 = 12 trailing bytes inside body.
// Body: 0x846b7..0x846d9
//   0x846b7: 09 00 historic\0 (11B, ends 0x846c2)
//   0x846c2: 09 00 olympics\0 (11B, ends 0x846cd)
//   0x846cd..0x846d9 = 12 bytes trailer
// Then records start at 0x846d9

// Let me check what's at 0x846d9
console.log('\nBytes at 0x846d9 (header_end if size=0x22 = body 34B):');
for (let o = 0x846d9; o < 0x846d9 + 32; o += 16) {
  const slice = buf.subarray(o, o + 16);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}

// Actually the layout might be: top header [u32 self][u32 categoryCount] + repeating [pstr16 catName + u32 idx]
// 0x846af: af 46 08 00 (self) 22 00 00 00 (?) — but 0x22 could be 34 OR it could be: u16 categoryCount=2 + u16 unknown=0
//
// Re-read: at 0x846b3: 22 00 00 00
// If u16: 0x0022 = 34 categories total in file? Let me count actual unique categories
const allCats = new Set();
pairs.forEach(p=>allCats.add(p.cat));
console.log('\nUnique categories: ' + allCats.size);
[...allCats].forEach(c=>console.log('  "' + c + '"'));

// Look for "earthquake" as a category to find counts
const catCount = {};
pairs.forEach(p=>catCount[p.cat]=(catCount[p.cat]||0)+1);
console.log('\nCategory counts:');
Object.entries(catCount).forEach(([k,v])=>console.log('  ' + k.padEnd(20) + ' ' + v));

// Hmm — "historic" and "olympics" appear at 0x846b7 — these are CATEGORIES not records?
// Let me check pairs more carefully — maybe they're (catKind, catName) at top
// What categories do we see?
//   "historic"/"olympics" — unique header pair
//   "volcano"/"eruption_at_*" — many
//   "earthquake"/"earthquake_*" — many
//   etc

// Check: between pair[0] (off=0x846b7) and pair[1] (off=0x846e6)
// strings: historic (11B) + olympics (11B) = 22B, ends at 0x846cd
// Then 0x846cd..0x846e6 = 25 bytes opaque

// stride from pair[0] to pair[1] = 0x846e6 - 0x846b7 = 47B
// Layout: 22B strings + 25B extra
// 25B extra: at 0x846cd...
console.log('\nBytes at 0x846cd (end of olympics nul) for 25 bytes:');
for (let o = 0x846cd; o < 0x846e6; o += 16) {
  const slice = buf.subarray(o, Math.min(o + 16, 0x846e6));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}

// For pair[1] (off=0x846e6) "volcano"/"eruption_at_etna_140"
// strings: 2+8 (volcano) + 2+21 (eruption_at_etna_140) = 33B, ends at 0x84707
// stride pair[1]->pair[2] = 0x84728 - 0x846e6 = 66B
// payload: 0x84707..0x84728 = 33B
console.log('\nBytes at 0x84707 (after etna_140) for 33 bytes:');
for (let o = 0x84707; o < 0x84728; o += 16) {
  const slice = buf.subarray(o, Math.min(o + 16, 0x84728));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}

// Look at the tail: from last pair to END
const lastPair = pairs[pairs.length - 1];
const lastEnd = lastPair.off + lastPair.catLen + lastPair.nameLen;
console.log('\nLast pair @0x' + lastPair.off.toString(16) + ' (' + lastPair.cat + '/' + lastPair.name + ')');
console.log('Strings end at: 0x' + lastEnd.toString(16));
console.log('END: 0x' + END.toString(16));
console.log('Trailing bytes: ' + (END - lastEnd));
console.log('Trailing payload:');
for (let o = lastEnd; o < Math.min(lastEnd + 128, END); o += 16) {
  const slice = buf.subarray(o, Math.min(o + 16, END));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}

// What's the stride from last pair to END?
console.log('\nStride last pair to END: ' + (END - lastPair.off));

// Quick: are records all the same stride?
const allStrides = new Set(strides);
console.log('\nUnique strides:', [...allStrides].sort((a,b)=>a-b));
