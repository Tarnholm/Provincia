// dig-diplocat-senate.js
// Targets #6 (senate special diplomacy) and #5 (diplomatic events/mission
// history). Vanilla saves have the SPQR senate; RIS may strip it.
//
//  - Is the senate faction ("senate"/"spqr"/"roman_senate") present in the
//    descr_sm_factions order and does it own a 0x39240005 diplo zone?
//  - Look for SENATE_MISSION / mission-history serialized instances by
//    scanning for mission-related strings or a mission table near faction recs.
//  - Look for the senate's relationship to the 3 roman factions (julii/brutii/
//    scipii) — a special diplomacy state in vanilla.
const fs = require("fs");
const { parseFactionTreasuries, parseAllFactionDiplomacy } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  "t0 (vanilla)": "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_t0.sav",
  "Autosave Rep Rome T5 (vanilla)": "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 5 Start.sav",
  "macedon t0 (RIS)": "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
};

// Vanilla descr_sm_factions lives with the base game data; we don't have a
// guaranteed path. Instead, harvest the faction names directly from the save
// by reading the diplo-zone owners via the player-zone byte heuristic is hard
// without order. So just scan for senate-related ASCII tokens.
const SENATE_TOKENS = ["senate", "spqr", "roman_senate", "s_p_q_r"];
const ROMAN_TOKENS = ["romans_julii", "romans_brutii", "romans_scipii", "romans_senate"];
const MISSION_TOKENS = ["mission", "senate_mission", "reward", "expansion", "sponsor"];

function countToken(buf, tok) {
  let n = 0, p = 0; const t = Buffer.from(tok, "latin1");
  while ((p = buf.indexOf(t, p)) !== -1) { n++; p += t.length; }
  return n;
}

for (const [label, path] of Object.entries(SAVES)) {
  let buf;
  try { buf = fs.readFileSync(path); } catch { console.log(`\n### ${label}: NOT FOUND`); continue; }
  console.log(`\n############ ${label} ############`);
  console.log("senate tokens:", SENATE_TOKENS.map((t) => `${t}=${countToken(buf, t)}`).join("  "));
  console.log("roman tokens: ", ROMAN_TOKENS.map((t) => `${t}=${countToken(buf, t)}`).join("  "));
  console.log("mission tokens:", MISSION_TOKENS.map((t) => `${t}=${countToken(buf, t)}`).join("  "));

  // Find the senate faction string locations (if any) and dump the bytes
  // around the first occurrence to see structure.
  for (const tok of ["roman_senate", "senate"]) {
    const t = Buffer.from(tok + "\0", "latin1");
    const at = buf.indexOf(t);
    if (at !== -1) {
      console.log(`  "${tok}\\0" first at 0x${at.toString(16)}`);
    }
  }

  // How many total 0x39240005 zones (faction count w/ relations)?
  const recs = parseFactionTreasuries(buf);
  let zones = 0;
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x39240005) continue;
    const c = buf.readUInt32LE(i + 4); if (c > 0 && c <= 250) zones++;
  }
  console.log(`  major faction records (class-100): ${recs.length},  total 0x39240005 zones: ${zones}`);
}
