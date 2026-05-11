// dig-gap11.js — final sweep: UTF-16LE strings + faction-magic + ascii in the main 9.3MB array
// (everything BEFORE 0xf84641)
const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const START = 0x633bb3;
const END = 0xf84641;  // end of uniform 267-byte record array

// 1) Faction magic ff 0a af f0
let magicCount = 0;
const magic = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);
for (let p = START; p < END - 4; p++) {
  if (buf[p]===0xff && buf[p+1]===0x0a && buf[p+2]===0xaf && buf[p+3]===0xf0) magicCount++;
}
console.log(`ff 0a af f0 faction magic occurrences in 0x${START.toString(16)}..0x${END.toString(16)}: ${magicCount}`);

// 2) ASCII strings >=4 chars
let strCount = 0;
let cur = null;
const strs = [];
for (let p = START; p < END; p++) {
  const b = buf[p];
  if (b >= 32 && b <= 126) {
    if (!cur) cur = { start: p, end: p };
    cur.end = p;
  } else {
    if (cur && cur.end - cur.start + 1 >= 4) {
      strs.push({ pos: cur.start, len: cur.end - cur.start + 1 });
      strCount++;
    }
    cur = null;
  }
}
if (cur && cur.end - cur.start + 1 >= 4) {
  strs.push({ pos: cur.start, len: cur.end - cur.start + 1 });
  strCount++;
}
console.log(`ASCII strings (>=4) in 9.3MB uniform array: ${strCount}`);
strs.slice(0,10).forEach(s => console.log(`  0x${s.pos.toString(16)}  len=${s.len}  "${buf.slice(s.pos, s.pos+s.len).toString('ascii')}"`));

// 3) UTF-16LE printable strings >=4 chars
let utf16Count = 0;
cur = null;
const utf16s = [];
for (let p = START; p < END - 1; p += 2) {
  const lo = buf[p], hi = buf[p+1];
  if (hi === 0 && lo >= 32 && lo <= 126) {
    if (!cur) cur = { start: p, chars: 0 };
    cur.chars++;
  } else {
    if (cur && cur.chars >= 4) {
      utf16s.push({ pos: cur.start, chars: cur.chars });
      utf16Count++;
    }
    cur = null;
  }
}
console.log(`UTF-16LE strings (>=4 chars) in 9.3MB uniform array: ${utf16Count}`);
utf16s.slice(0,10).forEach(s => {
  const bytes = buf.slice(s.pos, s.pos + s.chars*2);
  let txt = '';
  for (let i = 0; i < s.chars; i++) txt += String.fromCharCode(bytes[i*2]);
  console.log(`  0x${s.pos.toString(16)}  chars=${s.chars}  "${txt}"`);
});

// 4) Now confirm the precise boundary of uniform-array end. We had 36582 uniform records;
//    the next bytes look like settlement data.
console.log(`\nuniform array: 0x${(0x633c50).toString(16)} .. 0x${(0x633c50 + 36582*267).toString(16)}`);
console.log(`= bytes ${36582*267} for ${36582} records (267-byte stride)`);

// 5) Verify: does any record after i=36582 still satisfy the 267-byte uniform shape?
const REC_START = 0x633c50;
const STRIDE = 267;
console.log(`\nchecking next 30 records (36582..36611) for uniform shape:`);
for (let i = 36582; i < 36612; i++) {
  const rs = REC_START + i * STRIDE;
  if (rs + STRIDE > buf.length) break;
  const u32_0 = buf.readUInt32LE(rs);
  const u32_12 = buf.readUInt32LE(rs + 12);
  const looksUniform = (u32_0 === 5 && u32_12 === 0xa);
  console.log(`  i=${i}  rs=0x${rs.toString(16)}  u32[0]=0x${u32_0.toString(16)}  u32[12]=0x${u32_12.toString(16)}  ${looksUniform?'UNIFORM':'NOT-UNIFORM'}`);
}

// Quick: does the very last uniform record (i=36581) end at the start of settlement data?
const lastEnd = REC_START + 36582 * STRIDE;
console.log(`\nrecord 36581 ends at 0x${lastEnd.toString(16)} (which should be just before tail/settlement region)`);
