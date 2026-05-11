// dig-faction-ptol-track2.js — session 5 (v2)
//
// More robust: find Ptolemy's "second half" record by signature
// `20 4e 00 00 1e 00 00 00 00 x 16+`
// AND find "first half" by `... 64 00 00 00 01 00 00 00 00 x 12+ <self-pointer>`
//
// Then track treasury changes across rome turns.
const fs = require("fs");
const path = require("path");

function find2ndHalf(buf, factionId = 30) {
  // Pattern: treasury u32 at offset 0, then faction-id u32 at +4, then zeros.
  const hits = [];
  for (let i = 0; i + 32 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 4) !== factionId) continue;
    const tres = buf.readUInt32LE(i);
    if (tres < 1 || tres > 10000000) continue;  // sanity
    // Count zeros in [i+8, i+24)
    let z = 0;
    for (let k = 8; k < 24; k += 1) if (buf[i + k] === 0) z += 1;
    if (z < 14) continue;
    hits.push({ pos: i, treasury: tres });
  }
  return hits;
}

function find1stHalf(buf, factionId = 30, regionCount = 31) {
  // Pattern: treasury u32 at +0, ?? at +4, 100 at +8, 1 at +12, 12 zeros,
  // then self-pointer, then ??, then 8 zeros, then self-pointer, then size=6, then regionCount.
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    let z = 0;
    for (let k = 16; k < 28; k += 1) if (buf[i + k] === 0) z += 1;
    if (z < 11) continue;
    // Self-pointer at i+28
    const sp = buf.readUInt32LE(i + 28);
    if (sp !== i + 28) continue;
    // Sub-section at i+44 with size 6
    if (buf.readUInt32LE(i + 44) !== i + 44) continue;
    if (buf.readUInt32LE(i + 48) !== 6) continue;
    if (buf.readUInt32LE(i + 52) !== regionCount) continue;
    const tres = buf.readUInt32LE(i);
    hits.push({ pos: i, treasury: tres });
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
    "save_Autosave   Republic of Rome   Turn 11 Start.sav",
    "save_Autosave   Republic of Rome   Turn 11 End.sav",
    "save_Autosave   Republic of Rome   Turn 1.sav",
  ];
  console.log("# Ptolemy faction record tracking — half-1 (treasury+self-ptr) & half-2 (treasury+30+zeros)\n");
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const h2 = find2ndHalf(buf, 30);
    const h1 = find1stHalf(buf, 30, 31);
    console.log(`${f.padEnd(50)} half1: ${h1.length} | half2: ${h2.length}`);
    for (const h of h1) console.log(`   half1 pos=0x${h.pos.toString(16)} treasury=${h.treasury}`);
    for (const h of h2) console.log(`   half2 pos=0x${h.pos.toString(16)} treasury=${h.treasury}`);
  }
}

main();
