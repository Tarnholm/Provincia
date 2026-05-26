// Diagnostic: load the parser, run it against the Macedon save, and
// report whether Achaios is found / which layout / what stats. If he's
// NOT found, dump candidate offsets where his name index appears so we
// can see what's tripping the parser's gates.

const fs = require("fs");
const path = require("path");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const MOD = "C:/RIS/RIS/data";

const namesPath = path.join(MOD, "descr_names_lookup.txt");
const traitsPath = path.join(MOD, "export_descr_character_traits.txt");

// Parse nameLookup (one name per line, index = line number — 0-based)
const names = fs.readFileSync(namesPath, "utf8").split(/\r?\n/);
const nameIdx = names.indexOf("Achaios");
console.log(`"Achaios" → nameLookup index ${nameIdx}`);

if (nameIdx < 0) {
  console.error("Achaios not in nameLookup — name index missing means parser can't find him by name.");
  process.exit(0);
}

const buf = fs.readFileSync(SAVE);
console.log(`Save size: ${buf.length.toLocaleString()} bytes`);

// Search for the 4-byte little-endian name index of Achaios
const target = Buffer.alloc(4);
target.writeUInt32LE(nameIdx, 0);
const hits = [];
let p = 0;
while (true) {
  const i = buf.indexOf(target, p);
  if (i < 0) break;
  hits.push(i);
  p = i + 1;
}
console.log(`u32(${nameIdx}) "Achaios" appears at ${hits.length} offsets in the save.`);

// For each hit, dump surrounding bytes + classify
const traitNames = (() => {
  // Quick-parse: each `Trait` block declares one trait. We just collect names in order.
  const lines = fs.readFileSync(traitsPath, "utf8").split(/\r?\n/);
  const out = [];
  for (const l of lines) {
    const m = l.match(/^\s*Trait\s+(\S+)/);
    if (m) out.push(m[1]);
  }
  return out;
})();
console.log(`Loaded ${traitNames.length} trait names.`);

// Now check each hit: does it look like a character record start?
// A character record starts with the firstName u32 at offset 0. So the
// hit position IS the record start. Validate the rest of the header.
console.log("");
console.log("Per-hit gate analysis:");
console.log("");
for (const off of hits.slice(0, 20)) {
  const gender = buf[off + 4];
  const pad9_A = buf[off + 9];
  const pad9_B = buf[off + 5];
  const ageA = 242 - buf[off + 26];
  const ageB = 242 - buf[off + 22];
  const tcA = buf.readUInt16LE(off + 302);
  const tcB = buf.readUInt16LE(off + 298);
  const lastIdxA = buf.readUInt32LE(off + 5);

  const validLastA = lastIdxA >= 50 && lastIdxA < names.length && names[lastIdxA];
  const layoutAhint = `gender=${gender} pad9_A=${pad9_A} ageA=${ageA} tcA=${tcA} lastA="${validLastA ? names[lastIdxA] : "INVALID"}"`;
  const layoutBhint = `pad9_B=${pad9_B} ageB=${ageB} tcB=${tcB}`;
  // Try LAYOUT_A trait[0] validation
  const trait0A_id = buf.readUInt32LE(off + 308);
  const trait0A_lvl = buf.readUInt16LE(off + 308 + 4);
  const trait0A_name = trait0A_id < traitNames.length ? traitNames[trait0A_id] : "OOB";
  const trait0B_id = buf.readUInt32LE(off + 304);
  const trait0B_lvl = buf.readUInt16LE(off + 304 + 4);
  const trait0B_name = trait0B_id < traitNames.length ? traitNames[trait0B_id] : "OOB";
  console.log(`@0x${off.toString(16)}: ${layoutAhint}`);
  console.log(`              ${layoutBhint}`);
  console.log(`              traitA[0]: id=${trait0A_id} lvl=${trait0A_lvl} name=${trait0A_name}`);
  console.log(`              traitB[0]: id=${trait0B_id} lvl=${trait0B_lvl} name=${trait0B_name}`);
}
