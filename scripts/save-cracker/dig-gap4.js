// dig-gap4.js — verify 267-byte stride hypothesis. Is this another diplomacy matrix?
const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const START = 0x633bb3;
const END   = 0xf88637;

// from dig-gap3 zero-run analysis: zero runs of exactly 170 bytes, separated by ~97 bytes of non-zero.
// stride candidate = 267. confirm by counting positions where buf[p]==0 with period 267.

const FIRST_ZRUN_START = 0x633cb1;
const STRIDE = 267;

// 1) Test stride 267: at every multiple of 267 from FIRST_ZRUN_START, is the byte 0?
//    If yes, count how many consecutive 267-strides hold buf[p]==0.
let okCount = 0;
let firstBad = -1;
for (let i = 0; i < 100000; i++) {
  const p = FIRST_ZRUN_START + i * STRIDE;
  if (p >= END) break;
  if (buf[p] === 0) okCount++;
  else { firstBad = i; break; }
}
console.log(`stride=${STRIDE} from 0x${FIRST_ZRUN_START.toString(16)}: ${okCount} consecutive zero-byte anchor hits${firstBad>=0?` (broke at i=${firstBad}, p=0x${(FIRST_ZRUN_START+firstBad*STRIDE).toString(16)})`:''}`);

// 2) Locate the very first non-zero byte after START.
let firstNZ = START;
while (firstNZ < END && buf[firstNZ] === 0) firstNZ++;
console.log(`first non-zero byte in gap: 0x${firstNZ.toString(16)}`);

// 3) Backwards: is there a record header BEFORE firstNZ? Treat the gap as if it starts ~157 bytes before with first record.
// per dig-gap3: zero@0x633bb3..0x633c50 (157 bytes), non-zero starts at 0x633c50.
// then zero@0x633cb1..0x633d5b — so the first record is at ~0x633bb3 or 0x633c50.

// Best to walk every 267-byte stride backward from 0x633cb1, find where we exit the gap.
const records = [];
let p = FIRST_ZRUN_START - 96; // hypothesized start of 1st record's data (96 bytes of non-zero before first zero-run)
// actually 0x633cb1 - 0x633c50 = 0x61 = 97; first non-zero block runs 0x633c50..0x633cb1
const REC_START_HYP = 0x633c50;
for (let i = 0; i < 100000; i++) {
  const rs = REC_START_HYP + i * STRIDE;
  if (rs >= END) break;
  records.push(rs);
}
console.log(`hypothesized records of stride ${STRIDE} starting at 0x${REC_START_HYP.toString(16)}: ${records.length}`);
console.log(`last record at 0x${records[records.length-1].toString(16)}, end at 0x${(records[records.length-1]+STRIDE).toString(16)}`);
console.log(`gap end 0x${END.toString(16)}, file end 0x${buf.length.toString(16)}`);

// 4) For each record, check: bytes[0..96] are mostly non-zero, bytes[97..267] are all zero?
let goodRecords = 0, badRecords = 0;
let firstBadRec = -1;
for (let i = 0; i < records.length; i++) {
  const rs = records[i];
  if (rs + STRIDE > buf.length) break;
  // expected: bytes 0..96 have meaningful data, 97..267 (= 170 bytes) are zeros
  let zerosInTail = 0;
  for (let j = 97; j < 267; j++) {
    if (buf[rs + j] === 0) zerosInTail++;
  }
  if (zerosInTail >= 165) goodRecords++;  // allow few non-zero stragglers
  else { badRecords++; if (firstBadRec < 0) firstBadRec = i; }
}
console.log(`records matching layout (97 data bytes + 170 zero bytes): ${goodRecords} good / ${badRecords} bad`);
if (firstBadRec >= 0) {
  const rs = records[firstBadRec];
  console.log(`first bad record at i=${firstBadRec}, addr=0x${rs.toString(16)}`);
  // dump it
  console.log(`hex of bad record (first 96 bytes + a few tail):`);
  const slice = buf.slice(rs, rs + 128);
  console.log(Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' '));
}

// 5) Distinct "records" expected — 239 factions × 239 = 57121 ? OR 239 × 128 settlements? Try alt strides.
console.log(`\n239² = ${239*239}, ${records.length}/${239*239} = ${(records.length / (239*239)).toFixed(3)}`);
console.log(`Total bytes if ${records.length} records of stride ${STRIDE}: ${records.length*STRIDE} (0x${(records.length*STRIDE).toString(16)})`);
console.log(`Gap size: ${END - START} (0x${(END-START).toString(16)})`);

// 6) Dump first record contents (97 bytes of data)
console.log(`\n=== record 0 @ 0x${REC_START_HYP.toString(16)} (first 97 bytes) ===`);
{
  const slice = buf.slice(REC_START_HYP, REC_START_HYP + 97);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
  console.log(hex);
  console.log(asc);
}
console.log(`\n=== record 1 @ 0x${(REC_START_HYP+STRIDE).toString(16)} (first 97 bytes) ===`);
{
  const rs = REC_START_HYP + STRIDE;
  const slice = buf.slice(rs, rs + 97);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
  console.log(hex);
  console.log(asc);
}
console.log(`\n=== record 239 @ 0x${(REC_START_HYP+239*STRIDE).toString(16)} (first 97 bytes) ===`);
{
  const rs = REC_START_HYP + 239*STRIDE;
  const slice = buf.slice(rs, rs + 97);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
  console.log(hex);
  console.log(asc);
}
