// dig-anc2.js — find variable-length data between trait block and portraits
// across all chars in save_rome6
const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");
const MOD = "C:/RIS/RIS/data";
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
console.log("traits=" + traitNames.length + " ancillaries=" + ancNames.length);

const buf = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
console.log("chars: " + recs.length);

// For each character, compute the gap between (trait_block_end) and (portrait_start).
// portrait_start is where we find a u16 followed by ASCII "data/" of valid length.
function findPortraitStart(buf, fromOff, maxScan = 200) {
  for (let i = 0; i < maxScan; i++) {
    if (fromOff + i + 8 > buf.length) break;
    const len = buf.readUInt16LE(fromOff + i);
    if (len > 10 && len < 200 && buf[fromOff + i + 2] === 0x64) { // 'd' of 'data'
      // Verify 'data/' literal
      if (buf.slice(fromOff + i + 2, fromOff + i + 7).toString("ascii") === "data/") return i;
    }
  }
  return -1;
}

const gapHist = {};
const samples = {};
for (const r of recs) {
  const o = r.offset;
  const tcOff = r.lastName ? 302 : 298;
  const tsOff = r.lastName ? 308 : 304;
  const tc = buf.readUInt16LE(o + tcOff);
  if (tc < 1 || tc > 200) continue;
  const aft = o + tsOff + tc * 8;
  const gap = findPortraitStart(buf, aft, 80);
  if (gap < 0) continue;
  gapHist[gap] = (gapHist[gap] || 0) + 1;
  if (!samples[gap]) samples[gap] = [];
  if (samples[gap].length < 3) {
    const term = o + tsOff + (tc - 1) * 8;
    const termFlag = buf.readUInt16LE(term + 6);
    samples[gap].push({name: r.firstName + " " + (r.lastName||""), tc, gap, termFlag, off: "0x" + o.toString(16)});
  }
}
console.log("gap (bytes between trait_block_end and portrait_start) histogram:");
const sortedKeys = Object.keys(gapHist).map(Number).sort((a,b)=>a-b);
for (const k of sortedKeys) {
  console.log("  gap=" + k + ": " + gapHist[k] + " characters");
}
console.log("\nSamples (3 per gap):");
for (const k of sortedKeys) {
  console.log("  gap=" + k + ":");
  for (const s of samples[k]) console.log("    " + JSON.stringify(s));
}
