// Session 73 — Finalize the boundary: how many tail records and what's the trailer?

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAV);

const START = 0x846af, END = 0xa8beb;
const TAIL_START = 0x84f1d;

// Stride 26B. Walk and verify.
let count = 0;
let p = TAIL_START;
const samples = [];
while (p + 26 <= END) {
  // Check delim at +22..+26 = 4B 0xffffffff
  if (buf[p+22]===0xff && buf[p+23]===0xff && buf[p+24]===0xff && buf[p+25]===0xff) {
    if (samples.length < 5) samples.push({off:p, hex: buf.slice(p, p+26).toString('hex')});
    count++;
    p += 26;
  } else {
    break;
  }
}
console.log('Tail records (26B stride, delim at +22): ' + count);
console.log('Last record at: 0x' + (p-26).toString(16));
console.log('Next byte: 0x' + p.toString(16) + ' (END=0x' + END.toString(16) + ')');
console.log('Trailer: ' + (END - p) + ' bytes');

// Dump trailer
console.log('\nTrailer bytes:');
for (let o = p; o < END; o += 16) {
  const slice = buf.subarray(o, Math.min(o + 16, END));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}

// 5632 records × 26B = 146432B. From TAIL_START 0x84f1d, that ends at 0x84f1d+146432 = 0xa8a9d
// Then trailer = 0xa8a9d..0xa8beb = 0x14e = 334 bytes
// Hmm but my earlier delimiter count was 5633. Let me recount.

// Wait: I had 5632 stride values, which means 5633 delimiters and 5633 records.
// 5633 × 26 = 146458. 0x84f1d + 146458 = 0xa8aaf. Then trailer = 0xa8beb - 0xa8aaf = 316 bytes.

// Let me also check: what if rec[0] is at 0x84f1d but the first 4 bytes are NOT part of a record but a prologue?
// Then tail-records start at 0x84f21 with stride 26 and delim at offset +20..+24

// Check: bytes at 0x84f21
console.log('\nBytes at 0x84f21:');
for (let o = 0x84f21; o < 0x84f21 + 64; o += 16) {
  const slice = buf.subarray(o, o + 16);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}

// Try walking from 0x84f21 with stride 26 and delim at offset +20
let count2 = 0;
let p2 = 0x84f21;
while (p2 + 26 <= END) {
  if (buf[p2+20]===0xff && buf[p2+21]===0xff && buf[p2+22]===0xff && buf[p2+23]===0xff) {
    count2++;
    p2 += 26;
  } else {
    break;
  }
}
console.log('From 0x84f21 with delim at +20: ' + count2 + ' records, ended at 0x' + p2.toString(16));

// What is at 0x84efc..0x84f1d (33 bytes - the "last named record payload")?
// From earlier:
// 0x84efc: 0f ff ff ff 02 00 00 00 01 00 00 00 26 01 00 00
// 0x84f0c: 93 01 00 00 02 00 00 00 00 00 00 00 00 00 00 00
// 0x84f1c: 00
// 0x84f1d starts tail.

// 33B payload at 0x84efc:
// +0  i32  year = -241 (0x0fffffff = -241 LE? Let me check: 0x0f ff ff ff LE = 0xffffff0f = -241. YES)
// +4  u32  category id = 2
// +8  u32  ? = 1
// +12 u32  X = 294 (0x126) = flood_in_rome at X=294
// +16 u32  Y = 403 (0x193) = flood_in_rome at Y=403
// +20 u32  ? = 2
// +24 u32  ? = 0
// +28 u32  ? = 0  (last 4 bytes of payload)
// +32 byte 0
// Then tail starts.

// Wait so payload is 33B but ends at 0x84efc+33=0x84f1d (correct)

// Let me also re-examine the first record's 25B payload (historic/olympics)
console.log('\nFirst-record payload (25B from 0x846cd):');
for (let o = 0x846cd; o < 0x846e6; o += 16) {
  const slice = buf.subarray(o, Math.min(o + 16, 0x846e6));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}
