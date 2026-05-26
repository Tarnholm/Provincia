// CRACK STATUS 2026-05-20
// =======================
// Goal: find authoritative per-character coords + portraits in RTW saves.
//
// SOLVED:
//   - 354-byte coord/state record table at ~0x1517fb1 in Macedon T0 RIS.
//     Layout per record:
//       +0  : v1.secondaryUuid (bridge to v1, 542/542 matched)
//       +8  : x coord (matches v1.tileX 1:1)
//       +12 : y coord (matches v1.tileY 1:1)
//       +16 : 0x7fff fractional marker (constant)
//
//   - Portrait pool entry layout: [pstr16 portrait_path][11 bytes][u32 char_uuid].
//     Confirmed via distance histogram: 419/472 chars have pstr_end → uuid
//     distance == 11 bytes.
//
// OPEN:
//   - Which uuid does the pool's "11 bytes after pstr" actually map to?
//     Empirically `pool_uuid[X] = v1_portraits_scan[X-1]` for adjacent
//     chars in v1 file-order, so it might be the NEXT char's uuid (off
//     by one) OR an indirect lookup. Need in-game screenshots to verify.
//
//   - cracker.bodyguardUuid != v1.secondaryUuid (0 intersection in Macedon
//     T0 RIS). So we can't bridge cracker chars to the new 354-byte table
//     via existing uuid fields.
//
// PRACTICAL FIX (shipped 0.9.513):
//   - Build v1PortraitsByCoord map keyed by v1.tileX/v1.tileY directly,
//     bypassing the cracker's broken extX/extY. Pass to FamilyTree so
//     both unit cards AND family tree pull from the same v1 source.
//
// This script: walk the 354-byte table and confirm secUuid bridge.
const fs = require("fs");
const path = require("path");
const savePath = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traits = [];
for (const m of fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traits.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(savePath);
const v1Records = findCharacterRecords(buf, names, traits, null);

// For each v1 char with secondaryUuid + tile, find the matching coord record
function findRecord(v) {
  if (!v.secondaryUuid || v.tileX == null) return -1;
  const t = Buffer.alloc(4);
  t.writeUInt32LE(v.secondaryUuid);
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) {
    if (p + 16 > buf.length) break;
    if (buf.readUInt32LE(p + 8) === v.tileX && buf.readUInt32LE(p + 12) === v.tileY) return p;
    p += 1;
  }
  return -1;
}

const v1WithSec = v1Records.filter(c => c.secondaryUuid && c.secondaryUuid !== 0xffffffff && c.tileX != null);
let bridged = 0, span = { min: Infinity, max: 0 };
for (const v of v1WithSec) {
  const off = findRecord(v);
  if (off > 0) {
    bridged++;
    if (off < span.min) span.min = off;
    if (off > span.max) span.max = off;
  }
}
console.log(`Coord-table bridge: ${bridged} / ${v1WithSec.length} v1 chars with secondaryUuid+tile resolved`);
console.log(`Table span: 0x${span.min.toString(16)} - 0x${span.max.toString(16)}`);
console.log(`Stride at +354 should hold for all records.`);
