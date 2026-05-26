// Test if attachMapCoords works on vanilla classic (1.3 MB) saves.
// It starts scanning at 0x1500000 (22 MB) — past the END of vanilla saves.
const fs = require("fs");
const { parseCharacterExtras, attachMapCoords } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const PATHS = [
  ["Macedon T0 RIS", "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav"],
  ["Spain Turn 1 vanilla", "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_17-05-2026   Spain   Turn 1.sav"],
];

for (const [name, path] of PATHS) {
  try {
    const buf = fs.readFileSync(path);
    const chars = parseCharacterExtras(buf);
    console.log(`\n${name} (${(buf.length/1024).toFixed(0)} KB)`);
    console.log(`  parseCharacterExtras: ${chars.length} chars`);
    if (buf.length < 0x1500000) {
      console.log(`  ⚠️  save is < 0x1500000 (${buf.length.toString(16)}) — attachMapCoords WILL FAIL since it starts at 0x1500000`);
    }
    attachMapCoords(buf, chars);
    const withCoords = chars.filter(c => c.extX != null).length;
    console.log(`  attachMapCoords: ${withCoords}/${chars.length} chars got coords`);
  } catch (err) {
    console.log(`  ERROR: ${err.message}`);
  }
}
