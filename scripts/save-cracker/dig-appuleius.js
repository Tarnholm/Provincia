// dig-appuleius.js — why does v1 see Appuleius_Saturninus age 69 but
// his portraits[] is empty? Dump his record and scan for any nearby
// portrait pstrs that we might have missed.

"use strict";
const fs = require("fs");
const path = require("path");
const savePath = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traits = [];
for (const m of fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traits.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(savePath);

const chars = findCharacterRecords(buf, names, traits, null);
const c = chars.find(x => x.firstName === "Appuleius_Saturninus");
if (!c) { console.log("NOT FOUND"); process.exit(1); }

console.log(`=== ${c.firstName} age=${c.age} layout=${c.lastName?"A":"B"} traits=${(c.traits||[]).length} ancillaries=${(c.ancillaries||[]).length} ===`);
console.log(`  offset = 0x${c.offset.toString(16)}`);
console.log(`  primaryUuid=0x${c.primaryUuid.toString(16)} secondaryUuid=0x${(c.secondaryUuid||0).toString(16)}`);
console.log(`  tileX=${c.tileX} tileY=${c.tileY}`);
console.log(`  isDead=${c.isDead} role=${c.role} isLeader=${c.isLeader} isHeir=${c.isHeir}`);
console.log(`  traits: ${(c.traits||[]).map(t => `${t.name}(${t.points})`).join(", ")}`);

// Dump record bytes in detail
console.log(`\n=== Hex dump (offset 0x${c.offset.toString(16)} + 0..512) ===`);
for (let i = 0; i < 512; i += 16) {
  const row = [];
  const asc = [];
  for (let j = 0; j < 16 && (i+j) < 512; j++) {
    const b = buf[c.offset + i + j];
    row.push(b.toString(16).padStart(2,"0"));
    asc.push((b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".");
  }
  console.log(`  +${i.toString().padStart(3)}: ${row.join(" ")}  |${asc.join("")}|`);
}

// Scan for pstr16 strings within +0..+2048
console.log(`\n=== All printable pstr16 strings within +0..+2048 ===`);
for (let i = 0; i < 2048 && c.offset + i + 2 < buf.length; i++) {
  const len = buf.readUInt16LE(c.offset + i);
  if (len < 6 || len > 250) continue;
  const start = c.offset + i + 2;
  if (start + len > buf.length) continue;
  let valid = true;
  let s = "";
  for (let j = 0; j < len; j++) {
    const b = buf[start + j];
    if (b < 0x20 || b > 0x7e) { valid = false; break; }
    s += String.fromCharCode(b);
  }
  if (!valid) continue;
  console.log(`  @+${i} (len=${len}): "${s}"`);
}

// Also: where is the NEXT char's record (so we know where Appuleius ends)?
const allOffsets = chars.map(x => x.offset).sort((a,b) => a-b);
const idx = allOffsets.indexOf(c.offset);
const next = allOffsets[idx+1];
const prev = allOffsets[idx-1];
console.log(`\n  prev char offset: 0x${(prev||0).toString(16)}`);
console.log(`  this char offset: 0x${c.offset.toString(16)}`);
console.log(`  next char offset: 0x${(next||0).toString(16)} (gap: ${next - c.offset} bytes)`);
