// Session 23: hash blob #6 — pin the section structure.
// (a) The self-pointer at 0x1f442a8 is a SECTION BOUNDARY. Decode as standard section grammar
//     {u32 absoluteOffset, u32 size, payload}
// (b) Map the 289 unique 8-byte records — what could correlate with 289?
// (c) Walk the 16-byte zero records starting around 0x1f442e8 with correct offset.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

// (a) Section parsing at 0x1f442a8: selfPtr=0x1f442a8, then size?
const sectStart = 0x1f442a8;
const selfPtr = buf.readUInt32LE(sectStart);
const size = buf.readUInt32LE(sectStart + 4);
console.log(`Section at 0x${sectStart.toString(16)}:`);
console.log(`  selfPtr = 0x${selfPtr.toString(16)}  ${selfPtr === sectStart ? '(MATCHES — valid section header)' : '(MISMATCH)'}`);
console.log(`  size    = 0x${size.toString(16)} = ${size}`);
console.log(`  end     = 0x${(sectStart + size).toString(16)}`);

// Walk further: are there more section headers?
console.log(`\n=== Section walker from 0x${sectStart.toString(16)} ===`);
let p = sectStart;
let secCount = 0;
while (p + 8 < buf.length && secCount < 50) {
  const ptr = buf.readUInt32LE(p);
  const sz = buf.readUInt32LE(p + 4);
  if (ptr === p && sz >= 8 && sz < 100_000_000 && p + sz <= buf.length) {
    console.log(`  Section[${secCount}] @ 0x${p.toString(16)}: size=${sz} (0x${sz.toString(16)}), end=0x${(p+sz).toString(16)}`);
    p += sz;
    secCount++;
  } else {
    console.log(`  Stride breaks at 0x${p.toString(16)}: ptr=0x${ptr.toString(16)} sz=${sz}`);
    // Show following 32 bytes for context
    console.log(`  Following bytes: ${buf.subarray(p, p + 32).toString('hex')}`);
    break;
  }
}

// (b) Look at what comes before 0x1f442a8 — find prior section header
console.log(`\n=== Scan backward from 0x1f442a8 for prior section header ===`);
for (let off = sectStart - 4; off > sectStart - 0x10000; off -= 4) {
  const ptr = buf.readUInt32LE(off);
  if (ptr === off) {
    const sz = buf.readUInt32LE(off + 4);
    if (sz >= 8 && sz < 100_000_000 && off + sz === sectStart) {
      console.log(`  Prior section @ 0x${off.toString(16)}: size=${sz}, ends at 0x${(off+sz).toString(16)} (= our section start!)`);
      break;
    }
    if (sz >= 8 && sz < 100_000_000) {
      console.log(`  Self-pointer at 0x${off.toString(16)}, size=${sz}, end=0x${(off+sz).toString(16)} (does NOT chain to our section)`);
    }
  }
}

// (c) The 289-unique-8B-records hypothesis: maybe it's 8B hash + (8B/16B uuid in a separate section)?
// 289 == 23 majors + 216 minors + 50 unknowns? RIS has 23+216=239 factions per session 17.
// Or it's per-character data; if 289 characters in rome10, that's plausible.

// Count of character records via CHARACTER_PATHS would need section walk; skip.
// Instead, scan ASCII strings in the body for "character" markers near offsets where 289 appears.

// (d) Walk the 16-byte stride zeros block correctly. Each record is 16B with +12..+15 = 03 00 00 00.
let recCount = 0;
const arrStart = 0x1f442e8;
p = arrStart;
while (p + 16 <= buf.length) {
  let isPattern = true;
  // Bytes 0..11 must be zero
  for (let i = 0; i < 12; i++) if (buf[p + i] !== 0) { isPattern = false; break; }
  // Bytes 12..15 must be 03 00 00 00
  if (isPattern) {
    if (buf[p + 12] !== 0x03) isPattern = false;
    if (buf[p + 13] !== 0 || buf[p + 14] !== 0 || buf[p + 15] !== 0) isPattern = false;
  }
  if (!isPattern) break;
  recCount++;
  p += 16;
}
console.log(`\n16-byte all-zero-except-(+12=3) records starting 0x${arrStart.toString(16)}: ${recCount}`);
console.log(`Array ends at: 0x${p.toString(16)} (size ${p - arrStart} bytes)`);

// Show what follows
console.log(`\n=== After value=3 array end ===`);
for (let off = p; off < p + 256; off += 16) {
  const slice = buf.subarray(off, off + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  console.log(`  0x${off.toString(16)}: ${hex}`);
}

// (e) Reconciliation: what is the total span from 0x1f442a8 (section header) to where structure resumes?
// The previous section header pointed here. The "size" field tells us where this section ends.
// If size is e.g. ~19KB, the entire "hash blob region" is one section.

// (f) Try parsing the 8-byte high-entropy records: maybe they're hash+something else where bytes 0..3
// = some structured value, bytes 4..7 = random.
console.log(`\n=== First 10 records of high-entropy zone (8B each) ===`);
for (let i = 0; i < 10; i++) {
  const off = 0x1f43898 + i * 8;
  const rec = buf.subarray(off, off + 8);
  // As u32 + u32
  const lo = buf.readUInt32LE(off), hi = buf.readUInt32LE(off + 4);
  console.log(`  rec[${i}] @ 0x${off.toString(16)}: ${rec.toString('hex')}  (u32lo=0x${lo.toString(16).padStart(8,'0')}, u32hi=0x${hi.toString(16).padStart(8,'0')})`);
}
