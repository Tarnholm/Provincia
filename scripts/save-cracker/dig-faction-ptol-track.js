// dig-faction-ptol-track.js — session 5
//
// Find Ptolemy's faction record across all rome saves by structural signature:
// look for `c8 00 00 00 00 00 00 00 XX XX XX XX 1e 00 00 00` followed by lots
// of zeros (the second-half marker). 1e = 30 = Ptolemy's faction-id.
//
// Once located, read the u32 at the marker position — that's Ptolemy's
// current treasury.
const fs = require("fs");
const path = require("path");

function findPtolemyRecord(buf) {
  // Pattern matches the START of the Ptolemy "second half" record:
  // [zeros]... c8 00 00 00 00 00 [u32 treasury] 1e 00 00 00 [zeros]...
  // c8 00 00 00 = 200 (some hash/version constant)
  // Looking for: c8 00 00 00 00 00 [u32] 1e 00 00 00 00 00 00 00
  // The "c8 00 00 00" appears at offset relative to treasury-half-2:
  //   from rome5 0x1623638 (treasury) - 5 bytes = 0x1623633 has `c8`
  //   actually from dump: 0x162361a-1d: 00 00 c8 00 then 0x162361e-21 = 00 00 00 00, 0x1623622-25 = 20 4e 00 00, 0x1623626-29 = 1e 00 00 00
  // So pattern: [4 bytes c8 00 00 00] [4 bytes 00 00 00 00] [u32 treasury] [u32 1e 00 00 00] [zeros lots]
  const hits = [];
  for (let i = 0; i + 32 < buf.length; i += 1) {
    if (buf[i] !== 0xc8 || buf[i + 1] !== 0x00 || buf[i + 2] !== 0x00 || buf[i + 3] !== 0x00) continue;
    if (buf[i + 4] !== 0 || buf[i + 5] !== 0 || buf[i + 6] !== 0 || buf[i + 7] !== 0) continue;
    // u32 at i+8 = treasury candidate
    const treasury = buf.readUInt32LE(i + 8);
    // u32 at i+12 = 1e 00 00 00 (Ptolemaic faction-id = 30)
    if (buf.readUInt32LE(i + 12) !== 0x1e) continue;
    // Check that i+16..+28 are mostly zeros (16 zero bytes)
    let zeroCount = 0;
    for (let k = 16; k < 32; k += 1) if (buf[i + k] === 0) zeroCount += 1;
    if (zeroCount < 12) continue;
    hits.push({ pos: i, treasuryPos: i + 8, treasury });
  }
  return hits;
}

function findFirstHalf(buf) {
  // From rome5 dump: at 0x1623560 = `00 00 00 50 9d 00 00 58 2d 59 0e` then 0x162356b = `20 4e 00 00 d4 fa fd ff 64 00 00 00 01 00 00 00`
  // So pattern around treasury-half-1 is:
  //   [4-byte runtime junk] [u32 treasury] [4-byte runtime junk] [u32 100] [u32 1] [12 zeros] [self-pointer] ...
  // Easier marker: look for `64 00 00 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00` immediately after treasury
  // I.e. find 28-byte signature at relative +4 of treasury:
  //   [u32 ?] [64 00 00 00] [01 00 00 00] [00 x 12]
  // We can require: at i+8..+11 is 64 00 00 00, i+12..+15 is 01 00 00 00, i+16..+27 is zeros
  // And earlier: search for the "06 00 00 00 1f 00 00 00" sub-section that follows
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    let zeroCount = 0;
    for (let k = 16; k < 28; k += 1) if (buf[i + k] === 0) zeroCount += 1;
    if (zeroCount < 11) continue;
    // Check that at i+44+8 there's "06 00 00 00 1f 00 00 00" (sub-section size=6, then 1f = 31 region count)
    if (buf.readUInt32LE(i + 48) !== 6) continue;
    if (buf.readUInt32LE(i + 52) !== 0x1f) continue;
    const treasury = buf.readUInt32LE(i);
    hits.push({ pos: i, treasury });
  }
  return hits;
}

function main() {
  const dir = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
  const files = [
    "save_rome1.sav",
    "save_rome2.sav",
    "save_rome3.sav",
    "save_rome4.sav",
    "save_rome5..sav",
    "save_rome6.sav",
    "save_rome7.sav",
    "save_rome8.sav",
    "save_rome9.sav",
    "save_rome10.sav",
  ];
  console.log("# Ptolemy faction record tracking across rome saves");
  console.log("(Ptolemy faction-id = 30 = 0x1e in this campaign)\n");
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const half2 = findPtolemyRecord(buf);
    const half1 = findFirstHalf(buf);
    console.log(`${f.padEnd(20)} half2: ${half2.length} hits | half1: ${half1.length} hits`);
    for (const h of half2) {
      console.log(`   half2 pos=0x${h.pos.toString(16)} treasuryPos=0x${h.treasuryPos.toString(16)} treasury=${h.treasury}`);
    }
    for (const h of half1) {
      console.log(`   half1 pos=0x${h.pos.toString(16)} treasury=${h.treasury}`);
    }
  }
}

main();
