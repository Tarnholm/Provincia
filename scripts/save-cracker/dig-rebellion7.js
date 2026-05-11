// dig-rebellion7.js — IDENTIFY the 16-byte record array hidden inside each
// rebellion block. In chrysaoria, bytes 0x18d3821..0x18d4711 = 239 records of
// "00 00 00 00 00 00 00 00 00 00 00 03 00 00 00 00" (or similar 16-byte pattern).
// 239 matches RIS faction count (23 majors + 216 minors)!
//
// Decode this per-faction array's actual content.

const fs = require("fs");

const SAVE_ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const SAVE_ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function locateBlocks(buf) {
  const blocks = [];
  for (let p = 0; p + 8 < buf.length; p++) {
    if (buf[p] === 0x2e && buf[p + 1] === 0 && buf[p + 2] === 0x74 && buf[p + 3] === 0 &&
        buf[p + 4] === 0x78 && buf[p + 5] === 0 && buf[p + 6] === 0x74 && buf[p + 7] === 0) {
      let s = p;
      while (s - 2 >= 0 && buf[s - 1] === 0 && buf[s - 2] >= 0x20 && buf[s - 2] <= 0x7e) s -= 2;
      let charCount = -1, strLenOff = -1, strStart = -1;
      for (let test = s; test < p; test += 2) {
        const len = buf.readUInt16LE(test);
        if (len === (p + 8 - test - 2) / 2 && len > 4 && len < 200) {
          strLenOff = test;
          strStart = test + 2;
          charCount = len;
          break;
        }
      }
      if (charCount < 0) continue;
      const strEnd = p + 8;
      const selfPtr = buf.readUInt32LE(strEnd);
      if (selfPtr !== strEnd) continue;
      const count = buf.readUInt32LE(strEnd + 10);
      const recStart = strEnd + 14;
      const path = buf.slice(strStart, strEnd).toString("utf16le");
      if (!path.includes("spawn_scripts")) continue;
      blocks.push({ strLenOff, path, charCount, strEnd, count, recStart });
    }
  }
  return blocks;
}

function findFactionArray(buf, recStart, blockEnd) {
  // The 16-byte array is the longest run of stride-16 records that look like:
  //   [11 bytes of mostly-zero] [u8 nonzero?] [4 bytes of mostly-zero]
  // Detect: scan for stride-16 runs where buf[off+11] is consistently nonzero or where
  // (off & 0xf) % 16 has the byte 0x03 at +11 most of the time.
  //
  // Simpler heuristic: find longest stride-16 region by checking 16-byte alignment.
  // The data we want is at 0x18d3821 in chrysaoria.
  // Try: walk from recStart in 16-byte strides; record runs of similar shape.
  // Or: just find the position where byte[+11] = 0x03 in a stride-16 pattern.

  let bestStart = -1, bestEnd = -1;
  // Test alignment offsets
  for (let alignOff = 0; alignOff < 16; alignOff++) {
    // Walk in stride 16, find longest contiguous run where byte[+11]==0x03 (or similar pattern)
    let runStart = -1, runEnd = -1;
    for (let p = recStart + alignOff; p + 16 < blockEnd; p += 16) {
      const b11 = buf[p + 11];
      if (b11 === 0x03) {
        if (runStart < 0) runStart = p;
        runEnd = p + 16;
      } else {
        if (runStart >= 0 && runEnd - runStart > (bestEnd - bestStart)) {
          bestStart = runStart;
          bestEnd = runEnd;
        }
        runStart = -1;
      }
    }
    if (runStart >= 0 && runEnd - runStart > (bestEnd - bestStart)) {
      bestStart = runStart;
      bestEnd = runEnd;
    }
  }
  return { start: bestStart, end: bestEnd, recCount: (bestEnd - bestStart) / 16 };
}

for (const [name, path] of [["rome10", SAVE_ROME10], ["RoR-T1", SAVE_ROR_T1]]) {
  console.log(`\n=== ${name} ===`);
  const buf = fs.readFileSync(path);
  const blocks = locateBlocks(buf);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const next = blocks[i + 1];
    const blockEnd = next ? next.strLenOff - 19 : buf.length;
    const scriptName = b.path.split("/").pop().replace(".txt", "");
    const fa = findFactionArray(buf, b.recStart, blockEnd);
    console.log(`  ${scriptName.padEnd(20)} count=${b.count.toString().padStart(4)} recStart=0x${b.recStart.toString(16)}  faction-array @0x${fa.start.toString(16)}..0x${fa.end.toString(16)} (${fa.recCount} recs)`);
  }
}

// For chrysaoria, examine the 239-row pattern at 0x18d3821
const buf = fs.readFileSync(SAVE_ROME10);
console.log("\n=== chrysaoria 16-byte stride records ===");
const arrStart = 0x18d3821;
// Dump every 8th record (variety)
for (let i of [0, 1, 22, 23, 75, 100, 150, 200, 238]) {
  const off = arrStart + i * 16;
  const hex = [];
  for (let j = 0; j < 16; j++) hex.push(buf[off + j].toString(16).padStart(2, "0"));
  console.log(`  rec[${i}] @0x${off.toString(16)}: ${hex.join(" ")}`);
}

// Check if there are non-zero records
console.log("\n=== Non-default records in chrysaoria 239-array ===");
const defaultPat = Buffer.from("0000000000000000000000030000 0000".replace(/ /g, ""), "hex");
let nondefault = 0;
for (let i = 0; i < 239; i++) {
  const off = arrStart + i * 16;
  let isDefault = true;
  for (let j = 0; j < 16; j++) {
    if (buf[off + j] !== defaultPat[j]) { isDefault = false; break; }
  }
  if (!isDefault) {
    nondefault++;
    const hex = [];
    for (let j = 0; j < 16; j++) hex.push(buf[off + j].toString(16).padStart(2, "0"));
    if (nondefault <= 10) console.log(`  rec[${i}] @0x${off.toString(16)}: ${hex.join(" ")}`);
  }
}
console.log(`  total non-default: ${nondefault}`);
