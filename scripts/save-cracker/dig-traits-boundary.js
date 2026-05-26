// dig-traits-boundary.js
//
// Resolve what the "u16+6 of last slot" actually is. Hypothesis: the trait
// record is only 6 useful bytes (u32 id + u16 points) but stored on an
// 8-byte stride. For the LAST trait, the 2 trailing pad bytes overlap with
// the NEXT field (ancillary section or portrait length prefix). The value 53
// (0x35) == 'data/ui/...' portrait pstr length, or 290 etc.
//
// We dump the region around the last trait slot + the following bytes for
// several chars to characterize the boundary precisely.

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const MOD = "C:\\RIS\\RIS\\data";
const savePath = process.argv[2] || path.join(SAVE_DIR, "save_macedon t0.sav");

const edctLines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
const traitNames = [];
for (const l of edctLines) { const m = l.match(/^Trait\s+(\S+)/); if (m) traitNames.push(m[1]); }
function loadNameLookup() {
  const buf = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"));
  const text = (buf[0] === 0xff && buf[1] === 0xfe) ? buf.toString("utf16le", 2) : buf.toString("utf8");
  return text.split(/\r?\n/).map(s => s.trim());
}
const nameLookup = loadNameLookup();
const { findCharacterRecords } = require("C:/dev/Provincia/src/characterParser.js");
const buf = fs.readFileSync(savePath);
const chars = findCharacterRecords(buf, nameLookup, traitNames, null);

let count = 0;
for (const c of chars) {
  if (count >= 6) break;
  const layoutB = c.lastName == null;
  const tsOff = c.offset + (layoutB ? 304 : 308);
  const tcOff = c.offset + (layoutB ? 298 : 302);
  const tc = buf.readUInt16LE(tcOff);
  if (tc < 2) continue;
  count++;
  const lastBase = tsOff + (tc - 1) * 8;
  console.log(`\n${c.firstName} ${c.lastName||""} @0x${c.offset.toString(16)} tc=${tc}`);
  // last slot 8 bytes + next 16
  const region = buf.slice(lastBase, lastBase + 24);
  console.log(`  last-slot+next24: ${region.toString("hex").replace(/(..)/g,"$1 ")}`);
  const lastTid = buf.readUInt32LE(lastBase);
  const lastPts = buf.readUInt16LE(lastBase + 4);
  console.log(`  last trait: id=${lastTid} (${traitNames[lastTid]}) points=${lastPts}`);
  // Interpret +6 onward as the post-trait section. Try: u16 ancCount? then data/?
  const after = lastBase + 8;
  // search for data/ within 32 bytes
  let dp = -1;
  for (let i = 0; i < 32 && after + i + 5 < buf.length; i++) {
    if (buf.slice(after + i, after + i + 5).toString("ascii") === "data/") { dp = i; break; }
  }
  console.log(`  bytes from trait_block_end(0x${after.toString(16)}): ${buf.slice(after, after+12).toString("hex").replace(/(..)/g,"$1 ")}`);
  console.log(`  "data/" at +${dp} from trait_block_end`);
  // The u16+6 of last slot:
  console.log(`  u16 @ lastBase+6 = ${buf.readUInt16LE(lastBase+6)}  (this is the 2 bytes right after last trait's points)`);
  // Likely interpretation: trait points are u32 not u16? check
  console.log(`  ALT: last trait points as u32 = ${buf.readUInt32LE(lastBase+4)}`);
}
