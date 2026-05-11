// dig-chartail1.js — map character record bytes +219..+301 across rome1..rome10
//
// Session 4 covered +0..+218 (~88% of header). +219..+301 was not classified.
// This is the LAYOUT_A tail zone before traitCount at +302.
//
// Method:
//   1) Load all 10 rome saves; parse character records.
//   2) Identify a focus character (Marcus Livius_Drusus — captured Uria, gained
//      RomanConquerorMessapians trait, gained Messapivs epithet).
//   3) Walk +219..+301 byte-by-byte across rome1..rome10 and report transitions.
//   4) Cross-check ALL LAYOUT_A characters at the same offsets to identify which
//      bytes are character-specific (changing for the focus char only) vs.
//      ambient (changing for many chars at a turn boundary).

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8")
  .split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}

const ROMES = ["save_rome1.sav", "save_rome2.sav", "save_rome3.sav", "save_rome4.sav",
  "save_rome5..sav", "save_rome6.sav", "save_rome7.sav", "save_rome8.sav",
  "save_rome9.sav", "save_rome10.sav"];

const bufs = ROMES.map(f => fs.readFileSync(path.join(SAVES, f)));
const allRecs = bufs.map(buf => cp.findCharacterRecords(buf, nameLookup, traitNames, null));

function fkey(r) { return `${r.firstName}|${r.lastName || ""}`; }
function ukey(r) { return `${r.primaryUuid}`; }

// Find the focus character — Marcus Livius_Drusus
let focusKey = null;
for (const r of allRecs[0]) {
  if (r.firstName === "Marcus" && r.lastName === "Livius_Drusus") {
    focusKey = ukey(r);
    console.log(`Focus character: ${r.firstName} ${r.lastName}  uuid=${r.primaryUuid.toString(16)}  offset@rome1=${r.offset.toString(16)}`);
    break;
  }
}

if (!focusKey) {
  // Maybe Messapivs has overwritten — try Marcus + any last name
  for (const r of allRecs[0]) {
    if (r.firstName === "Marcus" && r.lastName && (r.lastName.includes("Drusus") || r.lastName.includes("Messap") || r.lastName === "Livius_Drusus")) {
      focusKey = ukey(r);
      console.log(`Focus character (alt): ${r.firstName} ${r.lastName}  uuid=${r.primaryUuid.toString(16)}`);
      break;
    }
  }
}

if (!focusKey) {
  console.log("Marcus Livius_Drusus not found in rome1; listing all Marcus chars in rome1:");
  for (const r of allRecs[0]) {
    if (r.firstName === "Marcus") {
      console.log(`  Marcus ${r.lastName}  uuid=${r.primaryUuid.toString(16)}  offset=${r.offset.toString(16)}  role=${r.role}`);
    }
  }
  process.exit(0);
}

// Trace focus character across all 10 saves by uuid
const focusByRome = ROMES.map((_, i) => {
  for (const r of allRecs[i]) if (ukey(r) === focusKey) return r;
  return null;
});

console.log("\nFocus character across saves:");
for (let i = 0; i < ROMES.length; i++) {
  const r = focusByRome[i];
  if (!r) { console.log(`  ${ROMES[i]}: NOT FOUND`); continue; }
  console.log(`  ${ROMES[i]}: ${r.firstName} ${r.lastName}  off=0x${r.offset.toString(16)}  age=${r.age}  role=${r.role}  traits=${r.traits.length}  anc=${r.ancillaries.length}`);
}

// Walk +219..+301 for the focus character
console.log("\n## Byte map +219..+301 for focus character across rome1..rome10");
console.log("rel | rome1 rome2 rome3 rome4 rome5 rome6 rome7 rome8 rome9 rome10 | changes");
for (let rel = 219; rel <= 301; rel++) {
  const vals = focusByRome.map(r => r ? bufs[focusByRome.indexOf(r)].readUInt8(r.offset + rel) : null);
  // Actually, use per-index for proper indexing:
  const v = [];
  for (let i = 0; i < 10; i++) {
    if (focusByRome[i]) v.push(bufs[i].readUInt8(focusByRome[i].offset + rel));
    else v.push(null);
  }
  const uniq = new Set(v.filter(x => x !== null));
  if (uniq.size > 1) {
    const display = v.map(x => x === null ? "  ?" : x.toString().padStart(3)).join(" ");
    console.log(`+${rel.toString().padStart(3)} | ${display} | uniq=${uniq.size}`);
  }
}

// Now also look at u16 / u32 / f32 / i32 readings at every offset that showed variation
console.log("\n## Wider reads (u16/u32/f32/i32) at every changing relative offset");
for (let rel = 219; rel <= 299; rel++) {
  const u16 = [];
  const u32 = [];
  const i32 = [];
  const f32 = [];
  for (let i = 0; i < 10; i++) {
    const r = focusByRome[i];
    if (!r || r.offset + rel + 4 > bufs[i].length) { u16.push(null); u32.push(null); i32.push(null); f32.push(null); continue; }
    u16.push(bufs[i].readUInt16LE(r.offset + rel));
    u32.push(bufs[i].readUInt32LE(r.offset + rel));
    i32.push(bufs[i].readInt32LE(r.offset + rel));
    f32.push(bufs[i].readFloatLE(r.offset + rel));
  }
  const u32u = new Set(u32.filter(x => x !== null));
  if (u32u.size > 1) {
    const showU32 = u32.map(x => x === null ? "?" : x.toString()).join(",");
    const showI32 = i32.map(x => x === null ? "?" : x.toString()).join(",");
    const showF32 = f32.map(x => x === null ? "?" : (Number.isFinite(x) && Math.abs(x) > 1e-30 && Math.abs(x) < 1e10 ? x.toFixed(3) : "_")).join(",");
    console.log(`+${rel.toString().padStart(3)} u32u=${u32u.size}  u32=[${showU32}]  i32=[${showI32}]  f32=[${showF32}]`);
  }
}
