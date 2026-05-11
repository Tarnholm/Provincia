// dig-lua-state1.js — Find lua persistent values / mission state in saves.
// Provincia currently parses findLuaCounters. We're looking for richer state:
// mission/quest state, scripted events, named records keyed by tokens.

const fs = require("fs");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);
console.log(`# File: ${SAVE.split(/[/\\]/).pop()} (${buf.length} bytes)`);

// Find HST manifest first to verify lua schema names
console.log("\n=== HST scan for lua-related schemas ===");
const hstStart = 0x3300;
const hstEnd = 0x3c00;
let p = hstStart;
while (p < hstEnd) {
  // Find next ASCIIZ string
  let s = -1;
  for (let q = p; q < hstEnd; q++) {
    if (buf[q] === 0) {
      if (s !== -1 && q - s >= 4) {
        const name = buf.slice(s, q).toString("ascii");
        if (/^[A-Z][A-Z0-9_]+$/.test(name)) {
          // After zero, u32 version
          if (q + 5 <= hstEnd) {
            const v = buf.readUInt32LE(q + 1);
            if (v >= 1 && v <= 16) {
              if (/LUA|MISSION|SCRIPT|EVENT|QUEST|TRIGGER|JOURNAL/i.test(name)) {
                console.log(`  @0x${s.toString(16)}: ${name} v=${v}`);
              }
            }
          }
        }
      }
      s = q + 1;
    } else if (s === -1) {
      s = q;
    }
  }
  break;
}

// Approach 2: dump ALL HST entries
console.log("\n=== Full HST manifest ===");
{
  let pos = 0x3320;
  const entries = [];
  while (pos < 0x3c00 - 4) {
    let end = pos;
    while (end < buf.length && buf[end] !== 0) end++;
    if (end - pos < 3 || end - pos > 80) { pos++; continue; }
    const s = buf.slice(pos, end).toString("ascii");
    if (!/^[A-Z][A-Z0-9_]+$/.test(s)) { pos = end + 1; continue; }
    if (end + 5 > buf.length) break;
    const v = buf.readUInt32LE(end + 1);
    if (v < 1 || v > 16) { pos = end + 1; continue; }
    entries.push({ off: pos, name: s, v });
    pos = end + 5;
  }
  console.log(`Total HST entries: ${entries.length}`);
  for (const e of entries) {
    console.log(`  @0x${e.off.toString(16)} ${e.name} v=${e.v}`);
  }
}

// Search for "lua" / "Lua" / "LUA_" / "PERSISTENT" strings anywhere in file
console.log("\n=== Search for lua-related ASCII strings throughout file ===");
const patterns = ["LUA_", "Lua_", "lua_", "PERSISTENT", "persistent", "mission_", "quest_", "trigger_", "event_", "journal_", "campaign_", "scripted_", "Faction_"];
for (const pat of patterns) {
  const n = Buffer.from(pat, "ascii");
  let off = 0;
  let count = 0;
  let first = -1;
  while ((off = buf.indexOf(n, off)) !== -1) {
    count++;
    if (first === -1) first = off;
    off++;
  }
  if (count > 0) {
    console.log(`  "${pat}": ${count} hits, first @0x${first.toString(16)}`);
  }
}
