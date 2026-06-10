// dig-anc5.js — HYPOTHESIS: ancillary list = [u16=0, u16=ancId]* + [u16=0] terminator + portrait length prefix
// Parse ancillaries for selected chars across all rome saves to see if the list is stable / grows over time.

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

function parseAncillariesAt(buf, charOff, layoutA) {
  const tcOff = layoutA ? 302 : 298;
  const tsOff = layoutA ? 308 : 304;
  const tc = buf.readUInt16LE(charOff + tcOff);
  const trEnd = charOff + tsOff + tc * 8;
  // Find first 'data/'
  let dataPos = -1;
  for (let i = 0; i < 200; i++) {
    if (buf[trEnd + i] === 0x64 && buf[trEnd + i + 1] === 0x61 && buf[trEnd + i + 2] === 0x74 && buf[trEnd + i + 3] === 0x61 && buf[trEnd + i + 4] === 0x2f) {
      dataPos = i;
      break;
    }
  }
  if (dataPos < 0) return null;
  // If dataPos = 0, lastFlag is the portrait length prefix overlap. 0 ancillaries.
  if (dataPos === 0) return [];
  // Otherwise, between trEnd and (trEnd + dataPos - 2) is anc section.
  // Structure: ?? ?? [u16 ancCount?] ?? ?? [u16=0, u16=ancId]* [u16=0]
  // Let's try: it's a sequence of [u16=0, u16=ancId] pairs followed by [u16=0] sentinel.
  // The length of this region is (dataPos - 2) bytes.
  const ancRegionLen = dataPos - 2;
  if (ancRegionLen < 2) return null;
  // Must end with 00 00
  // ancRegionLen = 2 + 4*N
  if ((ancRegionLen - 2) % 4 !== 0) return null;
  const N = (ancRegionLen - 2) / 4;
  // Read N ancillary entries
  const ancs = [];
  for (let i = 0; i < N; i++) {
    const a = buf.readUInt16LE(trEnd + i * 4);
    const b = buf.readUInt16LE(trEnd + i * 4 + 2);
    if (a !== 0) return null;  // must be padding/type=0
    ancs.push(b);
  }
  // The trailing 2 bytes should be 00 00 (terminator)
  const trail = buf.readUInt16LE(trEnd + N * 4);
  // (we don't require trail == 0, just record)
  return ancs;
}

const fnames = ["save_rome1.sav","save_rome2.sav","save_rome3.sav","save_rome4.sav","save_rome5..sav","save_rome6.sav","save_rome7.sav","save_rome8.sav","save_rome9.sav","save_rome10.sav"];
const targets = ["Hanno", "Hannibal", "AntigonosB", "Sadalas", "Satros", "Skostokos", "Rhoigos", "Marcus", "Aulus"];

for (const name of targets) {
  console.log("=== " + name);
  for (const f of fnames) {
    let buf; try { buf = fs.readFileSync(path.join(SAVES, f)); } catch (e) { continue; }
    const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
    let m;
    if (name === "Marcus") m = recs.find(r => r.firstName === "Marcus" && (r.lastName||"").toLowerCase().includes("drusus"));
    else m = recs.find(r => r.firstName === name);
    if (!m) { console.log("  " + f + ": MISSING"); continue; }
    const ancs = parseAncillariesAt(buf, m.offset, !!m.lastName);
    const tc = buf.readUInt16LE(m.offset + (m.lastName ? 302 : 298));
    if (ancs === null) { console.log("  " + f + ": tc=" + tc + " UNPARSEABLE"); continue; }
    const labels = ancs.map(id => id + "(" + (ancNames[id]||"?") + ")");
    console.log("  " + f.padEnd(22) + " tc=" + tc + " ancs[" + ancs.length + "]: " + labels.join(", "));
  }
}
