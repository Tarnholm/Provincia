// For each character's 354-byte extended record, scan u32s at every
// offset and see which offsets consistently hold ANOTHER character's
// ownUuid. The most common "hit" offset = fatherUuid location.
const fs = require("fs");
const { parseCharacterExtras, attachMapCoords } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const chars = parseCharacterExtras(buf);
attachMapCoords(buf, chars);

console.log(`${chars.length} characters parsed`);

// Build a set of all char ownUuids
const allUuids = new Set(chars.map(c => c.ownUuid));
console.log(`${allUuids.size} unique ownUuids`);

// For each character, locate the extended record via back-ref
// (same logic as attachMapCoords)
const extOffsetByChar = new Map();
for (const c of chars) {
  const ownBytes = Buffer.alloc(4);
  ownBytes.writeUInt32LE(c.ownUuid);
  const ref = buf.indexOf(ownBytes, 0x1500000);
  if (ref < 0 || ref >= c.offset) continue;
  if (ref + 354 > buf.length) continue;
  extOffsetByChar.set(c.ownUuid, ref);
}
console.log(`${extOffsetByChar.size} extended records located`);

// At each offset 0..350, count how many chars' u32 at that offset
// resolves to ANOTHER char's ownUuid (excluding self).
const offsetCounts = new Array(354).fill(0);
for (const [uuid, ext] of extOffsetByChar.entries()) {
  for (let off = 0; off + 4 <= 354; off++) {
    const val = buf.readUInt32LE(ext + off);
    if (val !== uuid && val !== 0 && val !== 0xffffffff && allUuids.has(val)) {
      offsetCounts[off]++;
    }
  }
}

// Find offsets with > 30 hits (most chars have a known parent UUID at this slot)
console.log("\noffsets with >30 hits (probable parent/relative UUID slots):");
for (let off = 0; off < 354; off++) {
  if (offsetCounts[off] > 30) {
    console.log(`  +${off.toString().padStart(3)}: ${offsetCounts[off]} chars have a known-char UUID here`);
  }
}

// Show distribution of hit counts
const sortedOffsets = offsetCounts.map((c, i) => ({ off: i, count: c })).sort((a, b) => b.count - a.count);
console.log("\nTop 20 offsets by hit count:");
for (const o of sortedOffsets.slice(0, 20)) {
  if (o.count === 0) break;
  console.log(`  +${o.off.toString().padStart(3)}: ${o.count} hits`);
}
