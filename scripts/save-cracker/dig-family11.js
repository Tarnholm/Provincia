#!/usr/bin/env node
// dig-family11.js — slot layout per LAYOUT
//
// Test:
//   - For every LAYOUT_A parent with children in save, list +50..+78 u32s and
//     mark which match children.
//   - Same for LAYOUT_B.
//   - Verify: LAYOUT_A children should be at +54, +58, +62, +66 (etc).
//             LAYOUT_B children should be at +50, +54, +58, +62 (-4 shift).

const fs = require('fs');
const path = require('path');
const cp = require('C:/dev/Provincia/src/characterParser.js');

const MOD = "C:/RIS/RIS/data";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}

function check(savePath) {
  const buf = fs.readFileSync(savePath);
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  const byUuid = new Map();
  for (const r of recs) byUuid.set(r.primaryUuid, r);
  const childrenOf = new Map();
  for (const r of recs) {
    if (r.fatherUuid && r.fatherUuid !== 0xffffffff && r.fatherUuid !== 0) {
      if (!childrenOf.has(r.fatherUuid)) childrenOf.set(r.fatherUuid, []);
      childrenOf.get(r.fatherUuid).push(r);
    }
  }

  console.log(`\n=== ${path.basename(savePath)} ===`);
  // Group by LAYOUT
  const posByLayout = { A: new Map(), B: new Map() };
  for (const [fid, kids] of childrenOf) {
    const parent = byUuid.get(fid);
    if (!parent) continue;
    const layout = parent.lastName ? 'A' : 'B';
    for (const kid of kids) {
      for (let i = 0; i + 4 <= 200; i++) {
        if (buf.readUInt32LE(parent.offset + i) === kid.primaryUuid) {
          posByLayout[layout].set(i, (posByLayout[layout].get(i)||0)+1);
        }
      }
    }
  }
  for (const L of ['A', 'B']) {
    const m = posByLayout[L];
    const sorted = [...m.entries()].sort((a,b) => a[0]-b[0]);
    console.log(`LAYOUT_${L}: ${[...m.values()].reduce((s,v)=>s+v,0)} child-references at offsets:`, sorted.map(([o,c]) => `+${o}:${c}`).join(' '));
  }

  // Detail: list LAYOUT_A parents and their children
  console.log(`\n--- LAYOUT_A parent details ---`);
  for (const [fid, kids] of childrenOf) {
    const parent = byUuid.get(fid);
    if (!parent || !parent.lastName) continue;
    if (kids.length === 0) continue;
    const sortedByAge = [...kids].sort((a, b) => b.age - a.age);
    const slotMap = {};
    for (const off of [50, 54, 58, 62, 66, 70, 74, 78]) {
      const v = buf.readUInt32LE(parent.offset + off);
      const kid = kids.find(k => k.primaryUuid === v);
      slotMap[off] = kid ? `${kid.firstName}(a${kid.age})` : (v === 0 ? '.' : `?${v}`);
    }
    console.log(`  ${parent.firstName} ${parent.lastName} (a${parent.age}, ${kids.length} kids: ${sortedByAge.map(k=>k.firstName+'a'+k.age).join(',')})`);
    console.log(`    +50:${slotMap[50]}  +54:${slotMap[54]}  +58:${slotMap[58]}  +62:${slotMap[62]}  +66:${slotMap[66]}`);
  }
}

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
check(path.join(SAVES, 'save_Autosave   Republic of Rome   Turn 1.sav'));
check(path.join(SAVES, 'save_rome10.sav'));
