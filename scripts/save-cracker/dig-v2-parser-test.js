// Run characterParserV2's logic directly on save_macedon t0.sav to see
// if it produces portraits per character. If yes, we already have the
// crack and just need to plumb it through to FamilyTree.

const fs = require("fs");
const path = require("path");

const SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);
console.log(`save size: ${buf.length}`);

// V2 parser walks character records anchored on a 0x03 marker. Let me find
// them.
const RECORD_MARKER = Buffer.from([0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const positions = [];
let p = 0;
while ((p = buf.indexOf(RECORD_MARKER, p)) !== -1) {
  positions.push(p);
  p += 8;
}
console.log(`0x03 marker positions: ${positions.length}`);

// V2's record header inspection (from characterParserV2.js):
// At each marker position `off`:
//   off - 12 to off - 9: primary_uuid
//   off - 8 to off - 5: commander_uuid
//   off + 8: name index (u32)
//   off + N: trait block

// Just sample first few markers' surroundings
console.log("\nfirst 5 0x03 markers — primary_uuid + name index:");
for (const off of positions.slice(0, 5)) {
  if (off < 12 || off + 16 > buf.length) continue;
  const pu = buf.readUInt32LE(off - 12);
  const cu = buf.readUInt32LE(off - 8);
  const nameIdx = buf.readUInt32LE(off + 8);
  console.log(`  0x${off.toString(16)}: primary_uuid=${pu.toString(16).padStart(8, '0')}  commander_uuid=${cu.toString(16).padStart(8, '0')}  name_idx=${nameIdx}`);
}

// Try V2's portrait-finding logic on first few markers — look for a pstr16
// "data/..." pstr16 within 400 bytes after the marker.
console.log("\nportraits within +50..+500 of first 10 0x03 markers:");
function findPortraitsAfter(off, maxDist) {
  const out = [];
  for (let i = off + 50; i < Math.min(buf.length - 200, off + maxDist) && out.length < 4; i++) {
    const len = buf.readUInt16LE(i);
    if (len < 8 || len > 200) continue;
    let s = "", ok = true;
    for (let k = 0; k < len - 1; k++) {
      const b = buf[i + 2 + k];
      if (b < 0x20 || b > 0x7e) { ok = false; break; }
      s += String.fromCharCode(b);
    }
    if (!ok || buf[i + 2 + len - 1] !== 0) continue;
    if (!s.startsWith("data/")) continue;
    out.push({ at: i, s, delta: i - off });
    i += 1 + len;
  }
  return out;
}
for (const off of positions.slice(0, 10)) {
  const ps = findPortraitsAfter(off, 600);
  if (ps.length > 0) {
    console.log(`  0x${off.toString(16)}: ${ps.length} portrait(s)`);
    for (const p of ps) console.log(`    +${p.delta}: "${p.s.split('/').slice(-3).join('/')}"`);
  }
}
