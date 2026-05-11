// Session 26 — Decode the 13.9KB char UUID index at 0x51ad..0x87e9
// Per dossier: "Single self-pointing section, kid[0] from session 12 — sorted u32 ID list of ~1157 entries"

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

const START = 0x51ad, END = 0x87e9;
console.log('UUID index region:', '0x' + START.toString(16), '..', '0x' + END.toString(16), '=', (END-START), 'bytes');

// Check for self-pointer header
const sp1 = buf.readUInt32LE(START);
const sz = buf.readUInt32LE(START+4);
console.log('Header u32 @ START:', '0x' + sp1.toString(16), '(self-pointer?)');
console.log('Header u32 @ START+4:', sz, '(size?)');
console.log('Expected section end if size=' + sz + ':', '0x' + (START + sz).toString(16));

// Hex dump first 256
console.log('\n=== First 256 bytes ===');
for (let o = START; o < START + 256; o += 16) {
  const slice = buf.subarray(o, Math.min(o+16, END));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b=>(b>=0x20&&b<0x7f)?String.fromCharCode(b):'.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex + '  ' + ascii);
}

// Hex dump last 128 bytes
console.log('\n=== Last 128 bytes ===');
for (let o = Math.max(END-128, START); o < END; o += 16) {
  const slice = buf.subarray(o, Math.min(o+16, END));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}

// Try parsing as fixed-stride u32 records
// Stride 4: 14108/4 = ~3527 u32 entries
// Stride 8: 1763 pairs
// Stride 12: 1175 triplets
for (const stride of [4, 8, 12, 16, 20, 24]) {
  console.log('\n=== Stride ' + stride + ' analysis ===');
  const N = Math.floor((END - START - 8) / stride);  // skip 8B header
  // Print first 10 entries
  for (let i = 0; i < Math.min(8, N); i++) {
    const o = START + 8 + i*stride;
    const fields = [];
    for (let j = 0; j < stride; j += 4) {
      if (o + j + 4 > END) break;
      fields.push('0x' + buf.readUInt32LE(o + j).toString(16).padStart(8,'0'));
    }
    console.log('  [' + i + '] 0x' + o.toString(16) + ': ' + fields.join(' '));
  }
}

// Check sorted-u32 hypothesis
// Treat the whole region (after 8B header) as u32 array
const N4 = Math.floor((END - START - 8) / 4);
console.log('\n=== As u32 array (after 8B header): ' + N4 + ' entries ===');
const u32s = [];
for (let i = 0; i < N4; i++) u32s.push(buf.readUInt32LE(START + 8 + i*4));
console.log('First 30 u32:');
for (let i = 0; i < 30; i++) console.log('  [' + i + '] = ' + u32s[i] + ' = 0x' + u32s[i].toString(16).padStart(8,'0'));
console.log('Last 10 u32:');
for (let i = N4-10; i < N4; i++) console.log('  [' + i + '] = ' + u32s[i] + ' = 0x' + u32s[i].toString(16).padStart(8,'0'));

// Check if u32s are SORTED
let sorted = true;
for (let i = 1; i < N4; i++) if (u32s[i] < u32s[i-1]) { sorted = false; console.log('Not sorted at i=' + i + ': prev=' + u32s[i-1] + ' curr=' + u32s[i]); break; }
console.log('Sorted ascending:', sorted);

// Even-index vs odd-index: if pairs (key, value), they might NOT be globally sorted but key-sorted
const evens = [], odds = [];
for (let i = 0; i < N4; i+=2) evens.push(u32s[i]);
for (let i = 1; i < N4; i+=2) odds.push(u32s[i]);
console.log('Pair-mode: evens count=' + evens.length + ', odds count=' + odds.length);
console.log('Even sorted asc?', evens.every((v,i)=>i===0 || evens[i]>=evens[i-1]));
console.log('Odd sorted asc?', odds.every((v,i)=>i===0 || odds[i]>=odds[i-1]));
console.log('First 10 evens:', evens.slice(0,10));
console.log('First 10 odds:', odds.slice(0,10));

