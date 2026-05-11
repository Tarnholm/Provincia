#!/usr/bin/env node
// Hunt for construction queue blocks across the corpus.
// Signature (from session 11 finding): inside a settlement, the +53 block has the form
//   [u32 chain_id_X][u32 0][8 bytes 0][u32 1][u32 0][u32 RT_PTR][u32 RT_PTR][u32 1][u32 0]
//   [u32 chain_id_X DUP][u32 0][u32 turns_or_level][trailing 12-16 bytes with 3rd chain_id]
//
// Detection heuristic: find positions in the save where
//   - readU32LE(p) === readU32LE(p+40)
//   - readU32LE(p) is a "small" chain-id-like value (1..2000)
//   - readU32LE(p+4) === 0
//   - readU32LE(p+8) === 0 && readU32LE(p+12) === 0
//   - readU32LE(p+16) === 1
// This gives an upper bound on construction queue block locations.

const fs = require('fs');
const path = require('path');

function findQueueBlocks(buf) {
  const hits = [];
  for (let p = 0; p + 60 < buf.length; p++) {
    const v0 = buf.readUInt32LE(p);
    if (v0 < 1 || v0 > 2000) continue;
    if (buf.readUInt32LE(p + 4) !== 0) continue;
    if (buf.readUInt32LE(p + 8) !== 0) continue;
    if (buf.readUInt32LE(p + 12) !== 0) continue;
    if (buf.readUInt32LE(p + 16) !== 1) continue;
    if (buf.readUInt32LE(p + 20) !== 0) continue;
    if (buf.readUInt32LE(p + 32) !== 1) continue;
    if (buf.readUInt32LE(p + 36) !== 0) continue;
    if (buf.readUInt32LE(p + 40) !== v0) continue;  // DUP chain-id
    if (buf.readUInt32LE(p + 44) !== 0) continue;
    // turn/level field at +48
    const v48 = buf.readUInt32LE(p + 48);
    hits.push({ pos: p, chainId: v0, v48 });
  }
  return hits;
}

function findSettlementContext(buf, p) {
  // search backwards for a UTF-16 settlement name (sequence of u16 [printable, 00])
  // candidates: 8-200 bytes back
  for (let s = p - 4; s >= p - 500 && s >= 0; s -= 2) {
    // attempt UTF-16 string ending here
    let end = s;
    let start = end;
    // walk backwards while we see [printable, 00]
    while (start - 2 >= 0 && buf[start-2] >= 0x20 && buf[start-2] <= 0x7e && buf[start-1] === 0) start -= 2;
    if (end - start >= 8) {
      const str = buf.slice(start, end).toString('utf16le').replace(/[\x00-\x1f]/g,'');
      if (str.length >= 4 && /^[A-Z]/.test(str)) {
        return { name: str, pos: start, dist: p - start };
      }
    }
  }
  return null;
}

const corpus = [
  ['saveturn1start', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_saveturn1start.sav'],
  ['saveturn1construction', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_saveturn1construction.sav'],
  ['saveturn1building', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_saveturn1building.sav'],
  ['saveturn2start', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_saveturn2start.sav'],
  ['damagedturn1', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_damagedturn1.sav'],
  ['damagedturn2', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_damagedturn2.sav'],
  ['t7end', 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/0004_save_Autosave   Macedon   Turn 7 End.sav'],
  ['t8start', 'C:/dev/Provincia/calibration/archive/2026-04-21T22-42-59-494Z/0005_save_Autosave   Macedon   Turn 8 Start.sav'],
  ['t97', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 97.sav'],
  ['t98end', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 98 End.sav'],
  ['t99start', 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves/save_Autosave   Macedon   Turn 99 Start.sav'],
];

for (const [label, p] of corpus) {
  if (!fs.existsSync(p)) { console.log(label, 'NOT FOUND'); continue; }
  const buf = fs.readFileSync(p);
  const hits = findQueueBlocks(buf);
  console.log(`\n=== ${label} (${(buf.length/1024).toFixed(0)} KB) — ${hits.length} queue blocks ===`);
  for (const h of hits) {
    const ctx = findSettlementContext(buf, h.pos);
    const ctxStr = ctx ? `near "${ctx.name}" (dist ${ctx.dist})` : 'no settlement nearby';
    console.log(`  0x${h.pos.toString(16).padStart(6,'0')}: chainId=${h.chainId}, +48=${h.v48}, ${ctxStr}`);
  }
}
