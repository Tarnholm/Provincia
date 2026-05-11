// dig-lua-state2.js — Investigate Macedon save's HST and lua state.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 99 Start.sav";
const buf = fs.readFileSync(SAVE);
console.log(`# File: ${SAVE.split(/[/\\]/).pop()} (${buf.length} bytes)`);

// Dump first 256 bytes
console.log("\n=== First 256 bytes ===");
for (let i = 0; i < 16; i++) {
  const off = i * 16;
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16; j++) {
    const b = buf[off + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
  }
  console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
}

// HST might be at different offset. Find any uppercase ASCIIZ + u32 v sequence
console.log("\n=== Locate HST manifest in this save ===");
const entries = [];
let pos = 0;
while (pos < buf.length - 10) {
  let end = pos;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end - pos < 3 || end - pos > 80) { pos = end + 1; continue; }
  const s = buf.slice(pos, end).toString("ascii");
  if (!/^[A-Z][A-Z0-9_]+$/.test(s)) { pos = end + 1; continue; }
  if (end + 5 > buf.length) break;
  const v = buf.readUInt32LE(end + 1);
  if (v < 1 || v > 16) { pos = end + 1; continue; }
  entries.push({ off: pos, name: s, v });
  pos = end + 5;
}
console.log(`Total HST-like entries: ${entries.length}`);
for (const e of entries.slice(0, 30)) {
  console.log(`  @0x${e.off.toString(16)} ${e.name} v=${e.v}`);
}
if (entries.length > 30) {
  console.log(`  ... ${entries.length - 30} more entries`);
}

// Filter to lua/mission-related ones
const lua = entries.filter(e => /LUA|MISSION|SCRIPT|EVENT|QUEST|TRIGGER|JOURNAL|PERSISTENT/.test(e.name));
console.log(`\nLua/mission HST entries: ${lua.length}`);
for (const e of lua) {
  console.log(`  @0x${e.off.toString(16)} ${e.name} v=${e.v}`);
}

// Now search for lua-prefixed strings throughout
console.log("\n=== Search for lua-related ASCII strings in body ===");
const patterns = ["LUA_PERSISTENT", "LUA_", "Lua_", "lua_", "mission_", "quest_", "campaign_", "scripted_", "JOURNAL_", "FactionCounter", "FactionScore", "_counter", "campaign_db"];
for (const pat of patterns) {
  const n = Buffer.from(pat, "ascii");
  let off = 0;
  let hits = [];
  while ((off = buf.indexOf(n, off)) !== -1) {
    hits.push(off);
    off++;
  }
  if (hits.length > 0) {
    console.log(`  "${pat}": ${hits.length} hits, first 3: ${hits.slice(0, 3).map(o => "0x" + o.toString(16)).join(", ")}`);
  }
}

// Look at the "campaign_" hit
const tg = buf.indexOf("campaign_");
if (tg !== -1) {
  console.log(`\nContext around campaign_ @0x${tg.toString(16)}:`);
  for (let i = -2; i < 8; i++) {
    const off = tg + i * 16;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
  }
}

// Look at "PERSISTENT" hit
const ps = buf.indexOf("PERSISTENT");
if (ps !== -1) {
  console.log(`\nContext around PERSISTENT @0x${ps.toString(16)}:`);
  for (let i = -2; i < 5; i++) {
    const off = ps + i * 16;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
  }
}
