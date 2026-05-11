// Walk body root linearly: after the preamble (two UTF-16 strings + small header),
// each child is a taw section {u32 self_ptr_eq_pos, u32 size, content[size-8]}

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);
const ROOT_OFF=0x3b99, ROOT_SIZE=0x63001a, ROOT_END=ROOT_OFF+ROOT_SIZE;

// Per the byte dump, payload structure:
//   +0  u16 lenP1=0x1a=26
//   +2  UTF-16LE "campaign/imperial_campaign" (25 chars * 2 = 50 bytes)
//   +52 u16 lenP1=0x11=17
//   +54 UTF-16LE "imperial_campaign" (16 chars * 2 = 32 bytes)
//   +86 from start (0x3ba1+86 = 0x3bf7) self-ptr=0x3bf7 size=0x1 (single byte payload)
// So first real child at 0x3bf7
//
// Wait, that's the second of the strings ending. Let me retrace.
// 0x3ba1 = body content start (after root's 8-byte header)
// At 0x3ba1: byte sequence is "61 00 6d 00 70 00 61 00" = "a m p a" UTF-16 starting
// So the FIRST u16 at body content start would be at 0x3b9f (-2 = lenP1) but body
// content starts at 0x3ba1. Actually the lenP1 was BEFORE.
// 0x3b99: 0x99 0x3b 0x00 0x00 (self-ptr u32)
// 0x3b9d: 0x1a 0x00 0x63 0x00 (size u32 = 0x63001a)
// 0x3ba1: 0x61 0x00 ... — but per protocol, body content starts here.
// Wait the size byte sequence is 0x1a 0x00 0x63 0x00 → little-endian u32 = 0x0063001a.
// So size = 0x63001a (correct).
// But the bytes 0x1a 0x00 also look like a lenP1=0x1a... hmm coincidence.
//
// Let me recheck: at 0x3ba1, the bytes are "61 00 6d 00 70 00 61 00 69 00..."
// That's "a\0m\0p\0a\0i\0..." which is "ampai..." (continuation of "campaign").
// So the "campaign" string actually STARTS at 0x3b9f (-2 byte = lenP1=0x1a) or
// earlier. The size field 0x1a 0x00 was probably read as part of the string!
//
// Actually the root section's "size" overlaps with the string's lenP1. Tricky.
// Let me re-read carefully:
//   0x3b99: 99 3b 00 00      = u32 self-pointer 0x3b99
//   0x3b9d: 1a 00 00 00 ???  — looking at the hex dump from script 1, line 0x3b90:
//     "4f 4e 00 01 00 00 00 04 00 99 3b 00 00 1a 00 63 00 61 00 6d 00 70..."
//   So at offset 0x3b90: 4f 4e 00 01 00 00 00 04 00 99 3b 00 00 1a 00 63
//                       ^0x3b90                 ^0x3b99 (=99 3b 00 00 self-ptr)
//                                               then 1a 00 63 00 = lenP1=0x1a (26 chars-1?)
//   Wait the u32 size at 0x3b9d would be: bytes 0x3b9d,0x3b9e,0x3b9f,0x3ba0
//   = ??, ??, ??, ?? — need to read raw.

const hex = (a,n)=>{let s=''; for(let i=0;i<n;i++) s+=buf[a+i].toString(16).padStart(2,'0')+' '; return s;};
console.log('0x3b90..0x3bc0:');
for(let o=0x3b90; o<0x3bc8; o+=8) console.log(' '+o.toString(16)+': '+hex(o,8));

// u32 at 0x3b99:
console.log('\nu32 @0x3b99:', buf.readUInt32LE(0x3b99).toString(16));
console.log('u32 @0x3b9d:', buf.readUInt32LE(0x3b9d).toString(16));
console.log('u32 @0x3ba1:', buf.readUInt32LE(0x3ba1).toString(16));