// 0x846cd: f3 fe ff ff = -269 (year). i32 = 0xfffffef3 = -269. Match. 270 BC start... 270-269... hmm odd.
// 0x846d1: 02 00 00 00 = 2
// 0x846d5: 00 00 00 00 = 0
// 0x846d9: 01 00 00 00 = 1
// 0x846dd: 00 00 00 00 = 0
// 0x846e1: 00 00 00 00 00 = 5 bytes? Hmm that's 5 bytes
// 25B payload. 0x846e6 - 0x846cd = 25. Bytes: 4+4+4+4+4 = 20, plus 5 more bytes = 25
// Hmm so layout for first ("historic" cat) record: 5 u32s + 5 trailing bytes
// Layout for "volcano" cat records: 5 u32s + 5 trailing 0 bytes + 8 more bytes? No, 33B for those.

// 33 = 8 u32 + 1 byte? Or 7 u32 + 5 bytes?
// volcano payload from 0x84707..0x84728 = 33B
// 0x84707: 74 ff ff ff (year -140 = etna_140 BC. CORRECT!)
// 0x8470b: 02 00 00 00 (= 2)
// 0x8470f: 01 00 00 00 (= 1)
// 0x84713: 37 01 00 00 (= 311 = etna X!)
// 0x84717: 58 01 00 00 (= 344 = etna Y!)
// 0x8471b: 00 00 00 00 (= 0)
// 0x8471f: 00 00 00 00 (= 0)
// 0x84723: 00 00 00 00 00 (= 5 bytes)
// total: 4*7 + 5 = 33 bytes ✓

// historic payload from 0x846cd..0x846e6 = 25B
// 0x846cd: f3 fe ff ff (year -269)
// 0x846d1: 02 00 00 00 = 2
// 0x846d5: 00 00 00 00 = 0
// 0x846d9: 01 00 00 00 = 1
// 0x846dd: 00 00 00 00 = 0
// 0x846e1: 00 00 00 00 00 = 5 bytes
// total: 4*5 + 5 = 25 bytes ✓

// So payload layout differs by category!
// historic: 5u32 + 5B = 25B
// volcano:  7u32 + 5B = 33B
// earthquake: ?
// flood:    ?

// Check earthquake payload at e.g. rec[18] (earthquake_at_santorini, 0x84b5f)
const r18 = 0x84b5f;
// strings: pstr16 "earthquake" (2+11=13B), pstr16 "earthquake_at_santorini" (2+24=26B) = 39B
const r18_strEnd = r18 + 13 + 26;
console.log('\nrec[18] earthquake/earthquake_at_santorini, strings end at 0x' + r18_strEnd.toString(16));
console.log('Payload bytes:');
for (let o = r18_strEnd; o < r18_strEnd + 64 && o < 0x84ba7; o += 16) {
  const slice = buf.subarray(o, Math.min(o + 16, 0x84ba7));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}
console.log('Payload size: ' + (0x84ba7 - r18_strEnd));
// 0x84ba7 is rec[19] off

// flood payload
const r33 = 0x84ee0;
const r33_strEnd = r33 + 7 + 19; // flood (2+6=8? actually 2+6 nope flood is 5+null=6 -> lenP1=6, total=8) and flood_in_rome_241
// Actually flood = 5 chars + nul = 6 bytes; lenP1=6 -> total 2+6=8
// flood_in_rome_241 = 17 chars + nul = 18 bytes; lenP1=18 -> total 2+18=20
const r33_strEndCorrect = r33 + 8 + 20;
console.log('\nrec[33] flood/flood_in_rome_241, strings end at 0x' + r33_strEndCorrect.toString(16));
console.log('Payload bytes (33B):');
for (let o = r33_strEndCorrect; o < r33_strEndCorrect + 33; o += 16) {
  const slice = buf.subarray(o, Math.min(o + 16, r33_strEndCorrect + 33));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  console.log('  0x' + o.toString(16) + ': ' + hex);
}
console.log('Total payload before tail starts: ' + (0x84f1d - r33_strEndCorrect));
