// Session 65 sweep 2 — decode the 9-byte stride record.
// Pattern: 2295 bytes / 9 = 255 records exactly.  2288/9 = 254.22 (close).
// 2281/9 = 253.44.  Maybe stride is variable or has small prefix.
// Looking at 015cfe7b: the first 2 bytes (00 00) precede the first "04 4c 04 60 00 00 00 00 00"
// So maybe records start at +2, and rec is 9 bytes? (2295-2)/9 = 254.78. Hmm.
// Let's hex-dump end of one range to find the trailing bytes.

const fs = require('fs');
const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

function hex(b, len) {
  let s = '';
  for (let i = 0; i < len && i < b.length; i++) s += b[i].toString(16).padStart(2, '0') + ' ';
  return s;
}

function dumpRange(s, e, label) {
  console.log(`\n=== ${label} 0x${s.toString(16)} .. 0x${e.toString(16)} (${e-s} B) ===`);
  console.log('first 80:', hex(buf.slice(s, s+80), 80));
  console.log('last  80:', hex(buf.slice(e-80, e), 80));

  // Try to find a stride. The pattern "XX YY ZZ N0 00 00 00 00 00" looks like
  // u32 LE + u32 LE + 1 byte? Or u16 + u32 + ... Let's see:
  // 4c 04 60 00 = LE 0x0060044c = 6291532
  // 1d 05 60 00 = LE 0x0060051d
  // 1e 04 30 00 = LE 0x0030041e
  // These all look like 24-bit values packed into u32 with high byte 0.
  // The 4th byte cycles between 10..70 in multiples of 0x10 -- 1/2/3/4/5/6/7 *0x10
  // That looks like a TYPE field (0..7).

  // Try 9-byte stride starting at s, s+1, s+2
  for (let off = 0; off < 9; off++) {
    let ok = 0;
    const end = Math.min(e, s + 90); // first 10 records
    for (let p = s + off; p + 9 <= end; p += 9) {
      const b4 = buf[p+3];
      const b5to8 = buf.readUInt32LE(p+4);
      const b9 = buf[p+8];
      // expect b3 in {0x10,0x20,0x30,0x40,0x50,0x60,0x70} and bytes 4..8 all zero
      if ((b4 & 0x0f) === 0 && b4 <= 0x80 && buf[p+4]===0 && buf[p+5]===0 && buf[p+6]===0 && buf[p+7]===0 && buf[p+8]===0) {
        ok++;
      }
    }
    console.log(`  stride 9 @ off=${off}: ${ok}/10 records match pattern`);
  }
}

dumpRange(0x015cfe7b, 0x015d0772, 'range A');
dumpRange(0x015d088a, 0x015d1181, 'range B');
dumpRange(0x015fb87c, 0x015fc177, 'range C');
dumpRange(0x015e72b9, 0x015e7ba2, 'range D');
dumpRange(0x016091aa, 0x01609a9a, 'range E');
dumpRange(0x01f17f18, 0x01f18948, 'range F (in faction zone)');

// Scan the WHOLE file for runs of this pattern.
// Pattern: every 9 bytes, bytes [3..8] match XX YY ZZ NN 00 00 00 00 00 where bytes 5..8 are 0.
// Actually pattern is: XX YY ZZ NN 00 00 00 00 00 — 9 bytes with bytes 5..9 (last 5) all zero,
// byte 4 being a small enum (0x00..0x70).
console.log('\n=== Whole-file scan for stride-9 record pattern ===');
const FILE = buf.length;
let runStart = -1;
let runs = [];
function isRec(p) {
  if (p + 9 > FILE) return false;
  // bytes p+4..p+8 must be zero (5 zero bytes)
  if (buf[p+4] !== 0 || buf[p+5] !== 0 || buf[p+6] !== 0 || buf[p+7] !== 0 || buf[p+8] !== 0) return false;
  // byte p+3 is the "type nibble" — low nibble must be 0, value <= 0x80
  const b3 = buf[p+3];
  if ((b3 & 0x0f) !== 0) return false;
  if (b3 > 0x80) return false;
  // bytes 0..2 form a u24 — at least one must be nonzero usually but allow zero too
  return true;
}

let p = 0;
while (p + 9 <= FILE) {
  if (isRec(p)) {
    const start = p;
    while (p + 9 <= FILE && isRec(p)) p += 9;
    const len = p - start;
    if (len >= 90) { // 10+ records
      runs.push([start, p, len]);
    }
  } else {
    p++;
  }
}

runs.sort((a,b)=>b[2]-a[2]);
console.log(`total runs (>= 10 records) of stride-9: ${runs.length}`);
let totalBytes = 0;
for (const [s,e,l] of runs) totalBytes += l;
console.log(`total bytes covered: ${totalBytes}`);
console.log('top 20:');
for (let i = 0; i < Math.min(20, runs.length); i++) {
  const [s,e,l] = runs[i];
  console.log(`  0x${s.toString(16).padStart(8,'0')} .. 0x${e.toString(16).padStart(8,'0')} = ${l} bytes (${l/9} recs)`);
}
