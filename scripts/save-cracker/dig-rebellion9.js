// dig-rebellion9.js — Validate the 239-row × 16-byte faction array.
// Are all 239 entries default in both saves? Or do some rebellion blocks have
// non-default per-faction values that we can correlate?
//
// Also: cross-check the count field (75/76/95/144/159/213) against something
// concrete in the bodies.

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
      let charCount = -1, strStart = -1;
      for (let test = s; test < p; test += 2) {
        const len = buf.readUInt16LE(test);
        if (len === (p + 8 - test - 2) / 2 && len > 4 && len < 200) {
          strStart = test + 2; charCount = len; break;
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
      blocks.push({ path, count, recStart });
    }
  }
  return blocks;
}

function findFactionArray(buf, recStart, blockEnd) {
  let bestStart = -1, bestEnd = -1;
  for (let alignOff = 0; alignOff < 16; alignOff++) {
    let runStart = -1, runEnd = -1;
    for (let p = recStart + alignOff; p + 16 < blockEnd; p += 16) {
      if (buf[p + 11] === 0x03) {
        if (runStart < 0) runStart = p;
        runEnd = p + 16;
      } else {
        if (runStart >= 0 && runEnd - runStart > (bestEnd - bestStart)) {
          bestStart = runStart; bestEnd = runEnd;
        }
        runStart = -1;
      }
    }
    if (runStart >= 0 && runEnd - runStart > (bestEnd - bestStart)) {
      bestStart = runStart; bestEnd = runEnd;
    }
  }
  return { start: bestStart, end: bestEnd, recCount: (bestEnd - bestStart) / 16 };
}

for (const [name, savePath] of [["rome10", SAVE_ROME10], ["RoR-T1", SAVE_ROR_T1]]) {
  console.log(`\n========== ${name} ==========`);
  const buf = fs.readFileSync(savePath);
  const blocks = locateBlocks(buf);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const scriptName = b.path.split("/").pop().replace(".txt", "");
    const next = blocks[i + 1];
    const blockEnd = next ? next.recStart : buf.length;
    const fa = findFactionArray(buf, b.recStart, blockEnd);

    // Check ALL 239 records for non-default values
    const factionStates = {};
    let nondefault = 0;
    for (let j = 0; j < fa.recCount; j++) {
      const off = fa.start + j * 16;
      const u32s = [];
      for (let k = 0; k < 4; k++) u32s.push(buf.readUInt32LE(off + k * 4));
      const u8s = [];
      for (let k = 0; k < 16; k++) u8s.push(buf[off + k]);
      const sig = u8s.map(b => b.toString(16).padStart(2, "0")).join("");
      factionStates[sig] = (factionStates[sig] || 0) + 1;
    }
    console.log(`  ${scriptName.padEnd(20)} count=${b.count} factionArrSize=${fa.recCount} distinctSigs=${Object.keys(factionStates).length}`);
    if (Object.keys(factionStates).length > 1) {
      for (const [sig, cnt] of Object.entries(factionStates).sort((a, b) => b[1] - a[1])) {
        console.log(`    sig=${sig} × ${cnt}`);
      }
    }
  }
}
