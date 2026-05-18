// Investigate why 9 characters didn't resolve to portraits.

const fs = require("fs");
const { parseCharacterExtras, resolvePortraitsByCharacter } = require("../../src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const u32 = (o) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0;

const chars = parseCharacterExtras(buf);
const portraits = resolvePortraitsByCharacter(buf, chars);

const unresolved = chars.filter(c => !portraits.has(c.ownUuid));
console.log(`unresolved: ${unresolved.length}/${chars.length}`);

for (const c of unresolved) {
  // Find back-ref
  const ownBytes = Buffer.alloc(4); ownBytes.writeUInt32LE(c.ownUuid);
  const ref = buf.indexOf(ownBytes, 0x1500000);
  console.log(`\n  ${c.region.padEnd(22)} age=${c.age} role=${c.role} culture=${c.culture}`);
  console.log(`    own=${c.ownUuid.toString(16).padStart(8, '0')} ref=${ref < 0 ? "(not found)" : "0x" + ref.toString(16)}`);
  if (ref < 0 || ref >= c.offset) {
    console.log(`    skipping (no valid back-ref)`);
    continue;
  }
  // Read +280
  const p280 = u32(ref + 280);
  console.log(`    +280 = ${p280.toString(16).padStart(8, '0')}`);
  // Where does +280 appear in the save?
  if (p280 !== 0 && p280 !== 0xffffffff) {
    const pBytes = Buffer.alloc(4); pBytes.writeUInt32LE(p280);
    const occs = [];
    let p = 0;
    while ((p = buf.indexOf(pBytes, p)) !== -1 && occs.length < 10) { occs.push(p); p += 4; }
    console.log(`    +280 occurs ${occs.length} times in save: ${occs.slice(0, 5).map(o => "0x" + o.toString(16)).join(", ")}`);
  }
}
