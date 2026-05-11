// dig-rebellion5.js — Validate the 16-byte stride claim by computing payload size /
// count for each block, and cross-validate on RoR-T1.
//
// Then look for patterns in the "count" field — what does it index?

const fs = require("fs");

const SAVE_ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const SAVE_ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function locateBlocks(buf) {
  // Find every UTF-16LE path ending in 'spawn_scripts/*.txt' and compute its trailing structure.
  const blocks = [];
  // Find ".txt" in UTF-16LE = 2e 00 74 00 78 00 74 00
  for (let p = 0; p + 8 < buf.length; p++) {
    if (buf[p] === 0x2e && buf[p + 1] === 0 && buf[p + 2] === 0x74 && buf[p + 3] === 0 &&
        buf[p + 4] === 0x78 && buf[p + 5] === 0 && buf[p + 6] === 0x74 && buf[p + 7] === 0) {
      // Walk back to find string start; STOP when the prior u16 (s-2) is a plausible strLen
      let s = p;
      while (s - 2 >= 0 && buf[s - 1] === 0 && buf[s - 2] >= 0x20 && buf[s - 2] <= 0x7e) {
        // Check if walking further back would match a u16 strLen here (i.e., s-2 is the u16 strLen)
        if (s - 4 >= 0) {
          const possibleLen = buf.readUInt16LE(s - 2);
          const possibleChars = (p + 8 - s) / 2 + 1; // including one more char if we go back
          // If s-2 reads as a length that equals (p+8 - s)/2 BEFORE going back, stop
        }
        s -= 2;
      }
      const path = buf.slice(s, p + 8).toString("utf16le");
      if (!path.includes("spawn_scripts")) continue;
      // s is the first byte of UTF-16; the u16 strLen is at s but we walked too far.
      // Reconstruct: find the u16 strLen by scanning back from s until we find a value V such that V*2 = (p+8) - s_candidate (where s_candidate = s + 2*(some))
      // Simpler: try each candidate.
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
      // Header: u32 selfPtr (=strEnd), then 6 zero bytes (or u32+u16 zero), then u32 count
      const selfPtr = buf.readUInt32LE(strEnd);
      if (selfPtr !== strEnd) continue;
      const count = buf.readUInt32LE(strEnd + 10);
      const recStart = strEnd + 14;
      const realPath = buf.slice(strStart, strEnd).toString("utf16le");
      blocks.push({ strLenOff, path: realPath, charCount, strEnd, count, recStart });
    }
  }
  return blocks;
}

function findBlockEnd(buf, recStart, nextRecStart) {
  // Block ends right before the next block's preamble: 16 zeros + 03 00 01 + u16 strLen
  if (!nextRecStart) return null;
  // Walk backward from nextStartLen to find the preamble start
  const nextStrLenOff = nextRecStart; // we'll pass strLenOff actually
  // The 16-zero block ends 19 bytes before nextStrLenOff: nextStrLenOff - 19
  return nextStrLenOff - 19;
}

for (const [name, path] of [["rome10", SAVE_ROME10], ["RoR-T1", SAVE_ROR_T1]]) {
  console.log(`\n========== ${name} ==========`);
  const buf = fs.readFileSync(path);
  const blocks = locateBlocks(buf);
  console.log(`Found ${blocks.length} spawn_scripts blocks`);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const next = blocks[i + 1];
    const blockEnd = next ? next.strLenOff - 19 : null;
    const payload = blockEnd ? blockEnd - b.recStart : null;
    const perRec = payload && b.count ? payload / b.count : null;
    const scriptName = b.path.split("/").pop().replace(".txt", "");
    console.log(`  [${i}] ${scriptName.padEnd(20)} strLen@0x${b.strLenOff.toString(16)} count=${b.count.toString().padStart(4)} payload=${payload} bytesPerRec=${perRec ? perRec.toFixed(2) : "?"}`);
  }
}

// Also: lua counters with prefixes match script names. Count them in the lua counter table.
function findLuaCounters(buf) {
  // Counter table: at end of file, sequence of [u32 nameLen][UTF-16LE name][u32 value]
  // From session 14: starts at 0x210f56f in rome10, 115 records.
  // Find candidate start: walk back from EOF until we hit something else.
  // For simplicity, just search the entire file for known counter name patterns.
  const counters = [];
  for (let p = 0; p + 8 < buf.length; p++) {
    const nameLen = buf.readUInt32LE(p);
    if (nameLen < 6 || nameLen > 60) continue;
    if (p + 4 + nameLen * 2 + 4 > buf.length) continue;
    // Check UTF-16LE printable ASCII
    let ok = true;
    for (let i = 0; i < nameLen; i++) {
      const c = buf.readUInt16LE(p + 4 + i * 2);
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    const name = buf.slice(p + 4, p + 4 + nameLen * 2).toString("utf16le");
    // Filter to recognizable lua counter names (alphanumeric + underscore)
    if (!/^[A-Z][A-Za-z0-9_]+$/.test(name)) continue;
    const value = buf.readUInt32LE(p + 4 + nameLen * 2);
    if (value > 1000000) continue;  // sanity
    counters.push({ off: p, name, value });
    p += 4 + nameLen * 2 + 4 - 1;
  }
  return counters;
}

for (const [name, path] of [["rome10", SAVE_ROME10], ["RoR-T1", SAVE_ROR_T1]]) {
  console.log(`\n=== ${name} lua counters with rebellion prefixes ===`);
  const buf = fs.readFileSync(path);
  const counters = findLuaCounters(buf);
  const prefixes = ["Chrysaoria", "Cilicia", "Egyptian", "Lycia", "Miletus", "Thessaly"];
  for (const prefix of prefixes) {
    const matching = counters.filter(c => c.name.startsWith(prefix));
    console.log(`  ${prefix}*: ${matching.length} counters`);
    for (const c of matching) {
      console.log(`    ${c.name} = ${c.value}`);
    }
  }
}
