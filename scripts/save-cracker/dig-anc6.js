// dig-anc6.js — final validation: parse ancillaries for every character in save_rome6 + several other saves
// and report (1) parse success rate, (2) ancillary id distribution

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");
const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}
const ancNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_ancillaries.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Ancillary\s+(\S+)/); if (m) ancNames.push(m[1]);
}

function parseAncillariesAt(buf, charOff, layoutA) {
  const tcOff = layoutA ? 302 : 298;
  const tsOff = layoutA ? 308 : 304;
  const tc = buf.readUInt16LE(charOff + tcOff);
  const trEnd = charOff + tsOff + tc * 8;
  // Find first 'data/' marking portrait start
  let dataPos = -1;
  for (let i = 0; i < 200; i++) {
    if (buf[trEnd + i] === 0x64 && buf[trEnd + i + 1] === 0x61 && buf[trEnd + i + 2] === 0x74 && buf[trEnd + i + 3] === 0x61 && buf[trEnd + i + 4] === 0x2f) {
      dataPos = i;
      break;
    }
  }
  if (dataPos < 0) return { ok: false, reason: "no data/" };
  if (dataPos === 0) return { ok: true, ancs: [], note: "gap=-2 overlap" };
  // (dataPos - 2) bytes of anc section + length prefix at trEnd+dataPos-2..trEnd+dataPos-1
  const ancRegionLen = dataPos - 2;
  if (ancRegionLen < 2) return { ok: false, reason: "ancRegion<2" };
  if (ancRegionLen % 4 !== 2) return { ok: false, reason: "ancRegionLen%4!=2 ("+ancRegionLen+")" };
  // Last 2 bytes of anc section before length prefix is a sentinel 00 00
  const N = (ancRegionLen - 2) / 4;
  const ancs = [];
  for (let i = 0; i < N; i++) {
    const a = buf.readUInt16LE(trEnd + i * 4);
    const b = buf.readUInt16LE(trEnd + i * 4 + 2);
    if (a !== 0) return { ok: false, reason: "non-zero pad at slot " + i };
    if (b >= ancNames.length) return { ok: false, reason: "ancId " + b + " out of range" };
    if (!ancNames[b]) return { ok: false, reason: "ancId " + b + " has no name" };
    ancs.push(b);
  }
  // Trailing zero sentinel u16 at trEnd + N*4
  const sentinel = buf.readUInt16LE(trEnd + N * 4);
  if (sentinel !== 0) return { ok: false, reason: "trailing sentinel " + sentinel + " != 0" };
  return { ok: true, ancs };
}

const savesToCheck = ["save_rome6.sav", "save_rome7.sav", "save_2.0.sav", "save_1turnstart.sav", "save_Autosave   Sparta   Turn 4 End.sav"];

for (const f of savesToCheck) {
  let buf;
  try { buf = fs.readFileSync(path.join(SAVES, f)); } catch (e) { continue; }
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  let okCount = 0, errCount = 0, ancTotal = 0;
  const errReasons = {};
  for (const r of recs) {
    const result = parseAncillariesAt(buf, r.offset, !!r.lastName);
    if (result.ok) { okCount++; ancTotal += result.ancs.length; }
    else { errCount++; errReasons[result.reason] = (errReasons[result.reason] || 0) + 1; }
  }
  console.log(f + ":");
  console.log("  chars=" + recs.length + " ok=" + okCount + " err=" + errCount + " total_anc=" + ancTotal);
  for (const r of Object.keys(errReasons).slice(0,5)) console.log("    err: " + r + ": " + errReasons[r]);
}
