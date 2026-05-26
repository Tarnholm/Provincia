// dig-diploterms-23-terms.js
// Hunt for AGREEMENT TERMS (tribute per turn, ceasefire turn count, trade rights
// detail). The 16-byte zone entry only has class/attitude. Terms must be:
//   (a) implied by class alone (trade=class2, no numeric terms), OR
//   (b) in a separate per-relation record, OR
//   (c) not serialized.
// Approach: dump what FOLLOWS the entries block in an NPC zone, and check if the
// entry is actually wider than 16 bytes (extra fields between entries).
"use strict";
const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const MARKER = 0x39240005;

function hexrow(buf, off, len) {
  const s = [];
  for (let i = 0; i < len; i++) { if (off+i>=0 && off+i<buf.length) s.push(buf[off+i].toString(16).padStart(2,"0")); }
  return s.join(" ");
}

// Carthage NPC zone in Spain T1 (6 entries). Dump entries + 64 bytes after.
const buf = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1.sav"));
let carthMarker = -1;
for (let i = 53; i + 8 < buf.length; i++) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  if (buf.readUInt32LE(i+4) > 250) continue;
  if (buf[i-53] === 7) { carthMarker = i; break; }
}
const count = buf.readUInt32LE(carthMarker+4);
console.log(`Carthage NPC zone @0x${carthMarker.toString(16)} count=${count}`);
console.log("Entries (16 bytes each) + what follows:");
const bodyStart = carthMarker + 8;
for (let k = 0; k < count; k++) {
  console.log(`  entry ${k}: ${hexrow(buf, bodyStart + k*16, 16)}`);
}
console.log("after entries (96 bytes):");
for (let off = 0; off < 96; off += 16) console.log(`  +${off}: ${hexrow(buf, bodyStart + count*16 + off, 16)}`);

// Now the WAR/TRADE term question: compare the carthage NPC zone entries' tag
// field — is tag always 0x10101 or does it vary (could encode trade flag bits)?
console.log("\nTag field analysis across ALL npc entries (looking for non-0x10101 = term bits):");
const tagHist = {};
for (let i = 53; i + 8 < buf.length; i++) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  const c = buf.readUInt32LE(i+4); if (c>250) continue;
  for (let k=0;k<c;k++){const t=buf.readUInt32LE(i+8+k*16+12);tagHist[t.toString(16)]=(tagHist[t.toString(16)]||0)+1;}
}
console.log("  tag histogram:", JSON.stringify(tagHist));
