// dig-agent-anchor.js
// =====================
// GOAL: locate non-military agent records (spy / assassin / diplomat / merchant)
// in Spain saves via parseCharacterExtras, and dump surrounding bytes so we can
// start mapping agent-specific state (skill level, mission target, infiltration
// flag, merchant trade value).
//
// Research-only. Does not modify app code.

const fs = require("fs");
const { parseCharacterExtras } = require("../../src/saveCrackerExtras.js");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";

const SAVES = [
  "save_17-05-2026   Spain   Turn 1.sav",
  "save_17-05-2026   Spain   Turn 1 move spy.sav",
  "save_17-05-2026   Spain   Turn 1move diplomat and army.sav",
  "save_Autosave   Spain   Turn 3 End.sav",
  "save_Autosave   Spain   Turn 3 inflitrated city with spy..sav",
];

const AGENT_ROLES = new Set(["spy", "assassin", "diplomat", "merchant"]);

function hex(buf, start, len) {
  const out = [];
  for (let i = 0; i < len; i += 16) {
    const row = [];
    const asc = [];
    for (let j = 0; j < 16 && start + i + j < buf.length; j++) {
      const b = buf[start + i + j];
      row.push(b.toString(16).padStart(2, "0"));
      asc.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    out.push(
      `  +${(i).toString().padStart(4)} (0x${(start + i).toString(16)}): ${row.join(" ").padEnd(48)} | ${asc.join("")}`
    );
  }
  return out.join("\n");
}

for (const name of SAVES) {
  const p = SAVE_DIR + name;
  if (!fs.existsSync(p)) {
    console.log(`\n### MISSING: ${name}`);
    continue;
  }
  const buf = fs.readFileSync(p);
  const chars = parseCharacterExtras(buf);
  const agents = chars.filter((c) => AGENT_ROLES.has(c.role));
  console.log(`\n========================================================`);
  console.log(`### ${name}  (size ${buf.length})`);
  console.log(`    total ext chars=${chars.length}  agents=${agents.length}`);
  for (const a of agents) {
    console.log(`\n  --- ${a.role} [${a.culture}] off=0x${a.offset.toString(16)} ownUuid=${a.ownUuid} bgUuid=${a.bodyguardUuid} region=${a.region} age=${a.age}`);
    // Dump 64 bytes before the role string and 200 bytes after the offset.
    const start = Math.max(0, a.offset - 64);
    console.log(hex(buf, start, 64 + 256));
  }
}
