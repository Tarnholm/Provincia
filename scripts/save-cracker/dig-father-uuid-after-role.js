// Scan AFTER the role string in each character's actual record body
// for u32 values matching other chars' ownUuids — find parent slot.
const fs = require("fs");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const chars = parseCharacterExtras(buf);
const allUuids = new Set(chars.map(c => c.ownUuid));
console.log(`${chars.length} chars, ${allUuids.size} unique ownUuids`);

// For each char, scan a wide window AFTER the role string (idx + 100 to idx + 1000)
// for u32s matching another char's UUID.
const SCAN_AFTER = 1000;
// Map: offset-from-role-string-start → hit count
const offsetCounts = new Map();
for (const c of chars) {
  const roleStart = c.offset;
  const roleLen = (c.culture.length + 1 + c.role.length + 1); // e.g. "greek general\0"
  // Scan from end of role string +0 to +SCAN_AFTER
  for (let off = roleLen; off < roleLen + SCAN_AFTER; off++) {
    if (roleStart + off + 4 >= buf.length) break;
    const val = buf.readUInt32LE(roleStart + off);
    if (val === c.ownUuid || val === c.bodyguardUuid || val === c.spouseUuid) continue;
    if (val === 0 || val === 0xffffffff) continue;
    if (allUuids.has(val)) {
      offsetCounts.set(off, (offsetCounts.get(off) || 0) + 1);
    }
  }
}

console.log("\nTop 20 offsets (from role start) by hit count for other-char UUIDs:");
const sorted = Array.from(offsetCounts.entries()).sort((a, b) => b[1] - a[1]);
for (const [off, count] of sorted.slice(0, 20)) {
  console.log(`  +${off}: ${count} chars have another-char UUID here`);
}

// Also check OFFSETS RELATIVE TO ROLE NULL (i.e., role_end_position)
console.log("\n(same data, framed as offset relative to roleLen):");
const sortedByOff = sorted.slice(0, 30).sort((a, b) => a[0] - b[0]);
for (const [off, count] of sortedByOff) {
  console.log(`  +${off} (after role): ${count} hits`);
}
