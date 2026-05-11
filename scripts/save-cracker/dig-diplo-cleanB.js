// Session 32 step B: locate the START of the diplomatic matrix array.
// First default-state record is at 0xf8fde. But there must be records BEFORE it
// that are non-default (e.g., the first row of the matrix is "faction X vs faction X" with state="self").
// Walk back from 0xf8fde in 267-byte steps and look at the records.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));

const stride = 267;

// Walk back from 0xf8fde (a known record start = sig start).
// Each record is 267 bytes. So records start at: 0xf8fde - k*267 for k = 0, 1, 2, ...
// Print byte content of records k=0 to k=20 walking back.

console.log(`Walking BACK from sig-start at 0xf8fde in 267-byte steps...`);
const REC_LEN = 267;
function previewRecord(off) {
  if (off < 0) return null;
  return a.slice(off, off + REC_LEN);
}
function hex(buf) {
  return Array.from(buf).map(x => x.toString(16).padStart(2, '0')).join(' ');
}

for (let k = 30; k >= -2; k--) {
  const off = 0xf8fde - k * stride;
  if (off < 0) continue;
  const rec = previewRecord(off);
  if (!rec) continue;
  console.log(`\n--- record k=-${k} at offset 0x${off.toString(16)} ---`);
  // Print first 80 bytes.
  for (let i = 0; i < 80; i += 16) {
    const s = rec.slice(i, Math.min(i + 16, rec.length));
    console.log(`  +${i.toString().padStart(3)}: ${hex(s)}`);
  }
}

// Now look at the offsets relative to record start: which 24-byte run is the signature?
// First record at 0xf8fde — actually wait, hits[] are the offsets where sig was found.
// hits[0]=0xf8fde. So sig starts at 0xf8fde and record contains it. Record start could be:
//   - 0xf8fde itself (sig is at +0),
//   - or some N bytes before (sig is at +N).
// Look at the structural prefix before the sig. From earlier:
//   0x103280 line: 00 00 00 00 00 00 [ENUM=05] 00 00 00 00 00 00 00 00 00
//   0x103290 line: 00 00 [0a 00 00 00 c8 00 00 00 ...]
// So before sig: 12 bytes (8 zeros + ENUM(u32 at +0x06 from row start) + ... ?)
// Actually the LINE 0x103280-0x103290 shows: 16 zeros, then "05 00 00 00 00 00 00 00 00 00 0a 00 00 00 c8 00 00 00"
// That's 6 bytes zero + 4 bytes enum + 6 bytes zero + sig.

// Try a different signature that includes more: 16 bytes BEFORE sig:
// `06 00 00 00 00 00 00 00 00 00 0a 00 00 00 c8 00 00 00 ...`
// Or simpler: just check what's at each record's start.

// Actually: the simple way: each record is 267 bytes. The sig is somewhere inside.
// hits[0] = 0xf8fde = sig start. Record might start anywhere from 0xf8fde - 266 to 0xf8fde.
// Let me find where the section in which the matrix sits begins by looking for a section header
// (8-byte self-pointer + size).

// Section grammar: u32 absolute_offset + u32 size, where absolute_offset == own offset.
// Look for u32le-at-offset-equals-offset within 10KB before hits[0].
console.log(`\n=== Section anchors near hits[0] ===`);
for (let i = Math.max(0, 0xf8fde - 10000); i < 0xf8fde + 1000; i += 1) {
  const sp = a.readUInt32LE(i);
  if (sp === i) {
    const sz = a.readUInt32LE(i + 4);
    if (sz > 1000 && sz < 100000000) {
      console.log(`  section anchor at 0x${i.toString(16)} size=${sz} (0x${sz.toString(16)})`);
    }
  }
}
