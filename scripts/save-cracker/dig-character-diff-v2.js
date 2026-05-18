// Try to find consecutive save pairs to diff characters.

const fs = require("fs");
const path = require("path");
const { parseCharacterExtras } = require("../../src/saveCrackerExtras.js");

// We have Macedon T0 + Macedon T1.sav in Alexander folder.
const SAVES_DIR_ALEX = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves";
const SAVES_DIR_ROME = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";

function tryLoad(dir, name) {
  const full = path.join(dir, name);
  if (!fs.existsSync(full)) return null;
  const buf = fs.readFileSync(full);
  const c = parseCharacterExtras(buf);
  return { name, buf, chars: c };
}

// Try Alexander T1 vs T2
const pairs = [
  [tryLoad(SAVES_DIR_ALEX, "save_17-05-2026   Macedon   Turn 1.sav"), tryLoad(SAVES_DIR_ALEX, "save_17-05-2026   Macedon   Turn 2.sav")],
  // Rome saves (numbered)
  [tryLoad(SAVES_DIR_ROME, "save_1.1.sav"), tryLoad(SAVES_DIR_ROME, "save_1.2.sav")],
  [tryLoad(SAVES_DIR_ROME, "save_2.1.sav"), tryLoad(SAVES_DIR_ROME, "save_2.2.sav")],
  // Macedon T0 vs Spain T1 (different factions; just for diagnostic)
  [tryLoad(SAVES_DIR_ROME, "save_macedon t0.sav"), tryLoad(SAVES_DIR_ROME, "save_17-05-2026   Spain   Turn 1.sav")],
];

for (const [a, b] of pairs) {
  if (!a || !b) { console.log(`pair skip: ${a?.name || "(none)"} | ${b?.name || "(none)"}`); continue; }
  console.log(`\n=== ${a.name}  vs  ${b.name} ===`);
  console.log(`  ${a.chars.length} chars → ${b.chars.length} chars`);
  if (a.chars.length === 0 || b.chars.length === 0) {
    console.log("  (one save has 0 chars — saves may use different role-string format)");
    continue;
  }
  const aSet = new Set(a.chars.map(c => c.ownUuid));
  const bSet = new Set(b.chars.map(c => c.ownUuid));
  const added = b.chars.filter(c => !aSet.has(c.ownUuid));
  const removed = a.chars.filter(c => !bSet.has(c.ownUuid));
  console.log(`  added: ${added.length}, removed: ${removed.length}`);
  for (const c of added.slice(0, 3)) console.log(`    +${c.role} ${c.region} age=${c.age}`);
  for (const c of removed.slice(0, 3)) console.log(`    -${c.role} ${c.region} age=${c.age}`);
}