// Check if these match the event-log hashes from session 26 (top hashes there: 0xec22d10b etc.)
const eventLogHashes = [
  0xec22d10b, 0x9cfb069d, 0xc1babc2f, 0x89161d61, 0x0d09eade,
  0xca6d80a3, 0xd0ac389d, 0xee3ba2aa, 0x1c87454b, 0x53eb05ff
];
console.log('\n=== Cross-reference with event-log hashes ===');
const u32Set = new Set(u32s);
let hits = 0;
for (const h of eventLogHashes) {
  if (u32Set.has(h>>>0)) { hits++; console.log('  HIT: 0x' + h.toString(16) + ' in UUID index'); }
  else console.log('  miss: 0x' + h.toString(16));
}
console.log('Total hits:', hits, '/', eventLogHashes.length);

// Check for the lua-footer faction-IDs
const factionIds = [1110011, 1210021, 5000020, 1320041, 1820161];
console.log('\n=== Cross-reference with faction IDs (top 5) ===');
for (const f of factionIds) {
  if (u32Set.has(f)) console.log('  HIT: ' + f + ' in UUID index');
  else console.log('  miss: ' + f);
}

// Check stride 8 = (key, value)
console.log('\n=== Stride-8 paired interpretation ===');
const pairs = [];
for (let i = 0; i < N4 - 1; i += 2) {
  pairs.push({key: u32s[i], val: u32s[i+1]});
}
console.log('Pairs:', pairs.length);
// Check key sorted
let keySorted = true;
for (let i = 1; i < pairs.length; i++) if (pairs[i].key < pairs[i-1].key) { keySorted = false; break; }
console.log('Keys sorted asc?', keySorted);
// First few pairs
console.log('First 20 pairs (key/val):');
pairs.slice(0,20).forEach((p,i)=>console.log('  [' + i + '] key=0x' + p.key.toString(16).padStart(8,'0') + ' val=0x' + p.val.toString(16).padStart(8,'0') + ' (' + p.key + ' / ' + p.val + ')'));

// Find what comes before this section: section header at START-12 etc?
console.log('\n=== Bytes BEFORE 0x51ad (12 prior) ===');
for (let o = 0x51a1; o < 0x51bd; o++) {
  process.stdout.write(buf[o].toString(16).padStart(2,'0') + ' ');
}
console.log();

// Check: is there a section header (selfPtr+size) at 0x51ad?
const v0 = buf.readUInt32LE(0x51ad);
const v4 = buf.readUInt32LE(0x51b1);
const v8 = buf.readUInt32LE(0x51b5);
console.log('At 0x51ad: u32[0]=0x' + v0.toString(16), 'u32[1]=' + v4, 'u32[2]=0x' + v8.toString(16));
// If 0x51ad is a self-pointer with size, expected: v0==0x51ad
// If not self-pointing, maybe it's a count or just data

// Now: does the region include a section header? section size needed for it to span 0x51ad..0x87e9 = 13884 bytes
// 13884 = 0x363c
// Search for section header pattern (selfPtr, sz) where selfPtr near START
for (let o = 0x51a8; o < 0x51c0; o++) {
  const v = buf.readUInt32LE(o);
  if (v === o) {
    const s = buf.readUInt32LE(o+4);
    console.log('  Found self-ptr at 0x' + o.toString(16) + ' size=' + s + ' (expected ' + (END-o) + '): match=' + ((o+s)===END));
  }
}

// Let me also check if the region has a "u32 N count" at the START
const headerN = buf.readUInt32LE(START);
console.log('\nHypothesis: header u32 at 0x' + START.toString(16) + ' = ' + headerN + ' (count of entries?)');
// If header is COUNT, then total bytes per entry = (END - START - 4) / N
if (headerN > 0 && headerN < 100000) {
  const per = (END - START - 4) / headerN;
  console.log('  → ' + per + ' bytes per entry if so');
}
