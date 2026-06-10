// dig-anc3.js: hypothesis test — post-trait-block data contains [u16=0, u16=ancillaryId] pairs
// followed by portrait. Count how many characters have this structure and see if the ancillary IDs are valid.
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

// For each character, look at bytes between trait_end and a u16 length prefix of 'data/' path.
// Parse those bytes as [u16=0, u16=ancId] pairs. The PORTRAIT PATH START is "data/" with a u16 length prefix.
function findPortraitLenAt(buf, fromOff, maxScan = 200) {
  for (let i = 0; i < maxScan; i++) {
    if (fromOff + i + 7 > buf.length) break;
    const len = buf.readUInt16LE(fromOff + i);
    if (len > 10 && len < 200 && buf[fromOff + i + 2] === 0x64 && buf[fromOff + i + 3] === 0x61 && buf[fromOff + i + 4] === 0x74 && buf[fromOff + i + 5] === 0x61) {
      return { off: i, len };
    }
  }
  return null;
}

let totalChars = 0;
let withAncs = 0;
const ancStats = {};
const culturePortraitLens = {};
const ancIdHist = {};
const examples = [];

for (const r of recs) {
  const o = r.offset;
  const tcOff = r.lastName ? 302 : 298;
  const tsOff = r.lastName ? 308 : 304;
  const tc = buf.readUInt16LE(o + tcOff);
  if (tc < 1 || tc > 80) continue;
  totalChars++;
  const trEnd = o + tsOff + tc * 8;
  const pp = findPortraitLenAt(buf, trEnd, 80);
  if (!pp) continue;
  // The portrait length prefix is at trEnd+pp.off, and bytes [trEnd, trEnd+pp.off) are pre-portrait data.
  // But also note: the LAST trait slot's "flag" field (last 2 bytes of trait_block) might actually be
  // the start of the pre-portrait area. So the real pre-portrait region might start 2 bytes earlier.
  // Let's check: if pp.off === 0, no pre-portrait data.
  // If pp.off > 0, we have pp.off bytes of pre-portrait data starting at trEnd.
  const preLen = pp.off;
  if (preLen > 0) {
    withAncs++;
    // Try to parse as [u16=0, u16=id] pairs
    const ids = [];
    let parseOk = true;
    for (let i = 0; i + 4 <= preLen; i += 4) {
      const a = buf.readUInt16LE(trEnd + i);
      const b = buf.readUInt16LE(trEnd + i + 2);
      if (a !== 0) { parseOk = false; break; }
      ids.push(b);
    }
    if (preLen % 4 !== 0) parseOk = false;
    if (parseOk) {
      for (const id of ids) {
        ancIdHist[id] = (ancIdHist[id] || 0) + 1;
      }
    }
    if (examples.length < 10) {
      const dump = [];
      for (let i = 0; i < preLen; i++) dump.push(buf[trEnd + i].toString(16).padStart(2, "0"));
      examples.push({
        name: r.firstName + " " + (r.lastName || ""),
        tc, preLen, dump: dump.join(" "), portraitLen: pp.len, ids: ids.map(id => id + "=" + (ancNames[id] || "?"))
      });
    }
  }
}

console.log("Total chars: " + totalChars);
console.log("With pre-portrait data: " + withAncs);
console.log("Distinct ancIds in pre-portrait pairs: " + Object.keys(ancIdHist).length);
const sortedIds = Object.keys(ancIdHist).map(k => [+k, ancIdHist[k]]).sort((a, b) => b[1] - a[1]).slice(0, 25);
console.log("Top 25 ids:");
sortedIds.forEach(s => console.log("  id=" + s[0] + " (" + (ancNames[s[0]] || "?") + ", trait=" + (traitNames[s[0]] || "?") + "): " + s[1]));
console.log("\nExamples:");
examples.forEach(e => console.log(JSON.stringify(e)));
