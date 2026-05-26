// dig-agent-rolescan.js
// =====================
// The Spain saves are small vanilla saves; parseCharacterExtras finds ~0 chars.
// Scan directly for the agent role STRINGS as they appear in the save:
//   "<culture> spy", "<culture> diplomat", etc. (ASCII pstr16 with null term)
// Also scan for any occurrence of the bare role tokens to understand how
// agents are represented in a vanilla save.
//
// Research-only.

const fs = require("fs");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
const SAVES = [
  "save_17-05-2026   Spain   Turn 1.sav",
  "save_17-05-2026   Spain   Turn 1 move spy.sav",
  "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
  "save_Autosave   Spain   Turn 3 inflitrated city with spy..sav",
];

const ROLES = ["spy", "assassin", "diplomat", "merchant", "general", "captain", "admiral", "princess"];

function findAll(buf, str) {
  const t = Buffer.from(str, "ascii");
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) {
    hits.push(p);
    p += 1;
  }
  return hits;
}

for (const name of SAVES) {
  const p = SAVE_DIR + name;
  if (!fs.existsSync(p)) { console.log(`MISSING ${name}`); continue; }
  const buf = fs.readFileSync(p);
  console.log(`\n=== ${name} (${buf.length}) ===`);
  for (const role of ROLES) {
    // Look for " <role>\0"  (space + role + null) which is the unit/type string tail
    const hits = findAll(buf, " " + role + "\0");
    if (hits.length) {
      // Show the preceding culture token for the first few
      const samples = hits.slice(0, 6).map((h) => {
        let start = h;
        while (start > 0) {
          const b = buf[start - 1];
          if ((b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || b === 0x5f) start--; else break;
        }
        const tok = buf.slice(start, h).toString("ascii");
        return `0x${h.toString(16)}(${tok})`;
      });
      console.log(`  " ${role}\\0" x${hits.length}: ${samples.join(" ")}`);
    }
    // Also raw role token occurrences (could be in descr_strat-style names like spy, descriptions, etc)
    const raw = findAll(buf, role);
    if (raw.length && !hits.length) {
      console.log(`  raw "${role}" x${raw.length} (no pstr tail form)`);
    }
  }
}
