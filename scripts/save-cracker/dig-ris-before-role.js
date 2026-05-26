// Dump 256 bytes BEFORE the role string of first antigonid char to see
// what fields precede it.
const fs = require("fs");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const chars = parseCharacterExtras(buf);
const c = chars.find(x => x.culture === "antigonid");
const idx = c.offset;

const nameLookup = fs.readFileSync("C:\\RIS\\RIS\\data\\descr_names_lookup.txt", "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = ["__nontrait__"];
for (const line of fs.readFileSync("C:\\RIS\\RIS\\data\\export_descr_character_traits.txt", "utf8").split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}

console.log(`char @0x${idx.toString(16)} role="${c.culture} ${c.role}" ownUuid=0x${c.ownUuid.toString(16)}\n`);
console.log("Bytes -300 to -2 before role string:");
for (let off = idx - 300; off < idx; off += 16) {
  let hex = "", asc = "";
  for (let i = 0; i < 16; i++) {
    const b = buf[off + i];
    hex += b.toString(16).padStart(2, "0") + " ";
    asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  const rel = off - idx;
  console.log(`  ${rel.toString().padStart(4)} (0x${off.toString(16)}): ${hex.padEnd(48)} | ${asc}`);
}

// Scan -300 to -2 for any plausible u32 nameLookup index
console.log("\nU32 scan for nameLookup index hits (-300 to -2):");
for (let off = idx - 300; off + 4 <= idx; off++) {
  const v = buf.readUInt32LE(off);
  if (v < 50 || v >= nameLookup.length) continue;
  const name = nameLookup[v];
  if (!name || name.length < 3) continue;
  if (name[0] < "A" || name[0] > "Z") continue;
  console.log(`  ${(off - idx).toString().padStart(4)}: u32=${v} = "${name}"`);
}

// Search for trait-list-like pattern within +300 to +2000 after role
console.log("\nWide search for trait list pattern (within idx +100 to +3000):");
for (let off = 100; off < 3000; off++) {
  if (idx + off + 2 > buf.length) break;
  const tc = buf.readUInt16LE(idx + off);
  if (tc < 3 || tc > 30) continue;
  // Validate next tc trait entries
  let valid = 0;
  let firstTraitName = null;
  for (let i = 0; i < tc; i++) {
    const tOff = idx + off + 2 + i * 8;
    if (tOff + 8 > buf.length) break;
    const tid = buf.readUInt32LE(tOff);
    const level = buf.readUInt16LE(tOff + 4);
    if (tid >= 1 && tid < traitNames.length && level >= 1 && level <= 200) {
      valid++;
      if (i === 0) firstTraitName = traitNames[tid];
    }
  }
  if (valid >= tc && firstTraitName) {
    console.log(`  STRONG: idx+${off}: u16=${tc}, first trait = "${firstTraitName}"`);
    for (let i = 0; i < Math.min(5, tc); i++) {
      const tOff = idx + off + 2 + i * 8;
      const tid = buf.readUInt32LE(tOff);
      const level = buf.readUInt16LE(tOff + 4);
      console.log(`    [${i}] ${traitNames[tid]} (id=${tid}) level=${level}`);
    }
    break;
  }
}
