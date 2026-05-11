// dig-upkeep10.js — session 9
//
// MAJOR FIND: right after the 12-record stride-354 array in player rec ends,
// at +44967 (after 12 * 354 = 4248 bytes from start +40719 = +44967), there's
// an ASCII string `caetrati` preceded by `01 00 13 00` and what looks like cost
// values `64 00 00 00 64 00 00 00` (100 / 100).
//
// caetrati is a Roman skirmisher unit. This must be the UNIT TYPES known to
// Romans Julii, with cost/upkeep stored per unit type.
//
// Let me identify the full structure: find all unit-type string records in the
// player record's trailing data, and dump their associated u32 fields.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function findMajorRecords(buf) {
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regionCount = buf.readUInt32LE(i + 48);
    if (regionCount > 200) continue;
    const treasury = buf.readInt32LE(i);
    hits.push({ pos: i, treasury, regionCount });
  }
  return hits;
}

// Scan for u16 length-prefixed ASCII strings that look like unit type names
function findUnitStrings(buf, start, end) {
  const out = [];
  for (let i = start; i + 4 < end; i++) {
    // Marker pattern: 01 00 LL 00 (u16 marker = 1, u16 length = LL)
    if (buf[i] === 0x01 && buf[i + 1] === 0x00 && buf[i + 3] === 0x00) {
      const len = buf[i + 2];
      if (len < 4 || len > 60) continue;
      // Check that next `len` bytes are ASCII letters / underscores / spaces (including trailing null)
      let ok = true;
      const start = i + 4;
      for (let j = 0; j < len; j++) {
        const c = buf[start + j];
        if (j === len - 1 && c === 0) continue;  // trailing null
        if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 32 || (c >= 48 && c <= 57))) { ok = false; break; }
      }
      if (ok) {
        const name = buf.slice(start, start + len).toString('ascii').replace(/\0/g, '');
        if (name.length >= 3) out.push({ pos: i, name, len });
      }
    }
  }
  return out;
}

const r5 = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const r6 = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const r7 = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));
const r10 = fs.readFileSync(path.join(SAVES, "save_rome10.sav"));

for (const [label, buf] of [["rome5", r5], ["rome6", r6], ["rome7", r7], ["rome10", r10]]) {
  const recs = findMajorRecords(buf);
  const p = recs[0];
  const next = recs[1];
  const strings = findUnitStrings(buf, p.pos, next.pos);
  console.log(`\n${label} player rec: ${strings.length} u16-prefixed ASCII strings`);
  // Show first 60
  for (const s of strings.slice(0, 60)) {
    const rel = s.pos - p.pos;
    console.log(`  +${rel.toString().padStart(6)}: ${s.name}`);
  }
}