// Hypothesis: body root is NOT a standard taw section. The 0x3b99 self-pointer
// is part of a different structure. Let me check: is 0x3b99 a u32 == its position?
// Yes (verified by script 1).
// Then the NEXT u32 at 0x3b9d is ???
// From the hex string "...99 3b 00 00 1a 00 63 00 61 00 6d 00..."
// u32 at 0x3b9d = bytes 0x3b9d, 0x3b9e, 0x3b9f, 0x3ba0
// In the dump, "1a 00 63 00" — but wait, that's already at 0x3b9d?
// Looking at the offsets: 0x3b90: "4f 4e 00 01" means 4f@0x3b90, 4e@0x3b91, 00@0x3b92, 01@0x3b93.
// "00 00 00" = 00@0x3b94, 00@0x3b95, 00@0x3b96. So 0x3b97-0x3b97 = ??.
// Wait the row was "4f 4e 00 01 00 00 00 04 00 99 3b 00 00 1a 00 63".
// That's 16 bytes starting at 0x3b90. So:
//   0x3b90 = 4f
//   0x3b91 = 4e
//   0x3b92 = 00
//   0x3b93 = 01
//   0x3b94 = 00
//   0x3b95 = 00
//   0x3b96 = 00
//   0x3b97 = 04
//   0x3b98 = 00
//   0x3b99 = 99
//   0x3b9a = 3b
//   0x3b9b = 00
//   0x3b9c = 00
//   0x3b9d = 1a
//   0x3b9e = 00
//   0x3b9f = 63
//
// So:
//   u32 @ 0x3b99 = (99 3b 00 00) = 0x3b99 (SELF — body root start)
//   u32 @ 0x3b9d = (1a 00 63 00) = 0x0063001a (SIZE of body root)
//   At 0x3ba1: u16 lenP1 = (61 00) = 0x0061?? That's weird.
//
// Wait but the actual lenP1 of "campaign/imperial_campaign" should be 26+1=27=0x1b
// or just 26 = 0x1a (the latter if it's NOT NUL-terminated).
//
// Let me check: characters c-a-m-p-a-i-g-n-/-i-m-p-e-r-i-a-l-_-c-a-m-p-a-i-g-n = 26 chars
// In UTF-16LE that's 52 bytes. If lenP1=26 (=char count, no NUL), the bytes would be
// at offset 0x3b9f (= 0x3b9d+2)? Actually the lenP1 might be at 0x3b9f or before.
//
// Hmm wait. Looking again: 0x3b9d = 1a, 0x3b9e=00, 0x3b9f=63, 0x3ba0=00, 0x3ba1=61
// "1a 00" at 0x3b9d looks like a u16 = 26 = lenP1 of the string.
// "63 00 61 00 6d 00..." at 0x3b9f onward = "c a m..." UTF-16LE = "campaign/imperial_campaign"
//
// But then where's the u32 size of the body root? It must be that body root is NOT
// a standard taw section. The "0x3b99 self-pointer" might just be a coincidence,
// OR the body root's size is encoded differently.
//
// Let me check: if we treat 0x3b99 as a section start with TWO header words
// (self+size), the size would be at 0x3b9d. u32 @ 0x3b9d = bytes 1a 00 63 00 = 0x0063001a.
// 0x0063001a = 6488090. body root end = 0x3b99+6488090 = 0x633bb3. ✓ matches dossier.
//
// And the body content starts at 0x3ba1 = 0x3b99 + 8. At 0x3ba1 the bytes are
// "61 00 6d 00 70 00 61 00..." which is the MIDDLE of "campaign" UTF-16.
//
// CONCLUSION: The body root size field overlaps the start of a UTF-16 string.
// Specifically, the u16 lenP1=0x001a sits in the body root size's low bytes
// (which are 0x1a 0x00 → coincidentally identical). The "campaign/imperial_campaign"
// string actually starts at 0x3b9d with lenP1 0x001a, and the string proper
// begins at 0x3b9f.
//
// So the body root has a 4-byte header (just the self-pointer at 0x3b99..0x3b9c)
// followed immediately by string-payload data at 0x3b9d. The "size" field
// I thought was at 0x3b9d is actually the string's lenP1 (=26 chars).
//
// Then where's the SIZE of body root encoded? It might NOT be a self-pointing
// section at all — the 0x3b99 self-pointer was coincidental? But session 12
// confirmed body root extends to 0x633bb3. Let me check if there's structure...
//
// Alternative: the body root's "self-pointer + size" pattern is just CONVENTION
// and the size is derived from "go until matching offset" or just file-end.
// Per session 12 the body root size 0x63001a is correct, but it's been derived
// from the next major region boundary (gap-region start = 0x633bb3) by inspection,
// NOT from a stored size field.

// Let me check: the first SELF-pointing section inside body root should be at 0x51ad.
console.log('\nFirst child @0x51ad:');
console.log(' u32:', buf.readUInt32LE(0x51ad).toString(16));
console.log(' u32 next:', buf.readUInt32LE(0x51b1).toString(16));
// per session 12 kid[0] = 13884B character-id index, kid[1]=0xa8d4d
console.log('\n@0xa8d4d:');
console.log(' u32:', buf.readUInt32LE(0xa8d4d).toString(16));

// Walk: starting at 0x51ad, advance by [size at +4] each time
console.log('\n--- Linear walk body root children ---');
let off = 0x51ad;
let i = 0;
const children = [];
while(off < ROOT_END - 12 && i < 1000){
  const sp = buf.readUInt32LE(off);
  const sz = buf.readUInt32LE(off+4);
  if(sp !== off){
    console.log(' BREAK @'+off.toString(16)+': self-ptr='+sp.toString(16)+' != pos');
    break;
  }
  if(sz < 8 || sz > 0x1000000 || off+sz > ROOT_END+4){
    console.log(' BAD-SIZE @'+off.toString(16)+': size='+sz.toString(16));
    break;
  }
  children.push({off, sz});
  if(i < 5 || i % 50 === 0) console.log(' kid['+i+'] @0x'+off.toString(16)+' size='+sz.toString(16)+' ('+sz+')');
  off += sz;
  i++;
}
console.log('Total children walked:', children.length, 'final offset:', off.toString(16), 'root end:', ROOT_END.toString(16));
console.log('Gap to root end:', ROOT_END - off);

// Size distribution
const sizes = children.map(c=>c.sz);
const sortedSizes = sizes.slice().sort((a,b)=>b-a);
console.log('\nLargest 10 children (size in bytes):');
sortedSizes.slice(0,10).forEach(s=>console.log(' ', s, '=', '0x'+s.toString(16)));
console.log('\nSize histogram (log10):');
const bins = {};
for(const s of sizes){
  const b = Math.floor(Math.log10(s));
  bins[b] = (bins[b]||0)+1;
}
for(let i=0;i<8;i++) if(bins[i]) console.log(' 10^'+i+'-10^'+(i+1)+': '+bins[i]+' kids');

// Total bytes accounted for
const total = sizes.reduce((a,b)=>a+b,0);
console.log('Total bytes in children:', total, '/ body root size', ROOT_SIZE, '=', (100*total/ROOT_SIZE).toFixed(1)+'%');

// What's between 0x3b99 and 0x51ad (= 5556 bytes)? That's the "preamble".
console.log('\nPreamble 0x3b99..0x51ad =', 0x51ad - 0x3b99, 'bytes');
