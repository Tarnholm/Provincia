// Compare two consecutive saves to find new/dead/changed characters.
// Useful for surfacing birth/death/adoption events in Provincia.

const fs = require("fs");
const path = require("path");
const { parseCharacterExtras } = require("../../src/saveCrackerExtras.js");

const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves";

// Compare T1 → T2 of Alexander Macedon (we have these via memory). Adoption
// finding was in cracker session 164.
const saves = [
  "save_17-05-2026   Macedon   Turn 1.sav",
  "save_17-05-2026   Macedon   Turn 2.sav",
];

const chars = saves.map(name => {
  const fullPath = path.join(SAVES_DIR, name);
  if (!fs.existsSync(fullPath)) return null;
  const buf = fs.readFileSync(fullPath);
  const all = parseCharacterExtras(buf);
  return { name, buf, chars: all };
});

if (chars.some(c => !c)) {
  console.log("Some saves missing:", saves);
  process.exit(0);
}

console.log(`T1: ${chars[0].chars.length} chars`);
console.log(`T2: ${chars[1].chars.length} chars`);

const t1Set = new Set(chars[0].chars.map(c => c.ownUuid));
const t2Set = new Set(chars[1].chars.map(c => c.ownUuid));

const added = chars[1].chars.filter(c => !t1Set.has(c.ownUuid));
const removed = chars[0].chars.filter(c => !t2Set.has(c.ownUuid));

console.log(`\nAdded T1→T2 (births/adoptions): ${added.length}`);
for (const c of added.slice(0, 10)) {
  console.log(`  +${c.role} own=${c.ownUuid.toString(16)}  age=${c.age}  region=${c.region}`);
}

console.log(`\nRemoved T1→T2 (deaths/etc): ${removed.length}`);
for (const c of removed.slice(0, 10)) {
  console.log(`  -${c.role} own=${c.ownUuid.toString(16)}  age=${c.age}  region=${c.region}`);
}

// Age comparison — chars that aged differently than expected
console.log(`\nAge changes:`);
const t1ByUuid = new Map(chars[0].chars.map(c => [c.ownUuid, c]));
let ageChanged = 0;
for (const c2 of chars[1].chars) {
  const c1 = t1ByUuid.get(c2.ownUuid);
  if (c1 && c1.age !== c2.age) {
    ageChanged++;
    if (ageChanged <= 5) console.log(`  ${c2.region}: age ${c1.age} → ${c2.age}`);
  }
}
console.log(`  total chars with age change: ${ageChanged}`);
