// dig-anc4.js — characterize the pre-portrait data with the hypothesis that it's [u16=0, u16=ancId] pairs.
// Print the first ~12 bytes after each character's trait_block_end across all chars.
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

const buf = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

// For each character, find portrait_start (first 'data/' offset) and tabulate the [u16,u16] pairs in between.
// Group by character culture (from portrait path).
function findFirstDataAt(buf, fromOff, maxScan = 200) {
  for (let i = 0; i < maxScan; i++) {
    if (fromOff + i + 7 > buf.length) break;
    // Match 'data/' literal
    if (buf[fromOff + i] === 0x64 && buf[fromOff + i + 1] === 0x61 && buf[fromOff + i + 2] === 0x74 && buf[fromOff + i + 3] === 0x61 && buf[fromOff + i + 4] === 0x2f) {
      return i;
    }
  }
  return -1;
}

const cultureSamples = {};
const ancIdHist = {};
let parsed = 0, malformed = 0;

for (const r of recs) {
  const o = r.offset;
  const tcOff = r.lastName ? 302 : 298;
  const tsOff = r.lastName ? 308 : 304;
  const tc = buf.readUInt16LE(o + tcOff);
  if (tc < 1 || tc > 80) continue;
  const trEnd = o + tsOff + tc * 8;
  const dataOff = findFirstDataAt(buf, trEnd, 200);
  if (dataOff < 0) continue;
  // The portrait length prefix is at trEnd + dataOff - 2 (right before 'data')
  // Bytes [trEnd, trEnd+dataOff-2) = pre-portrait region.
  const preLen = dataOff - 2;
  if (preLen <= 0) continue;
  if (preLen % 4 !== 0) { malformed++; continue; }
  // Parse [u16=0, u16=ancId] pairs
  const ids = [];
  let ok = true;
  for (let i = 0; i < preLen; i += 4) {
    const a = buf.readUInt16LE(trEnd + i);
    const b = buf.readUInt16LE(trEnd + i + 2);
    if (a !== 0) { ok = false; break; }
    ids.push(b);
  }
  if (!ok) { malformed++; continue; }
  parsed++;
  for (const id of ids) ancIdHist[id] = (ancIdHist[id] || 0) + 1;
  // Group by portrait path culture
  const culture = (r.portraits[0] || '').match(/data\/ui\/(\w+)\/portraits/);
  const c = culture ? culture[1] : "unknown";
  if (!cultureSamples[c]) cultureSamples[c] = [];
  if (cultureSamples[c].length < 5) cultureSamples[c].push({ name: r.firstName + " " + (r.lastName||""), tc, ids: ids.map(i=>i+'='+(ancNames[i]||'?')).slice(0,8) });
}

console.log("parsed=" + parsed + " malformed=" + malformed);
console.log("Distinct ancIds: " + Object.keys(ancIdHist).length);
const sortedIds = Object.keys(ancIdHist).map(k => [+k, ancIdHist[k]]).sort((a,b)=>b[1]-a[1]).slice(0,30);
console.log("Top 30 'ancId' values:");
sortedIds.forEach(s => console.log("  id=" + s[0] + " (" + (ancNames[s[0]] || "?") + ", trait=" + (traitNames[s[0]] || "?") + "): " + s[1]));
console.log("\nSamples by culture:");
for (const c in cultureSamples) {
  console.log("  " + c + ":");
  for (const s of cultureSamples[c]) console.log("    " + JSON.stringify(s));
}
